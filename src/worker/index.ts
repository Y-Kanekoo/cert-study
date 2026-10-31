import { updateSrs } from '../shared/sm2';
import type {
  Attempt,
  ExamConfig,
  ExamId,
  Progress,
  Question,
  Session,
  SrsState,
  Syllabus,
} from '../shared/types';

declare const __EXAM__: ExamId;
declare const __HTML__: string;
declare const __APP_JS__: string;
declare const __APP_CSS__: string;
declare const __MANIFEST__: string;
declare const __SOURCES__: string;
declare const __CONTENT__: { exam: ExamConfig; syllabus: Syllabus; questions: Question[] };

type Env = { DB: D1Database; TOKEN_SHA256: string; EXAM?: string };
const content = __CONTENT__;
const questions = new Map(content.questions.map((q) => [q.id, q]));
const securityHeaders = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy':
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
};
function response(body: string, status = 200, type = 'application/json; charset=utf-8'): Response {
  return new Response(body, {
    status,
    headers: { ...securityHeaders, 'Content-Type': type, 'Cache-Control': 'no-store' },
  });
}
function json(value: unknown, status = 200): Response {
  return response(JSON.stringify(value), status);
}
function fail(message: string, status = 400): Response {
  return json({ error: message }, status);
}
function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
function date(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}
function integer(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;
}
async function parseBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}
async function authorized(request: Request, env: Env): Promise<Response | null> {
  if (!env.TOKEN_SHA256?.trim()) return fail('認証が設定されていません', 503);
  if (!/^[0-9a-f]{64}$/i.test(env.TOKEN_SHA256)) return fail('認証が設定されていません', 503);
  const match = /^Bearer (.+)$/.exec(request.headers.get('Authorization') ?? '');
  if (!match) return fail('認証が必要です', 401);
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(match[1]));
  const actual = [...new Uint8Array(bytes)];
  const expected = env.TOKEN_SHA256.match(/../g)?.map((part) => parseInt(part, 16)) ?? [];
  let diff = 0;
  for (let i = 0; i < 32; i++) diff |= actual[i] ^ expected[i];
  return diff === 0 ? null : fail('トークンが正しくありません', 401);
}
function validateAttempt(value: unknown): value is Attempt {
  if (!isObject(value) || typeof value.questionId !== 'string' || !questions.has(value.questionId))
    return false;
  const q = questions.get(value.questionId)!;
  if (
    !['practice', 'review', 'retention', 'mock'].includes(String(value.mode)) ||
    typeof value.correct !== 'boolean' ||
    !integer(value.elapsedMs, 0, 86400000) ||
    !date(value.createdAt)
  )
    return false;
  if (q.type === 'mcq') {
    if (!integer(value.choice, 0, 3) && value.choice !== null) return false;
    if (value.correct !== (value.choice === q.answer)) return false;
    if (value.selfScore != null) return false;
  }
  if (
    q.type === 'self' &&
    (!integer(value.selfScore, 0, 2) || value.correct !== value.selfScore >= 1 || value.choice != null)
  )
    return false;
  if (value.lowConfidence !== undefined && typeof value.lowConfidence !== 'boolean') return false;
  return value.mode === 'retention'
    ? integer(value.gapDays, 3, 30) && [3, 7, 14, 30].includes(value.gapDays)
    : value.gapDays == null;
}
function validateSession(value: unknown): value is Session {
  return (
    isObject(value) &&
    (value.kind === 'practice' || value.kind === 'mock') &&
    (value.mockId === undefined ||
      value.mockId === null ||
      (typeof value.mockId === 'string' && content.exam.mockExams.some((m) => m.id === value.mockId))) &&
    date(value.startedAt) &&
    date(value.finishedAt) &&
    integer(value.total, 0, 1000) &&
    integer(value.correct, 0, value.total) &&
    typeof value.scoreRatio === 'number' &&
    value.scoreRatio >= 0 &&
    value.scoreRatio <= 1 &&
    Math.abs(value.scoreRatio - (value.total ? value.correct / value.total : 0)) < 0.0001 &&
    (value.passed === undefined || value.passed === null || typeof value.passed === 'boolean') &&
    isObject(value.detail)
  );
}
function rowSrs(row: Record<string, unknown>): SrsState {
  return {
    questionId: String(row.question_id),
    ease: Number(row.ease),
    intervalDays: Number(row.interval_days),
    repetitions: Number(row.repetitions),
    dueAt: String(row.due_at),
    lapses: Number(row.lapses),
    lastResult: !!row.last_result,
    lastSeenAt: String(row.last_seen_at),
    firstCorrectAt: row.first_correct_at === null ? null : String(row.first_correct_at),
  };
}
function sessionStatement(db: D1Database, session: Session): D1PreparedStatement {
  return db
    .prepare(
      'INSERT INTO sessions(exam,kind,mock_id,started_at,finished_at,total,correct,score_ratio,passed,detail_json) VALUES(?,?,?,?,?,?,?,?,?,?)',
    )
    .bind(
      __EXAM__,
      session.kind,
      session.mockId ?? null,
      session.startedAt,
      session.finishedAt,
      session.total,
      session.correct,
      session.scoreRatio,
      session.passed == null ? null : Number(session.passed),
      JSON.stringify(session.detail),
    );
}
async function writeBatches(db: D1Database, statements: D1PreparedStatement[]): Promise<void> {
  for (let index = 0; index < statements.length; index += 1000) {
    await db.batch(statements.slice(index, index + 1000));
  }
}
function insertRows(
  db: D1Database,
  table: string,
  columns: string[],
  rows: (string | number | null)[][],
): D1PreparedStatement[] {
  const statements: D1PreparedStatement[] = [];
  for (let index = 0; index < rows.length; index += 100) {
    const chunk = rows.slice(index, index + 100);
    const values = chunk.map(() => `(${columns.map(() => '?').join(',')})`).join(',');
    statements.push(
      db.prepare(`INSERT INTO ${table}(${columns.join(',')}) VALUES${values}`).bind(...chunk.flat()),
    );
  }
  return statements;
}
async function recordAttempts(
  db: D1Database,
  attempts: Attempt[],
  sessions: Session[] = [],
): Promise<SrsState[]> {
  const rows = await db
    .prepare('SELECT * FROM srs_state WHERE exam=?')
    .bind(__EXAM__)
    .all<Record<string, unknown>>();
  const states = new Map(
    rows.results.map((row) => {
      const state = rowSrs(row);
      return [state.questionId, state] as const;
    }),
  );
  const results: SrsState[] = new Array(attempts.length);
  const statements: D1PreparedStatement[] = [];
  const attemptRows: (string | number | null)[][] = [];
  const retentionRows: (string | number | null)[][] = [];
  const chronological = attempts
    .map((attempt, index) => ({ attempt, index }))
    .sort((a, b) => a.attempt.createdAt.localeCompare(b.attempt.createdAt) || a.index - b.index);
  for (const { attempt, index } of chronological) {
    attemptRows.push([
      __EXAM__,
      attempt.questionId,
      attempt.mode,
      Number(attempt.correct),
      attempt.choice ?? null,
      attempt.selfScore ?? null,
      attempt.elapsedMs,
      attempt.createdAt,
    ]);
    // TODO(autonomous): セルフ採点2点の品質値を、ローカル保存側と設計書を含めて統一する。
    const quality = !attempt.correct
      ? 1
      : attempt.lowConfidence || attempt.selfScore === 1
        ? 3
        : attempt.elapsedMs <= 15000
          ? 5
          : 4;
    const state = updateSrs(states.get(attempt.questionId), attempt.questionId, quality, attempt.createdAt);
    states.set(attempt.questionId, state);
    results[index] = state;
    if (attempt.mode === 'retention')
      retentionRows.push([
        __EXAM__,
        attempt.questionId,
        attempt.gapDays ?? null,
        Number(attempt.correct),
        attempt.createdAt,
      ]);
  }
  statements.push(
    ...insertRows(
      db,
      'attempts',
      ['exam', 'question_id', 'mode', 'correct', 'choice', 'self_score', 'elapsed_ms', 'created_at'],
      attemptRows,
    ),
  );
  statements.push(
    ...insertRows(
      db,
      'retention_checks',
      ['exam', 'question_id', 'gap_days', 'correct', 'created_at'],
      retentionRows,
    ),
  );
  for (const questionId of new Set(attempts.map((attempt) => attempt.questionId))) {
    const state = states.get(questionId)!;
    statements.push(
      db
        .prepare(
          'INSERT INTO srs_state(exam,question_id,ease,interval_days,repetitions,due_at,lapses,last_result,last_seen_at,first_correct_at) VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(exam,question_id) DO UPDATE SET ease=excluded.ease,interval_days=excluded.interval_days,repetitions=excluded.repetitions,due_at=excluded.due_at,lapses=excluded.lapses,last_result=excluded.last_result,last_seen_at=excluded.last_seen_at,first_correct_at=excluded.first_correct_at',
        )
        .bind(
          __EXAM__,
          state.questionId,
          state.ease,
          state.intervalDays,
          state.repetitions,
          state.dueAt,
          state.lapses,
          Number(state.lastResult),
          state.lastSeenAt,
          state.firstCorrectAt,
        ),
    );
  }
  statements.push(...sessions.map((session) => sessionStatement(db, session)));
  await writeBatches(db, statements);
  return results;
}
async function progress(db: D1Database): Promise<Progress> {
  const [a, s, ss, r] = await Promise.all([
    db
      .prepare('SELECT * FROM attempts WHERE exam=? ORDER BY created_at,id')
      .bind(__EXAM__)
      .all<Record<string, unknown>>(),
    db.prepare('SELECT * FROM srs_state WHERE exam=?').bind(__EXAM__).all<Record<string, unknown>>(),
    db
      .prepare('SELECT * FROM sessions WHERE exam=? ORDER BY finished_at,id')
      .bind(__EXAM__)
      .all<Record<string, unknown>>(),
    db
      .prepare('SELECT * FROM retention_checks WHERE exam=? ORDER BY created_at,id')
      .bind(__EXAM__)
      .all<Record<string, unknown>>(),
  ]);
  return {
    attempts: a.results.map((row) => ({
      id: Number(row.id),
      questionId: String(row.question_id),
      mode: row.mode as Attempt['mode'],
      correct: !!row.correct,
      choice: row.choice === null ? null : Number(row.choice),
      selfScore: row.self_score === null ? null : Number(row.self_score),
      elapsedMs: Number(row.elapsed_ms),
      createdAt: String(row.created_at),
    })),
    srs: s.results.map(rowSrs),
    sessions: ss.results.map((row) => ({
      id: Number(row.id),
      kind: row.kind as Session['kind'],
      mockId: row.mock_id === null ? null : String(row.mock_id),
      startedAt: String(row.started_at),
      finishedAt: String(row.finished_at),
      total: Number(row.total),
      correct: Number(row.correct),
      scoreRatio: Number(row.score_ratio),
      passed: row.passed === null ? null : !!row.passed,
      detail: JSON.parse(String(row.detail_json)) as Record<string, unknown>,
    })),
    retentionChecks: r.results.map((row) => ({
      questionId: String(row.question_id),
      gapDays: Number(row.gap_days),
      correct: !!row.correct,
      createdAt: String(row.created_at),
    })),
  };
}
export async function handleRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;
  if (!path.startsWith('/api/')) {
    if (request.method !== 'GET' && request.method !== 'HEAD')
      return fail('メソッドが許可されていません', 405);
    const assets: Record<string, [string, string]> = {
      '/app.js': [__APP_JS__, 'text/javascript; charset=utf-8'],
      '/app.css': [__APP_CSS__, 'text/css; charset=utf-8'],
      '/manifest.webmanifest': [__MANIFEST__, 'application/manifest+json; charset=utf-8'],
      '/sources.md': [__SOURCES__, 'text/markdown; charset=utf-8'],
    };
    const [body, type] = assets[path] ?? [__HTML__, 'text/html; charset=utf-8'];
    return response(request.method === 'HEAD' ? '' : body, 200, type);
  }
  if (request.method === 'GET' && path === '/api/health')
    return json({ ok: true, exam: __EXAM__, questionCount: questions.size, version: '0.1.0' });
  if (request.method === 'GET' && path === '/api/content') return json(content);
  const authError = await authorized(request, env);
  if (authError) return authError;
  try {
    if (request.method === 'GET' && path === '/api/auth/check') return json({ ok: true });
    if (request.method === 'GET' && path === '/api/progress') return json(await progress(env.DB));
    if (request.method === 'DELETE' && path === '/api/progress') {
      if (request.headers.get('X-Confirm') !== 'reset') return fail('リセット確認ヘッダが必要です');
      await writeBatches(
        env.DB,
        ['attempts', 'srs_state', 'sessions', 'retention_checks'].map((table) =>
          env.DB.prepare(`DELETE FROM ${table} WHERE exam=?`).bind(__EXAM__),
        ),
      );
      return json({ ok: true });
    }
    if (request.method === 'POST' && path === '/api/attempts') {
      const body = await parseBody(request);
      const items = Array.isArray(body) ? body : [body];
      if (!items.length || items.length > 500 || !items.every(validateAttempt))
        return fail('解答データが不正です');
      return json({ states: await recordAttempts(env.DB, items as Attempt[]) });
    }
    if (request.method === 'POST' && path === '/api/sessions') {
      const body = await parseBody(request);
      if (!validateSession(body)) return fail('セッションデータが不正です');
      await writeBatches(env.DB, [sessionStatement(env.DB, body)]);
      return json({ ok: true });
    }
    if (request.method === 'POST' && path === '/api/import') {
      const body = await parseBody(request);
      if (
        !isObject(body) ||
        !Array.isArray(body.attempts) ||
        !Array.isArray(body.sessions) ||
        body.attempts.length > 5000 ||
        body.sessions.length > 1000 ||
        !body.attempts.every(validateAttempt) ||
        !body.sessions.every(validateSession)
      )
        return fail('取り込みデータが不正です');
      const attempts = body.attempts as Attempt[];
      await recordAttempts(env.DB, attempts, body.sessions as Session[]);
      return json({ ok: true, attempts: attempts.length, sessions: body.sessions.length });
    }
    return fail('見つかりません', 404);
  } catch {
    return fail('サーバー処理に失敗しました', 500);
  }
}
export default { fetch: handleRequest } satisfies ExportedHandler<Env>;
