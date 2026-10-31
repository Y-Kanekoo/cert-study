import type { Question } from '../src/shared/types';

export type DuplicateReport = { errors: string[]; warnings: string[] };

function normalized(question: Question): string {
  return `${question.question}\u0000${question.code ?? ''}`
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s。、，．,.!?！？:：;；「」『』（）()]/g, '');
}

function grams(value: string): Set<string> {
  const result = new Set<string>();
  for (let index = 0; index <= value.length - 3; index++) result.add(value.slice(index, index + 3));
  return result;
}

export function detectDuplicates(questions: Question[]): DuplicateReport {
  const errors: string[] = [];
  const warnings: string[] = [];
  const seen = new Map<string, Question>();
  const previous: { question: Question; grams: Set<string> }[] = [];
  const index = new Map<string, number[]>();
  for (const question of questions) {
    const value = normalized(question);
    const exact = seen.get(value);
    if (exact) {
      errors.push(`${question.exam}: ${exact.id} と ${question.id} の問題文とコードが重複しています`);
      continue;
    }
    seen.set(value, question);
    const current = grams(value);
    const overlaps = new Map<number, number>();
    for (const gram of current)
      for (const position of index.get(gram) ?? []) overlaps.set(position, (overlaps.get(position) ?? 0) + 1);
    for (const [position, intersection] of overlaps) {
      const other = previous[position];
      if (intersection / (current.size + other.grams.size - intersection) >= 0.7)
        warnings.push(`${question.exam}: ${other.question.id} と ${question.id} の問題文が類似しています`);
    }
    const position = previous.length;
    previous.push({ question, grams: current });
    for (const gram of current) {
      const positions = index.get(gram) ?? [];
      positions.push(position);
      index.set(gram, positions);
    }
  }
  return { errors, warnings };
}
