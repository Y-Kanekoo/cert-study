import { describe, expect, it } from 'vitest';
import { qualityForAttempt } from '../src/shared/sm2';
import type { Attempt } from '../src/shared/types';

const attempt: Attempt = {
  questionId: 'ap-self-1',
  mode: 'practice',
  correct: true,
  selfScore: 2,
  elapsedMs: 20000,
  createdAt: '2026-11-04T00:00:00.000Z',
};

describe('解答の品質値', () => {
  it.each([
    [{ correct: false, selfScore: 0, elapsedMs: 1000 }, 1],
    [{ selfScore: 1 }, 3],
    [{ selfScore: 2, elapsedMs: 15001 }, 4],
    [{ selfScore: 2, elapsedMs: 15000 }, 5],
    [{ selfScore: null, lowConfidence: true }, 3],
    [{ selfScore: null, lowConfidence: false, elapsedMs: 20000 }, 4],
  ] satisfies [Partial<Attempt>, number][])('解答条件 %j を品質値 %i に変換する', (changes, expected) => {
    expect(qualityForAttempt({ ...attempt, ...changes })).toBe(expected);
  });
});
