import type { Question } from './types';

export function choiceMask(indices: number[]): number {
  return indices.reduce((mask, index) => mask | (1 << index), 0);
}

export function isCorrectChoice(question: Question, choice: number | null | undefined): boolean {
  if (choice == null) return false;
  if (question.type === 'multi') return choice === choiceMask(question.answers ?? []);
  return question.type === 'mcq' && question.answer !== undefined && choice === question.answer;
}

export function selectedIndices(choice: number | null | undefined, count: number): number[] {
  if (choice == null) return [];
  return Array.from({ length: count }, (_, index) => index).filter((index) => (choice & (1 << index)) !== 0);
}
