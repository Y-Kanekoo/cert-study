import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { updateSrs } from '../src/shared/sm2';
import type { Attempt, ExamConfig, Question, Session, Syllabus } from '../src/shared/types';

const read = <T>(path: string): T => JSON.parse(readFileSync(path, 'utf8')) as T;
const config = read<ExamConfig>('content/fe/exam.json');
const syllabus = read<Syllabus>('content/fe/syllabus.json');
const questions = read<Question[]>('test/fixtures/fe.json');
const uniqueQuestions = Array.from({ length: 2000 }, (_, index) => ({
  ...questions[index % questions.length],
  id: `fe-batch-${index}`,
}));
let handle: (
  request: Request,
  env: { DB: D1Database; TOKEN_SHA256: string; EXAM?: string },
) => Promise<Response>;
let hash = '';

function fakeD1(): { db: D1Database; count: () => number; reset: () => void } {
  const database = new DatabaseSync(':memory:');
  database.exec(readFileSync('migrations/0001_init.sql', 'utf8'));
  let queries = 0;
  const statement = (sql: string, params: unknown[]) => ({
    sql,
    params,
    bind(...values: unknown[]) {
      return statement(sql, values);
    },
    first<T>(): T | null {
      queries++;
      return (database.prepare(sql).get(...params) ?? null) as T | null;
    },
    all<T>(): { results: T[]; success: true } {
      queries++;
      return { results: database.prepare(sql).all(...params) as T[], success: true };
    },
    run() {
      queries++;
      return database.prepare(sql).run(...params);
    },
  });
  const db = {
    prepare(sql: string) {
      return statement(sql, []);
    },
    async batch(statements: ReturnType<typeof statement>[]) {
      queries++;
      expect(statements.length).toBeLessThanOrEqual(1000);
      return statements.map((item) => database.prepare(item.sql).run(...item.params));
    },
  } as unknown as D1Database;
  return {
    db,
    count: () => queries,
    reset: () => {
      queries = 0;
    },
  };
}

function attempt(index: number, mode: Attempt['mode'] = 'mock'): Attempt {
  const question = questions[index % questions.length];
  const correct = index % 3 !== 0;
  return {
    questionId: question.id,
    mode,
    correct,
    choice: correct ? question.answer : (question.answer! + 1) % 4,
    gapDays: mode === 'retention' ? 7 : null,
    elapsedMs: index % 2 ? 20000 : 3000,
    createdAt: new Date(Date.UTC(2026, 9, 1, 0, 0, index)).toISOString(),
  };
}

async function call(db: D1Database, path: string, method: string, body?: unknown): Promise<Response> {
  return handle(
    new Request(`https://study.example${path}`, {
      method,
      headers: {
        Authorization: 'Bearer test-token',
        'Content-Type': 'application/json',
        'X-Confirm': 'reset',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    { DB: db, TOKEN_SHA256: hash, EXAM: 'ap' },
  );
}

beforeAll(async () => {
  Object.assign(globalThis, {
    __EXAM__: 'fe',
    __HTML__: '',
    __APP_JS__: '',
    __APP_CSS__: '',
    __MANIFEST__: '',
    __SOURCES__: '',
    __CONTENT__: { exam: config, syllabus, questions: [...questions, ...uniqueQuestions] },
  });
  hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode('test-token')))]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
  handle = (await import('../src/worker/index')).handleRequest;
});

describe('D1 バッチ書き込み', () => {
  it('認証未設定のエラーを日本語で返す', async () => {
    const fake = fakeD1();
    const response = await handle(new Request('https://study.example/api/progress'), {
      DB: fake.db,
      TOKEN_SHA256: '',
      EXAM: 'ap',
    });
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: '認証が設定されていません' });
  });

  it('80 解答を 5 回以内で保存し、時系列で SRS を更新する', async () => {
    const fake = fakeD1();
    const attempts = Array.from({ length: 80 }, (_, index) => attempt(index)).reverse();
    const response = await call(fake.db, '/api/attempts', 'POST', attempts);
    expect(response.status).toBe(200);
    expect(fake.count()).toBeLessThanOrEqual(5);
    const states = ((await response.json()) as { states: { lastSeenAt: string }[] }).states;
    expect(states[0].lastSeenAt).toBe(attempts[0].createdAt);
    fake.reset();
    const progress = (await (await call(fake.db, '/api/progress', 'GET')).json()) as {
      attempts: Attempt[];
      srs: { questionId: string; repetitions: number; lapses: number }[];
    };
    expect(progress.attempts).toHaveLength(80);
    expect(progress.srs).toHaveLength(2);
    for (const question of questions) {
      const expected = attempts
        .filter((item) => item.questionId === question.id)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
        .reduce<ReturnType<typeof updateSrs> | undefined>(
          (previous, item) =>
            updateSrs(
              previous,
              item.questionId,
              !item.correct ? 1 : item.elapsedMs <= 15000 ? 5 : 4,
              item.createdAt,
            ),
          undefined,
        );
      const actual = progress.srs.find((state) => state.questionId === question.id);
      expect(actual?.repetitions).toBe(expected?.repetitions);
      expect(actual?.lapses).toBe(expected?.lapses);
    }
  });

  it('2000 解答とセッションを 5 回以内で取り込む', async () => {
    const fake = fakeD1();
    const attempts = Array.from({ length: 2000 }, (_, index) => attempt(index, 'practice'));
    const sessions: Session[] = [
      {
        kind: 'practice',
        startedAt: attempts[0].createdAt,
        finishedAt: attempts.at(-1)!.createdAt,
        total: 1000,
        correct: 667,
        scoreRatio: 667 / 1000,
        detail: {},
      },
    ];
    const response = await call(fake.db, '/api/import', 'POST', { attempts, sessions });
    expect(response.status).toBe(200);
    expect(fake.count()).toBeLessThanOrEqual(5);
    const progress = (await (await call(fake.db, '/api/progress', 'GET')).json()) as {
      attempts: Attempt[];
      sessions: Session[];
    };
    expect(progress.attempts).toHaveLength(2000);
    expect(progress.sessions).toHaveLength(1);
  });

  it('2000 件すべて異なる定着チェックも 5 回以内で取り込む', async () => {
    const fake = fakeD1();
    const attempts = uniqueQuestions.map((question, index) => ({
      ...attempt(index, 'retention'),
      questionId: question.id,
    }));
    const response = await call(fake.db, '/api/import', 'POST', { attempts, sessions: [] });
    expect(response.status).toBe(200);
    expect(fake.count()).toBeLessThanOrEqual(5);
    const progress = (await (await call(fake.db, '/api/progress', 'GET')).json()) as {
      attempts: Attempt[];
      srs: unknown[];
      retentionChecks: unknown[];
    };
    expect(progress.attempts).toHaveLength(2000);
    expect(progress.srs).toHaveLength(2000);
    expect(progress.retentionChecks).toHaveLength(2000);
  });

  it('定着履歴とリセットをそれぞれバッチで書く', async () => {
    const fake = fakeD1();
    expect((await call(fake.db, '/api/attempts', 'POST', [attempt(0, 'retention')])).status).toBe(200);
    fake.reset();
    expect((await call(fake.db, '/api/progress', 'DELETE')).status).toBe(200);
    expect(fake.count()).toBe(1);
    const progress = (await (await call(fake.db, '/api/progress', 'GET')).json()) as {
      attempts: Attempt[];
      retentionChecks: unknown[];
    };
    expect(progress.attempts).toHaveLength(0);
    expect(progress.retentionChecks).toHaveLength(0);
  });
});
