import { beforeAll, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import Ajv from 'ajv/dist/2020.js';
import { choiceMask, isCorrectChoice, selectedIndices } from '../src/shared/grading';
import { validateQuestionLinks } from '../src/shared/content';
import { composeMock, mockTypes } from '../src/shared/study';
import { blindQuestions, compareBlindAnswers } from '../scripts/blind';
import type { ExamConfig, Question, Syllabus } from '../src/shared/types';

const read = <T>(path: string): T => JSON.parse(readFileSync(path, 'utf8')) as T;
const syllabus = read<Syllabus>('content/jstqb/syllabus.json');
const base = read<Question[]>('test/fixtures/jstqb.json')[0];
const multi: Question = {
  ...base,
  id: 'jstqb-multi-test',
  type: 'multi',
  question: '境界値分析で優先する値を2つ選べ。',
  choices: ['最小値', '中央値', '最大値', '任意の値', '境界の外側'],
  answers: [0, 2],
  choiceNotes: ['下限', '境界でない', '上限', '保証なし', '対象外'],
  answer: undefined,
};

describe('複数選択問題', () => {
  it('ビットマスクを集合として採点する', () => {
    expect(choiceMask([2, 0])).toBe(5);
    expect(selectedIndices(5, 5)).toEqual([0, 2]);
    expect(isCorrectChoice(multi, 5)).toBe(true);
    expect(isCorrectChoice(multi, 3)).toBe(false);
    expect(isCorrectChoice(multi, null)).toBe(false);
  });

  it('スキーマで選択肢数、正解配列の順序、余分な answer を検証する', () => {
    const schema = read<Record<string, unknown>>('content/schema/question.schema.json');
    const validate = new Ajv({ strict: false }).compile(schema);
    const valid = { ...multi } as Record<string, unknown>;
    delete valid.answer;
    expect(validate([valid])).toBe(true);
    expect(validate([{ ...valid, answers: [2, 0] }])).toBe(false);
    expect(validate([{ ...valid, answers: [0, 0] }])).toBe(false);
    expect(validate([{ ...valid, answer: 0 }])).toBe(false);
    expect(validate([{ ...valid, choiceNotes: ['一つ'] }])).toBe(false);
    expect(
      validate([
        {
          ...valid,
          choices: multi.choices?.slice(0, 4),
          answers: [0, 4],
          choiceNotes: multi.choiceNotes?.slice(0, 4),
        },
      ]),
    ).toBe(false);
    expect(validateQuestionLinks([multi], syllabus)).toEqual([]);
    expect(
      validateQuestionLinks([{ ...multi, question: '境界値分析で優先する値を3つ選べ。' }], syllabus),
    ).toContain('jstqb-multi-test: 問題文の「Nつ選べ」と正解数が一致しません');
  });

  it('模擬試験を形式ごとに抽出する', () => {
    const config = read<ExamConfig>('content/ap/exam.json');
    const apSyllabus = read<Syllabus>('content/ap/syllabus.json');
    const apBase = read<Question[]>('test/fixtures/ap.json');
    const bMcq = { ...apBase[0], id: 'ap-case-1', section: 'B' as const };
    const bMulti = { ...bMcq, id: 'ap-case-2', type: 'multi' as const, answers: [0, 1], answer: undefined };
    const pool = [...apBase, bMcq, bMulti];
    const caseConfig = config.mockExams.find((item) => item.id === 'ap-B-case')!;
    const selfConfig = config.mockExams.find((item) => item.id === 'ap-B-self')!;
    expect(mockTypes(caseConfig)).toEqual(['mcq', 'multi']);
    expect(
      composeMock(pool, caseConfig, apSyllabus, () => 0.5)
        .map((q) => q.id)
        .sort(),
    ).toEqual(['ap-case-1', 'ap-case-2']);
    expect(composeMock(pool, selfConfig, apSyllabus, () => 0.5).map((q) => q.type)).toEqual(['self']);
  });

  it('ブラインド書き出しと集合比較に対応する', () => {
    const blind = blindQuestions([multi])[0];
    expect(blind).toMatchObject({ type: 'multi', select: 2 });
    expect(blind).not.toHaveProperty('answers');
    expect(compareBlindAnswers([multi], { [multi.id]: [2, 0] })).toEqual([]);
    expect(compareBlindAnswers([multi], { [multi.id]: [0, 0] })).toHaveLength(1);
  });
});

describe('Worker の複数選択記録', () => {
  let handle: (request: Request, env: { DB: D1Database; TOKEN_SHA256: string }) => Promise<Response>;
  let hash: string;
  const db = {
    prepare() {
      return {
        bind() {
          return { all: () => ({ results: [] }) };
        },
      };
    },
    batch: async () => [],
  } as unknown as D1Database;
  beforeAll(async () => {
    const question = { ...multi } as Record<string, unknown>;
    delete question.answer;
    Object.assign(globalThis, {
      __EXAM__: 'jstqb',
      __HTML__: '',
      __APP_JS__: '',
      __APP_CSS__: '',
      __MANIFEST__: '',
      __SOURCES__: '',
      __CONTENT__: { exam: read<ExamConfig>('content/jstqb/exam.json'), syllabus, questions: [question] },
    });
    hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode('test-token')))]
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('');
    vi.resetModules();
    handle = (await import('../src/worker/index')).handleRequest;
  });

  async function submit(choice: unknown, correct: boolean): Promise<Response> {
    return handle(
      new Request('https://study.example/api/attempts', {
        method: 'POST',
        headers: { Authorization: 'Bearer test-token', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          questionId: multi.id,
          mode: 'mock',
          choice,
          correct,
          elapsedMs: 1000,
          createdAt: '2026-10-01T00:00:00.000Z',
        }),
      }),
      { DB: db, TOKEN_SHA256: hash },
    );
  }

  it('範囲内のビットマスクと正誤の一致を検証する', async () => {
    expect((await submit(5, true)).status).toBe(200);
    expect((await submit(0, false)).status).toBe(200);
    expect((await submit(31, false)).status).toBe(200);
    expect((await submit(null, false)).status).toBe(200);
    expect((await submit(5, false)).status).toBe(400);
    expect((await submit(32, false)).status).toBe(400);
    expect((await submit(-1, false)).status).toBe(400);
    expect((await submit(1.5, false)).status).toBe(400);
  });
});
