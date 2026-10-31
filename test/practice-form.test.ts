import { readFileSync } from 'node:fs';
import { expect, it, vi } from 'vitest';
import { emptyProgress, type Attempt, type Question } from '../src/shared/types';

it('誤答のみで追加項目を有効にし、期間と未克服を出題に反映する', async () => {
  const root = { innerHTML: '', textContent: '' };
  const listeners = new Map<string, (event: { preventDefault: () => void; currentTarget: object }) => void>();
  const form = {
    addEventListener: (name: string, listener: Parameters<typeof listeners.set>[1]) =>
      listeners.set(name, listener),
  };
  let change: (() => void) | undefined;
  const wrong = {
    checked: false,
    addEventListener: (_name: string, listener: () => void) => {
      change = listener;
    },
  };
  const period = { disabled: true };
  const unresolved = { disabled: true };
  const fixture = JSON.parse(readFileSync('test/fixtures/jstqb.json', 'utf8')) as Question[];
  const questions = ['対象問題', '克服済み問題', '期間外問題'].map((text, index) => ({
    ...fixture[0],
    id: String(index),
    question: text,
  }));
  const attempt = (questionId: string, correct: boolean, createdAt: string): Attempt => ({
    questionId,
    correct,
    createdAt,
    mode: 'practice',
    elapsedMs: 1000,
  });
  const progress = emptyProgress();
  progress.attempts = [
    attempt('0', false, '2026-10-30T00:00:00Z'),
    attempt('0', true, '2026-10-31T00:00:00Z'),
    attempt('1', false, '2026-10-30T00:00:00Z'),
    attempt('1', true, '2026-10-31T00:00:00Z'),
    attempt('1', true, '2026-11-01T00:00:00Z'),
    attempt('2', false, '2026-01-01T00:00:00Z'),
  ];
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-01T12:00:00Z'));
  vi.stubGlobal('document', {
    getElementById: () => root,
    querySelector: (selector: string) =>
      ({
        '#practice-form': form,
        '[name="wrong"]': wrong,
        '[name="wrongPeriod"]': period,
        '[name="unresolved"]': unresolved,
      })[selector] ?? null,
    querySelectorAll: () => [],
  });
  vi.stubGlobal('location', { hash: '#practice' });
  vi.stubGlobal('window', { addEventListener: () => undefined });
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => (key.endsWith(':progress') ? JSON.stringify(progress) : null),
  });
  vi.stubGlobal('fetch', async () =>
    Response.json({
      exam: JSON.parse(readFileSync('content/jstqb/exam.json', 'utf8')) as unknown,
      syllabus: JSON.parse(readFileSync('content/jstqb/syllabus.json', 'utf8')) as unknown,
      questions,
    }),
  );
  vi.stubGlobal(
    'FormData',
    class {
      get(name: string): string {
        return name === 'wrongPeriod' ? 'last-7-days' : name === 'count' ? '10' : '';
      }
      has(name: string): boolean {
        return name === 'wrong' || name === 'unresolved';
      }
    },
  );
  try {
    await import('../src/client/app');
    await vi.waitFor(() => expect(listeners.has('submit')).toBe(true));
    for (const label of [
      '誤答の期間',
      'すべて',
      '直近の回答が誤り',
      '7日以内',
      '30日以内',
      '90日以内',
      '未克服のみ',
    ]) {
      expect(root.innerHTML).toContain(label);
    }
    expect(root.innerHTML).toContain('value="latest-wrong" selected');
    expect(root.innerHTML).toContain('name="wrongPeriod" disabled');
    expect(root.innerHTML).toContain('name="unresolved" disabled');
    wrong.checked = true;
    change?.();
    expect([period.disabled, unresolved.disabled]).toEqual([false, false]);
    wrong.checked = false;
    change?.();
    expect([period.disabled, unresolved.disabled]).toEqual([true, true]);
    wrong.checked = true;
    change?.();
    listeners.get('submit')?.({ preventDefault: () => undefined, currentTarget: form });
    expect(root.innerHTML).toContain('対象問題');
    expect(root.innerHTML).not.toContain('克服済み問題');
    expect(root.innerHTML).not.toContain('期間外問題');
    expect(root.innerHTML).toContain('1 / 1');
  } finally {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  }
});
