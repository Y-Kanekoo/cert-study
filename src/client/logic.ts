import { dueQueue } from '../shared/sm2';
import type { Progress } from '../shared/types';

export function homeStats(
  progress: Progress,
  at: Date,
): {
  due: number;
  retentionRate: number | null;
  answered: number;
  accuracy: number | null;
  streak: number;
} {
  const checks = progress.retentionChecks;
  const attempts = progress.attempts;
  const localDay = (date: Date): string => `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
  const days = new Set(attempts.map((attempt) => localDay(new Date(attempt.createdAt))));
  const day = new Date(at);
  if (!days.has(localDay(day))) day.setDate(day.getDate() - 1);
  let streak = 0;
  while (days.has(localDay(day))) {
    streak++;
    day.setDate(day.getDate() - 1);
  }
  return {
    due: dueQueue(progress.srs, at.toISOString()).length,
    retentionRate: checks.length ? checks.filter((check) => check.correct).length / checks.length : null,
    answered: attempts.length,
    accuracy: attempts.length ? attempts.filter((attempt) => attempt.correct).length / attempts.length : null,
    streak,
  };
}

export const choiceLabel = (index: number): string => ['ア', 'イ', 'ウ', 'エ', 'オ'][index] ?? '';

export function remainingMs(startedAt: string, minutes: number, at: number): number {
  return Math.max(0, minutes * 60000 - (at - Date.parse(startedAt)));
}
