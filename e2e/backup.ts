import { updateSrs } from '../src/shared/sm2';
import type { Attempt, Progress, RetentionCheck, SrsState } from '../src/shared/types';

export function restorableAttempts(backup: Progress): Attempt[] {
  const checks = new Map<string, RetentionCheck[]>();
  const key = (item: { questionId: string; createdAt: string; correct: boolean }): string =>
    `${item.questionId}\u0000${item.createdAt}\u0000${item.correct}`;
  for (const check of backup.retentionChecks) {
    const id = key(check);
    checks.set(id, [...(checks.get(id) ?? []), check]);
  }
  const attempts = backup.attempts.map((attempt) => {
    if (attempt.mode !== 'retention') return attempt;
    const check = checks.get(key(attempt))?.shift();
    if (!check) throw new Error('定着チェック履歴から間隔を復元できません');
    return { ...attempt, gapDays: check.gapDays };
  });
  if ([...checks.values()].some((items) => items.length))
    throw new Error('定着チェック履歴と解答履歴が一致しません');
  return attempts;
}

export function verifyRestorable(backup: Progress): Attempt[] {
  // TODO(autonomous): 進捗 API が自信なしと定着間隔を直接返せるようにしたら、復元時の推定を不要にする。
  if (backup.attempts.length > 5000 || backup.sessions.length > 1000)
    throw new Error('取り込み API の件数上限を超えています');
  const attempts = restorableAttempts(backup);
  const states = new Map<string, SrsState>();
  for (const attempt of [...attempts].sort(
    (a, b) => a.createdAt.localeCompare(b.createdAt) || (a.id ?? 0) - (b.id ?? 0),
  )) {
    const quality = !attempt.correct ? 1 : attempt.selfScore === 1 ? 3 : attempt.elapsedMs <= 15000 ? 5 : 4;
    states.set(
      attempt.questionId,
      updateSrs(states.get(attempt.questionId), attempt.questionId, quality, attempt.createdAt),
    );
  }
  const stored = new Map(backup.srs.map((state) => [state.questionId, state]));
  if (states.size !== stored.size) throw new Error('復習状態を再現できません');
  for (const [id, actual] of states) {
    const expected = stored.get(id);
    if (
      !expected ||
      Object.keys(actual).some((name) => actual[name as keyof SrsState] !== expected[name as keyof SrsState])
    )
      throw new Error('復習状態を再現できません');
  }
  return attempts;
}
