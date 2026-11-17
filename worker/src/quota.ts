import { DEFAULT_DAILY_AI_LIMIT, FALLBACK_GLOBAL_DAILY_AI_LIMIT, nextShanghaiMidnightISO, shanghaiDate } from '@tarot/shared';
import type { Env } from './env';

// AI 额度：按 Asia/Shanghai 午夜重置。
// 用户限额：users.daily_ai_limit（NULL = 默认 0）；管理员也必须获得显式分配。
// 全局限额：settings.global_daily_ai_limit → env.GLOBAL_DAILY_AI_LIMIT → 常量 200。
//
// C1 原子性：个人与全站额度都用「带 WHERE guard 的 INSERT..ON CONFLICT..UPDATE」单条自增，
// 以 meta.changes 判断是否成功，从根上消除「先查后加」的并发超发。
// AI 失败退还（releaseQuota）按 MAX(count-1, 0) 双表同时回退。

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

/** 全站今日用量：读 global_ai_usage 单行（0004 迁移后为权威来源） */
export async function getGlobalUsage(DB: D1Database, date = shanghaiDate()): Promise<number> {
  const row = await DB.prepare('SELECT count FROM global_ai_usage WHERE usage_date = ?')
    .bind(date)
    .first<{ count: number }>();
  return row?.count ?? 0;
}

export async function getUserUsageTotal(DB: D1Database, userId: string): Promise<number> {
  const row = await DB.prepare('SELECT COALESCE(SUM(count), 0) AS total FROM ai_usage WHERE user_id = ?')
    .bind(userId)
    .first<{ total: number }>();
  return row?.total ?? 0;
}

/**
 * 原子占用个人额度：count < limit 才自增成功。
 * @returns true = 占用成功（本次调用获得一个名额）
 */
export async function tryConsumeUserQuota(DB: D1Database, userId: string, limit: number, date = shanghaiDate()): Promise<boolean> {
  // 首插同样受 limit 约束（limit=0 时不插入），冲突分支再叠加 count < limit 的 guard。
  const res = await DB.prepare(
    `INSERT INTO ai_usage (user_id, usage_date, count)
     SELECT ?, ?, 1 WHERE ? > 0
     ON CONFLICT (user_id, usage_date) DO UPDATE SET count = count + 1
     WHERE ai_usage.count < ?`
  )
    .bind(userId, date, limit, limit)
    .run();
  return Number(res.meta?.changes ?? 0) === 1;
}

/** 原子占用全站额度：count < globalLimit 才自增成功 */
export async function tryConsumeGlobalQuota(DB: D1Database, globalLimit: number, date = shanghaiDate()): Promise<boolean> {
  const res = await DB.prepare(
    `INSERT INTO global_ai_usage (usage_date, count)
     SELECT ?, 1 WHERE ? > 0
     ON CONFLICT (usage_date) DO UPDATE SET count = count + 1
     WHERE global_ai_usage.count < ?`
  )
    .bind(date, globalLimit, globalLimit)
    .run();
  return Number(res.meta?.changes ?? 0) === 1;
}

/** 退还个人额度（全站占用失败时只回退个人，全站此时并未自增） */
export async function releaseUserQuota(DB: D1Database, userId: string, date = shanghaiDate()): Promise<void> {
  await DB.prepare('UPDATE ai_usage SET count = MAX(count - 1, 0) WHERE user_id = ? AND usage_date = ?')
    .bind(userId, date)
    .run();
}

/** 退还全站额度 */
export async function releaseGlobalQuota(DB: D1Database, date = shanghaiDate()): Promise<void> {
  await DB.prepare('UPDATE global_ai_usage SET count = MAX(count - 1, 0) WHERE usage_date = ?')
    .bind(date)
    .run();
}

/** AI 调用失败时退还当次用量：个人与全站同时回退（下限 0） */
export async function releaseQuota(DB: D1Database, userId: string, date = shanghaiDate()): Promise<void> {
  await releaseUserQuota(DB, userId, date);
  await releaseGlobalQuota(DB, date);
}

/** 成功调用后累加 token 用量（B5 成本观测；行必然已由 tryConsumeUserQuota 创建） */
export async function recordTokenUsage(
  DB: D1Database,
  userId: string,
  promptTokens: number,
  completionTokens: number,
  date = shanghaiDate()
): Promise<void> {
  if (!Number.isFinite(promptTokens) || !Number.isFinite(completionTokens)) return;
  if (promptTokens <= 0 && completionTokens <= 0) return;
  await DB.prepare(
    `UPDATE ai_usage SET prompt_tokens = prompt_tokens + ?, completion_tokens = completion_tokens + ?
     WHERE user_id = ? AND usage_date = ?`
  )
    .bind(Math.max(Math.floor(promptTokens), 0), Math.max(Math.floor(completionTokens), 0), userId, date)
    .run();
}

/** token 用量合计（userId = null 时为全站） */
export async function getTokensTotal(DB: D1Database, userId: string | null): Promise<number> {
  const where = userId ? 'WHERE user_id = ?' : '';
  const row = await DB.prepare(`SELECT COALESCE(SUM(prompt_tokens + completion_tokens), 0) AS t FROM ai_usage ${where}`)
    .bind(...(userId ? [userId] : []))
    .first<{ t: number }>();
  return row?.t ?? 0;
}

export async function getTokensForDate(DB: D1Database, date: string): Promise<number> {
  const row = await DB.prepare('SELECT COALESCE(SUM(prompt_tokens + completion_tokens), 0) AS t FROM ai_usage WHERE usage_date = ?')
    .bind(date)
    .first<{ t: number }>();
  return row?.t ?? 0;
}

export function resetAtISO(): string {
  return nextShanghaiMidnightISO();
}
