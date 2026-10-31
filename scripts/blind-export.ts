import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { exams, loadExam } from './content';
import type { ExamId } from '../src/shared/types';

const [examArg, answersPath] = process.argv.slice(2); const exam = examArg as ExamId;
if (!exams.includes(exam)) { console.error('試験は fe、ap、jstqb のいずれかを指定してください'); process.exit(1); }
const { questions } = await loadExam(exam);
if (process.env.npm_lifecycle_event === 'review:blind') {
  await mkdir(join('.cache', 'blind'), { recursive: true });
  const blind = questions.map(({ answer, explanation, choiceNotes, modelAnswer, rubric, ...rest }) => { void answer; void explanation; void choiceNotes; void modelAnswer; void rubric; return rest; });
  const path = join('.cache', 'blind', `${exam}.json`); await writeFile(path, JSON.stringify(blind, null, 2)); console.log(`${path}: ${blind.length}問を書き出しました`);
} else {
  if (!answersPath) { console.error('解答 JSON のパスを指定してください'); process.exit(1); }
  const answers = JSON.parse(await readFile(answersPath, 'utf8')) as Record<string, number>;
  const byId = new Map(questions.filter(q => q.type === 'mcq').map(q => [q.id, q.answer])); let mismatches = 0;
  for (const [id, answer] of Object.entries(answers)) { const correct = byId.get(id); if (correct === undefined || correct !== answer) { console.log(`${id}: 提出 ${answer} / 正解 ${correct ?? 'ID不明'}`); mismatches++; } }
  console.log(`${Object.keys(answers).length}問中 ${mismatches}件不一致`); if (mismatches) process.exitCode = 1;
}
