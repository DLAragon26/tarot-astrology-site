import {
  ERR,
  shanghaiDate,
  validatePassword,
  validateUsername,
  type AdminCreateUserRequest,
  type AdminPatchUserRequest,
} from '@tarot/shared';
import { Hono } from 'hono';
import { hashPassword, toPublicUser, type UserRow } from '../auth';
import type { Env } from '../env';
import { getGlobalDailyLimit, getGlobalUsage, getUserDailyLimit, getUserUsage } from '../quota';

export const adminRoutes = new Hono<{ Bindings: Env; Variables: { user: UserRow } }>();

function nowISO(): string {
  return new Date().toISOString();
}

function generateInviteCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 去掉易混淆的 I/O/0/1
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  let code = '';
  for (const b of bytes) code += alphabet[b % alphabet.length];
  return `TQ-${code}`;
}

// GET /api/admin/users
adminRoutes.get('/users', async (c) => {
  const rows = await c.env.DB.prepare(
    `SELECT u.*,
       COALESCE((SELECT count FROM ai_usage a WHERE a.user_id = u.id AND a.usage_date = ?), 0) AS used_today,
       COALESCE((SELECT COUNT(*) FROM readings r WHERE r.user_id = u.id), 0) AS readings_count
     FROM users u ORDER BY u.created_at ASC`
  )
    .bind(shanghaiDate())
    .all<
      UserRow & { used_today: number; readings_count: number }
    >();

  const users = [];
  for (const row of rows.results ?? []) {
    const limit = await getUserDailyLimit(c.env.DB, row.daily_ai_limit);
    users.push({
      ...toPublicUser(row),
      is_active: row.is_active === 1,
      used_today: row.used_today,
      readings_count: row.readings_count,
      remaining: row.role === 'admin' ? -1 : Math.max(limit - row.used_today, 0),
    });
  }
  return c.json({ users });
});

// POST /api/admin/users — 管理员直接创建账号（无公开注册）。
adminRoutes.post('/users', async (c) => {
  let body: Partial<AdminCreateUserRequest>;
  try {
    body = (await c.req.json()) as Partial<AdminCreateUserRequest>;
  } catch {
    return c.json({ error: { code: ERR.VALIDATION, message: '请求体必须是 JSON' } }, 400);
  }
  const username = validateUsername(body.username);
  const password = validatePassword(body.password);
  if (!username) return c.json({ error: { code: ERR.VALIDATION, message: '用户名需为 3-32 位字母、数字或下划线' } }, 400);
  if (!password) return c.json({ error: { code: ERR.VALIDATION, message: '密码至少 8 位' } }, 400);
  const role = body.role === 'admin' ? 'admin' : 'member';
  let dailyLimit: number | null = null;
  if (body.daily_ai_limit !== undefined && body.daily_ai_limit !== null) {
    const n = Number(body.daily_ai_limit);
    if (!Number.isInteger(n) || n < 0 || n > 10000) {
      return c.json({ error: { code: ERR.VALIDATION, message: '每日额度必须是 0-10000 的整数' } }, 400);
    }
    dailyLimit = n;
  }

  const existing = await c.env.DB.prepare('SELECT id FROM users WHERE username = ?').bind(username).first();
  if (existing) return c.json({ error: { code: ERR.CONFLICT, message: '用户名已存在' } }, 409);

  const id = crypto.randomUUID();
  const ts = nowISO();
  const hash = await hashPassword(password);
  await c.env.DB.prepare(
    `INSERT INTO users (id, username, password_hash, role, daily_ai_limit, is_active, must_change_password, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 1, 0, ?, ?)`
  )
    .bind(id, username, hash, role, dailyLimit, ts, ts)
    .run();

  const limit = await getUserDailyLimit(c.env.DB, dailyLimit);
  return c.json(
    {
      user: {
        id,
        username,
        role,
        daily_ai_limit: dailyLimit,
        is_active: true,
        must_change_password: false,
        created_at: ts,
        used_today: 0,
        readings_count: 0,
        remaining: role === 'admin' ? -1 : limit,
      },
    },
    201
  );
});

// PATCH /api/admin/users/:id — 角色 / 额度 / 启停 / 重置密码。不允许修改自己的角色或停用自己。
adminRoutes.patch('/users/:id', async (c) => {
  const admin = c.get('user');
  const id = c.req.param('id');
  const target = await c.env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(id).first<UserRow>();
  if (!target) return c.json({ error: { code: ERR.NOT_FOUND, message: '用户不存在' } }, 404);

  let body: Partial<AdminPatchUserRequest>;
  try {
    body = (await c.req.json()) as Partial<AdminPatchUserRequest>;
  } catch {
    return c.json({ error: { code: ERR.VALIDATION, message: '请求体必须是 JSON' } }, 400);
  }

  if (target.id === admin.id && (body.role !== undefined || body.is_active !== undefined)) {
    return c.json({ error: { code: ERR.FORBIDDEN, message: '不能修改自己的角色或停用自己' } }, 403);
  }

  const updates: string[] = [];
  const values: (string | number)[] = [];
  if (body.role !== undefined) {
    if (body.role !== 'admin' && body.role !== 'member') {
      return c.json({ error: { code: ERR.VALIDATION, message: 'role 必须是 admin 或 member' } }, 400);
    }
    updates.push('role = ?');
    values.push(body.role);
  }
  if (body.daily_ai_limit !== undefined) {
    if (body.daily_ai_limit === null) {
      updates.push('daily_ai_limit = NULL');
    } else {
      const n = Number(body.daily_ai_limit);
      if (!Number.isInteger(n) || n < 0 || n > 10000) {
        return c.json({ error: { code: ERR.VALIDATION, message: '每日额度必须是 0-10000 的整数或 null（默认）' } }, 400);
      }
      updates.push('daily_ai_limit = ?');
      values.push(n);
    }
  }
  if (body.is_active !== undefined) {
    updates.push('is_active = ?');
    values.push(body.is_active ? 1 : 0);
  }
  if (body.new_password !== undefined) {
    const pw = validatePassword(body.new_password);
    if (!pw) return c.json({ error: { code: ERR.VALIDATION, message: '新密码至少 8 位' } }, 400);
    const hash = await hashPassword(pw);
    updates.push('password_hash = ?', 'must_change_password = 1');
    values.push(hash);
  }
  if (updates.length === 0) {
    return c.json({ error: { code: ERR.VALIDATION, message: '没有可更新的字段' } }, 400);
  }
  updates.push('updated_at = ?');
  values.push(nowISO());
  values.push(id);
  await c.env.DB.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`)
    .bind(...values)
    .run();

  // 重置密码或停用时吊销其全部会话
  if (body.new_password !== undefined || body.is_active === false) {
    await c.env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(id).run();
  }

  const fresh = await c.env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(id).first<UserRow>();
  return c.json({ user: fresh ? toPublicUser(fresh) : null });
});

// POST /api/admin/invite-codes
adminRoutes.post('/invite-codes', async (c) => {
  const admin = c.get('user');
  const code = generateInviteCode();
  await c.env.DB.prepare('INSERT INTO invite_codes (code, created_by, created_at, status) VALUES (?, ?, ?, ?)')
    .bind(code, admin.id, nowISO(), 'active')
    .run();
  return c.json({ invite_code: { code, status: 'active', created_at: nowISO() } }, 201);
});

// GET /api/admin/invite-codes
adminRoutes.get('/invite-codes', async (c) => {
  const rows = await c.env.DB.prepare(
    `SELECT i.code, i.created_at, i.status, i.redeemed_at, u.username AS redeemed_by
     FROM invite_codes i LEFT JOIN users u ON u.id = i.redeemed_by
     ORDER BY i.created_at DESC LIMIT 200`
  ).all<{ code: string; created_at: string; status: string; redeemed_at: string | null; redeemed_by: string | null }>();
  return c.json({
    invite_codes: (rows.results ?? []).map((r) => ({
      code: r.code,
      created_at: r.created_at,
      status: r.status,
      redeemed_by: r.redeemed_by,
      redeemed_at: r.redeemed_at,
    })),
  });
});

// GET /api/admin/stats
adminRoutes.get('/stats', async (c) => {
  const today = shanghaiDate();
  const totalRow = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM readings').first<{ n: number }>();
  const globalLimit = await getGlobalDailyLimit(c.env.DB, c.env);
  const globalUsed = await getGlobalUsage(c.env.DB);

  const userRows = await c.env.DB.prepare(
    `SELECT u.*,
       COALESCE((SELECT count FROM ai_usage a WHERE a.user_id = u.id AND a.usage_date = ?), 0) AS used_today,
       COALESCE((SELECT COUNT(*) FROM readings r WHERE r.user_id = u.id), 0) AS readings_count
     FROM users u ORDER BY u.created_at ASC`
  )
    .bind(today)
    .all<UserRow & { used_today: number; readings_count: number }>();

  const inviteRows = await c.env.DB.prepare(
    `SELECT code, created_at, status, redeemed_by, redeemed_at FROM invite_codes ORDER BY created_at DESC LIMIT 200`
  ).all<{ code: string; created_at: string; status: string; redeemed_by: string | null; redeemed_at: string | null }>();

  const users = [];
  for (const row of userRows.results ?? []) {
    const limit = await getUserDailyLimit(c.env.DB, row.daily_ai_limit);
    users.push({
      ...toPublicUser(row),
      is_active: row.is_active === 1,
      used_today: row.used_today,
      readings_count: row.readings_count,
      remaining: row.role === 'admin' ? -1 : Math.max(limit - row.used_today, 0),
    });
  }

  return c.json({
    stats: {
      total_readings: totalRow?.n ?? 0,
      global_limit: globalLimit,
      global_used_today: globalUsed,
      users,
      invite_codes: inviteRows.results ?? [],
    },
  });
});
