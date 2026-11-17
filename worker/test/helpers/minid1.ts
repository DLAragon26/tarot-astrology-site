import { createRequire } from 'node:module';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// 测试用 D1 兼容适配器：基于 node:sqlite 的内存库，执行真实的 migration SQL。
// 覆盖 worker 代码用到的 D1 接口子集：prepare/bind/first/all/run、batch。
// 通过 createRequire 加载，避免 vite 静态解析 node:sqlite 失败。

const require = createRequire(import.meta.url);
const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite');

const here = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.resolve(here, '../../migrations');

function applyMigrations(db: DatabaseSync): void {
  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  for (const f of files) {
    db.exec(readFileSync(path.join(migrationsDir, f), 'utf8'));
  }
}

class Stmt {
  constructor(
    private db: DatabaseSync,
    private sql: string,
    private params: unknown[] = []
  ) {}

  bind(...params: unknown[]): Stmt {
    return new Stmt(this.db, this.sql, params);
  }

  first<T = Record<string, unknown>>(): T | null {
    return (this.db.prepare(this.sql).get(...this.params) as T | undefined) ?? null;
  }

  all<T = Record<string, unknown>>(): { results: T[]; success: true; meta: Record<string, unknown> } {
    const rows = this.db.prepare(this.sql).all(...this.params) as T[];
    return { results: rows, success: true, meta: {} };
  }

  run(): { success: true; meta: Record<string, unknown> } {
    const result = this.db.prepare(this.sql).run(...this.params);
    return { success: true, meta: { changes: Number(result.changes) } };
  }
}

export class MiniD1 {
  private db: DatabaseSync;

  constructor() {
    this.db = new DatabaseSync(':memory:');
    applyMigrations(this.db);
  }

  prepare(sql: string): Stmt {
    return new Stmt(this.db, sql);
  }

  batch<T = unknown>(stmts: Stmt[]): { results: T[]; success: true; meta: Record<string, unknown> }[] {
    // D1 契约：batch 返回 D1Result[]（数组），每项 { results, success, meta }
    return stmts.map((s) => {
      const result = s.run();
      return { results: [] as T[], success: true as const, meta: result.meta };
    });
  }

  /** 测试辅助：直接查询 */
  raw<T = Record<string, unknown>>(sql: string): T[] {
    return this.db.prepare(sql).all() as T[];
  }
}

export function createTestDb(): MiniD1 & D1Database {
  return new MiniD1() as unknown as MiniD1 & D1Database;
}
