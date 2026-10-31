import { expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  emptyProgress,
  type Attempt,
  type ExamConfig,
  type Question,
  type Session,
  type Syllabus,
} from '../src/shared/types';

const read = <T>(path: string): T => JSON.parse(readFileSync(path, 'utf8')) as T;

class Control {
  dataset: Record<string, string>;
  checked = false;
  listeners = new Map<string, () => void>();
  constructor(dataset: Record<string, string> = {}) {
    this.dataset = dataset;
  }
  addEventListener(type: string, listener: () => void): void {
    this.listeners.set(type, listener);
  }
  emit(type: string): void {
    this.listeners.get(type)?.();
  }
}

it('複数選択の模擬試験で解答確定、見直し、採点を行う', async () => {
  const root = { innerHTML: '', textContent: '' };
  const config = read<ExamConfig>('content/jstqb/exam.json');
  const syllabus = read<Syllabus>('content/jstqb/syllabus.json');
  const question = {
    ...read<Question[]>('test/fixtures/jstqb.json')[0],
    type: 'multi' as const,
    question: '境界値の候補を2つ選べ。',
    choices: ['下限', '中央', '上限', '任意', '平均'],
    answers: [0, 2],
    choiceNotes: ['境界', '中央', '境界', '任意', '平均'],
  };
  delete question.answer;
  const mock = new Control({ mock: 'jstqb-mini' });
  const submit = new Control();
  const multiAnswer = new Control();
  const flag = new Control();
  const choices = Array.from({ length: 5 }, (_, index) => new Control({ multi: String(index) }));
  const attempts: Attempt[][] = [];
  const sessions: Session[] = [];
  vi.stubGlobal('document', {
    getElementById: () => root,
    querySelector: (selector: string) =>
      ({ '#submit': submit, '#multi-answer': multiAnswer, '#flag': flag })[selector] ?? null,
    querySelectorAll: (selector: string) =>
      selector === '[data-mock]' ? [mock] : selector === '[data-multi]' ? choices : [],
  });
  vi.stubGlobal('location', { hash: '#mock' });
  vi.stubGlobal('window', { addEventListener: () => undefined });
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => (key.endsWith(':token') ? 'test-token' : null),
    setItem: () => undefined,
  });
  vi.stubGlobal('confirm', () => true);
  vi.stubGlobal('setInterval', () => 1);
  vi.stubGlobal('clearInterval', () => undefined);
  vi.stubGlobal('fetch', async (path: string, options?: RequestInit) => {
    if (path === '/api/content') return Response.json({ exam: config, syllabus, questions: [question] });
    if (path === '/api/auth/check') return Response.json({ ok: true });
    if (path === '/api/progress') return Response.json(emptyProgress());
    if (path === '/api/attempts') {
      attempts.push(JSON.parse(String(options?.body)) as Attempt[]);
      return Response.json({ states: [] });
    }
    if (path === '/api/sessions') {
      sessions.push(JSON.parse(String(options?.body)) as Session);
      return Response.json({ ok: true });
    }
    throw new Error(`想定外の通信: ${path}`);
  });
  try {
    vi.resetModules();
    await import('../src/client/app');
    await vi.waitFor(() => expect(mock.listeners.has('click')).toBe(true));
    mock.emit('click');
    expect(root.innerHTML).toContain('（2 つ選択）');
    expect(root.innerHTML).toContain('id="multi-answer" disabled');
    choices[0].checked = true;
    choices[0].emit('change');
    expect(root.innerHTML).toContain('id="multi-answer" disabled');
    choices[2].checked = true;
    choices[2].emit('change');
    expect(root.innerHTML).toContain('id="multi-answer" >解答');
    multiAnswer.emit('click');
    flag.emit('click');
    submit.emit('click');
    await vi.waitFor(() => expect(attempts).toHaveLength(1));
    await vi.waitFor(() => expect(sessions).toHaveLength(1));
    expect(attempts[0][0]).toMatchObject({ choice: 5, correct: true, mode: 'mock' });
    expect(sessions[0]).toMatchObject({ correct: 1, total: 1 });
    expect(sessions[0].detail.flaggedIds).toEqual([question.id]);
    expect(root.innerHTML).toContain('正解:');
    expect(root.innerHTML).toContain('下限');
    expect(root.innerHTML).toContain('上限');
  } finally {
    vi.unstubAllGlobals();
  }
});
