import { describe, expect, it } from 'vitest';
import { restorableAttempts, verifyRestorable } from '../e2e/backup';
import { updateSrs } from '../src/shared/sm2';
import { emptyProgress, type Attempt } from '../src/shared/types';

const attempt: Attempt = {
  questionId: 'fe-test',
  mode: 'retention',
  correct: true,
  choice: 0,
  elapsedMs: 20000,
  createdAt: '2026-10-31T00:00:00.000Z',
};

describe('本番 E2E バックアップの事前検証', () => {
  it('定着チェックの間隔を履歴から再構成する', () => {
    const backup = emptyProgress();
    backup.attempts = [attempt];
    backup.retentionChecks = [
      { questionId: attempt.questionId, gapDays: 3, correct: true, createdAt: attempt.createdAt },
    ];
    backup.srs = [updateSrs(undefined, attempt.questionId, 4, attempt.createdAt)];
    expect(restorableAttempts(backup)[0].gapDays).toBe(3);
    expect(verifyRestorable(backup)).toHaveLength(1);
  });

  it('再現できない復習状態を本番データ削除前に拒否する', () => {
    const backup = emptyProgress();
    backup.attempts = [{ ...attempt, mode: 'practice', gapDays: null }];
    backup.srs = [updateSrs(undefined, attempt.questionId, 3, attempt.createdAt)];
    expect(() => verifyRestorable(backup)).toThrow('復習状態を再現できません');
  });
});
