import { describe, expect, it } from 'vitest';
import {
  getGlobalDailyLimit,
  getTokensForDate,
  getTokensTotal,
  recordTokenUsage,
  releaseQuota,
  tryConsumeGlobalQuota,
  tryConsumeUserQuota,
} from '../src/quota';
import { createTestDb } from './helpers/minid1';
import { shanghaiDate as sharedDate } from '@tarot/shared';

describe('全站每日上限的取值优先级（P2-C）', () => {
  it('settings 表优先', async () => {
    const DB = createTestDb();
    await DB.prepare("UPDATE settings SET value = '77' WHERE key = 'global_daily_ai_limit'").run();
    const env = { GLOBAL_DAILY_AI_LIMIT: '50' } as never as Parameters<typeof getGlobalDailyLimit>[1];
    expect(await getGlobalDailyLimit(DB as never, env)).toBe(77);
  });

  it('settings 缺失时回落 env.GLOBAL_DAILY_AI_LIMIT（文档教的调法必须生效）', async () => {
    const DB = createTestDb();
    await DB.prepare("DELETE FROM settings WHERE key = 'global_daily_ai_limit'").run();
    const env = { GLOBAL_DAILY_AI_LIMIT: '50' } as never as Parameters<typeof getGlobalDailyLimit>[1];
    expect(await getGlobalDailyLimit(DB as never, env)).toBe(50);
  });

  it('settings 与 env 都缺失时兜底常量 200；非法值被忽略', async () => {
    const DB = createTestDb();
    await DB.prepare("DELETE FROM settings WHERE key = 'global_daily_ai_limit'").run();
    const none = undefined as unknown as Parameters<typeof getGlobalDailyLimit>[1];
    expect(await getGlobalDailyLimit(DB as never, none)).toBe(200);
    const bad = { GLOBAL_DAILY_AI_LIMIT: 'not-a-number' } as never as Parameters<typeof getGlobalDailyLimit>[1];
    expect(await getGlobalDailyLimit(DB as never, bad)).toBe(200);
  });
});

describe('C1 原子额度', () => {
  it('个人额度：limit=0 首插即拒绝；limit=2 依次 1/1/0；退还后可再用', async () => {
    const DB = createTestDb();
    await DB.prepare(
      "INSERT INTO users (id, username, password_hash, role, daily_ai_limit, is_active, must_change_password, created_at, updated_at) VALUES ('u1','u1','x','member',NULL,1,0,'2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z')"
    ).run();
    const date = sharedDate();

    expect(await tryConsumeUserQuota(DB as never, 'u1', 0, date)).toBe(false);

    expect(await tryConsumeUserQuota(DB as never, 'u1', 2, date)).toBe(true);
    expect(await tryConsumeUserQuota(DB as never, 'u1', 2, date)).toBe(true);
    expect(await tryConsumeUserQuota(DB as never, 'u1', 2, date)).toBe(false);

    const row = await DB.prepare('SELECT count FROM ai_usage WHERE user_id = ? AND usage_date = ?')
      .bind('u1', date)
      .first<{ count: number }>();
    expect(row?.count).toBe(2);

    await releaseQuota(DB as never, 'u1', date);
    expect(await tryConsumeUserQuota(DB as never, 'u1', 2, date)).toBe(true);
  });

  it('全站额度同样原子；limit=0 不插入行', async () => {
    const DB = createTestDb();
    const date = sharedDate();
    expect(await tryConsumeGlobalQuota(DB as never, 0, date)).toBe(false);
    expect(await tryConsumeGlobalQuota(DB as never, 1, date)).toBe(true);
    expect(await tryConsumeGlobalQuota(DB as never, 1, date)).toBe(false);
    const row = await DB.prepare('SELECT count FROM global_ai_usage WHERE usage_date = ?').bind(date).first<{ count: number }>();
    expect(row?.count).toBe(1);
  });
});

describe('B5 token 记账', () => {
  it('recordTokenUsage 累加，getTokensTotal / getTokensForDate 汇总', async () => {
    const DB = createTestDb();
    await DB.prepare(
      "INSERT INTO users (id, username, password_hash, role, daily_ai_limit, is_active, must_change_password, created_at, updated_at) VALUES ('u2','u2','x','member',NULL,1,0,'2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z')"
    ).run();
    const date = sharedDate();
    await tryConsumeUserQuota(DB as never, 'u2', 5, date);
    await recordTokenUsage(DB as never, 'u2', 100, 40, date);
    await recordTokenUsage(DB as never, 'u2', 20, 10, date);
    expect(await getTokensTotal(DB as never, 'u2')).toBe(170);
    expect(await getTokensForDate(DB as never, date)).toBe(170);
    expect(await getTokensTotal(DB as never, null)).toBe(170);
  });
});
