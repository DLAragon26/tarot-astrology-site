import type { Env } from '../src/env';
import app from '../src/index';
import { createTestDb } from './helpers/minid1';

export function makeEnv(overrides: Partial<Env> = {}): Env {
  return {
    DB: createTestDb(),
    API_BASE_URL: 'https://ai.test/v1',
    API_KEY: 'test-only-placeholder-key',
    MODEL_NAME: 'test-model',
    MAX_TOKENS: '100',
    TEMPERATURE: '0.5',
    SITE_ACCESS_KEY: 'test-site-key',
    SESSION_SECRET: 'test-session-secret',
    ADMIN_INITIAL_PASSWORD: 'test-admin-initial-pw',
    GLOBAL_DAILY_AI_LIMIT: '200',
    ALLOWED_ORIGINS: 'https://pages.test',
    COOKIE_SECURE: 'false',
    ...overrides,
  } as Env;
}

export const ADMIN_LOGIN = { site_access_key: 'test-site-key', username: 'admin', password: 'test-admin-initial-pw' };
export const MEMBER_PW = 'member-pw-123456';

export async function login(
  env: Env,
  body: Record<string, string>
): Promise<{ res: Response; cookie: string }> {
  const res = await appRequest(env)('/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const setCookie = res.headers.get('Set-Cookie') ?? '';
  const m = setCookie.match(/tq_session=([^;]+)/);
  return { res, cookie: m ? `tq_session=${m[1]}` : '' };
}

type Fetcher = (path: string, init?: RequestInit) => Promise<Response>;

/** 所有请求共享同一个 env（同一个 D1 内存库） */
export function appRequest(env: Env): Fetcher {
  return (path, init = {}) => app.request(path, init, env);
}

export async function setupAdmin(): Promise<{ env: Env; req: Fetcher; adminCookie: string }> {
  const env = makeEnv();
  const req = appRequest(env);
  const { res, cookie } = await login(env, ADMIN_LOGIN);
  if (res.status !== 200) throw new Error(`admin bootstrap failed: ${res.status}`);
  return { env, req, adminCookie: cookie };
}

export async function createMember(
  req: Fetcher,
  adminCookie: string,
  username: string,
  opts: { daily_ai_limit?: number | null } = {}
): Promise<{ id: string }> {
  const res = await req('/api/admin/users', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
    body: JSON.stringify({ username, password: MEMBER_PW, daily_ai_limit: opts.daily_ai_limit ?? null }),
  });
  if (res.status !== 201) throw new Error(`create member failed: ${res.status}`);
  const body = (await res.json()) as { user: { id: string } };
  return body.user;
}

export async function loginMember(env: Env, username: string): Promise<string> {
  const { res, cookie } = await login(env, { site_access_key: 'test-site-key', username, password: MEMBER_PW });
  if (res.status !== 200) throw new Error(`member login failed: ${res.status}`);
  return cookie;
}

export const THREE_CARDS_PAYLOAD = {
  mode: 'online',
  question: '测试问题：最近的工作状态如何？',
  spread: 'three-card',
  cards: [
    { position: 'past', card: 'rw-00-fool', orientation: 'upright' },
    { position: 'present', card: 'rw-10-wheel-of-fortune', orientation: 'reversed' },
    { position: 'future', card: 'rw-19-sun', orientation: 'upright' },
  ],
};

export function aiOkResponse(text = '这是一段测试解读。'): string {
  return JSON.stringify({ choices: [{ message: { content: text } }] });
}
