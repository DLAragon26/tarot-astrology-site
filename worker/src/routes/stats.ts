import type { CountRow, ReadingStats, QuotaInfo } from '@tarot/shared';
import { getCard, parseDrawnCardsJson } from '@tarot/shared';
import { Hono } from 'hono';
import type { UserRow } from '../auth';
import type { Env } from '../env';
import {
  getGlobalDailyLimit,
  getGlobalUsage,
  getUserDailyLimit,
  getUserUsage,
  getTokensTotal,
  resetAtISO,
  getUserUsageTotal,
} from '../quota';

export const statsRoutes = new Hono<{ Bindings: Env; Variables: { user: UserRow } }>();

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** 最近 12 个月（Asia/Shanghai）序列补齐 */
function last12Months(now = new Date()): string[] {
  const months: string[] = [];
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  for (let i = 0; i < 12; i++) {
    const shifted = new Date(d.getTime() + 8 * 3600 * 1000);
    months.push(`${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}`);
    d.setUTCMonth(d.getUTCMonth() - 1);
  }
  return months.reverse();
}

/** ISO 时间 → Asia/Shanghai 月份 YYYY-MM */
function shanghaiMonth(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  const d = new Date(t + 8 * 3600 * 1000);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`;
}

interface StatRow {
  created_at: string;
  mode: string;
  spread: string;
  topic_tag: string | null;
  cards: string;
}

/**
 * 统计在 JS 侧聚合：一次读取记录后在内存统计，不依赖各 SQLite 变体对 JSON 表函数
 * 与 GROUP BY 绑定参数的行为差异（本地 node:sqlite 与 Cloudflare D1 必须一致）。
 * 私人站点数据量小，全表读取足够；将来数据量增大可改为按时间窗分批。
 */
async function aggregateStats(DB: D1Database, userId: string | null): Promise<Omit<ReadingStats, 'scope'>> {
  const where = userId ? 'WHERE user_id = ?' : '';
  const rows = await DB.prepare(`SELECT created_at, mode, spread, topic_tag, cards FROM readings ${where}`)
    .bind(...(userId ? [userId] : []))
    .all<StatRow>();
  const list = rows.results ?? [];

  const byMode = new Map<string, number>();
  const bySpread = new Map<string, number>();
  const byTopic = new Map<string, number>();
  const byMonth = new Map<string, number>();
  const byCard = new Map<string, number>();
  let upright = 0;
  let reversed = 0;

  for (const r of list) {
    byMode.set(r.mode, (byMode.get(r.mode) ?? 0) + 1);
    bySpread.set(r.spread, (bySpread.get(r.spread) ?? 0) + 1);
    if (r.topic_tag) byTopic.set(r.topic_tag, (byTopic.get(r.topic_tag) ?? 0) + 1);
    const m = shanghaiMonth(r.created_at);
    if (m) byMonth.set(m, (byMonth.get(m) ?? 0) + 1);
    const cards = parseDrawnCardsJson(r.cards) ?? [];
    for (const c of cards) {
      byCard.set(c.card, (byCard.get(c.card) ?? 0) + 1);
      if (c.orientation === 'upright') upright++;
      else reversed++;
    }
  }

  const toSorted = (m: Map<string, number>): CountRow[] =>
    [...m.entries()]
      .map(([key, count]) => ({ key, count }))
      .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));

  const aiTotal = userId
    ? await getUserUsageTotal(DB, userId)
    : ((
        await DB.prepare('SELECT COALESCE(SUM(count), 0) AS t FROM ai_usage').first<{ t: number }>()
      )?.t ?? 0);

  const months = last12Months();
  const tokensTotal = await getTokensTotal(DB, userId);

  return {
    total: list.length,
    by_month: months.map((m) => ({ key: m, count: byMonth.get(m) ?? 0 })),
    by_mode: toSorted(byMode),
    by_topic: toSorted(byTopic),
    by_spread: toSorted(bySpread),
    top_cards: [...byCard.entries()]
      .map(([card, count]) => ({ card, nameZh: getCard(card)?.nameZh ?? card, count }))
      .sort((a, b) => b.count - a.count || a.card.localeCompare(b.card))
      .slice(0, 10),
    orientations: { upright, reversed },
    ai_used_total: aiTotal,
    ai_used_today: 0,
    ai_tokens_total: tokensTotal,
  };
}

// GET /api/stats?scope=all（scope=all 仅 admin）
statsRoutes.get('/', async (c) => {
  const user = c.get('user');
  const wantAll = c.req.query('scope') === 'all' && user.role === 'admin';
  const agg = await aggregateStats(c.env.DB, wantAll ? null : user.id);
  const aiToday = wantAll ? await getGlobalUsage(c.env.DB) : await getUserUsage(c.env.DB, user.id);
  const stats: ReadingStats = { scope: wantAll ? 'all' : 'self', ...agg, ai_used_today: aiToday };
  return c.json({ stats });
});

// GET /api/quota
export const quotaRoutes = new Hono<{ Bindings: Env; Variables: { user: UserRow } }>();

quotaRoutes.get('/', async (c) => {
  const user = c.get('user');
  const dailyLimit = await getUserDailyLimit(c.env.DB, user.daily_ai_limit);
  const usedToday = await getUserUsage(c.env.DB, user.id);
  const globalLimit = await getGlobalDailyLimit(c.env.DB, c.env);
  const globalUsed = await getGlobalUsage(c.env.DB);
  const quota: QuotaInfo = {
    daily_limit: dailyLimit,
    used_today: usedToday,
    remaining: Math.max(dailyLimit - usedToday, 0),
    global_limit: globalLimit,
    global_used_today: globalUsed,
    reset_at: resetAtISO(),
  };
  return c.json({ quota });
});
