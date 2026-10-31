import type { Question } from '../src/shared/types';

const absolutePattern = /必ず|すべて|全て|絶対に/u;
const allChoicesPattern = /(?:上記|選択肢).{0,8}(?:すべて|全て)|(?:すべて|全て).{0,6}正し/u;

function choiceLength(value: string): number {
  return Array.from(value.normalize('NFKC').replace(/\s/gu, '')).length;
}

function average(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/** 正誤の内容を判定せず、見た目や表現が正答の手掛かりになる可能性を警告する。 */
export function detectAnswerClues(questions: Question[]): string[] {
  const warnings: string[] = [];
  for (const question of questions) {
    const choices = question.choices;
    if (question.type === 'self' || !choices) continue;
    const answers = question.type === 'mcq' ? [question.answer] : question.answers;
    // 構造不備は既存の検証へ任せ、不完全な正答情報から警告を作らない。
    if (
      !answers?.length ||
      answers.some(
        (index) => index === undefined || !Number.isInteger(index) || index < 0 || index >= choices.length,
      )
    )
      continue;
    const correctIndices = new Set(answers);
    const correct = choices.filter((_, index) => correctIndices.has(index));
    const incorrect = choices.filter((_, index) => !correctIndices.has(index));
    if (!correct.length || !incorrect.length) continue;
    const warn = (message: string): void => {
      warnings.push(`${question.exam}: ${question.id}: ${message}`);
    };
    const correctLengths = correct.map(choiceLength);
    const incorrectLengths = incorrect.map(choiceLength);
    const correctAverage = average(correctLengths);
    const incorrectAverage = average(incorrectLengths);
    const longestAverage = Math.max(correctAverage, incorrectAverage);
    const separated =
      Math.min(...correctLengths) > Math.max(...incorrectLengths) ||
      Math.max(...correctLengths) < Math.min(...incorrectLengths);
    // 参考実装の差率（差 / 大きい平均）を使用。問題単位では重なりを除外し40%超を注意対象にする。
    if (separated && longestAverage > 0 && Math.abs(correctAverage - incorrectAverage) / longestAverage > 0.4)
      warn('正答と誤答の選択肢の文字数が偏っています（平均文字数の差率40%超）');
    if (
      !correct.some((choice) => absolutePattern.test(choice)) &&
      incorrect.filter((choice) => absolutePattern.test(choice)).length >= 2
    )
      warn('「必ず」「すべて」「絶対に」等の断定語が誤答のみに2選択肢以上あります');
    if (choices.some((choice) => allChoicesPattern.test(choice)))
      warn('「上記のすべて」「すべて正しい」等の包括的な選択肢を確認してください');
  }
  return warnings;
}
