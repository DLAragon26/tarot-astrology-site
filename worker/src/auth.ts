import { SESSION_COOKIE_NAME, SESSION_TTL_SECONDS } from '@tarot/shared';
import type { Context, MiddlewareHandler } from 'hono';
import type { Env } from './env';

// 密码与 session。密码哈希：PBKDF2-SHA256（100k 迭代、16B salt、32B 派生键），
// Workers WebCrypto 原生可跑。session token 只在 D1 存 SHA-256 摘要，
// cookie 值 = token + '.' + HMAC-SHA256(token, SESSION_SECRET)。

export interface UserRow {
  id: string;
  username: string;
  password_hash: string;
  role: 'admin' | 'member';
  daily_ai_limit: number | null;
  is_active: number;
  must_change_password: number;
  created_at: string;
  updated_at: string;
}

const enc = new TextEncoder();

function toBase64Url(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function pbkdf2(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations },
    key,
    256
  );
  return new Uint8Array(bits);
}

/** Cloudflare Workers WebCrypto 当前允许的 PBKDF2 最大迭代数。 */
export const PBKDF2_ITERATIONS = 100000;

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const dk = await pbkdf2(password, salt, PBKDF2_ITERATIONS);
  return `pbkdf2$${PBKDF2_ITERATIONS}$${toBase64Url(salt)}$${toBase64Url(dk)}`;
}

/** 恒时比较，避免时序侧信道 */
export function timingSafeEqualStr(a: string, b: string): boolean {
  const ab = enc.encode(a);
  const bb = enc.encode(b);
  if (ab.length !== bb.length) {
    // 长度不同也要走完一次比较
    let x = 1;
    for (let i = 0; i < bb.length; i++) x |= bb[i] ^ bb[i];
    return false;
  }
  let diff = 0;
  for (let i = 0; i < ab.length; i++) diff |= ab[i] ^ bb[i];
  return diff === 0;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2') return false;
  const iterations = Number(parts[1]);
  const salt = fromBase64Url(parts[2]);
  const expect = parts[3];
  const dk = await pbkdf2(password, salt, iterations);
  return timingSafeEqualStr(toBase64Url(dk), expect);
}

export async function sha256Base64Url(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', enc.encode(input));
  return toBase64Url(digest);
}

async function hmacBase64Url(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  return toBase64Url(sig);
}

// ---------- session ----------

export function randomToken(): string {
  return toBase64Url(crypto.getRandomValues(new Uint8Array(32)));
}

function nowISO(): string {
  return new Date().toISOString();
}

export async function createSession(DB: D1Database, env: Env, userId: string): Promise<string> {
  const token = randomToken();
  const tokenHash = await sha256Base64Url(token);
  const mac = await hmacBase64Url(env.SESSION_SECRET, token);
  const expires = new Date(Date.now() + SESSION_TTL_SECONDS * 1000).toISOString();
  await DB.prepare('INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)')
    .bind(tokenHash, userId, expires, nowISO())
    .run();
  return `${token}.${mac}`;
}

export async function destroySession(DB: D1Database, env: Env, sessionValue: string | undefined): Promise<void> {
  const token = await verifySessionValue(env, sessionValue);
  if (!token) return;
  const tokenHash = await sha256Base64Url(token);
  await DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(tokenHash).run();
}

async function verifySessionValue(env: Env, sessionValue: string | undefined): Promise<string | null> {
  if (!sessionValue) return null;
  const idx = sessionValue.indexOf('.');
  if (idx <= 0) return null;
  const token = sessionValue.slice(0, idx);
  const mac = sessionValue.slice(idx + 1);
  const expect = await hmacBase64Url(env.SESSION_SECRET, token);
  return timingSafeEqualStr(mac, expect) ? token : null;
}

function readCookie(request: Request, name: string): string | undefined {
  const header = request.headers.get('Cookie');
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k === name) return rest.join('=');
  }
  return undefined;
}

function readBearer(request: Request): string | undefined {
  const header = request.headers.get('Authorization');
  if (!header?.startsWith('Bearer ')) return undefined;
  const value = header.slice('Bearer '.length).trim();
  return value.length > 0 && value.length <= 512 ? value : undefined;
}

/** Authorization Bearer 优先，Cookie 作为兼容回退。 */
export function requestSessionValue(request: Request): string | undefined {
  return readBearer(request) ?? readCookie(request, SESSION_COOKIE_NAME);
}

export function sessionCookieHeader(env: Env, value: string): string {
  const secure = (env.COOKIE_SECURE ?? 'true') !== 'false';
  // GitHub Pages 与 workers.dev 属于不同站点，生产必须用 SameSite=None。
  const attrs = [`HttpOnly`, `SameSite=${secure ? 'None' : 'Lax'}`, `Path=/`, `Max-Age=${SESSION_TTL_SECONDS}`];
  if (secure) attrs.push('Secure');
  return `${SESSION_COOKIE_NAME}=${value}; ${attrs.join('; ')}`;
}

export function clearCookieHeader(env: Env): string {
  const secure = (env.COOKIE_SECURE ?? 'true') !== 'false';
  const attrs = [`HttpOnly`, `SameSite=${secure ? 'None' : 'Lax'}`, `Path=/`, `Max-Age=0`];
  if (secure) attrs.push('Secure');
  return `${SESSION_COOKIE_NAME}=; ${attrs.join('; ')}`;
}

/** 从请求解析 session 并加载用户；无效/过期/禁用一律返回 null */
export async function getSessionUser(DB: D1Database, env: Env, request: Request): Promise<UserRow | null> {
  const token = await verifySessionValue(env, requestSessionValue(request));
  if (!token) return null;
  const tokenHash = await sha256Base64Url(token);
  const row = await DB.prepare(
    `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = ? AND s.expires_at > ? AND u.is_active = 1`
  )
    .bind(tokenHash, nowISO())
    .first<UserRow>();
  return row ?? null;
}

export function toPublicUser(u: UserRow) {
  return {
    id: u.id,
    username: u.username,
    role: u.role,
    daily_ai_limit: u.daily_ai_limit,
    must_change_password: u.must_change_password === 1,
    created_at: u.created_at,
  };
}

// ---------- 权限中间件 ----------

type Vars = { user: UserRow };

export const requireAuth: MiddlewareHandler<{ Bindings: Env; Variables: Vars }> = async (c, next) => {
  const user = await getSessionUser(c.env.DB, c.env, c.req.raw);
  if (!user) {
    return c.json({ error: { code: 'UNAUTHENTICATED', message: '请先登录' } }, 401);
  }
  c.set('user', user);
  await next();
};

export const requireAdmin: MiddlewareHandler<{ Bindings: Env; Variables: Vars }> = async (c, next) => {
  const user = c.get('user');
  if (!user || user.role !== 'admin') {
    return c.json({ error: { code: 'NOT_ADMIN', message: '需要管理员权限' } }, 403);
  }
  await next();
};

// ---------- 管理员引导（惰性创建） ----------

/**
 * 仅当 users 表为空且 username=admin 且密码等于 ADMIN_INITIAL_PASSWORD 时，
 * 创建首个 admin 账号（must_change_password=1）。secret 只存在于 Cloudflare Secrets / .dev.vars。
 */
export async function bootstrapAdminIfNeeded(DB: D1Database, env: Env, username: string, password: string): Promise<UserRow | null> {
  if (!env.ADMIN_INITIAL_PASSWORD) return null;
  const count = await DB.prepare('SELECT COUNT(*) AS n FROM users').first<{ n: number }>();
  if (!count || count.n > 0) return null;
  if (username !== 'admin') return null;
  if (!timingSafeEqualStr(password, env.ADMIN_INITIAL_PASSWORD)) return null;
  const id = crypto.randomUUID();
  const hash = await hashPassword(password);
  const ts = nowISO();
  await DB.prepare(
    `INSERT INTO users (id, username, password_hash, role, daily_ai_limit, is_active, must_change_password, created_at, updated_at)
     VALUES (?, ?, ?, 'admin', NULL, 1, 1, ?, ?)`
  )
    .bind(id, 'admin', hash, ts, ts)
    .run();
  return (await DB.prepare('SELECT * FROM users WHERE id = ?').bind(id).first<UserRow>()) ?? null;
}
