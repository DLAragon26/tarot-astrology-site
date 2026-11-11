import { DEFAULT_DAILY_AI_LIMIT, FALLBACK_GLOBAL_DAILY_AI_LIMIT, nextShanghaiMidnightISO, shanghaiDate } from '@tarot/shared';
import type { Env } from './env';

// AI 额度：按 Asia/Shanghai 午夜重置。
// 用户限额：users.daily_ai_limit（NULL = 默认 20）；admin 无上限。
// 全局限额：settings.global_daily_ai_limit → env.GLOBAL_DAILY_AI_LIMIT → 常量 200。

export async function getUserDailyLimit(DB: D1Database, dailyAiLimit: number | null): Promise<number> {
  if (typeof dailyAiLimit === 'number' && dailyAiLimit >= 0) return dailyAiLimit;
  return DEFAULT_DAILY_AI_LIMIT;
}

/**
 * 全站每日 AI 上限，优先级：settings 表 > env.GLOBAL_DAILY_AI_LIMIT > 常量 200。
 * settings 由部署后在 D1 里调整（运行时配置）；env 是部署配置的回落。
 */
export async function getGlobalDailyLimit(DB: D1Database, env?: Env): Promise<number> {
  const row = await DB.prepare("SELECT value FROM settings WHERE key = 'global_daily_ai_limit'").first<{ value: string }>();
  if (row) {
    const n = Number(row.value);
    if (Number.isFinite(n) && n >= 0) return n;
  }
  if (env?.GLOBAL_DAILY_AI_LIMIT !== undefined && env.GLOBAL_DAILY_AI_LIMIT !== '') {
    const fromEnv = Number(env.GLOBAL_DAILY_AI_LIMIT);
    if (Number.isFinite(fromEnv) && fromEnv >= 0) return fromEnv;
  }
  return FALLBACK_GLOBAL_DAILY_AI_LIMIT;
}

export async function getUserUsage(DB: D1Database, userId: string, date = shanghaiDate()): Promise<number> {
  const row = await DB.prepare('SELECT count FROM ai_usage WHERE user_id = ? AND usage_date = ?')
    .bind(userId, date)
    .first<{ count: number }>();
  return row?.count ?? 0;
}

export async function getGlobalUsage(DB: D1Database, date = shanghaiDate()): Promise<number> {
  const row = await DB.prepare('SELECT COALESCE(SUM(count), 0) AS total FROM ai_usage WHERE usage_date = ?')
    .bind(date)
    .first<{ total: number }>();
  return row?.total ?? 0;
}

export async function getUserUsageTotal(DB: D1Database, userId: string): Promise<number> {
  const row = await DB.prepare('SELECT COALESCE(SUM(count), 0) AS total FROM ai_usage WHERE user_id = ?')
    .bind(userId)
    .first<{ total: number }>();
  return row?.total ?? 0;
}

export async function incrementUsage(DB: D1Database, userId: string, date = shanghaiDate()): Promise<void> {
  await DB.prepare(
    `INSERT INTO ai_usage (user_id, usage_date, count) VALUES (?, ?, 1)
     ON CONFLICT (user_id, usage_date) DO UPDATE SET count = count + 1`
  )
    .bind(userId, date)
    .run();
}

/** AI 调用失败时退还当次用量 */
export async function decrementUsage(DB: D1Database, userId: string, date = shanghaiDate()): Promise<void> {
  await DB.prepare(
    `UPDATE ai_usage SET count = MAX(count - 1, 0) WHERE user_id = ? AND usage_date = ?`
  )
    .bind(userId, date)
    .run();
}

export function resetAtISO(): string {
  return nextShanghaiMidnightISO();
}
