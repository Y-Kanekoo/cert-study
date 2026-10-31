import { topicMap, leafIds } from '../src/shared/content';
import type { Question, Syllabus } from '../src/shared/types';
import { exams, loadExam } from './content';

type Counts = Record<string, number>;
export type QuestionStats = {
  count: number;
  sectionTypeDifficulty: Counts;
  categories: Counts;
  leafCoverage: { zero: number; one: number; two: number; threePlus: number };
  answerPositions: number[];
};

function increment(counts: Counts, key: string): void {
  counts[key] = (counts[key] ?? 0) + 1;
}

export function questionStats(questions: Question[], syllabus: Syllabus): QuestionStats {
  const sectionTypeDifficulty: Counts = {};
  const categories: Counts = Object.fromEntries(syllabus.tree.map((node) => [node.id, 0]));
  const leaves = leafIds(syllabus);
  const leafCounts: Counts = Object.fromEntries([...leaves].map((id) => [id, 0]));
  const paths = topicMap(syllabus);
  const answerPositions = [0, 0, 0, 0, 0];
  for (const question of questions) {
    increment(sectionTypeDifficulty, `${question.section}/${question.type}/${question.difficulty}`);
    const category = paths.get(question.topic)?.[0]?.id;
    if (category) increment(categories, category);
    if (leaves.has(question.topic)) increment(leafCounts, question.topic);
    for (const answer of question.type === 'multi'
      ? (question.answers ?? [])
      : question.type === 'mcq'
        ? [question.answer]
        : [])
      if (answer !== undefined && answer >= 0 && answer < answerPositions.length) answerPositions[answer]++;
  }
  const leafCoverage = { zero: 0, one: 0, two: 0, threePlus: 0 };
  for (const count of Object.values(leafCounts)) {
    if (count === 0) leafCoverage.zero++;
    else if (count === 1) leafCoverage.one++;
    else if (count === 2) leafCoverage.two++;
    else leafCoverage.threePlus++;
  }
  return { count: questions.length, sectionTypeDifficulty, categories, leafCoverage, answerPositions };
}

const result: Record<string, { verified: QuestionStats; total: QuestionStats }> = {};
for (const exam of exams) {
  const { questions, syllabus } = await loadExam(exam);
  result[exam] = {
    verified: questionStats(
      questions.filter((question) => question.status === 'verified'),
      syllabus,
    ),
    total: questionStats(questions, syllabus),
  };
  if (!process.argv.includes('--json')) {
    for (const [scope, stats] of Object.entries(result[exam])) {
      console.log(`${exam} ${scope}: ${stats.count}問`);
      console.log(`  科目/形式/難易度: ${JSON.stringify(stats.sectionTypeDifficulty)}`);
      console.log(`  大分類: ${JSON.stringify(stats.categories)}`);
      console.log(`  末端の問題数 0/1/2/3+: ${Object.values(stats.leafCoverage).join('/')}`);
      console.log(`  正解位置 ア/イ/ウ/エ/オ: ${stats.answerPositions.join('/')}`);
    }
  }
}
if (process.argv.includes('--json')) console.log(JSON.stringify(result, null, 2));
