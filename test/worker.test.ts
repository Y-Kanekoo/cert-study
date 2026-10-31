import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import type { Attempt, ExamConfig, Question, Session, Syllabus } from '../src/shared/types';

const read = <T>(path: string): T => JSON.parse(readFileSync(path, 'utf8')) as T;
const config = read<ExamConfig>('content/fe/exam.json');
const syllabus = read<Syllabus>('content/fe/syllabus.json');
const questions = read<Question[]>('test/fixtures/fe.json');
const database = new DatabaseSync(':memory:');
database.exec(readFileSync('migrations/0001_init.sql', 'utf8'));
const D1_MAX_BOUND_PARAMS = 100;
const adapter = {
  prepare(sql: string) {
    return {
      bind(...params: unknown[]) {
        if (params.length > D1_MAX_BOUND_PARAMS) throw new Error('too many SQL variables');
        return {
          first<T>(): T | null {
            return (database.prepare(sql).get(...params) ?? null) as T | null;
          },
          all<T>(): { results: T[]; success: true } {
            return { results: database.prepare(sql).all(...params) as T[], success: true };
          },
          run() {
            const result = database.prepare(sql).run(...params);
            return { success: true, meta: { changes: result.changes, last_row_id: result.lastInsertRowid } };
          },
        };
      },
    };
  },
  async batch(statements: { run(): unknown }[]) {
    return statements.map((statement) => statement.run());
  },
} as unknown as D1Database;
let handle: (request: Request, env: { DB: D1Database; TOKEN_SHA256: string }) => Promise<Response>;
let hash = '';
const request = (
  path: string,
  method = 'GET',
  body?: unknown,
  authorized = true,
  extra?: Record<string, string>,
): Request =>
  new Request(`https://study.example${path}`, {
    method,
    headers: {
      ...(authorized ? { Authorization: 'Bearer test-token' } : {}),
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...extra,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
async function call(
  path: string,
  method = 'GET',
  body?: unknown,
  authorized = true,
  extra?: Record<string, string>,
  tokenHash = hash,
): Promise<Response> {
  return handle(request(path, method, body, authorized, extra), { DB: adapter, TOKEN_SHA256: tokenHash });
}
beforeAll(async () => {
  Object.assign(globalThis, {
    __EXAM__: 'fe',
    __HTML__: '<html>app</html>',
    __APP_JS__: 'console.log(1)',
    __APP_CSS__: 'body{}',
    __MANIFEST__: '{}',
    __SOURCES__: '# 出典',
    __CONTENT__: { exam: config, syllabus, questions },
  });
  hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode('test-token')))]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  const module = await import('../src/worker/index');
  handle = module.handleRequest;
});
describe('Worker API と D1', () => {
  it('100 個を超えるバインド変数を拒否する', () => {
    expect(() => adapter.prepare('SELECT 1').bind(...Array(101).fill(1))).toThrow('too many SQL variables');
  });
  it('公開コンテンツとセキュリティヘッダを返す', async () => {
    const content = await call('/api/content', 'GET', undefined, false);
    expect(content.status).toBe(200);
    expect(((await content.json()) as { questions: Question[] }).questions).toHaveLength(2);
    const html = await call('/', 'GET', undefined, false);
    expect(html.headers.get('Content-Security-Policy')).toContain("frame-ancestors 'none'");
    expect(await html.text()).toContain('app');
    expect((await call('/api/health', 'GET', undefined, false)).status).toBe(200);
  });
  it('未設定、無認証、不正なトークンを拒否する', async () => {
    expect((await call('/api/progress', 'GET', undefined, true, undefined, '')).status).toBe(503);
    expect((await call('/api/progress', 'GET', undefined, false)).status).toBe(401);
    expect((await call('/api/progress', 'GET', undefined, true, undefined, '0'.repeat(64))).status).toBe(401);
  });
  it('解答から SRS と定着履歴を作り、入力を検証する', async () => {
    const attempt: Attempt = {
      questionId: questions[0].id,
      mode: 'retention',
      correct: true,
      choice: 0,
      gapDays: 7,
      elapsedMs: 20000,
      createdAt: '2026-10-01T00:00:00.000Z',
    };
    expect((await call('/api/attempts', 'POST', { ...attempt, questionId: 'unknown' })).status).toBe(400);
    expect((await call('/api/attempts', 'POST', { ...attempt, correct: false })).status).toBe(400);
    expect((await call('/api/attempts', 'POST', { ...attempt, choice: null, correct: true })).status).toBe(
      400,
    );
    const response = await call('/api/attempts', 'POST', attempt);
    expect(response.status).toBe(200);
    const progress = (await (await call('/api/progress')).json()) as {
      attempts: Attempt[];
      srs: { dueAt: string }[];
      retentionChecks: unknown[];
    };
    expect(progress.attempts).toHaveLength(1);
    expect(progress.srs[0].dueAt).toBe('2026-10-02T00:00:00.000Z');
    expect(progress.retentionChecks).toHaveLength(1);
  });
  it('模擬セッションを保存し、確認付きリセットを行う', async () => {
    const session: Session = {
      kind: 'mock',
      mockId: 'fe-A-mini',
      startedAt: '2026-10-01T00:00:00.000Z',
      finishedAt: '2026-10-01T00:30:00.000Z',
      total: 2,
      correct: 1,
      scoreRatio: 0.5,
      passed: false,
      detail: {},
    };
    expect((await call('/api/sessions', 'POST', session)).status).toBe(200);
    expect((await call('/api/progress', 'DELETE')).status).toBe(400);
    expect((await call('/api/progress', 'DELETE', undefined, true, { 'X-Confirm': 'reset' })).status).toBe(
      200,
    );
    const progress = (await (await call('/api/progress')).json()) as {
      attempts: unknown[];
      sessions: unknown[];
    };
    expect(progress.attempts).toHaveLength(0);
    expect(progress.sessions).toHaveLength(0);
  });
  it('ローカル履歴を一括取り込みする', async () => {
    const attempt: Attempt = {
      questionId: questions[1].id,
      mode: 'practice',
      correct: false,
      choice: 0,
      elapsedMs: 3000,
      createdAt: '2026-10-03T00:00:00.000Z',
    };
    expect((await call('/api/import', 'POST', { attempts: [attempt], sessions: [] })).status).toBe(200);
    const progress = (await (await call('/api/progress')).json()) as { attempts: Attempt[] };
    expect(progress.attempts[0].questionId).toBe(questions[1].id);
  });
});
