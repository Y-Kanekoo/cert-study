import type {
  Attempt,
  MockConfig,
  Question,
  RetentionCheck,
  Session,
  SrsState,
  Syllabus,
  SyllabusNode,
} from './types';
import { inSubtree, topicMap } from './content';

export function selectRetention(
  states: SrsState[],
  questions: Question[],
  gapDays: number,
  now: string,
): Question[] {
  const cutoff = Date.parse(now) - gapDays * 86400000;
  const byId = new Map(questions.map((q) => [q.id, q]));
  return states
    .filter((s) => s.lastResult && Date.parse(s.lastSeenAt) <= cutoff)
    .map((s) => byId.get(s.questionId))
    .filter((q): q is Question => !!q);
}
export function composeMock(
  questions: Question[],
  config: MockConfig,
  syllabus: Syllabus,
  random: () => number = Math.random,
): Question[] {
  const available = shuffle(
    questions.filter(
      (q) => q.section === config.section && (config.selfGraded ? q.type === 'self' : q.type === 'mcq'),
    ),
    random,
  );
  const limit = Math.min(config.questionCount, available.length);
  const selected: Question[] = [];
  const used = new Set<string>();
  const map = topicMap(syllabus);
  const portions =
    config.distribution?.map((part, i) => ({
      ...part,
      countTarget: part.count ?? Math.floor(limit * (part.weight ?? 0)),
      index: i,
    })) ?? [];
  if (portions.length && portions.some((p) => p.weight !== undefined)) {
    let remaining = limit - portions.reduce((sum, p) => sum + p.countTarget, 0);
    for (const p of [...portions].sort(
      (a, b) => (((b.weight ?? 0) * limit) % 1) - (((a.weight ?? 0) * limit) % 1),
    )) {
      if (remaining-- <= 0) break;
      p.countTarget++;
    }
  }
  for (const part of portions)
    for (const q of available) {
      if (selected.filter((item) => inSubtree(item, part.prefix, map)).length >= part.countTarget) break;
      if (!used.has(q.id) && inSubtree(q, part.prefix, map)) {
        selected.push(q);
        used.add(q.id);
      }
    }
  for (const q of available) {
    if (selected.length >= limit) break;
    if (!used.has(q.id)) {
      selected.push(q);
      used.add(q.id);
    }
  }
  return shuffle(selected, random);
}
function shuffle<T>(items: T[], random: () => number): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}
export type TopicStats = {
  id: string;
  title: string;
  level: number;
  questionCount: number;
  answered: number;
  correct: number;
  accuracy: number | null;
  recentAccuracy: number | null;
  retentionRate: number | null;
};
export function aggregateTopics(
  syllabus: Syllabus,
  questions: Question[],
  attempts: Attempt[],
  checks: RetentionCheck[],
): TopicStats[] {
  const map = topicMap(syllabus);
  const result: TopicStats[] = [];
  const nodes = new Map<string, SyllabusNode>();
  for (const path of map.values()) for (const node of path) nodes.set(node.id, node);
  for (const node of nodes.values()) {
    const ids = new Set(questions.filter((q) => inSubtree(q, node.id, map)).map((q) => q.id));
    const records = attempts.filter((a) => ids.has(a.questionId));
    const recent = [...records].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 10);
    const ret = checks.filter((c) => ids.has(c.questionId));
    result.push({
      id: node.id,
      title: node.title,
      level: (map.get(node.id)?.length ?? 1) - 1,
      questionCount: ids.size,
      answered: records.length,
      correct: records.filter((a) => a.correct).length,
      accuracy: records.length ? records.filter((a) => a.correct).length / records.length : null,
      recentAccuracy: recent.length ? recent.filter((a) => a.correct).length / recent.length : null,
      retentionRate: ret.length ? ret.filter((c) => c.correct).length / ret.length : null,
    });
  }
  return result;
}
export function weakTopics(stats: TopicStats[]): TopicStats[] {
  return stats
    .filter((s) => s.level === 2 && s.answered >= 2)
    .sort((a, b) => (a.recentAccuracy ?? 1) - (b.recentAccuracy ?? 1) || b.answered - a.answered)
    .slice(0, 8);
}
export function retentionRates(checks: RetentionCheck[]): { gapDays: number; total: number; rate: number }[] {
  return [3, 7, 14, 30].map((gapDays) => {
    const rows = checks.filter((c) => c.gapDays === gapDays);
    return {
      gapDays,
      total: rows.length,
      rate: rows.length ? rows.filter((c) => c.correct).length / rows.length : 0,
    };
  });
}
export function scoreHistory(sessions: Session[]): { date: string; score: number }[] {
  return sessions
    .filter((s) => s.kind === 'mock')
    .sort((a, b) => a.finishedAt.localeCompare(b.finishedAt))
    .map((s) => ({ date: s.finishedAt, score: s.scoreRatio }));
}
