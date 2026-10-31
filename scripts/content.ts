import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ExamConfig, ExamId, Question, Syllabus } from '../src/shared/types';

export const exams: ExamId[] = ['fe', 'ap', 'jstqb'];
export async function readJson<T>(path: string): Promise<T> { return JSON.parse(await readFile(path, 'utf8')) as T; }
export async function loadExam(exam: ExamId): Promise<{ config: ExamConfig; syllabus: Syllabus; questions: Question[] }> {
  const root = join('content', exam);
  const [config, syllabus] = await Promise.all([readJson<ExamConfig>(join(root, 'exam.json')), readJson<Syllabus>(join(root, 'syllabus.json'))]);
  const dir = join(root, 'questions'); let files: string[] = [];
  try { files = (await readdir(dir)).filter(name => name.endsWith('.json')).sort(); } catch (error) { if ((error as { code?: string }).code !== 'ENOENT') throw error; }
  const questions = (await Promise.all(files.map(name => readJson<Question[]>(join(dir, name))))).flat();
  return { config, syllabus, questions };
}
