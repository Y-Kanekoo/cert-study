import { describe, expect, it } from 'vitest';
import { detectAnswerClues } from '../scripts/quality';
import type { Question } from '../src/shared/types';

function question(overrides: Partial<Question> = {}): Question {
  return {
    id: 'jstqb-clue-001',
    exam: 'jstqb',
    topic: 'FL-1.1.1',
    type: 'mcq',
    difficulty: 1,
    section: 'A',
    question: '適切な説明を選べ。',
    choices: ['甲'.repeat(10), '乙'.repeat(10), '丙'.repeat(10), '丁'.repeat(10)],
    answer: 0,
    explanation: '内容に基づいて判断する。',
    status: 'draft',
    origin: 'original',
    ...overrides,
  };
}

const lengths = (...values: number[]): string[] => values.map((value) => '字'.repeat(value));

describe('正答の手掛かりの警告', () => {
  it('均等な選択肢と空の問題群には警告しない', () => {
    expect(detectAnswerClues([])).toEqual([]);
    expect(detectAnswerClues([question()])).toEqual([]);
  });

  it.each([
    [20, 10, 10, 10],
    [5, 10, 10, 10],
  ])('正答だけが極端に長い／短い場合に問題を特定して警告する: %j', (...values) => {
    const warnings = detectAnswerClues([question({ choices: lengths(...values) })]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('jstqb: jstqb-clue-001:');
    expect(warnings[0]).toContain('文字数');
  });

  it('文字数差率40%ちょうどは警告せず、超えた場合に警告する', () => {
    expect(detectAnswerClues([question({ choices: lengths(10, 6, 6, 6) })])).toEqual([]);
    expect(detectAnswerClues([question({ choices: lengths(10, 5, 6, 6) })])).toHaveLength(1);
  });

  it('文字数は空白を除外して正規化し、Unicodeコードポイントで数える', () => {
    expect(
      detectAnswerClues([
        question({ choices: ['😀'.repeat(10), '字'.repeat(10), 'Ａ '.repeat(10), '字'.repeat(10)] }),
      ]),
    ).toEqual([]);
  });

  it('誤答が長いだけで正答が突出しない場合は警告しない', () => {
    expect(detectAnswerClues([question({ choices: lengths(10, 5, 30, 30) })])).toEqual([]);
  });

  it('複数選択でも正答群と誤答群の文字数差を警告する', () => {
    expect(
      detectAnswerClues([
        question({ type: 'multi', answer: undefined, answers: [1, 3], choices: lengths(10, 20, 10, 20, 10) }),
      ]),
    ).toHaveLength(1);
  });

  it('複数選択で正答群と誤答群の文字数が重なる場合は警告しない', () => {
    expect(
      detectAnswerClues([question({ type: 'multi', answers: [0, 1], choices: lengths(5, 40, 10, 10) })]),
    ).toEqual([]);
  });

  it.each(['必ず', 'すべて', '全て', '絶対に'])(
    '断定語「%s」が誤答だけに2選択肢以上あれば警告する',
    (word) => {
      const warnings = detectAnswerClues([
        question({
          choices: [
            '品質情報を提供する',
            `${word}欠陥を発見する`,
            `${word}成功を保証する`,
            '実装作業を担当する',
          ],
        }),
      ]);
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain('断定語');
    },
  );

  it('断定語が1誤答だけの場合や正答にもある場合は警告しない', () => {
    expect(
      detectAnswerClues([
        question({
          choices: ['品質情報を提供する', '必ず欠陥を発見する', '成功を保証する', '実装作業を担当する'],
        }),
      ]),
    ).toEqual([]);
    expect(
      detectAnswerClues([
        question({
          choices: ['必ず品質情報を得る', '必ず欠陥を発見する', '絶対に成功する', '実装作業を担当する'],
        }),
      ]),
    ).toEqual([]);
  });

  it('複数選択でも全正答に断定語がない場合だけ偏りを警告する', () => {
    const choices = ['品質情報を提供する', '必ず欠陥を発見する', 'リスク評価を支える', '絶対に成功する'];
    expect(detectAnswerClues([question({ type: 'multi', answers: [0, 2], choices })])).toHaveLength(1);
    expect(detectAnswerClues([question({ type: 'multi', answers: [0, 1], choices })])).toEqual([]);
  });

  it.each(['上記のすべて', '選択肢の全て', 'すべて正しい'])(
    '包括的な選択肢「%s」は正誤を問わず警告する',
    (choice) => {
      for (const answer of [0, 1]) {
        const warnings = detectAnswerClues([
          question({ answer, choices: [choice, '品質を調べる', '欠陥を探す', '情報を示す'] }),
        ]);
        expect(warnings.some((warning) => warning.includes('包括的'))).toBe(true);
      }
    },
  );

  it('問題文と解説だけにある断定語や包括表現は対象外とする', () => {
    expect(
      detectAnswerClues([
        question({ question: 'すべて正しい説明を選べ。', explanation: '必ず、絶対にという表現に注意する。' }),
      ]),
    ).toEqual([]);
  });

  it('自己採点式と正答情報が不完全な問題は既存の構造検証へ任せる', () => {
    for (const overrides of [
      { type: 'self' as const },
      { choices: undefined },
      { answer: undefined },
      { answer: -1 },
      { answer: 4 },
      { answer: 0.5 },
      { type: 'multi' as const, answers: undefined },
      { type: 'multi' as const, answers: [] },
      { type: 'multi' as const, answers: [0, 4] },
      { type: 'multi' as const, answers: [0, 1, 2, 3] },
    ]) {
      expect(detectAnswerClues([question(overrides)])).toEqual([]);
    }
  });
});
