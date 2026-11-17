import { Hono } from 'hono';
import { requireAdmin, requireAuth } from './auth';
import type { Env } from './env';
import { cleanupExpiredSessions, cleanupLoginAttempts } from './limiter';
import { adminRoutes } from './routes/admin';
import { authRoutes } from './routes/auth';
import { interpretRoutes } from './routes/interpret';
import { readingRoutes } from './routes/readings';
import { statsRoutes, quotaRoutes } from './routes/stats';

export type AppEnv = { Bindings: Env; Variables: { user: import('./auth').UserRow } };

const app = new Hono<AppEnv>().basePath('/api');

// ---------- CORS：只允许白名单来源（GitHub Pages 域名 + 本地开发），其余一律拒 ----------

function allowedOrigins(env: Env): Set<string> {
  const list = (env.ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((s) => s.trim().replace(/\/+$/, ''))
    .filter(Boolean);
  return new Set(list);
}

app.use('*', async (c, next) => {
  const origin = c.req.header('Origin');
  const allowed = allowedOrigins(c.env);

  if (c.req.method === 'OPTIONS') {
    if (origin && allowed.has(origin.replace(/\/+$/, ''))) {
      c.header('Access-Control-Allow-Origin', origin);
      c.header('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
      c.header('Access-Control-Allow-Headers', 'Content-Type');
      c.header('Access-Control-Allow-Credentials', 'true');
      c.header('Access-Control-Max-Age', '86400');
      c.header('Vary', 'Origin');
      return c.body(null, 204);
    }
    return c.body(null, 403);
  }

  if (origin) {
    if (!allowed.has(origin.replace(/\/+$/, ''))) {
      return c.json({ error: { code: 'ORIGIN_NOT_ALLOWED', message: '来源不被允许' } }, 403);
    }
    c.header('Access-Control-Allow-Origin', origin);
    c.header('Access-Control-Allow-Credentials', 'true');
    c.header('Vary', 'Origin');
  }
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('Referrer-Policy', 'no-referrer');
  await next();
});

// ---------- 公共路由 ----------

app.get('/health', (c) => c.json({ ok: true }));
app.route('/', authRoutes); // /api/login /api/logout /api/me /api/redeem

// ---------- 登录后路由 ----------

app.use('*', requireAuth);
app.route('/readings', readingRoutes); // /api/readings, /api/readings/:id
app.route('/interpret', interpretRoutes); // /api/interpret
app.route('/stats', statsRoutes); // /api/stats
app.route('/quota', quotaRoutes); // /api/quota

// ---------- 管理员路由 ----------

// 双挂：'/admin/*' 覆盖子路径，'/admin' 覆盖精确路径（未来若新增 adminRoutes.get('/') 也不会裸奔）
app.use('/admin', requireAdmin);
app.use('/admin/*', requireAdmin);
app.route('/admin', adminRoutes);

// ---------- 兜底 ----------

app.notFound((c) => c.json({ error: { code: 'NOT_FOUND', message: '接口不存在' } }, 404));

app.onError((err, c) => {
  console.error('unhandled error:', err instanceof Error ? err.message : err);
  return c.json({ error: { code: 'INTERNAL', message: '服务器内部错误' } }, 500);
});

// ---------- 定时清理（C3）：过期 session 与过期登录限流记录 ----------

async function scheduledCleanup(env: Env): Promise<void> {
  try {
    await cleanupExpiredSessions(env.DB);
    await cleanupLoginAttempts(env.DB);
  } catch (e) {
    console.error('scheduled cleanup failed:', e instanceof Error ? e.message : e);
  }
}

// 命名导出 Hono app（测试/工具直接使用 app.request，无需经过 Workers 运行时）
export { app };

export default {
  fetch: app.fetch,
  scheduled: (_controller: ScheduledController, env: Env, ctx: ExecutionContext) => {
    ctx.waitUntil(scheduledCleanup(env));
  },
} satisfies ExportedHandler<Env>;
