import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { updateSrs, dueQueue } from '../src/shared/sm2';
import { aggregateTopics, composeMock, retentionRates, selectRetention, weakTopics } from '../src/shared/study';
import { leafIds, validateQuestionLinks } from '../src/shared/content';
import type { Attempt, Question, Syllabus } from '../src/shared/types';

const read = <T>(path: string): T => JSON.parse(readFileSync(path, 'utf8')) as T;
const fe = read<Syllabus>('content/fe/syllabus.json'); const questions = read<Question[]>('test/fixtures/fe.json');
describe('共有ロジック', () => {
  it('SM-2を更新し、失敗を翌日の優先キューに入れる', () => {
    const at = '2026-10-01T00:00:00.000Z'; const first = updateSrs(undefined, questions[0].id, 4, at);
    expect(first.repetitions).toBe(1); expect(first.intervalDays).toBe(1);
    const second = updateSrs(first, questions[0].id, 4, '2026-10-02T00:00:00.000Z'); expect(second.intervalDays).toBe(6);
    const failed = updateSrs(second, questions[0].id, 1, '2026-10-03T00:00:00.000Z');
    expect(failed.repetitions).toBe(0); expect(failed.lapses).toBe(1); expect(failed.ease).toBeGreaterThanOrEqual(1.3);
    expect(dueQueue([failed], '2026-10-04T00:00:00.000Z')).toHaveLength(1);
  });
  it('重みと不足補充で模擬試験を重複なく構成する', () => {
    const config = { id: 'test', name: '試験', section: 'A' as const, questionCount: 4, minutes: 10, passRatio: 0.6, distribution: [{ prefix: 'fe-L3', weight: 0.75 }, { prefix: 'fe-L9', weight: 0.25 }] };
    const result = composeMock(questions, config, fe, () => 0.5); expect(result).toHaveLength(2); expect(new Set(result.map(q => q.id)).size).toBe(2);
    expect(composeMock(questions, { ...config, section: 'B' }, fe)).toHaveLength(0);
    const byCount = composeMock(questions, { ...config, distribution: [{ prefix: 'fe-L3', count: 1 }, { prefix: 'fe-L9', count: 3 }] }, fe, () => 0.5);
    expect(byCount).toHaveLength(2); expect(new Set(byCount.map(q => q.id)).size).toBe(2);
  });
  it('定着候補とトピック集計を計算する', () => {
    const state = updateSrs(undefined, questions[0].id, 4, '2026-10-01T00:00:00.000Z');
    expect(selectRetention([state], questions, 7, '2026-10-08T00:00:00.000Z')).toHaveLength(1);
    expect(selectRetention([state], questions, 14, '2026-10-08T00:00:00.000Z')).toHaveLength(0);
    const attempts: Attempt[] = [0, 1, 2].map(i => ({ questionId: questions[0].id, mode: 'practice', correct: i === 0, elapsedMs: 1000, createdAt: `2026-10-0${i + 1}T00:00:00.000Z` }));
    const stats = aggregateTopics(fe, questions, attempts, [{ questionId: questions[0].id, gapDays: 7, correct: false, createdAt: '2026-10-08T00:00:00.000Z' }]);
    expect(stats.find(s => s.id === questions[0].topic)?.accuracy).toBeCloseTo(1 / 3);
    expect(weakTopics(stats)[0].id).toBe(questions[0].topic);
    expect(retentionRates([{ questionId: questions[0].id, gapDays: 7, correct: false, createdAt: '2026-10-08T00:00:00.000Z' }])[1].rate).toBe(0);
  });
  it('コンテンツの参照を検証する', () => { expect(validateQuestionLinks(questions, fe)).toEqual([]); expect(leafIds(fe).has(questions[0].topic)).toBe(true); expect(validateQuestionLinks([...questions, questions[0]], fe)).toContain(`${questions[0].id}: ID が重複しています`); });
});
