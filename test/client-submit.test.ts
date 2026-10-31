import { expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  emptyProgress,
  type Attempt,
  type ExamConfig,
  type Question,
  type Syllabus,
} from '../src/shared/types';

const read = <T>(path: string): T => JSON.parse(readFileSync(path, 'utf8')) as T;

class Button {
  dataset: Record<string, string>;
  listeners = new Map<string, (event?: unknown) => void>();

  constructor(dataset: Record<string, string> = {}) {
    this.dataset = dataset;
  }

  addEventListener(type: string, listener: (event?: unknown) => void): void {
    this.listeners.set(type, listener);
  }

  emit(type: string, event?: unknown): void {
    this.listeners.get(type)?.(event);
  }

  click(): void {
    this.emit('click');
  }
}

it('模擬試験の全解答を 1 回の POST で送る', async () => {
  const root = { innerHTML: '', textContent: '' };
  const mockButton = new Button({ mock: 'fe-A-mini' });
  const submitButton = new Button();
  const formButton = new Button();
  const nextButton = new Button();
  const choiceButtons = [0, 1, 2, 3].map((choice) => new Button({ choice: String(choice) }));
  const config = read<ExamConfig>('content/fe/exam.json');
  const syllabus = read<Syllabus>('content/fe/syllabus.json');
  const questions = read<Question[]>('test/fixtures/fe.json').map((question) => ({
    ...question,
    code: 'if (value < 1) return;',
  }));
  const sent: Attempt[][] = [];
  const locationState = { hash: '#mock' };
  let hashChange: (() => void) | undefined;
  vi.stubGlobal('document', {
    getElementById: () => root,
    querySelector: (selector: string) =>
      ({ '#submit': submitButton, '#practice-form': formButton, '#next': nextButton })[selector] ?? null,
    querySelectorAll: (selector: string) =>
      selector === '[data-mock]' ? [mockButton] : selector === '[data-choice]' ? choiceButtons : [],
  });
  vi.stubGlobal('location', locationState);
  vi.stubGlobal('window', {
    addEventListener: (type: string, listener: () => void) => {
      if (type === 'hashchange') hashChange = listener;
    },
  });
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => (key.endsWith(':token') ? 'test-token' : null),
    setItem: () => undefined,
  });
  vi.stubGlobal('confirm', () => true);
  vi.stubGlobal(
    'FormData',
    class {
      get(name: string): string {
        return name === 'count' ? '2' : '';
      }
      has(): boolean {
        return false;
      }
    },
  );
  vi.stubGlobal('setInterval', () => 1);
  vi.stubGlobal('clearInterval', () => undefined);
  vi.stubGlobal('fetch', async (path: string, options?: RequestInit) => {
    if (path === '/api/content') return Response.json({ exam: config, syllabus, questions });
    if (path === '/api/auth/check') return Response.json({ ok: true });
    if (path === '/api/progress') return Response.json(emptyProgress());
    if (path === '/api/attempts') {
      sent.push(JSON.parse(String(options?.body)) as Attempt[]);
      return Response.json({ states: [] });
    }
    if (path === '/api/sessions') return Response.json({ ok: true });
    throw new Error(`想定外の通信: ${path}`);
  });

  try {
    await import('../src/client/app');
    await vi.waitFor(() => expect(root.innerHTML || root.textContent).not.toBe(''));
    expect(root.textContent).toBe('');
    await vi.waitFor(() => expect(mockButton.listeners.has('click')).toBe(true));
    mockButton.click();
    expect(root.innerHTML).toContain('残り時間');
    expect(root.innerHTML).toContain('<pre class="code">if (value &lt; 1) return;</pre>');
    expect(root.innerHTML).toContain('ア.');
    submitButton.click();
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    await vi.waitFor(() => expect(root.innerHTML).toContain('<h2>結果</h2>'));
    expect(sent[0]).toHaveLength(questions.length);
    expect(sent[0].every((item) => item.mode === 'mock')).toBe(true);
    expect(root.innerHTML).toContain('正解:');
    expect(root.innerHTML).toContain('解答と解説');
    locationState.hash = '#home';
    hashChange?.();
    for (const label of [
      '今日の復習',
      '定着率',
      '解答数',
      '正答率',
      '連続学習日数',
      '練習',
      '復習',
      '定着チェック',
      '模擬試験',
      'シラバス',
      '分析',
    ]) {
      expect(root.innerHTML).toContain(label);
    }
    expect(root.innerHTML).toContain(syllabus.source.url);
    locationState.hash = '#practice';
    hashChange?.();
    formButton.emit('submit', { preventDefault: () => undefined, currentTarget: formButton });
    choiceButtons[0].click();
    await vi.waitFor(() => expect(sent).toHaveLength(2));
    await vi.waitFor(() => expect(root.innerHTML).toContain('<div class="feedback">'));
    expect(root.innerHTML).toContain('正解:');
    expect(root.innerHTML).toMatch(/条件を指定する|疎通確認に使う/);
    nextButton.click();
    choiceButtons[0].click();
    await vi.waitFor(() => expect(sent).toHaveLength(3));
    await vi.waitFor(() => expect(root.innerHTML).toContain('結果を見る'));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(root.innerHTML).not.toContain('保存に失敗');
    expect(sent.slice(1).every((items) => items.length === 1 && items[0].mode === 'practice')).toBe(true);
  } finally {
    vi.unstubAllGlobals();
  }
});
