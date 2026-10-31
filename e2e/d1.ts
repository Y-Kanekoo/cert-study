import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

export function createD1(): D1Database {
  const database = new DatabaseSync(':memory:');
  database.exec(readFileSync('migrations/0001_init.sql', 'utf8'));
  const statement = (sql: string, params: unknown[]) => ({
    sql,
    params,
    bind(...values: unknown[]) {
      return statement(sql, values);
    },
    first<T>(): T | null {
      return (database.prepare(sql).get(...params) ?? null) as T | null;
    },
    all<T>(): { results: T[]; success: true } {
      return { results: database.prepare(sql).all(...params) as T[], success: true };
    },
    run() {
      return database.prepare(sql).run(...params);
    },
    async exec() {
      database.exec(sql);
      return { count: 1, duration: 0 };
    },
  });
  return {
    prepare(sql: string) {
      return statement(sql, []);
    },
    async batch(statements: ReturnType<typeof statement>[]) {
      return statements.map((item) => database.prepare(item.sql).run(...item.params));
    },
    async exec(sql: string) {
      database.exec(sql);
      return { count: 1, duration: 0 };
    },
  } as unknown as D1Database;
}
