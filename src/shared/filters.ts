import type { Attempt, Question } from './types';

export type WrongPeriod = 'ever' | 'latest-wrong' | 'last-7-days' | 'last-30-days' | 'last-90-days';
export type PracticeFilters = {
  difficulty?: number;
  unansweredOnly?: boolean;
  wrongOnly?: boolean;
  wrongPeriod?: WrongPeriod;
  unresolvedOnly?: boolean;
};

const recentDays: Partial<Record<WrongPeriod, number>> = {
  'last-7-days': 7,
  'last-30-days': 30,
  'last-90-days': 90,
};

export function filterPracticeQuestions(
  questions: Question[],
  attempts: Attempt[],
  filters: PracticeFilters,
  now: string,
): Question[] {
  const period = filters.wrongPeriod ?? 'latest-wrong';
  const days = recentDays[period];
  const cutoff = days === undefined ? -Infinity : Date.parse(now) - days * 86400000;
  const histories = new Map<string, Attempt[]>();
  // 同時刻は保存済み ID 順、ID がなければ入力順で判定する。元の履歴は変更しない。
  const chronological = [...attempts].sort(
    (a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt) || (a.id ?? 0) - (b.id ?? 0),
  );
  for (const attempt of chronological) {
    const history = histories.get(attempt.questionId) ?? [];
    history.push(attempt);
    histories.set(attempt.questionId, history);
  }
  return questions.filter((question) => {
    if (filters.difficulty && question.difficulty !== filters.difficulty) return false;
    const history = histories.get(question.id) ?? [];
    if (filters.unansweredOnly && history.length) return false;
    if (!filters.wrongOnly) return true;
    if (!history.some((attempt) => !attempt.correct)) return false;
    if (period === 'latest-wrong' && history.at(-1)?.correct) return false;
    if (days !== undefined && !history.some((a) => !a.correct && Date.parse(a.createdAt) >= cutoff)) {
      return false;
    }
    // Attempt にセッション ID がないため、最後の2回答が連続正解なら克服とする。
    if (filters.unresolvedOnly && history.length >= 2 && history.slice(-2).every((a) => a.correct)) {
      return false;
    }
    return true;
  });
}
