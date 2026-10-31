import { describe, expect, it } from 'vitest';
import { filterPracticeQuestions, type PracticeFilters, type WrongPeriod } from '../src/shared/filters';
import type { Attempt, Question } from '../src/shared/types';

const now = '2026-11-01T12:00:00.000Z';
const question = (id: string, difficulty: Question['difficulty'] = 1): Question => ({
  id,
  exam: 'jstqb',
  topic: '1',
  type: 'mcq',
  difficulty,
  section: 'A',
  question: '問題',
  explanation: '解説',
  status: 'verified',
  origin: 'original',
});
const attempt = (questionId: string, correct: boolean, createdAt = now): Attempt => ({
  questionId,
  correct,
  createdAt,
  mode: 'practice',
  elapsedMs: 1000,
});
const select = (questions: Question[], attempts: Attempt[], filters: PracticeFilters): string[] =>
  filterPracticeQuestions(questions, attempts, filters, now).map((q) => q.id);

describe('練習の誤答絞り込み', () => {
  it('絞り込みなしでは履歴の有無によらず全問題を返す', () => {
    expect(select([question('未回答'), question('正解')], [attempt('正解', true)], {})).toEqual([
      '未回答',
      '正解',
    ]);
  });

  it('すべては誤答経験、既定値と直近の回答が誤りは最新の正誤で判定する', () => {
    const questions = ['未回答', '正解のみ', '誤答', '克服'].map((id) => question(id));
    const attempts = [
      attempt('正解のみ', true),
      attempt('誤答', false),
      attempt('克服', false, '2026-10-01T00:00:00Z'),
      attempt('克服', true, '2026-10-02T00:00:00Z'),
      attempt('克服', true),
    ];
    expect(select(questions, attempts, { wrongOnly: true, wrongPeriod: 'ever' })).toEqual(['誤答', '克服']);
    expect(select(questions, attempts, { wrongOnly: true })).toEqual(['誤答']);
    expect(select(questions, attempts, { wrongOnly: true, wrongPeriod: 'latest-wrong' })).toEqual(['誤答']);
  });

  it.each<[WrongPeriod, number]>([
    ['last-7-days', 7],
    ['last-30-days', 30],
    ['last-90-days', 90],
  ])('%s は境界を含み、直近の正解ではなく期間内の誤答で判定する', (wrongPeriod, days) => {
    const cutoff = Date.parse(now) - days * 86400000;
    const questions = ['境界前', '境界', '境界後', '正解のみ'].map((id) => question(id));
    const attempts = [
      attempt('境界前', false, new Date(cutoff - 1).toISOString()),
      attempt('境界前', true),
      attempt('境界', false, new Date(cutoff).toISOString()),
      attempt('境界', true),
      attempt('境界後', false, new Date(cutoff + 1).toISOString()),
      attempt('正解のみ', true),
    ];
    expect(select(questions, attempts, { wrongOnly: true, wrongPeriod })).toEqual(['境界', '境界後']);
    expect(
      filterPracticeQuestions(
        questions,
        attempts,
        { wrongOnly: true, wrongPeriod },
        new Date(Date.parse(now) + 2).toISOString(),
      ).map((q) => q.id),
    ).toEqual([]);
  });

  it('未克服は誤答経験があり最後の2回答が連続正解でない問題に限定する', () => {
    const histories = [
      ['未回答', []],
      ['正解のみ', [true, true]],
      ['誤答のみ', [false]],
      ['正解1回', [false, true]],
      ['正解2回', [false, true, true]],
      ['再誤答', [false, true, true, false]],
      ['再誤答後正解', [false, true, true, false, true]],
    ] as const;
    const questions = histories.map(([id]) => question(id));
    const attempts = histories.flatMap(([id, results]) =>
      results.map((correct, index) =>
        attempt(id, correct, new Date(Date.parse(now) - (5 - index) * 86400000).toISOString()),
      ),
    );
    expect(
      select(questions, attempts, { wrongOnly: true, wrongPeriod: 'ever', unresolvedOnly: true }),
    ).toEqual(['誤答のみ', '正解1回', '再誤答', '再誤答後正解']);
  });

  it('期間、未克服、難易度を組み合わせ、未回答とは共通部分を取る', () => {
    const questions = [question('対象', 2), question('克服', 2), question('別難易度'), question('期間外', 2)];
    const attempts = [
      attempt('対象', false),
      attempt('克服', false),
      attempt('克服', true),
      attempt('克服', true),
      attempt('別難易度', false),
      attempt('期間外', false, '2026-01-01T00:00:00Z'),
    ];
    const filters: PracticeFilters = {
      wrongOnly: true,
      wrongPeriod: 'last-7-days',
      unresolvedOnly: true,
      difficulty: 2,
    };
    expect(select(questions, attempts, filters)).toEqual(['対象']);
    expect(select(questions, attempts, { ...filters, unansweredOnly: true })).toEqual([]);
    expect(
      select([...questions, question('未回答', 2)], attempts, { unansweredOnly: true, difficulty: 2 }),
    ).toEqual(['未回答']);
  });

  it('誤答のみが未選択なら期間と未克服の条件を適用しない', () => {
    expect(select([question('未回答')], [], { wrongPeriod: 'ever', unresolvedOnly: true })).toEqual([
      '未回答',
    ]);
  });

  it('回答日時で並べ、同時刻は ID、ID がなければ入力順で判定し、入力を変更しない', () => {
    const questions = [question('日時'), question('ID'), question('入力順')];
    const attempts = [
      attempt('日時', false, '2026-11-01T12:00:00Z'),
      attempt('日時', true, '2026-11-01T20:00:00+09:00'),
      { ...attempt('ID', false), id: 2 },
      { ...attempt('ID', true), id: 1 },
      attempt('入力順', true),
      attempt('入力順', false),
    ];
    const original = structuredClone(attempts);
    expect(select(questions, attempts, { wrongOnly: true })).toEqual(['日時', 'ID', '入力順']);
    expect(attempts).toEqual(original);
    expect(questions.map((q) => q.id)).toEqual(['日時', 'ID', '入力順']);
  });
});
