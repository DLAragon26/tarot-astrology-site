#!/usr/bin/env node
// 本地端到端冒烟：内置 OpenAI-compatible stub（127.0.0.1:8788）+ 驱动 wrangler dev（127.0.0.1:8787）。
// - 自动生成 worker/.dev.vars（随机密钥，绝不打印、绝不提交）
// - 每次运行重建本地 D1（干净起点），再 apply migration
// - 断言链覆盖：登录/me/解读/额度/记录 CRUD/越权 403/404/额度耗尽不调 AI/AI 失败不扣额度/邀请码/全站统计
// 用法：node scripts/smoke.mjs   （退出码 0 = 全绿）
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import http from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const workerDir = path.join(root, 'worker');
const STUB_PORT = 8788;
const API = 'http://127.0.0.1:8787';
const persistDir = mkdtempSync(path.join(tmpdir(), 'tarot-smoke-'));

// 所有运行值只存在于当前进程；D1 使用独立临时目录，绝不触碰 worker/.dev.vars 或本地开发数据。
const vars = {
  API_BASE_URL: `http://127.0.0.1:${STUB_PORT}/v1`,
  MODEL_NAME: 'stub-model',
  API_KEY: 'stub-placeholder-not-a-real-key',
  MAX_TOKENS: '300',
  TEMPERATURE: '0.5',
  SITE_ACCESS_KEY: randomBytes(16).toString('hex'),
  SESSION_SECRET: randomBytes(32).toString('hex'),
  ADMIN_INITIAL_PASSWORD: randomBytes(12).toString('hex'),
  GLOBAL_DAILY_AI_LIMIT: '200',
  ALLOWED_ORIGINS: 'http://localhost:4321',
  COOKIE_SECURE: 'false',
};
const wranglerVarArgs = Object.entries(vars).flatMap(([key, value]) => ['--var', `${key}:${value}`]);
console.log(`[setup] isolated smoke state: ${persistDir}`);

// ---------- 2. AI stub ----------
let stubMode = 'ok';
let stubCount = 0;
let stubLastBody = '';
const STUB_SYNTHESIS = '【测试解读】这是本地 stub 返回的固定综合叙述，仅用于冒烟测试。它不代表真实 AI 输出。';
const STUB_CONTENT = JSON.stringify({
  cards: [
    { index: 0, analysis: '【测试解读】第一张牌的 stub 分析文本。' },
    { index: 1, analysis: '【测试解读】第二张牌的 stub 分析文本。' },
    { index: 2, analysis: '【测试解读】第三张牌的 stub 分析文本。' },
  ],
  synthesis: STUB_SYNTHESIS,
  reflection: ['【测试】这条问题背后你真正在意的是什么？'],
});
const STUB_USAGE = { prompt_tokens: 120, completion_tokens: 80 };

const stub = http.createServer((req, res) => {
  if (req.method === 'POST' && req.url.endsWith('/chat/completions')) {
    stubCount++;
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      stubLastBody = body;
      if (stubMode === 'fail') {
        res.writeHead(500, { 'content-type': 'text/plain' });
        res.end('stub failure (intentional)');
        return;
      }
      const wantsStream = (() => {
        try {
          return JSON.parse(body).stream === true;
        } catch {
          return false;
        }
      })();
      if (wantsStream) {
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        const size = Math.ceil(STUB_CONTENT.length / 6);
        for (let i = 0; i < STUB_CONTENT.length; i += size) {
          res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: STUB_CONTENT.slice(i, i + size) } }] })}\n\n`);
        }
        res.write(`data: ${JSON.stringify({ choices: [], usage: STUB_USAGE })}\n\n`);
        res.write('data: [DONE]\n\n');
        res.end();
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { content: STUB_CONTENT } }], usage: STUB_USAGE }));
    });
    return;
  }
  if (req.method === 'GET' && req.url === '/__count') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ count: stubCount, mode: stubMode }));
    return;
  }
  if (req.method === 'GET' && req.url === '/__last') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ body: stubLastBody }));
    return;
  }
  res.writeHead(404);
  res.end();
});

await new Promise((resolve, reject) => {
  stub.once('error', reject);
  stub.listen(STUB_PORT, '127.0.0.1', resolve);
});
console.log(`[stub] listening on http://127.0.0.1:${STUB_PORT}`);

// ---------- 3. 干净本地 D1 + migration ----------
const mig = spawnSync(
  'npx',
  ['wrangler', 'd1', 'migrations', 'apply', 'tarot-astrology', '--local', '--persist-to', persistDir],
  {
    cwd: workerDir,
    encoding: 'utf8',
    env: { ...process.env, CI: '1' },
  }
);
if (mig.status !== 0) {
  console.error('[migrate] failed:\n' + (mig.stdout ?? '') + (mig.stderr ?? ''));
  rmSync(persistDir, { recursive: true, force: true });
  process.exit(2);
}
console.log('[migrate] isolated local D1 migrated (all migrations)');

// ---------- 4. wrangler dev ----------
const dev = spawn(
  'npx',
  ['wrangler', 'dev', '--port', '8787', '--ip', '127.0.0.1', '--local', '--persist-to', persistDir, ...wranglerVarArgs],
  {
    cwd: workerDir,
    env: { ...process.env, CI: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  }
);
let devLog = '';
dev.stdout.on('data', (d) => (devLog += d.toString()));
dev.stderr.on('data', (d) => (devLog += d.toString()));

async function waitHealth(timeoutMs = 180000) {
  const start = Date.now();
  let lastErr = '';
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${API}/api/health`);
      if (res.ok) return true;
      lastErr = `HTTP ${res.status}`;
    } catch (e) {
      lastErr = e?.cause?.code ?? e?.message ?? 'fetch failed';
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  console.error(`[dev] last probe error: ${lastErr}`);
  return false;
}

const healthOk = await waitHealth();
if (!healthOk) {
  console.error('[dev] wrangler dev failed to become healthy in 180s. tail:\n' + devLog.slice(-2000));
  dev.kill('SIGTERM');
  stub.close();
  rmSync(persistDir, { recursive: true, force: true });
  process.exit(2);
}
console.log('[dev] worker healthy on http://127.0.0.1:8787');

// ---------- 5. 断言 ----------
const results = [];
function check(name, cond, detail = '') {
  results.push({ name, ok: !!cond });
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
}

async function api(pathname, { method = 'GET', cookie, body } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (cookie) headers.Cookie = cookie;
  const res = await fetch(`${API}${pathname}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* non-json */
  }
  return { status: res.status, json, setCookie: res.headers.get('set-cookie') };
}

function cookieOf(res) {
  const m = (res.setCookie ?? '').match(/tq_session=([^;]+)/);
  return m ? `tq_session=${m[1]}` : '';
}

async function login(body) {
  const res = await api('/api/login', { method: 'POST', body });
  return { ...res, cookie: cookieOf(res) };
}

const threeCards = {
  mode: 'online',
  question: '冒烟测试：最近的工作状态如何？',
  spread: 'three-card',
  cards: [
    { position: 'past', card: 'rw-00-fool', orientation: 'upright' },
    { position: 'present', card: 'rw-10-wheel-of-fortune', orientation: 'reversed' },
    { position: 'future', card: 'rw-19-sun', orientation: 'upright' },
  ],
};

try {
  // 1. admin 首登
  const adminLogin = await login({
    site_access_key: vars.SITE_ACCESS_KEY,
    username: 'admin',
    password: vars.ADMIN_INITIAL_PASSWORD,
  });
  check('admin 首登 200 并签发 cookie', adminLogin.status === 200 && adminLogin.cookie.length > 20);
  check('admin 首登要求改密', adminLogin.json?.user?.must_change_password === true);
  const adminCookie = adminLogin.cookie;

  // 2. me
  const me = await api('/api/me', { cookie: adminCookie });
  check('/api/me 返回 admin', me.status === 200 && me.json?.user?.role === 'admin');

  // 3. 管理员默认 0 额度；分配后才可调用
  const initialQuota = await api('/api/quota', { cookie: adminCookie });
  check('admin 初始额度为 0', initialQuota.status === 200 && initialQuota.json?.quota?.daily_limit === 0);
  const adminBlocked = await api('/api/interpret', { method: 'POST', cookie: adminCookie, body: threeCards });
  check('admin 0 额度调用 AI → 429', adminBlocked.status === 429 && adminBlocked.json?.error?.code === 'QUOTA_USER_EXCEEDED');
  check('0 额度时 AI stub 未收到请求', stubCount === 0);
  const adminId = me.json?.user?.id;
  const allocateAdmin = await api(`/api/admin/users/${adminId}`, {
    method: 'PATCH',
    cookie: adminCookie,
    body: { daily_ai_limit: 10 },
  });
  check('管理员给自己分配 10 次额度', allocateAdmin.status === 200 && allocateAdmin.json?.user?.daily_ai_limit === 10);

  // 4. interpret 成功 + 额度消耗 + 结构化输出
  const interp1 = await api('/api/interpret', { method: 'POST', cookie: adminCookie, body: threeCards });
  check('admin /api/interpret 200', interp1.status === 200 && interp1.json?.interpretation?.format === 'structured');
  check('结构化解读：综合叙述来自 stub', interp1.json?.interpretation?.synthesis === STUB_SYNTHESIS);
  check('结构化解读：三张牌分析齐全', interp1.json?.interpretation?.cards?.length === 3);
  check('解读后 admin 额度 used_today = 1', interp1.json?.quota?.used_today === 1);
  const quota1 = await api('/api/quota', { cookie: adminCookie });
  check('/api/quota 反映已用 1 次', quota1.json?.quota?.used_today === 1);

  // 5. readings CRUD（admin 自己的记录）
  const created = await api('/api/readings', {
    method: 'POST',
    cookie: adminCookie,
    body: { ...threeCards, ai_interpretation: JSON.stringify(interp1.json?.interpretation) },
  });
  check('保存记录 201', created.status === 201 && !!created.json?.reading?.id);
  check('保存的是结构化解读 JSON', String(created.json?.reading?.ai_interpretation ?? '').includes('"format":"structured"'));
  const adminReadingId = created.json?.reading?.id;

  const list = await api('/api/readings', { cookie: adminCookie });
  check('列表包含新记录', list.status === 200 && list.json?.items?.some((r) => r.id === adminReadingId));

  const searchHit = await api(`/api/readings?q=${encodeURIComponent('冒烟测试')}`, { cookie: adminCookie });
  check('A7 关键词搜索命中', searchHit.status === 200 && searchHit.json?.total >= 1);

  const patched = await api(`/api/readings/${adminReadingId}`, {
    method: 'PATCH',
    cookie: adminCookie,
    body: { user_note: '冒烟测试备注' },
  });
  check('修改备注 200 且生效', patched.status === 200 && patched.json?.reading?.user_note === '冒烟测试备注');

  const one = await api(`/api/readings/${adminReadingId}`, { cookie: adminCookie });
  check('单条读取 200', one.status === 200 && one.json?.reading?.id === adminReadingId);

  const del = await api(`/api/readings/${adminReadingId}`, { method: 'DELETE', cookie: adminCookie });
  const afterDel = await api(`/api/readings/${adminReadingId}`, { cookie: adminCookie });
  check('删除记录 200 且再读 404', del.status === 200 && afterDel.status === 404);

  // 6. 建 member + 登录
  const mk = await api('/api/admin/users', {
    method: 'POST',
    cookie: adminCookie,
    body: { username: 'smoke_member', password: 'smoke-pw-123456', role: 'member' },
  });
  check('管理员创建 member 201', mk.status === 201 && mk.json?.user?.role === 'member');
  const memberId = mk.json?.user?.id;

  const memberLogin = await login({ site_access_key: vars.SITE_ACCESS_KEY, username: 'smoke_member', password: 'smoke-pw-123456' });
  check('member 登录 200', memberLogin.status === 200 && memberLogin.cookie.length > 20);
  const memberCookie = memberLogin.cookie;

  // 7. 越权
  const adminApiAsMember = await api('/api/admin/users', { cookie: memberCookie });
  check('member 访问 /api/admin/users → 403', adminApiAsMember.status === 403);

  const adminReading = await api('/api/readings', { method: 'POST', cookie: adminCookie, body: threeCards });
  const adminReadingId2 = adminReading.json?.reading?.id;
  const steal = await api(`/api/readings/${adminReadingId2}`, { cookie: memberCookie });
  check('member 读 admin 的记录 → 404', steal.status === 404);

  // 8. 调额度到 3
  const limit = await api(`/api/admin/users/${memberId}`, {
    method: 'PATCH',
    cookie: adminCookie,
    body: { daily_ai_limit: 3 },
  });
  check('管理员把 member 额度调为 3', limit.status === 200 && limit.json?.user?.daily_ai_limit === 3);

  // 9. member 前两次解读成功
  const m1 = await api('/api/interpret', { method: 'POST', cookie: memberCookie, body: threeCards });
  const m2 = await api('/api/interpret', { method: 'POST', cookie: memberCookie, body: threeCards });
  check('member 第 1/2 次解读 200', m1.status === 200 && m2.status === 200);
  check('member used_today = 2', m2.json?.quota?.used_today === 2);

  // 10. AI 失败 → 明确错误、无伪解读、额度不扣减；自动重试一次（stub 收到 2 次）
  stubMode = 'fail';
  const beforeFail = stubCount;
  const mFail = await api('/api/interpret', { method: 'POST', cookie: memberCookie, body: threeCards });
  check('AI 上游失败 → 502 AI_UPSTREAM_ERROR', mFail.status === 502 && mFail.json?.error?.code === 'AI_UPSTREAM_ERROR');
  check('失败响应不含伪造解读文本', !mFail.json?.interpretation);
  check('B4 失败自动重试一次（stub 收到 2 次请求）', stubCount === beforeFail + 2, `stubCount ${beforeFail} → ${stubCount}`);
  const qAfterFail = await api('/api/quota', { cookie: memberCookie });
  check('失败不扣额度（used_today 仍为 2）', qAfterFail.json?.quota?.used_today === 2);

  // 11. stub 恢复 → 第 3 次成功 → 额度用尽
  stubMode = 'ok';
  const m3 = await api('/api/interpret', { method: 'POST', cookie: memberCookie, body: threeCards });
  check('恢复后第 3 次解读 200（used 3）', m3.status === 200 && m3.json?.quota?.used_today === 3);

  const countBefore = stubCount;
  const m4 = await api('/api/interpret', { method: 'POST', cookie: memberCookie, body: threeCards });
  check('第 4 次额度耗尽 → 429 QUOTA_USER_EXCEEDED', m4.status === 429 && m4.json?.error?.code === 'QUOTA_USER_EXCEEDED');
  check('额度耗尽后 stub 未收到新请求', stubCount === countBefore, `stubCount ${countBefore} → ${stubCount}`);

  // 12. 邀请码闭环
  const inv = await api('/api/admin/invite-codes', { method: 'POST', cookie: adminCookie });
  const code = inv.json?.invite_code?.code;
  check('管理员生成邀请码 201', inv.status === 201 && !!code);
  const redeemed = await api('/api/redeem', {
    method: 'POST',
    body: { invite_code: code, site_access_key: vars.SITE_ACCESS_KEY, username: 'smoke_guest', password: 'guest-pw-123456' },
  });
  const guestCookie = cookieOf(redeemed);
  check('邀请码 redeem 201 并登录态签发', redeemed.status === 201 && guestCookie.length > 20);
  const guestMe = await api('/api/me', { cookie: guestCookie });
  check('邀请码用户 /api/me 200 member', guestMe.status === 200 && guestMe.json?.user?.role === 'member');
  const guestQuota = await api('/api/quota', { cookie: guestCookie });
  check('邀请码用户初始额度为 0', guestQuota.status === 200 && guestQuota.json?.quota?.daily_limit === 0);

  // 13. 全站统计 + token 记账 + 流式解读 + 上下文注入 + 登录限流
  // 注：admin 的第一条记录在 CRUD 用例里被删，现存 1 条（admin 第二条）→ total_readings >= 1
  const adminStats = await api('/api/admin/stats', { cookie: adminCookie });
  check(
    'admin stats 聚合（≥1 记录、≥3 用户）',
    adminStats.status === 200 && adminStats.json?.stats?.total_readings >= 1 && adminStats.json?.stats?.users?.length >= 3
  );
  check('B5 token 用量已记账（≥ 200）', (adminStats.json?.stats?.ai_tokens_total ?? 0) >= 200);

  // A4 流式解读（admin 额度 10，已用 1）
  const streamRes = await fetch(`${API}/api/interpret/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
    body: JSON.stringify(threeCards),
  });
  const streamText = await streamRes.text();
  const doneEvent = streamText.split('\n\n').find((p) => p.includes('event: done'));
  const doneData = doneEvent?.split('\n').find((l) => l.startsWith('data:'));
  let streamDone = null;
  try {
    streamDone = doneData ? JSON.parse(doneData.slice(5).trim()) : null;
  } catch {
    streamDone = null;
  }
  check(
    'A4 流式 SSE：delta + done 事件、结构化结果',
    streamRes.status === 200 && streamText.includes('event: delta') && streamDone?.interpretation?.format === 'structured'
  );

  // B3 上下文注入（admin 已有 1 条记录）
  const ctxInterp = await api('/api/interpret', { method: 'POST', cookie: adminCookie, body: { ...threeCards, include_context: true } });
  const lastCall = await fetch(`http://127.0.0.1:${STUB_PORT}/__last`).then((r) => r.json());
  let lastPrompt = '';
  try {
    lastPrompt = JSON.parse(lastCall.body)?.messages?.[1]?.content ?? '';
  } catch {
    lastPrompt = '';
  }
  check('B3 include_context=true 注入最近记录背景', ctxInterp.status === 200 && lastPrompt.includes('最近记录背景'));

  // C2 登录限流（不存在的用户名，5 次失败 → 第 6 次 429）
  let lastStatus = 0;
  for (let i = 0; i < 5; i++) {
    const bad = await api('/api/login', {
      method: 'POST',
      body: { site_access_key: vars.SITE_ACCESS_KEY, username: 'smoke_lock_probe', password: 'wrong-pw-000000' },
    });
    lastStatus = bad.status;
  }
  const lockedLogin = await api('/api/login', {
    method: 'POST',
    body: { site_access_key: vars.SITE_ACCESS_KEY, username: 'smoke_lock_probe', password: 'wrong-pw-000000' },
  });
  check('C2 连续失败 5 次 → 锁定 429 RATE_LIMITED', lastStatus === 401 && lockedLogin.status === 429 && lockedLogin.json?.error?.code === 'RATE_LIMITED');

  // stub 调用计数：interp1(1) + m1/m2(2) + mFail 重试(2) + m3(1) + stream(1) + context(1) = 8
  check('stub 总调用次数 = 8（含重试与流式）', stubCount === 8, `stubCount=${stubCount}`);
} catch (err) {
  console.error('smoke run threw:', err?.stack ?? err);
  results.push({ name: 'unexpected exception', ok: false });
} finally {
  dev.kill('SIGTERM');
  stub.close();
  rmSync(persistDir, { recursive: true, force: true });
}

const failed = results.filter((r) => !r.ok);
console.log(`\n=== ${results.length - failed.length}/${results.length} assertions passed ===`);
if (failed.length > 0) {
  console.log('failed:', failed.map((f) => f.name).join(' | '));
  process.exit(1);
}
console.log('SMOKE OK');
process.exit(0);
