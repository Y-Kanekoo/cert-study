import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { exams, loadExam } from './content';
import type { ExamId } from '../src/shared/types';
import { blindQuestions, compareBlindAnswers, type BlindAnswer } from './blind';

const [examArg, answersPath] = process.argv.slice(2);
const exam = examArg as ExamId;
if (!exams.includes(exam)) {
  console.error('試験は fe、ap、jstqb のいずれかを指定してください');
  process.exit(1);
}
const { questions } = await loadExam(exam);
if (process.env.npm_lifecycle_event === 'review:blind') {
  await mkdir(join('.cache', 'blind'), { recursive: true });
  const blind = blindQuestions(questions);
  const path = join('.cache', 'blind', `${exam}.json`);
  await writeFile(path, JSON.stringify(blind, null, 2));
  console.log(`${path}: ${blind.length}問を書き出しました`);
} else {
  if (!answersPath) {
    console.error('解答 JSON のパスを指定してください');
    process.exit(1);
  }
  const answers = JSON.parse(await readFile(answersPath, 'utf8')) as Record<string, BlindAnswer>;
  const mismatches = compareBlindAnswers(questions, answers);
  for (const message of mismatches) console.log(message);
  console.log(`${Object.keys(answers).length}問中 ${mismatches.length}件不一致`);
  if (mismatches.length) process.exitCode = 1;
}
