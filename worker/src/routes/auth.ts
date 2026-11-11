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
  requireAuth,
  sessionCookieHeader,
  timingSafeEqualStr,
  toPublicUser,
  verifyPassword,
  type UserRow,
} from '../auth';

export const authRoutes = new Hono<{ Bindings: Env; Variables: { user: UserRow } }>();

function nowISO(): string {
  return new Date().toISOString();
}

function siteKeyOk(env: Env, key: unknown): boolean {
  return typeof key === 'string' && key.length > 0 && timingSafeEqualStr(key, env.SITE_ACCESS_KEY);
}

// POST /api/login — 站点访问密钥 + 用户名 + 密码；无公开注册。
authRoutes.post('/login', async (c) => {
  let body: Partial<LoginRequest>;
  try {
    body = (await c.req.json()) as Partial<LoginRequest>;
  } catch {
    return c.json({ error: { code: ERR.VALIDATION, message: '请求体必须是 JSON' } }, 400);
  }
  if (!siteKeyOk(c.env, body.site_access_key)) {
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
    return c.json({ error: { code: 'INVALID_CREDENTIALS', message: '站点访问密钥、用户名或密码不正确' } }, 401);
  }
  const ok = await verifyPassword(password, user.password_hash);
  if (!ok) {
    return c.json({ error: { code: 'INVALID_CREDENTIALS', message: '站点访问密钥、用户名或密码不正确' } }, 401);
  }

  const cookieValue = await createSession(c.env.DB, c.env, user.id);
  c.header('Set-Cookie', sessionCookieHeader(c.env, cookieValue));
  return c.json({ user: toPublicUser(user) });
});

// POST /api/logout
authRoutes.post('/logout', async (c) => {
  await destroySession(c.env.DB, c.env, c.req.header('Cookie') ? readCookie(c.req.raw) : undefined);
  c.header('Set-Cookie', clearCookieHeader(c.env));
  return c.json({ ok: true });
});

function readCookie(request: Request): string | undefined {
  const header = request.headers.get('Cookie');
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k === 'tq_session') return rest.join('=');
  }
  return undefined;
}

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
  }>();
  if (!invite || invite.status !== 'active') {
    return c.json({ error: { code: ERR.VALIDATION, message: '邀请码无效或已被使用' } }, 400);
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
      `INSERT INTO users (id, username, password_hash, role, daily_ai_limit, is_active, must_change_password, created_at, updated_at)
       VALUES (?, ?, ?, 'member', NULL, 1, 0, ?, ?)`
    ).bind(id, username, hash, ts, ts),
    c.env.DB.prepare(
      `UPDATE invite_codes SET status = 'redeemed', redeemed_by = ?, redeemed_at = ? WHERE code = ? AND status = 'active'`
    ).bind(id, ts, code),
  ];
  const results = await c.env.DB.batch(stmts);
  const redeemed = results[1]?.success ?? false;
  if (!redeemed) {
    return c.json({ error: { code: ERR.CONFLICT, message: '邀请码无效或已被使用' } }, 400);
  }
  const cookieValue = await createSession(c.env.DB, c.env, id);
  c.header('Set-Cookie', sessionCookieHeader(c.env, cookieValue));
  return c.json({ user: { id, username, role: 'member', daily_ai_limit: null, must_change_password: false, created_at: ts } }, 201);
});
