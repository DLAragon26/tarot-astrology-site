import type { CountRow, ReadingStats, QuotaInfo } from '@tarot/shared';
import { getCard } from '@tarot/shared';
import { Hono } from 'hono';
import type { UserRow } from '../auth';
import type { Env } from '../env';
import { getGlobalDailyLimit, getGlobalUsage, getUserDailyLimit, getUserUsage, resetAtISO, getUserUsageTotal } from '../quota';

export const statsRoutes = new Hono<{ Bindings: Env; Variables: { user: UserRow } }>();

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** 最近 12 个月（Asia/Shanghai，近似 +8h 修正）序列补齐 */
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

async function aggregateStats(DB: D1Database, userId: string | null): Promise<Omit<ReadingStats, 'scope'>> {
  const where = userId ? 'WHERE user_id = ?' : '';
  const args = userId ? [userId] : [];

  const totalRow = await DB.prepare(`SELECT COUNT(*) AS n FROM readings ${where}`)
    .bind(...args)
    .first<{ n: number }>();

  const byModeRows = await DB.prepare(
    `SELECT mode AS key, COUNT(*) AS count FROM readings ${where} GROUP BY mode`
  )
    .bind(...args)
    .all<CountRow>();

  const bySpreadRows = await DB.prepare(
    `SELECT spread AS key, COUNT(*) AS count FROM readings ${where} GROUP BY spread`
  )
    .bind(...args)
    .all<CountRow>();

  const byTopicSql = userId
    ? `SELECT topic_tag AS key, COUNT(*) AS count FROM readings WHERE user_id = ? AND topic_tag IS NOT NULL GROUP BY topic_tag`
    : `SELECT topic_tag AS key, COUNT(*) AS count FROM readings WHERE topic_tag IS NOT NULL GROUP BY topic_tag`;
  const byTopicRows = await DB.prepare(byTopicSql)
    .bind(...args)
    .all<CountRow>();

  const monthRows = await DB.prepare(
    `SELECT strftime('%Y-%m', datetime(created_at, '+8 hours')) AS key, COUNT(*) AS count
     FROM readings ${where ? where + ' AND' : 'WHERE'} created_at >= datetime('now', '-12 months')
     GROUP BY key`
  )
    .bind(...args)
    .all<CountRow>();

  const cardRows = await DB.prepare(
    `SELECT json_extract(je.value, '$.card') AS card, COUNT(*) AS count
     FROM readings r, json_each(r.cards) je
     ${userId ? 'WHERE r.user_id = ?' : ''}
     GROUP BY card ORDER BY count DESC LIMIT 10`
  )
    .bind(...args)
    .all<{ card: string; count: number }>();

  const orientRows = await DB.prepare(
    `SELECT json_extract(je.value, '$.orientation') AS key, COUNT(*) AS count
     FROM readings r, json_each(r.cards) je
     ${userId ? 'WHERE r.user_id = ?' : ''}
     GROUP BY key`
  )
    .bind(...args)
    .all<CountRow>();

  const aiTotal = userId
    ? await getUserUsageTotal(DB, userId)
    : ((
        await DB.prepare('SELECT COALESCE(SUM(count), 0) AS t FROM ai_usage').first<{ t: number }>()
      )?.t ?? 0);

  const months = last12Months();
  const monthMap = new Map(monthRows.results.map((r) => [r.key, r.count]));

  return {
    total: totalRow?.n ?? 0,
    by_month: months.map((m) => ({ key: m, count: monthMap.get(m) ?? 0 })),
    by_mode: byModeRows.results,
    by_topic: byTopicRows.results,
    by_spread: bySpreadRows.results,
    top_cards: cardRows.results.map((r) => ({
      card: r.card,
      nameZh: getCard(r.card)?.nameZh ?? r.card,
      count: r.count,
    })),
    orientations: {
      upright: orientRows.results.find((r) => r.key === 'upright')?.count ?? 0,
      reversed: orientRows.results.find((r) => r.key === 'reversed')?.count ?? 0,
    },
    ai_used_total: aiTotal,
    ai_used_today: 0,
  };
}

// GET /api/stats?scope=all（scope=all 仅 admin）
statsRoutes.get('/', async (c) => {
  const user = c.get('user');
  const wantAll = c.req.query('scope') === 'all' && user.role === 'admin';
  const agg = await aggregateStats(c.env.DB, wantAll ? null : user.id);
  const aiToday = wantAll
    ? await getGlobalUsage(c.env.DB)
    : await getUserUsage(c.env.DB, user.id);
  const stats: ReadingStats = { scope: wantAll ? 'all' : 'self', ...agg, ai_used_today: aiToday };
  return c.json({ stats });
});

// GET /api/quota
statsRoutes.get('/quota', async (c) => {
  const user = c.get('user');
  const dailyLimit = await getUserDailyLimit(c.env.DB, user.daily_ai_limit);
  const usedToday = await getUserUsage(c.env.DB, user.id);
  const globalLimit = await getGlobalDailyLimit(c.env.DB);
  const globalUsed = await getGlobalUsage(c.env.DB);
  const quota: QuotaInfo = {
    daily_limit: user.role === 'admin' ? -1 : dailyLimit,
    used_today: usedToday,
    remaining: user.role === 'admin' ? -1 : Math.max(dailyLimit - usedToday, 0),
    global_limit: globalLimit,
    global_used_today: globalUsed,
    reset_at: resetAtISO(),
  };
  return c.json({ quota });
});
