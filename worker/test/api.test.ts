import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PBKDF2_ITERATIONS } from '../src/auth';
import type { Env } from '../src/env';
import {
  aiOkResponse,
  ADMIN_LOGIN,
  appRequest,
  createMember,
  login,
  loginMember,
  makeEnv,
  MEMBER_PW,
  setupAdmin,
  sseBody,
  THREE_CARDS_PAYLOAD,
} from './helpers/env';

const ORIGIN = { Origin: 'https://pages.test' };

function jsonHeaders(cookie = ''): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json', ...ORIGIN };
  if (cookie) h.Cookie = cookie;
  return h;
}

let env: Env;
let req: ReturnType<typeof appRequest>;

beforeEach(() => {
  env = makeEnv();
  req = appRequest(env);
  vi.stubGlobal('fetch', vi.fn(async () => new Response(aiOkResponse(), { status: 200 })));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('认证与未登录防护', () => {
  it('PBKDF2 迭代数不超过 Cloudflare Workers WebCrypto 上限', () => {
    expect(PBKDF2_ITERATIONS).toBeLessThanOrEqual(100000);
  });

  it('未登录访问 readings/interpret/quota/stats 一律 401', async () => {
    const cases: [string, RequestInit][] = [
      ['/api/readings', { method: 'GET' }],
      ['/api/interpret', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }],
      ['/api/quota', { method: 'GET' }],
      ['/api/stats', { method: 'GET' }],
      ['/api/admin/users', { method: 'GET' }],
    ];
    for (const [path, init] of cases) {
      const res = await req(path, { ...init, headers: { ...(init.headers as Record<string, string>), ...ORIGIN } });
      expect(res.status, path).toBe(401);
      const body = (await res.json()) as { error: { code: string } };
      expect(body.error.code).toBe('UNAUTHENTICATED');
    }
  });

  it('站点访问密钥错误 → 401，且不泄露具体是哪一项错', async () => {
    const { res } = await login(env, { ...ADMIN_LOGIN, site_access_key: 'wrong-key' });
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { message: string } };
    expect(body.error.message).toContain('不正确');
  });

  it('首次引导：users 表为空时 admin + ADMIN_INITIAL_PASSWORD 创建管理员并要求改密', async () => {
    const { res } = await login(env, ADMIN_LOGIN);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { user: { role: string; must_change_password: boolean } };
    expect(body.user.role).toBe('admin');
    expect(body.user.must_change_password).toBe(true);
  });

  it('session cookie 属性正确（HttpOnly/SameSite=Lax/Path/Max-Age；COOKIE_SECURE=true 时含 Secure）', async () => {
    const insecure = makeEnv({ COOKIE_SECURE: 'false' });
    const res = await appRequest(insecure)('/api/login', {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify(ADMIN_LOGIN),
    });
    const setCookie = res.headers.get('Set-Cookie') ?? '';
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('SameSite=Lax');
    expect(setCookie).toContain('Path=/');
    expect(setCookie).toContain('Max-Age=604800');
    expect(setCookie).not.toContain('Secure');

    const secure = makeEnv({ COOKIE_SECURE: 'true' });
    const res2 = await appRequest(secure)('/api/login', {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify(ADMIN_LOGIN),
    });
    const setCookie2 = res2.headers.get('Set-Cookie') ?? '';
    expect(setCookie2).toContain('SameSite=None');
    expect(setCookie2).toContain('Secure');
  });

  it('logout 吊销会话', async () => {
    const { adminCookie } = await setupAdmin(env, req);
    const res = await req('/api/logout', { method: 'POST', headers: { Cookie: adminCookie, ...ORIGIN } });
    expect(res.status).toBe(200);
    const me = await req('/api/me', { headers: { Cookie: adminCookie, ...ORIGIN } });
    expect(me.status).toBe(401);
  });
});

describe('CORS', () => {
  it('白名单 origin 预检通过并返回 CORS 头', async () => {
    const res = await req('/api/login', {
      method: 'OPTIONS',
      headers: { Origin: 'https://pages.test', 'Access-Control-Request-Method': 'POST' },
    });
    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://pages.test');
    expect(res.headers.get('Access-Control-Allow-Credentials')).toBe('true');
  });

  it('非白名单 origin 一律 403（含预检与实际请求）', async () => {
    const pre = await req('/api/login', {
      method: 'OPTIONS',
      headers: { Origin: 'https://evil.example', 'Access-Control-Request-Method': 'POST' },
    });
    expect(pre.status).toBe(403);
    const real = await req('/api/health', { headers: { Origin: 'https://evil.example' } });
    expect(real.status).toBe(403);
  });
});

describe('记录权限与校验', () => {
  it('member 不能访问 admin 接口', async () => {
    const { adminCookie } = await setupAdmin(env, req);
    await createMember(req, adminCookie, 'alice');
    const cookie = await loginMember(env, 'alice');
    for (const path of ['/api/admin/users', '/api/admin/stats', '/api/admin/invite-codes']) {
      const res = await req(path, { headers: { Cookie: cookie, ...ORIGIN } });
      expect(res.status, path).toBe(403);
    }
    const post = await req('/api/admin/invite-codes', { method: 'POST', headers: { Cookie: cookie, ...ORIGIN } });
    expect(post.status).toBe(403);
  });

  it('非法牌阵/牌名/正逆位/空问题 → 400', async () => {
    const { adminCookie } = await setupAdmin(env, req);
    await createMember(req, adminCookie, 'bob', { daily_ai_limit: 1 });
    const cookie = await loginMember(env, 'bob');
    const headers = jsonHeaders(cookie);

    const badSpread = await req('/api/readings', {
      method: 'POST',
      headers,
      body: JSON.stringify({ ...THREE_CARDS_PAYLOAD, spread: 'celtic-cross' }),
    });
    expect(badSpread.status).toBe(400);

    const badCard = await req('/api/readings', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        ...THREE_CARDS_PAYLOAD,
        cards: [{ position: 'past', card: 'rw-99-fake', orientation: 'upright' }],
      }),
    });
    expect(badCard.status).toBe(400);

    const emptyQuestion = await req('/api/readings', {
      method: 'POST',
      headers,
      body: JSON.stringify({ ...THREE_CARDS_PAYLOAD, question: '   ' }),
    });
    expect(emptyQuestion.status).toBe(400);

    const badOrientation = await req('/api/interpret', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        ...THREE_CARDS_PAYLOAD,
        cards: [{ position: 'past', card: 'rw-00-fool', orientation: 'sideways' }],
      }),
    });
    expect(badOrientation.status).toBe(400);
  });

  it('member 不能读取/修改/删除他人记录（一律 404，不泄露存在性）', async () => {
    const { adminCookie } = await setupAdmin(env, req);
    await createMember(req, adminCookie, 'carol');
    await createMember(req, adminCookie, 'dave');
    const carol = await loginMember(env, 'carol');
    const dave = await loginMember(env, 'dave');

    const created = await req('/api/readings', {
      method: 'POST',
      headers: jsonHeaders(carol),
      body: JSON.stringify(THREE_CARDS_PAYLOAD),
    });
    expect(created.status).toBe(201);
    const { reading } = (await created.json()) as { reading: { id: string } };

    expect((await req(`/api/readings/${reading.id}`, { headers: { Cookie: dave, ...ORIGIN } })).status).toBe(404);
    expect(
      (
        await req(`/api/readings/${reading.id}`, {
          method: 'PATCH',
          headers: jsonHeaders(dave),
          body: JSON.stringify({ user_note: 'x' }),
        })
      ).status
    ).toBe(404);
    expect((await req(`/api/readings/${reading.id}`, { method: 'DELETE', headers: jsonHeaders(dave) })).status).toBe(404);

    const mine = await req(`/api/readings/${reading.id}`, { headers: { Cookie: carol, ...ORIGIN } });
    expect(mine.status).toBe(200);

    const list = await req('/api/readings', { headers: { Cookie: dave, ...ORIGIN } });
    const listBody = (await list.json()) as { items: unknown[] };
    expect(listBody.items.length).toBe(0);

    const carolList = await req('/api/readings', { headers: { Cookie: carol, ...ORIGIN } });
    const carolBody = (await carolList.json()) as { items: { id: string }[] };
    expect(carolBody.items.map((i) => i.id)).toContain(reading.id);
  });

  it('member 用 scope=all 只能拿到自己的记录；admin 才能拿全站', async () => {
    const { adminCookie } = await setupAdmin(env, req);
    await createMember(req, adminCookie, 'erin');
    const erin = await loginMember(env, 'erin');
    const res = await req('/api/readings?scope=all', { headers: { Cookie: erin, ...ORIGIN } });
    const body = (await res.json()) as { scope: string };
    expect(body.scope).toBe('self');
    const adminRes = await req('/api/readings?scope=all', { headers: { Cookie: adminCookie, ...ORIGIN } });
    const adminBody = (await adminRes.json()) as { scope: string };
    expect(adminBody.scope).toBe('all');
  });

  it('记录列表按模式和主题在服务端筛选，并拒绝非法筛选值', async () => {
    const { adminCookie } = await setupAdmin(env, req);
    await createMember(req, adminCookie, 'frank_filter');
    const cookie = await loginMember(env, 'frank_filter');

    await req('/api/readings', {
      method: 'POST',
      headers: jsonHeaders(cookie),
      body: JSON.stringify({ ...THREE_CARDS_PAYLOAD, mode: 'online', topic_tag: '事业' }),
    });
    await req('/api/readings', {
      method: 'POST',
      headers: jsonHeaders(cookie),
      body: JSON.stringify({ ...THREE_CARDS_PAYLOAD, mode: 'offline', topic_tag: '感情' }),
    });

    const filtered = await req('/api/readings?mode=offline&topic=%E6%84%9F%E6%83%85', {
      headers: { Cookie: cookie, ...ORIGIN },
    });
    const body = (await filtered.json()) as {
      total: number;
      items: { mode: string; topic_tag: string }[];
    };
    expect(filtered.status).toBe(200);
    expect(body.total).toBe(1);
    expect(body.items).toHaveLength(1);
    expect(body.items[0]).toMatchObject({ mode: 'offline', topic_tag: '感情' });

    const badMode = await req('/api/readings?mode=sideways', { headers: { Cookie: cookie, ...ORIGIN } });
    expect(badMode.status).toBe(400);
    const badTopic = await req('/api/readings?topic=not-a-tag', { headers: { Cookie: cookie, ...ORIGIN } });
    expect(badTopic.status).toBe(400);
  });
});

describe('AI 额度', () => {
  it('默认 0 额度不可调用；分配后可调用，用尽后再次拒绝', async () => {
    const { adminCookie } = await setupAdmin(env, req);
    const fetchMock = vi.mocked(globalThis.fetch);

    const adminZero = await req('/api/interpret', {
      method: 'POST',
      headers: jsonHeaders(adminCookie),
      body: JSON.stringify(THREE_CARDS_PAYLOAD),
    });
    expect(adminZero.status).toBe(429);
    expect(fetchMock).not.toHaveBeenCalled();

    await createMember(req, adminCookie, 'frida', { daily_ai_limit: 2 });
    const frida = await loginMember(env, 'frida');

    for (let i = 0; i < 2; i++) {
      const res = await req('/api/interpret', {
        method: 'POST',
        headers: jsonHeaders(frida),
        body: JSON.stringify(THREE_CARDS_PAYLOAD),
      });
      expect(res.status).toBe(200);
    }
    const callsAfterTwo = fetchMock.mock.calls.length;

    const third = await req('/api/interpret', {
      method: 'POST',
      headers: jsonHeaders(frida),
      body: JSON.stringify(THREE_CARDS_PAYLOAD),
    });
    expect(third.status).toBe(429);
    const thirdBody = (await third.json()) as { error: { code: string; message: string } };
    expect(thirdBody.error.code).toBe('QUOTA_USER_EXCEEDED');
    expect(thirdBody.error.message).toContain('午夜');
    // 关键断言：额度耗尽后 AI 没有被调用
    expect(fetchMock.mock.calls.length).toBe(callsAfterTwo);

    // 额度耗尽时，即使输入非法也按顺序先拒绝额度
    const badInput = await req('/api/interpret', {
      method: 'POST',
      headers: jsonHeaders(frida),
      body: JSON.stringify({ ...THREE_CARDS_PAYLOAD, spread: 'nope' }),
    });
    expect(badInput.status).toBe(429);

    // 管理员给自己分配额度后，与普通用户一样按额度使用。
    const adminMe = await req('/api/me', { headers: { Cookie: adminCookie, ...ORIGIN } });
    const adminId = ((await adminMe.json()) as { user: { id: string } }).user.id;
    const allocateAdmin = await req(`/api/admin/users/${adminId}`, {
      method: 'PATCH',
      headers: jsonHeaders(adminCookie),
      body: JSON.stringify({ daily_ai_limit: 1 }),
    });
    expect(allocateAdmin.status).toBe(200);
    const adminRes = await req('/api/interpret', {
      method: 'POST',
      headers: jsonHeaders(adminCookie),
      body: JSON.stringify(THREE_CARDS_PAYLOAD),
    });
    expect(adminRes.status).toBe(200);
    const adminBody = (await adminRes.json()) as { quota: { daily_limit: number; remaining: number } };
    expect(adminBody.quota.daily_limit).toBe(1);
    expect(adminBody.quota.remaining).toBe(0);
  });

  it('全站额度耗尽 → 429 QUOTA_GLOBAL_EXCEEDED（对 admin 同样生效）', async () => {
    const { adminCookie } = await setupAdmin(env, req);
    await createMember(req, adminCookie, 'gina', { daily_ai_limit: 5 });
    const gina = await loginMember(env, 'gina');
    // 全站上限读 settings 表（运行时配置），改为 1
    await env.DB.prepare("UPDATE settings SET value = '1' WHERE key = 'global_daily_ai_limit'").run();

    const r1 = await req('/api/interpret', {
      method: 'POST',
      headers: jsonHeaders(gina),
      body: JSON.stringify(THREE_CARDS_PAYLOAD),
    });
    expect(r1.status).toBe(200);

    const adminMe = await req('/api/me', { headers: { Cookie: adminCookie, ...ORIGIN } });
    const adminId = ((await adminMe.json()) as { user: { id: string } }).user.id;
    await req(`/api/admin/users/${adminId}`, {
      method: 'PATCH',
      headers: jsonHeaders(adminCookie),
      body: JSON.stringify({ daily_ai_limit: 1 }),
    });
    const r2 = await req('/api/interpret', {
      method: 'POST',
      headers: jsonHeaders(adminCookie),
      body: JSON.stringify(THREE_CARDS_PAYLOAD),
    });
    expect(r2.status).toBe(429);
    const body = (await r2.json()) as { error: { code: string } };
    expect(body.error.code).toBe('QUOTA_GLOBAL_EXCEEDED');
  });

  it('AI 上游失败 → 502 明确错误，不输出伪装解读，且额度已退还', async () => {
    const { adminCookie } = await setupAdmin(env, req);
    await createMember(req, adminCookie, 'henry', { daily_ai_limit: 1 });
    const henry = await loginMember(env, 'henry');
    vi.stubGlobal('fetch', vi.fn(async () => new Response('upstream exploded', { status: 500 })));

    const res = await req('/api/interpret', {
      method: 'POST',
      headers: jsonHeaders(henry),
      body: JSON.stringify(THREE_CARDS_PAYLOAD),
    });
    expect(res.status).toBe(502);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe('AI_UPSTREAM_ERROR');
    expect(body.error.message).toContain('未计入额度');
    expect((body.error as { detail?: string }).detail).toBeUndefined();

    // 额度已退还，重试可用
    vi.stubGlobal('fetch', vi.fn(async () => new Response(aiOkResponse({ synthesis: '恢复了' }), { status: 200 })));
    const retry = await req('/api/interpret', {
      method: 'POST',
      headers: jsonHeaders(henry),
      body: JSON.stringify(THREE_CARDS_PAYLOAD),
    });
    expect(retry.status).toBe(200);
    const retryBody = (await retry.json()) as {
      interpretation: { format: string; synthesis: string; cards: unknown[] };
    };
    expect(retryBody.interpretation.format).toBe('structured');
    expect(retryBody.interpretation.synthesis).toBe('恢复了');
    expect(retryBody.interpretation.cards).toHaveLength(3);
  });

  it('quota 接口返回额度信息与 ISO 重置时间', async () => {
    const { adminCookie } = await setupAdmin(env, req);
    await createMember(req, adminCookie, 'iris');
    const iris = await loginMember(env, 'iris');
    const res = await req('/api/quota', { headers: { Cookie: iris, ...ORIGIN } });
    const body = (await res.json()) as {
      quota: { daily_limit: number; remaining: number; reset_at: string; global_limit: number };
    };
    expect(body.quota.daily_limit).toBe(0);
    expect(body.quota.remaining).toBe(0);
    expect(body.quota.global_limit).toBe(200);
    expect(() => new Date(body.quota.reset_at).toISOString()).not.toThrow();
  });
});

describe('邀请码闭环与管理员操作', () => {
  it('发码 → redeem → 登录 → 码变为已使用且不可复用', async () => {
    const { adminCookie } = await setupAdmin(env, req);
    const created = await req('/api/admin/invite-codes', { method: 'POST', headers: jsonHeaders(adminCookie) });
    expect(created.status).toBe(201);
    const { invite_code } = (await created.json()) as { invite_code: { code: string; expires_at: string } };
    expect(invite_code.expires_at).toBeTruthy();

    const redeemed = await req('/api/redeem', {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({
        invite_code: invite_code.code,
        site_access_key: 'test-site-key',
        username: 'guest_one',
        password: 'guest-pw-123456',
      }),
    });
    expect(redeemed.status).toBe(201);

    const again = await req('/api/redeem', {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({
        invite_code: invite_code.code,
        site_access_key: 'test-site-key',
        username: 'guest_two',
        password: 'guest-pw-123456',
      }),
    });
    expect(again.status).toBe(400);

    const { res: loginRes } = await login(env, {
      site_access_key: 'test-site-key',
      username: 'guest_one',
      password: 'guest-pw-123456',
    });
    expect(loginRes.status).toBe(200);

    const list = await req('/api/admin/invite-codes', { headers: { Cookie: adminCookie, ...ORIGIN } });
    const listBody = (await list.json()) as {
      invite_codes: { code: string; status: string; redeemed_by: string; expires_at: string }[];
    };
    expect(listBody.invite_codes[0].status).toBe('redeemed');
    expect(listBody.invite_codes[0].redeemed_by).toBe('guest_one');
    expect(listBody.invite_codes[0].expires_at).toBe(invite_code.expires_at);
  });

  it('邀请码可撤销，撤销后不能兑换', async () => {
    const { adminCookie } = await setupAdmin(env, req);
    const created = await req('/api/admin/invite-codes', { method: 'POST', headers: jsonHeaders(adminCookie) });
    const { invite_code } = (await created.json()) as { invite_code: { code: string } };

    const revoked = await req(`/api/admin/invite-codes/${invite_code.code}`, {
      method: 'PATCH',
      headers: jsonHeaders(adminCookie),
      body: JSON.stringify({ action: 'revoke' }),
    });
    expect(revoked.status).toBe(200);

    const redeem = await req('/api/redeem', {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({
        invite_code: invite_code.code,
        site_access_key: 'test-site-key',
        username: 'revoked_guest',
        password: 'revoked-pw-123456',
      }),
    });
    expect(redeem.status).toBe(400);
  });

  it('同一邀请码并发兑换时只能成功一次', async () => {
    const { adminCookie } = await setupAdmin(env, req);
    const created = await req('/api/admin/invite-codes', { method: 'POST', headers: jsonHeaders(adminCookie) });
    const { invite_code } = (await created.json()) as { invite_code: { code: string } };
    const redeemBody = (username: string) => ({
      invite_code: invite_code.code,
      site_access_key: 'test-site-key',
      username,
      password: 'concurrent-pw-123456',
    });

    const [first, second] = await Promise.all([
      req('/api/redeem', {
        method: 'POST',
        headers: jsonHeaders(),
        body: JSON.stringify(redeemBody('race_guest_one')),
      }),
      req('/api/redeem', {
        method: 'POST',
        headers: jsonHeaders(),
        body: JSON.stringify(redeemBody('race_guest_two')),
      }),
    ]);
    expect([first.status, second.status].sort()).toEqual([201, 400]);

    const users = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM users WHERE username IN ('race_guest_one', 'race_guest_two')"
    ).first<{ n: number }>();
    expect(users?.n).toBe(1);
  });

  it('过期邀请码不能兑换，并在管理列表中显示 expired', async () => {
    const { adminCookie } = await setupAdmin(env, req);
    const created = await req('/api/admin/invite-codes', { method: 'POST', headers: jsonHeaders(adminCookie) });
    const { invite_code } = (await created.json()) as { invite_code: { code: string } };
    await env.DB.prepare("UPDATE invite_codes SET expires_at = '2000-01-01T00:00:00.000Z' WHERE code = ?")
      .bind(invite_code.code)
      .run();

    const redeem = await req('/api/redeem', {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({
        invite_code: invite_code.code,
        site_access_key: 'test-site-key',
        username: 'expired_guest',
        password: 'expired-pw-123456',
      }),
    });
    expect(redeem.status).toBe(400);

    const list = await req('/api/admin/invite-codes', { headers: { Cookie: adminCookie, ...ORIGIN } });
    const listBody = (await list.json()) as { invite_codes: { code: string; status: string }[] };
    expect(listBody.invite_codes.find((c) => c.code === invite_code.code)?.status).toBe('expired');
  });

  it('redeem 拒绝错误站点密钥与弱密码', async () => {
    const { adminCookie } = await setupAdmin(env, req);
    const created = await req('/api/admin/invite-codes', { method: 'POST', headers: jsonHeaders(adminCookie) });
    const { invite_code } = (await created.json()) as { invite_code: { code: string } };

    const wrongKey = await req('/api/redeem', {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({ invite_code: invite_code.code, site_access_key: 'bad', username: 'u1', password: 'longenoughpw1' }),
    });
    expect(wrongKey.status).toBe(401);

    const weakPw = await req('/api/redeem', {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({ invite_code: invite_code.code, site_access_key: 'test-site-key', username: 'u2', password: 'short' }),
    });
    expect(weakPw.status).toBe(400);
  });

  it('admin 调整额度、重置密码；不能停用自己', async () => {
    const { adminCookie } = await setupAdmin(env, req);
    const { id } = await createMember(req, adminCookie, 'jack');

    const patched = await req(`/api/admin/users/${id}`, {
      method: 'PATCH',
      headers: jsonHeaders(adminCookie),
      body: JSON.stringify({ daily_ai_limit: 5 }),
    });
    expect(patched.status).toBe(200);
    const { user: patchedUser } = (await patched.json()) as { user: { daily_ai_limit: number | null } };
    expect(patchedUser.daily_ai_limit).toBe(5);

    const reset = await req(`/api/admin/users/${id}`, {
      method: 'PATCH',
      headers: jsonHeaders(adminCookie),
      body: JSON.stringify({ new_password: 'new-pw-12345678' }),
    });
    expect(reset.status).toBe(200);

    const oldLogin = await login(env, { site_access_key: 'test-site-key', username: 'jack', password: MEMBER_PW });
    expect(oldLogin.res.status).toBe(401);
    const newLogin = await login(env, { site_access_key: 'test-site-key', username: 'jack', password: 'new-pw-12345678' });
    expect(newLogin.res.status).toBe(200);

    const me = await req('/api/me', { headers: { Cookie: adminCookie, ...ORIGIN } });
    const meBody = (await me.json()) as { user: { id: string } };
    const selfPatch = await req(`/api/admin/users/${meBody.user.id}`, {
      method: 'PATCH',
      headers: jsonHeaders(adminCookie),
      body: JSON.stringify({ is_active: false }),
    });
    expect(selfPatch.status).toBe(403);
  });

  it('admin stats 聚合全站数据', async () => {
    const { adminCookie } = await setupAdmin(env, req);
    await createMember(req, adminCookie, 'kate');
    const kate = await loginMember(env, 'kate');
    await req('/api/readings', {
      method: 'POST',
      headers: jsonHeaders(kate),
      body: JSON.stringify(THREE_CARDS_PAYLOAD),
    });
    const res = await req('/api/admin/stats', { headers: { Cookie: adminCookie, ...ORIGIN } });
    const { stats } = (await res.json()) as {
      stats: { total_readings: number; global_used_today: number; users: unknown[] };
    };
    expect(stats.total_readings).toBe(1);
    expect(stats.users.length).toBe(2);
  });
});

describe('统计接口', () => {
  it('member stats 覆盖 MVP 字段', async () => {
    const { adminCookie } = await setupAdmin(env, req);
    await createMember(req, adminCookie, 'liam');
    const liam = await loginMember(env, 'liam');
    await req('/api/readings', {
      method: 'POST',
      headers: jsonHeaders(liam),
      body: JSON.stringify(THREE_CARDS_PAYLOAD),
    });
    const res = await req('/api/stats', { headers: { Cookie: liam, ...ORIGIN } });
    const { stats } = (await res.json()) as {
      stats: {
        total: number;
        by_month: unknown[];
        by_mode: { key: string; count: number }[];
        by_topic: unknown[];
        by_spread: { key: string; count: number }[];
        top_cards: { card: string; count: number }[];
        orientations: { upright: number; reversed: number };
        ai_used_total: number;
      };
    };
    expect(stats.total).toBe(1);
    expect(stats.by_month).toHaveLength(12);
    expect(stats.by_mode[0]).toEqual({ key: 'online', count: 1 });
    expect(stats.by_spread[0]).toEqual({ key: 'three-card', count: 1 });
    // 三张牌各出现一次，并列时顺序不确定：按集合断言
    const cardIds = stats.top_cards.map((c) => c.card).sort();
    expect(cardIds).toEqual(['rw-00-fool', 'rw-10-wheel-of-fortune', 'rw-19-sun']);
    expect(stats.orientations.upright).toBe(2);
    expect(stats.orientations.reversed).toBe(1);
  });
});

describe('A7 历史关键词搜索', () => {
  it('q 命中问题文本；通配符被转义；超长拒绝', async () => {
    const { adminCookie } = await setupAdmin(env, req);
    await createMember(req, adminCookie, 'search_user');
    const cookie = await loginMember(env, 'search_user');
    const mk = (question: string) =>
      req('/api/readings', {
        method: 'POST',
        headers: jsonHeaders(cookie),
        body: JSON.stringify({ ...THREE_CARDS_PAYLOAD, question }),
      });
    await mk('关于搬家的问题');
    await mk('关于跳槽的问题');

    const hit = await req(`/api/readings?q=${encodeURIComponent('搬家')}`, { headers: { Cookie: cookie, ...ORIGIN } });
    expect(hit.status).toBe(200);
    const hitBody = (await hit.json()) as { total: number; items: { question: string }[] };
    expect(hitBody.total).toBe(1);
    expect(hitBody.items[0]?.question).toContain('搬家');

    // 纯通配符不应匹配全部（被 ESCAPE 转义为字面量）
    const wildcard = await req(`/api/readings?q=${encodeURIComponent('%')}`, { headers: { Cookie: cookie, ...ORIGIN } });
    const wildcardBody = (await wildcard.json()) as { total: number };
    expect(wildcardBody.total).toBe(0);

    const tooLong = await req(`/api/readings?q=${'x'.repeat(101)}`, { headers: { Cookie: cookie, ...ORIGIN } });
    expect(tooLong.status).toBe(400);
  });
});

describe('C2 登录限流', () => {
  it('连续 5 次失败后锁定；锁定期满后可正常登录', async () => {
    const { adminCookie } = await setupAdmin(env, req);
    await createMember(req, adminCookie, 'lockme');

    for (let i = 0; i < 5; i++) {
      const bad = await login(env, { site_access_key: 'test-site-key', username: 'lockme', password: 'wrong-pw-000000' });
      expect(bad.res.status, `attempt ${i + 1}`).toBe(401);
    }
    // 第 6 次即使密码正确也被锁定拒绝
    const locked = await login(env, { site_access_key: 'test-site-key', username: 'lockme', password: MEMBER_PW });
    expect(locked.res.status).toBe(429);
    const lockedBody = (await locked.res.json()) as { error: { code: string } };
    expect(lockedBody.error.code).toBe('RATE_LIMITED');

    // 模拟锁定到期
    await env.DB.prepare("UPDATE login_attempts SET locked_until = '2000-01-01T00:00:00.000Z'").run();
    const ok = await login(env, { site_access_key: 'test-site-key', username: 'lockme', password: MEMBER_PW });
    expect(ok.res.status).toBe(200);
    const rows = await env.DB.prepare('SELECT COUNT(*) AS n FROM login_attempts').first<{ n: number }>();
    expect(rows?.n).toBe(0);
  });
});

describe('C1 额度原子性', () => {
  it('并发双请求在 limit=1 下只放行一次', async () => {
    const { adminCookie } = await setupAdmin(env, req);
    await createMember(req, adminCookie, 'race_quota', { daily_ai_limit: 1 });
    const cookie = await loginMember(env, 'race_quota');
    const body = JSON.stringify(THREE_CARDS_PAYLOAD);
    const [a, b] = await Promise.all([
      req('/api/interpret', { method: 'POST', headers: jsonHeaders(cookie), body }),
      req('/api/interpret', { method: 'POST', headers: jsonHeaders(cookie), body }),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 429]);
    const fetchMock = vi.mocked(globalThis.fetch);
    expect(fetchMock.mock.calls.length).toBe(1);
    const row = await env.DB.prepare(
      "SELECT count FROM ai_usage WHERE user_id = (SELECT id FROM users WHERE username = 'race_quota')"
    ).first<{ count: number }>();
    expect(row?.count).toBe(1);
  });

  it('全站额度占用失败只回退个人额度，不影响全站计数', async () => {
    const { adminCookie } = await setupAdmin(env, req);
    const gina = await createMember(req, adminCookie, 'gina2', { daily_ai_limit: 5 });
    const ginaCookie = await loginMember(env, 'gina2');
    await env.DB.prepare("UPDATE settings SET value = '1' WHERE key = 'global_daily_ai_limit'").run();
    await req('/api/interpret', {
      method: 'POST',
      headers: jsonHeaders(ginaCookie),
      body: JSON.stringify(THREE_CARDS_PAYLOAD),
    });
    const adminMe = await req('/api/me', { headers: { Cookie: adminCookie, ...ORIGIN } });
    const adminId = ((await adminMe.json()) as { user: { id: string } }).user.id;
    await req(`/api/admin/users/${adminId}`, {
      method: 'PATCH',
      headers: jsonHeaders(adminCookie),
      body: JSON.stringify({ daily_ai_limit: 1 }),
    });
    const blocked = await req('/api/interpret', {
      method: 'POST',
      headers: jsonHeaders(adminCookie),
      body: JSON.stringify(THREE_CARDS_PAYLOAD),
    });
    expect(blocked.status).toBe(429);
    // 全站计数应保持 1（gina 的一次），不因回退变成 0
    const globalRow = await env.DB.prepare(
      "SELECT count FROM global_ai_usage WHERE usage_date = date('now','+8 hours')"
    ).first<{ count: number }>();
    expect(globalRow?.count).toBe(1);
    // 个人额度已回退到 0
    const adminRow = await env.DB.prepare('SELECT count FROM ai_usage WHERE user_id = ?').bind(adminId).first<{ count: number }>();
    expect(adminRow?.count).toBe(0);
    expect(gina.id).toBeTruthy();
  });
});

describe('A4 流式解读（SSE）', () => {
  const content = JSON.stringify({
    cards: [
      { index: 0, analysis: '第一张牌的流式分析。' },
      { index: 1, analysis: '第二张牌的流式分析。' },
      { index: 2, analysis: '第三张牌的流式分析。' },
    ],
    synthesis: '流式综合解读。',
    reflection: ['流式反思问题？'],
  });

  it('delta/done 事件、结构化结果与 token 记账', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(sseBody(content, { prompt_tokens: 100, completion_tokens: 60 }), { status: 200 }))
    );
    const { adminCookie } = await setupAdmin(env, req);
    const member = await createMember(req, adminCookie, 'streamer', { daily_ai_limit: 2 });
    const cookie = await loginMember(env, 'streamer');

    const res = await req('/api/interpret/stream', {
      method: 'POST',
      headers: jsonHeaders(cookie),
      body: JSON.stringify(THREE_CARDS_PAYLOAD),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('text/event-stream');
    const text = await res.text();
    expect(text).toContain('event: delta');
    expect(text).toContain('event: done');
    const doneEvent = text.split('\n\n').find((part) => part.includes('event: done'));
    const dataLine = doneEvent?.split('\n').find((l) => l.startsWith('data:'));
    expect(dataLine).toBeTruthy();
    const done = JSON.parse(dataLine!.slice(5).trim()) as {
      interpretation: { format: string; synthesis: string; cards: unknown[] };
      quota: { used_today: number };
    };
    expect(done.interpretation.format).toBe('structured');
    expect(done.interpretation.synthesis).toBe('流式综合解读。');
    expect(done.interpretation.cards).toHaveLength(3);
    expect(done.quota.used_today).toBe(1);

    const row = await env.DB.prepare('SELECT prompt_tokens, completion_tokens FROM ai_usage WHERE user_id = ?')
      .bind(member.id)
      .first<{ prompt_tokens: number; completion_tokens: number }>();
    expect(row?.prompt_tokens).toBe(100);
    expect(row?.completion_tokens).toBe(60);
  });

  it('上游失败：error 事件 + 额度退还', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('boom', { status: 500 })));
    const { adminCookie } = await setupAdmin(env, req);
    await createMember(req, adminCookie, 'stream_fail', { daily_ai_limit: 1 });
    const cookie = await loginMember(env, 'stream_fail');

    const res = await req('/api/interpret/stream', {
      method: 'POST',
      headers: jsonHeaders(cookie),
      body: JSON.stringify(THREE_CARDS_PAYLOAD),
    });
    expect(res.status).toBe(200); // SSE 以事件传达错误
    const text = await res.text();
    expect(text).toContain('event: error');
    expect(text).toContain('AI_UPSTREAM_ERROR');

    const quota = await req('/api/quota', { headers: { Cookie: cookie, ...ORIGIN } });
    const quotaBody = (await quota.json()) as { quota: { used_today: number } };
    expect(quotaBody.quota.used_today).toBe(0);
  });
});

describe('B3 最近记录上下文注入', () => {
  it('默认不注入；include_context=true 时注入问题摘要', async () => {
    const { adminCookie } = await setupAdmin(env, req);
    await createMember(req, adminCookie, 'ctx_user', { daily_ai_limit: 3 });
    const cookie = await loginMember(env, 'ctx_user');
    await req('/api/readings', {
      method: 'POST',
      headers: jsonHeaders(cookie),
      body: JSON.stringify({ ...THREE_CARDS_PAYLOAD, question: '我上次问的工作问题', topic_tag: '事业' }),
    });
    const fetchMock = vi.mocked(globalThis.fetch);

    await req('/api/interpret', {
      method: 'POST',
      headers: jsonHeaders(cookie),
      body: JSON.stringify(THREE_CARDS_PAYLOAD),
    });
    const firstBody = JSON.parse(String(fetchMock.mock.calls.at(-1)![1]?.body)) as {
      messages: { role: string; content: string }[];
    };
    expect(firstBody.messages[1]!.content).not.toContain('最近记录背景');

    await req('/api/interpret', {
      method: 'POST',
      headers: jsonHeaders(cookie),
      body: JSON.stringify({ ...THREE_CARDS_PAYLOAD, include_context: true }),
    });
    const secondBody = JSON.parse(String(fetchMock.mock.calls.at(-1)![1]?.body)) as {
      messages: { role: string; content: string }[];
    };
    expect(secondBody.messages[1]!.content).toContain('最近记录背景');
    expect(secondBody.messages[1]!.content).toContain('我上次问的工作问题');
  });
});

describe('B5 token 用量记账', () => {
  it('成功后累加 tokens 并在 stats / admin stats 暴露', async () => {
    const { adminCookie } = await setupAdmin(env, req);
    const member = await createMember(req, adminCookie, 'token_user', { daily_ai_limit: 2 });
    const cookie = await loginMember(env, 'token_user');
    const res = await req('/api/interpret', {
      method: 'POST',
      headers: jsonHeaders(cookie),
      body: JSON.stringify(THREE_CARDS_PAYLOAD),
    });
    expect(res.status).toBe(200);
    const row = await env.DB.prepare('SELECT prompt_tokens, completion_tokens FROM ai_usage WHERE user_id = ?')
      .bind(member.id)
      .first<{ prompt_tokens: number; completion_tokens: number }>();
    expect(row).toMatchObject({ prompt_tokens: 120, completion_tokens: 80 });

    const statsRes = await req('/api/stats', { headers: { Cookie: cookie, ...ORIGIN } });
    const statsBody = (await statsRes.json()) as { stats: { ai_tokens_total: number } };
    expect(statsBody.stats.ai_tokens_total).toBe(200);

    const adminStats = await req('/api/admin/stats', { headers: { Cookie: adminCookie, ...ORIGIN } });
    const adminBody = (await adminStats.json()) as { stats: { ai_tokens_today: number; ai_tokens_total: number } };
    expect(adminBody.stats.ai_tokens_total).toBe(200);
    expect(adminBody.stats.ai_tokens_today).toBe(200);
  });

  it('结构化解析失败时降级为纯文本（不伪装成结构化）', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: '这不是 JSON。' } }] }), { status: 200 })));
    const { adminCookie } = await setupAdmin(env, req);
    await createMember(req, adminCookie, 'fallback_user', { daily_ai_limit: 1 });
    const cookie = await loginMember(env, 'fallback_user');
    const res = await req('/api/interpret', {
      method: 'POST',
      headers: jsonHeaders(cookie),
      body: JSON.stringify(THREE_CARDS_PAYLOAD),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { interpretation: { format: string; text: string } };
    expect(body.interpretation.format).toBe('text');
    expect(body.interpretation.text).toBe('这不是 JSON。');
  });
});

describe('P1 全站记录归属与按用户筛选', () => {
  it('scope=all 返回 username；user 参数筛选；member 列表不带 username', async () => {
    const { adminCookie } = await setupAdmin(env, req);
    const alice = await createMember(req, adminCookie, 'own_alice');
    const bob = await createMember(req, adminCookie, 'own_bob');
    const aliceCookie = await loginMember(env, 'own_alice');
    const bobCookie = await loginMember(env, 'own_bob');
    await req('/api/readings', {
      method: 'POST',
      headers: jsonHeaders(aliceCookie),
      body: JSON.stringify({ ...THREE_CARDS_PAYLOAD, question: 'alice 的问题' }),
    });
    await req('/api/readings', {
      method: 'POST',
      headers: jsonHeaders(bobCookie),
      body: JSON.stringify({ ...THREE_CARDS_PAYLOAD, question: 'bob 的问题' }),
    });

    // admin 全站视图：带 username
    const all = await req('/api/readings?scope=all', { headers: { Cookie: adminCookie, ...ORIGIN } });
    const allBody = (await all.json()) as { items: { username: string | null; question: string }[] };
    expect(allBody.items).toHaveLength(2);
    const usernames = allBody.items.map((i) => i.username).sort();
    expect(usernames).toEqual(['own_alice', 'own_bob']);

    // admin 按用户筛选：只返回 alice 的
    const filtered = await req(`/api/readings?scope=all&user=${alice.id}`, {
      headers: { Cookie: adminCookie, ...ORIGIN },
    });
    const filteredBody = (await filtered.json()) as {
      total: number;
      items: { username: string | null; user_id: string }[];
    };
    expect(filteredBody.total).toBe(1);
    expect(filteredBody.items[0]).toMatchObject({ username: 'own_alice', user_id: alice.id });

    // member 自己的列表：不带 username（不查询 users 表）
    const mine = await req('/api/readings', { headers: { Cookie: aliceCookie, ...ORIGIN } });
    const mineBody = (await mine.json()) as { items: { username?: string | null }[] };
    expect(mineBody.items).toHaveLength(1);
    expect(mineBody.items[0]?.username ?? null).toBeNull();

    // member 用 user 参数无效（scope 被强制 self，user 参数被忽略 → 仍只看到自己的）
    const memberFiltered = await req(`/api/readings?scope=self&user=${bob.id}`, {
      headers: { Cookie: aliceCookie, ...ORIGIN },
    });
    const memberFilteredBody = (await memberFiltered.json()) as { items: unknown[] };
    expect(memberFilteredBody.items).toHaveLength(1);
  });
});
