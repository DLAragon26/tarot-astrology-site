import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
  vi.stubGlobal('fetch', vi.fn(async () => new Response(aiOkResponse('模拟解读：这是一次测试输出。'), { status: 200 })));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('认证与未登录防护', () => {
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
    expect(res2.headers.get('Set-Cookie')).toContain('Secure');
  });

  it('logout 吊销会话', async () => {
    const { adminCookie } = await setupAdmin();
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
    const { adminCookie } = await setupAdmin();
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
    const { adminCookie } = await setupAdmin();
    await createMember(req, adminCookie, 'bob');
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
    const { adminCookie } = await setupAdmin();
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
    const { adminCookie } = await setupAdmin();
    await createMember(req, adminCookie, 'erin');
    const erin = await loginMember(env, 'erin');
    const res = await req('/api/readings?scope=all', { headers: { Cookie: erin, ...ORIGIN } });
    const body = (await res.json()) as { scope: string };
    expect(body.scope).toBe('self');
    const adminRes = await req('/api/readings?scope=all', { headers: { Cookie: adminCookie, ...ORIGIN } });
    const adminBody = (await adminRes.json()) as { scope: string };
    expect(adminBody.scope).toBe('all');
  });
});

describe('AI 额度', () => {
  it('member 额度耗尽 → 429 且不再调用 AI；admin 个人无上限', async () => {
    const { adminCookie } = await setupAdmin();
    await createMember(req, adminCookie, 'frida', { daily_ai_limit: 2 });
    const frida = await loginMember(env, 'frida');
    const fetchMock = vi.mocked(globalThis.fetch);

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

    // admin 不受个人额度限制
    const adminRes = await req('/api/interpret', {
      method: 'POST',
      headers: jsonHeaders(adminCookie),
      body: JSON.stringify(THREE_CARDS_PAYLOAD),
    });
    expect(adminRes.status).toBe(200);
    const adminBody = (await adminRes.json()) as { quota: { daily_limit: number | null } };
    expect(adminBody.quota.daily_limit).toBeNull();
  });

  it('全站额度耗尽 → 429 QUOTA_GLOBAL_EXCEEDED（对 admin 同样生效）', async () => {
    const { adminCookie } = await setupAdmin();
    await createMember(req, adminCookie, 'gina');
    const gina = await loginMember(env, 'gina');
    const limited = makeEnv({ GLOBAL_DAILY_AI_LIMIT: '1' });
    const lreq = appRequest(limited);
    const llogin = await login(limited, { site_access_key: 'test-site-key', username: 'gina', password: MEMBER_PW });

    const r1 = await lreq('/api/interpret', {
      method: 'POST',
      headers: jsonHeaders(llogin.cookie),
      body: JSON.stringify(THREE_CARDS_PAYLOAD),
    });
    expect(r1.status).toBe(200);

    const adminL = await login(limited, ADMIN_LOGIN);
    const r2 = await lreq('/api/interpret', {
      method: 'POST',
      headers: jsonHeaders(adminL.cookie),
      body: JSON.stringify(THREE_CARDS_PAYLOAD),
    });
    expect(r2.status).toBe(429);
    const body = (await r2.json()) as { error: { code: string } };
    expect(body.error.code).toBe('QUOTA_GLOBAL_EXCEEDED');
    void gina;
  });

  it('AI 上游失败 → 502 明确错误，不输出伪装解读，且额度已退还', async () => {
    const { adminCookie } = await setupAdmin();
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

    // 额度已退还，重试可用
    vi.stubGlobal('fetch', vi.fn(async () => new Response(aiOkResponse('恢复了'), { status: 200 })));
    const retry = await req('/api/interpret', {
      method: 'POST',
      headers: jsonHeaders(henry),
      body: JSON.stringify(THREE_CARDS_PAYLOAD),
    });
    expect(retry.status).toBe(200);
    const retryBody = (await retry.json()) as { interpretation: string };
    expect(retryBody.interpretation).toBe('恢复了');
  });

  it('quota 接口返回额度信息与 ISO 重置时间', async () => {
    const { adminCookie } = await setupAdmin();
    await createMember(req, adminCookie, 'iris');
    const iris = await loginMember(env, 'iris');
    const res = await req('/api/quota', { headers: { Cookie: iris, ...ORIGIN } });
    const body = (await res.json()) as {
      quota: { daily_limit: number; remaining: number; reset_at: string; global_limit: number };
    };
    expect(body.quota.daily_limit).toBe(20);
    expect(body.quota.remaining).toBe(20);
    expect(body.quota.global_limit).toBe(200);
    expect(() => new Date(body.quota.reset_at).toISOString()).not.toThrow();
  });
});

describe('邀请码闭环与管理员操作', () => {
  it('发码 → redeem → 登录 → 码变为已使用且不可复用', async () => {
    const { adminCookie } = await setupAdmin();
    const created = await req('/api/admin/invite-codes', { method: 'POST', headers: jsonHeaders(adminCookie) });
    expect(created.status).toBe(201);
    const { invite_code } = (await created.json()) as { invite_code: { code: string } };

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
    const listBody = (await list.json()) as { invite_codes: { code: string; status: string; redeemed_by: string }[] };
    expect(listBody.invite_codes[0].status).toBe('redeemed');
    expect(listBody.invite_codes[0].redeemed_by).toBe('guest_one');
  });

  it('redeem 拒绝错误站点密钥与弱密码', async () => {
    const { adminCookie } = await setupAdmin();
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
    const { adminCookie } = await setupAdmin();
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
    const { adminCookie } = await setupAdmin();
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
    const { adminCookie } = await setupAdmin();
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
    expect(stats.top_cards[0].card).toBe('rw-00-fool');
    expect(stats.orientations.upright).toBe(2);
    expect(stats.orientations.reversed).toBe(1);
  });
});
