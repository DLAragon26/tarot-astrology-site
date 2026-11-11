import { describe, expect, it } from 'vitest';
import { getGlobalDailyLimit } from '../src/quota';
import { createTestDb } from './helpers/minid1';

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
