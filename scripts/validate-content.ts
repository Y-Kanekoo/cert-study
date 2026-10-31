import Ajv from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { join } from 'node:path';
import { leafIds, topicMap, validateQuestionLinks } from '../src/shared/content';
import { exams, loadExam, readJson } from './content';

async function main(): Promise<void> {
  const schema = await readJson<Record<string, unknown>>(join('content', 'schema', 'question.schema.json'));
  const ajv = new Ajv({ allErrors: true, strict: false }); addFormats(ajv); const validate = ajv.compile(schema);
  let errors = 0;
  for (const exam of exams) {
    const { config, syllabus, questions } = await loadExam(exam);
    if (!validate(questions)) { for (const error of validate.errors ?? []) console.error(`${exam}: ${error.instancePath} ${error.message}`); errors++; }
    for (const message of validateQuestionLinks(questions, syllabus)) { console.error(message); errors++; }
    const verified = questions.filter(q => q.status === 'verified'); const map = topicMap(syllabus);
    const answerCounts = [0, 0, 0, 0]; for (const q of questions) if (q.type === 'mcq' && q.answer !== undefined) answerCounts[q.answer]++;
    const major = config.exam === syllabus.exam ? syllabus.tree.map(node => `${node.title}: ${verified.filter(q => map.get(q.topic)?.[0]?.id === node.id).length}`).join(' / ') : '試験 ID 不一致';
    if (config.exam !== syllabus.exam) errors++;
    console.log(`${exam}: 全${questions.length}問 / 検証済み${verified.length}問 / 正解位置 ${answerCounts.join(', ')} / ${major}`);
    for (const leaf of leafIds(syllabus)) if (!verified.some(q => q.topic === leaf)) console.warn(`${exam}: 検証済み問題なし ${leaf}`);
  }
  if (errors) { console.error(`${errors}件のエラー`); process.exitCode = 1; }
}
await main();
