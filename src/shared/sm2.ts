import type { SrsState } from './types';

export function updateSrs(previous: SrsState | undefined, questionId: string, quality: number, at: string): SrsState {
  const q = Math.max(0, Math.min(5, quality)); const ease = Math.max(1.3, (previous?.ease ?? 2.5) + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02)));
  const repetitions = q < 3 ? 0 : (previous?.repetitions ?? 0) + 1;
  const intervalDays = q < 3 ? 1 : repetitions === 1 ? 1 : repetitions === 2 ? 6 : Math.max(1, Math.round((previous?.intervalDays ?? 6) * ease));
  const dueAt = new Date(new Date(at).getTime() + intervalDays * 86400000).toISOString();
  return { questionId, ease, repetitions, intervalDays, dueAt, lapses: (previous?.lapses ?? 0) + (q < 3 ? 1 : 0), lastResult: q >= 3, lastSeenAt: at, firstCorrectAt: previous?.firstCorrectAt ?? (q >= 3 ? at : null) };
}
export function dueQueue(states: SrsState[], now: string): SrsState[] {
  const time = Date.parse(now); return states.filter(s => Date.parse(s.dueAt) <= time).sort((a, b) => {
    const score = (s: SrsState) => s.lapses * 10 + Math.max(0, (time - Date.parse(s.dueAt)) / 86400000);
    return score(b) - score(a) || a.questionId.localeCompare(b.questionId);
  });
}
