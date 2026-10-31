import type { Question } from '../src/shared/types';

export type BlindAnswer = number | number[];

export function blindQuestions(questions: Question[]): Record<string, unknown>[] {
  return questions.map(({ answer, answers, explanation, choiceNotes, modelAnswer, rubric, ...rest }) => {
    void answer;
    void answers;
    void explanation;
    void choiceNotes;
    void modelAnswer;
    void rubric;
    return rest.type === 'multi' ? { ...rest, select: answers?.length ?? 0 } : rest;
  });
}

export function compareBlindAnswers(questions: Question[], answers: Record<string, BlindAnswer>): string[] {
  const byId = new Map(questions.filter((q) => q.type !== 'self').map((q) => [q.id, q]));
  const mismatches: string[] = [];
  for (const [id, submitted] of Object.entries(answers)) {
    const question = byId.get(id);
    const expected = question?.type === 'multi' ? question.answers : question?.answer;
    const correct =
      question?.type === 'multi'
        ? Array.isArray(submitted) &&
          submitted.length === question.answers?.length &&
          new Set(submitted).size === submitted.length &&
          submitted.every((index) => question.answers?.includes(index))
        : typeof submitted === 'number' && submitted === expected;
    if (!correct)
      mismatches.push(
        `${id}: 提出 ${JSON.stringify(submitted)} / 正解 ${expected === undefined ? 'ID不明' : JSON.stringify(expected)}`,
      );
  }
  return mismatches;
}
