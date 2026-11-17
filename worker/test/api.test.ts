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
