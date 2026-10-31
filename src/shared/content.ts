import type { Question, Syllabus, SyllabusNode } from './types';

export function walkSyllabus(nodes: SyllabusNode[], visit: (node: SyllabusNode, ancestors: SyllabusNode[]) => void, ancestors: SyllabusNode[] = []): void {
  for (const node of nodes) { visit(node, ancestors); if (node.children) walkSyllabus(node.children, visit, [...ancestors, node]); }
}
export function leafIds(syllabus: Syllabus): Set<string> {
  const ids = new Set<string>(); walkSyllabus(syllabus.tree, node => { if (!node.children?.length) ids.add(node.id); }); return ids;
}
export function topicMap(syllabus: Syllabus): Map<string, SyllabusNode[]> {
  const map = new Map<string, SyllabusNode[]>(); walkSyllabus(syllabus.tree, (node, ancestors) => { map.set(node.id, [...ancestors, node]); }); return map;
}
export function inSubtree(question: Question, topicId: string, map: Map<string, SyllabusNode[]>): boolean {
  return !topicId || (map.get(question.topic)?.some(node => node.id === topicId) ?? false);
}
export function validateQuestionLinks(questions: Question[], syllabus: Syllabus): string[] {
  const errors: string[] = []; const ids = new Set<string>(); const leaves = leafIds(syllabus);
  for (const q of questions) {
    if (ids.has(q.id)) errors.push(`${q.id}: ID が重複しています`); ids.add(q.id);
    if (q.exam !== syllabus.exam || !q.id.startsWith(`${syllabus.exam}-`)) errors.push(`${q.id}: 試験 ID が一致しません`);
    if (!leaves.has(q.topic)) errors.push(`${q.id}: topic は末端ノードである必要があります`);
    if (q.type === 'mcq' && (q.choices?.length !== 4 || new Set(q.choices).size !== 4 || q.answer === undefined || q.answer < 0 || q.answer > 3)) errors.push(`${q.id}: 四肢択一の選択肢または正解が不正です`);
    if (q.type === 'self' && (!q.modelAnswer?.trim() || !q.rubric?.length || q.rubric.some(point => !point.trim()))) errors.push(`${q.id}: セルフ採点の模範解答または採点観点がありません`);
    if (q.exam === 'jstqb' && (q.section !== 'A' || q.k !== topicMap(syllabus).get(q.topic)?.at(-1)?.k)) errors.push(`${q.id}: JSTQB の科目または K レベルが不正です`);
    if (hasEmptyString(q)) errors.push(`${q.id}: 空文字列があります`);
  }
  return errors;
}
function hasEmptyString(value: unknown): boolean {
  if (typeof value === 'string') return value.trim().length === 0;
  if (Array.isArray(value)) return value.some(hasEmptyString);
  if (value && typeof value === 'object') return Object.values(value).some(hasEmptyString);
  return false;
}
