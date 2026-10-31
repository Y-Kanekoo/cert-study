import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { detectDuplicates } from '../scripts/duplicates';
import type { Question } from '../src/shared/types';

const question = (id: string, text: string, code?: string): Question => ({
  id,
  exam: 'jstqb',
  topic: 'FL-4.2.2',
  type: 'mcq',
  difficulty: 2,
  section: 'A',
  question: text,
  code,
  choices: ['下限', '中央', '上限', '平均'],
  answer: 0,
  choiceNotes: ['正解', '誤答', '誤答', '誤答'],
  explanation: '境界となる値を調べる。',
  status: 'draft',
  origin: 'original',
});

describe('コンテンツツール', () => {
  it('同一の問題文とコードをエラー、類似問題を警告にする', () => {
    const first = question('jstqb-one', '長い事例について境界値分析で優先すべき値を二つ選ぶ。', 'value = 1');
    const exact = question('jstqb-two', '長い事例について境界値分析で優先すべき値を二つ選ぶ。 ', 'value = 1');
    const near = question(
      'jstqb-three',
      '長い事例について境界値分析で優先すべき値を二つ選択する。',
      'value = 1',
    );
    const differentCode = question('jstqb-four', first.question, 'value = 2');
    const report = detectDuplicates([first, exact, near, differentCode]);
    expect(report.errors).toHaveLength(1);
    expect(report.warnings.length).toBeGreaterThanOrEqual(1);
  });

  it('既存のコンテンツを読み込める', () => {
    const questions = JSON.parse(readFileSync('test/fixtures/jstqb.json', 'utf8')) as Question[];
    expect(detectDuplicates(questions)).toEqual({ errors: [], warnings: [] });
  });
});
