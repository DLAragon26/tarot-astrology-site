import type { D1Database } from '@cloudflare/workers-types';

// C2 登录限流：按 IP+用户名 计数失败尝试，连续失败达上限后锁定一段时间。
// 只针对未认证端点（/api/login、/api/redeem）的凭据类失败（401）；校验错误（400）不计。
// attempt_key 存 SHA-256 摘要，不落原文 IP/用户名。

export const LOGIN_MAX_FAILURES = 5;
export const LOGIN_LOCK_MINUTES = 15;

interface AttemptRow {
  fail_count: number;
  locked_until: string | null;
}

async function attemptKey(request: Request, username: string): Promise<string> {
  const ip =
    request.headers.get('CF-Connecting-IP') ??
    request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim() ??
    'unknown';
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${ip}|${username.trim().toLowerCase()}`));
  const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `login:${hex}`;
}

export interface LockState {
  locked: boolean;
  retryAfterSec: number;
}

export async function getLockState(DB: D1Database, request: Request, username: string): Promise<LockState> {
  if (!username) return { locked: false, retryAfterSec: 0 };
  const key = await attemptKey(request, username);
  const row = await DB.prepare('SELECT fail_count, locked_until FROM login_attempts WHERE attempt_key = ?')
    .bind(key)
    .first<AttemptRow>();
  if (!row?.locked_until) return { locked: false, retryAfterSec: 0 };
  const until = Date.parse(row.locked_until);
  if (!Number.isFinite(until) || until <= Date.now()) return { locked: false, retryAfterSec: 0 };
  return { locked: true, retryAfterSec: Math.max(Math.ceil((until - Date.now()) / 1000), 1) };
}

/** 记一次凭据失败；累计达到上限时锁定 */
export async function recordLoginFailure(DB: D1Database, request: Request, username: string): Promise<void> {
  if (!username) return;
  const key = await attemptKey(request, username);
  const now = new Date().toISOString();
  const lockUntil = new Date(Date.now() + LOGIN_LOCK_MINUTES * 60000).toISOString();
  await DB.prepare(
    `INSERT INTO login_attempts (attempt_key, fail_count, locked_until, updated_at)
     VALUES (?, 1, NULL, ?)
     ON CONFLICT (attempt_key) DO UPDATE SET
       fail_count = fail_count + 1,
       locked_until = CASE
         WHEN login_attempts.fail_count + 1 >= ?
           THEN ?
         ELSE login_attempts.locked_until
       END,
       updated_at = ?`
  )
    .bind(key, now, LOGIN_MAX_FAILURES, lockUntil, now)
    .run();
}

/** 登录成功：清除该键的失败计数 */
export async function clearLoginFailures(DB: D1Database, request: Request, username: string): Promise<void> {
  if (!username) return;
  const key = await attemptKey(request, username);
  await DB.prepare('DELETE FROM login_attempts WHERE attempt_key = ?').bind(key).run();
}

/** 定期清理（scheduled）：删除超过 24h 未更新且未在锁定期内的记录 */
export async function cleanupLoginAttempts(DB: D1Database): Promise<void> {
  const cutoff = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  await DB.prepare(
    "DELETE FROM login_attempts WHERE updated_at < ? AND (locked_until IS NULL OR locked_until <= ?)"
  )
    .bind(cutoff, cutoff)
    .run();
}

/** 过期 session 清理（C3，同一 scheduled 调用） */
export async function cleanupExpiredSessions(DB: D1Database): Promise<void> {
  await DB.prepare('DELETE FROM sessions WHERE expires_at <= ?').bind(new Date().toISOString()).run();
}
