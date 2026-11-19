import {
  ERR,
  validatePassword,
  validateUsername,
  type LoginRequest,
  type RedeemRequest,
} from '@tarot/shared';
import { Hono } from 'hono';
import type { Env } from '../env';
import {
  bootstrapAdminIfNeeded,
  clearCookieHeader,
  createSession,
  destroySession,
  requestSessionValue,
  requireAuth,
  sessionCookieHeader,
  timingSafeEqualStr,
  toPublicUser,
  verifyPassword,
  type UserRow,
} from '../auth';
import { clearLoginFailures, getLockState, recordLoginFailure } from '../limiter';

export const authRoutes = new Hono<{ Bindings: Env; Variables: { user: UserRow } }>();

function nowISO(): string {
  return new Date().toISOString();
}

function siteKeyOk(env: Env, key: unknown): boolean {
  return typeof key === 'string' && key.length > 0 && timingSafeEqualStr(key, env.SITE_ACCESS_KEY);
}

/** C2：锁定中 → 429（带 Retry-After）；不泄露账号是否存在 */
function lockedResponse(retryAfterSec: number): Response {
  return new Response(
    JSON.stringify({
      error: { code: ERR.RATE_LIMITED, message: `尝试次数过多，请约 ${Math.ceil(retryAfterSec / 60)} 分钟后再试。` },
    }),
    {
      status: 429,
      headers: { 'Content-Type': 'application/json', 'Retry-After': String(retryAfterSec) },
    }
  );
}

// POST /api/login — 站点访问密钥 + 用户名 + 密码；无公开注册。
authRoutes.post('/login', async (c) => {
  let body: Partial<LoginRequest>;
  try {
    body = (await c.req.json()) as Partial<LoginRequest>;
  } catch {
    return c.json({ error: { code: ERR.VALIDATION, message: '请求体必须是 JSON' } }, 400);
  }
  const attemptUsername = typeof body.username === 'string' ? body.username : '';
  const lock = await getLockState(c.env.DB, c.req.raw, attemptUsername);
  if (lock.locked) return lockedResponse(lock.retryAfterSec);

  if (!siteKeyOk(c.env, body.site_access_key)) {
    await recordLoginFailure(c.env.DB, c.req.raw, attemptUsername);
    return c.json({ error: { code: ERR.SITE_KEY, message: '站点访问密钥、用户名或密码不正确' } }, 401);
  }
  const username = validateUsername(body.username);
  const password = body.password;
  if (!username || typeof password !== 'string' || password.length === 0) {
    return c.json({ error: { code: 'INVALID_CREDENTIALS', message: '站点访问密钥、用户名或密码不正确' } }, 401);
  }

  const bootstrapped = await bootstrapAdminIfNeeded(c.env.DB, c.env, username, password);
  const user =
    bootstrapped ??
    (await c.env.DB.prepare('SELECT * FROM users WHERE username = ?').bind(username).first<UserRow>());

  if (!user || user.is_active !== 1) {
    await recordLoginFailure(c.env.DB, c.req.raw, username);
    return c.json({ error: { code: 'INVALID_CREDENTIALS', message: '站点访问密钥、用户名或密码不正确' } }, 401);
  }
  const ok = await verifyPassword(password, user.password_hash);
  if (!ok) {
    await recordLoginFailure(c.env.DB, c.req.raw, username);
    return c.json({ error: { code: 'INVALID_CREDENTIALS', message: '站点访问密钥、用户名或密码不正确' } }, 401);
  }

  await clearLoginFailures(c.env.DB, c.req.raw, username);
  const cookieValue = await createSession(c.env.DB, c.env, user.id);
  c.header('Set-Cookie', sessionCookieHeader(c.env, cookieValue));
  c.header('Cache-Control', 'no-store');
  return c.json({ user: toPublicUser(user), session_token: cookieValue });
});

// POST /api/logout
authRoutes.post('/logout', async (c) => {
  await destroySession(c.env.DB, c.env, requestSessionValue(c.req.raw));
  c.header('Set-Cookie', clearCookieHeader(c.env));
  c.header('Cache-Control', 'no-store');
  return c.json({ ok: true });
});

// GET /api/me
authRoutes.get('/me', requireAuth, (c) => {
  const user = c.get('user');
  return c.json({ user: toPublicUser(user) });
});

// POST /api/redeem — 邀请码激活（无公开注册的闭环：管理员发码，受邀人自设密码）。
authRoutes.post('/redeem', async (c) => {
  let body: Partial<RedeemRequest>;
  try {
    body = (await c.req.json()) as Partial<RedeemRequest>;
  } catch {
    return c.json({ error: { code: ERR.VALIDATION, message: '请求体必须是 JSON' } }, 400);
  }
  if (!siteKeyOk(c.env, body.site_access_key)) {
    const redeemUser = typeof body.username === 'string' ? body.username : '';
    await recordLoginFailure(c.env.DB, c.req.raw, redeemUser);
    return c.json({ error: { code: ERR.SITE_KEY, message: '站点访问密钥不正确' } }, 401);
  }
  const code = typeof body.invite_code === 'string' ? body.invite_code.trim() : '';
  const username = validateUsername(body.username);
  const password = validatePassword(body.password);
  if (!code) return c.json({ error: { code: ERR.VALIDATION, message: '邀请码不能为空' } }, 400);
  if (!username) return c.json({ error: { code: ERR.VALIDATION, message: '用户名需为 3-32 位字母、数字或下划线' } }, 400);
  if (!password) return c.json({ error: { code: ERR.VALIDATION, message: `密码至少 ${8} 位` } }, 400);

  const invite = await c.env.DB.prepare('SELECT * FROM invite_codes WHERE code = ?').bind(code).first<{
    code: string;
    status: string;
    expires_at: string | null;
  }>();
  if (
    !invite ||
    invite.status !== 'active' ||
    (invite.expires_at !== null && Date.parse(invite.expires_at) <= Date.now())
  ) {
    return c.json({ error: { code: ERR.VALIDATION, message: '邀请码无效、已过期或已被使用' } }, 400);
  }
  const existing = await c.env.DB.prepare('SELECT id FROM users WHERE username = ?').bind(username).first();
  if (existing) {
    return c.json({ error: { code: ERR.CONFLICT, message: '用户名已存在' } }, 409);
  }

  const { hashPassword } = await import('../auth');
  const id = crypto.randomUUID();
  const ts = nowISO();
  const hash = await hashPassword(password);
  const stmts = [
    c.env.DB.prepare(
      `UPDATE invite_codes SET status = 'redeemed', redeemed_at = ?
       WHERE code = ? AND status = 'active' AND (expires_at IS NULL OR expires_at > ?)`
    ).bind(ts, code, ts),
    c.env.DB.prepare(
      `INSERT INTO users (id, username, password_hash, role, daily_ai_limit, is_active, must_change_password, created_at, updated_at)
       SELECT ?, ?, ?, 'member', NULL, 1, 0, ?, ? WHERE changes() = 1`
    ).bind(id, username, hash, ts, ts),
    c.env.DB.prepare(
      `UPDATE invite_codes SET redeemed_by = ?
       WHERE code = ? AND status = 'redeemed' AND redeemed_at = ? AND changes() = 1`
    ).bind(id, code, ts),
  ];
  const results = await c.env.DB.batch(stmts);
  const userInserted = Number(results[1]?.meta?.changes ?? 0) === 1;
  if (!userInserted) {
    return c.json({ error: { code: ERR.CONFLICT, message: '邀请码无效、已过期或已被使用' } }, 400);
  }
  await clearLoginFailures(c.env.DB, c.req.raw, username);
  const cookieValue = await createSession(c.env.DB, c.env, id);
  c.header('Set-Cookie', sessionCookieHeader(c.env, cookieValue));
  c.header('Cache-Control', 'no-store');
  return c.json(
    {
      user: { id, username, role: 'member', daily_ai_limit: null, must_change_password: false, created_at: ts },
      session_token: cookieValue,
    },
    201
  );
});
