import { describe, expect, it } from 'vitest';
import { choiceLabel, homeStats, remainingMs } from '../src/client/logic';
import { emptyProgress } from '../src/shared/types';

describe('クライアント表示ロジック', () => {
  it('ホームの解答数、正答率、定着率、復習数、連続日数を集計する', () => {
    const progress = emptyProgress();
    expect(homeStats(progress, new Date('2026-10-03T12:00:00Z'))).toEqual({
      due: 0,
      retentionRate: null,
      answered: 0,
      accuracy: null,
      streak: 0,
    });
    progress.attempts = [
      {
        questionId: 'q',
        mode: 'practice',
        correct: true,
        elapsedMs: 1000,
        createdAt: '2026-10-01T12:00:00Z',
      },
      { questionId: 'q', mode: 'review', correct: false, elapsedMs: 1000, createdAt: '2026-10-02T12:00:00Z' },
    ];
    progress.retentionChecks = [
      { questionId: 'q', gapDays: 7, correct: true, createdAt: '2026-10-02T12:00:00Z' },
    ];
    progress.srs = [
      {
        questionId: 'q',
        ease: 2.5,
        intervalDays: 1,
        repetitions: 1,
        dueAt: '2026-10-03T00:00:00Z',
        lapses: 0,
        lastResult: false,
        lastSeenAt: '2026-10-02T12:00:00Z',
        firstCorrectAt: '2026-10-01T12:00:00Z',
      },
    ];
    const stats = homeStats(progress, new Date('2026-10-03T12:00:00Z'));
    expect(stats).toEqual({ due: 1, retentionRate: 1, answered: 2, accuracy: 0.5, streak: 2 });
  });

  it('選択肢を表示順に日本語で示す', () => {
    expect([0, 1, 2, 3].map(choiceLabel)).toEqual(['ア', 'イ', 'ウ', 'エ']);
  });

  it('模擬試験の残り時間を 0 で止める', () => {
    const startedAt = '2026-10-01T00:00:00.000Z';
    const start = Date.parse(startedAt);
    expect(remainingMs(startedAt, 90, start + 1000)).toBe(5_399_000);
    expect(remainingMs(startedAt, 90, start + 5_400_001)).toBe(0);
  });
});
