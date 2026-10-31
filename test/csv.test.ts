import { describe, expect, it } from 'vitest';
import { serializeAttemptsCsv } from '../src/shared/csv';
import type { Attempt, Question, Syllabus } from '../src/shared/types';

const syllabus: Syllabus = {
  exam: 'fe',
  title: '試験',
  source: { name: '出典', version: '1', url: '', publisher: '発行元' },
  tree: [{ id: 'topic', title: '分野名' }],
};
const question: Question = {
  id: 'fe-1',
  exam: 'fe',
  topic: 'topic',
  type: 'mcq',
  difficulty: 1,
  section: 'A',
  question: '問題',
  choices: ['ア', 'イ', 'ウ', 'エ'],
  answer: 0,
  explanation: '解説',
  status: 'verified',
  origin: 'original',
};
const attempt: Attempt = {
  questionId: question.id,
  mode: 'practice',
  correct: true,
  choice: 0,
  elapsedMs: 1250,
  createdAt: '2026-10-01T00:00:00.000Z',
};
const header = '"日時(ISO)","問題ID","分野","モード","正誤","選択","自己採点","回答時間(秒)"\r\n';

describe('回答履歴CSV', () => {
  it('UTF-8 BOMと日本語の列名を付けて、単一選択と秒単位の時間を書き出す', () => {
    expect(serializeAttemptsCsv([attempt], [question], syllabus)).toBe(
      `\uFEFF${header}"2026-10-01T00:00:00.000Z","fe-1","topic 分野名","practice","正解","1","","1.25"\r\n`,
    );
  });

  it.each(['=', '+', '-', '@', '\t', '\r', '\n'])('先頭文字 %j のセルを数式として評価させない', (prefix) => {
    const questionId = `${prefix}危険な値`;
    const csv = serializeAttemptsCsv([{ ...attempt, questionId }], [], syllabus);
    expect(csv).toContain(`"'${questionId}"`);
    const topic = `${prefix}topic`;
    expect(
      serializeAttemptsCsv([attempt], [{ ...question, topic }], {
        ...syllabus,
        tree: [{ id: topic, title: '分野名' }],
      }),
    ).toContain(`"'${topic} 分野名"`);
  });

  it('カンマ・改行を含むセルを引用し、ダブルクォートを二重化する', () => {
    const csv = serializeAttemptsCsv([attempt], [question], {
      ...syllabus,
      tree: [{ id: 'topic', title: '分野,"名称"\r\n続き' }],
    });
    expect(csv).toContain('"topic 分野,""名称""\r\n続き"');
  });

  it('複数選択のビットマスクを1始まりの位置に変換する', () => {
    const csv = serializeAttemptsCsv(
      [{ ...attempt, choice: 5, mode: 'mock', correct: false }],
      [{ ...question, type: 'multi', answer: undefined, answers: [0, 2] }],
      syllabus,
    );
    expect(csv).toContain('"mock","誤答","1|3","","1.25"');
  });

  it('選択なしを空欄にし、自己採点の0を保持する', () => {
    const csv = serializeAttemptsCsv(
      [{ ...attempt, choice: null, selfScore: 0 }],
      [{ ...question, type: 'self' }],
      syllabus,
    );
    expect(csv).toContain('"正解","","0","1.25"');
  });

  it('現在の問題に存在しない履歴も問題IDを保持して書き出す', () => {
    expect(serializeAttemptsCsv([attempt], [], syllabus)).toContain(
      '"fe-1","","practice","正解","","","1.25"',
    );
  });

  it('空履歴でもBOMとヘッダーを書き出す', () => {
    expect(serializeAttemptsCsv([], [question], syllabus)).toBe(`\uFEFF${header}`);
  });
});
