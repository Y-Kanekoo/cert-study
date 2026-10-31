import { topicMap } from './content';
import { selectedIndices } from './grading';
import type { Attempt, Question, Syllabus } from './types';

function escapeCsvCell(value: string): string {
  // 表計算ソフトによる数式としての評価を防ぐ。
  const protectedValue = /^[=+\-@\t\r\n]/.test(value) ? `'${value}` : value;
  return `"${protectedValue.replaceAll('"', '""')}"`;
}

export function serializeAttemptsCsv(attempts: Attempt[], questions: Question[], syllabus: Syllabus): string {
  const questionMap = new Map(questions.map((question) => [question.id, question]));
  const topics = topicMap(syllabus);
  const header = ['日時(ISO)', '問題ID', '分野', 'モード', '正誤', '選択', '自己採点', '回答時間(秒)'];
  const rows = attempts.map((attempt) => {
    const question = questionMap.get(attempt.questionId);
    const title = question ? topics.get(question.topic)?.at(-1)?.title : undefined;
    // 選択位置は1始まりとし、複数選択は「|」で区切る。
    const selection =
      attempt.choice == null || !question || question.type === 'self'
        ? ''
        : question.type === 'multi'
          ? selectedIndices(attempt.choice, question.choices?.length ?? 0)
              .map((index) => index + 1)
              .join('|')
          : String(attempt.choice + 1);
    return [
      attempt.createdAt,
      attempt.questionId,
      question ? [question.topic, title].filter(Boolean).join(' ') : '',
      attempt.mode,
      attempt.correct ? '正解' : '誤答',
      selection,
      String(attempt.selfScore ?? ''),
      String(attempt.elapsedMs / 1000),
    ];
  });
  return `\uFEFF${[header, ...rows].map((row) => row.map(escapeCsvCell).join(',')).join('\r\n')}\r\n`;
}
