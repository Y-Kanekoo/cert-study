import { afterEach, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  emptyProgress,
  type Attempt,
  type ExamConfig,
  type Progress,
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

  click(): void {
    this.listeners.get('click')?.();
  }

  submit(): void {
    this.listeners.get('submit')?.({ preventDefault: () => undefined, currentTarget: this });
  }
}

type FetchHandler = (path: string, options?: RequestInit) => Promise<Response>;

async function setup(initialRoute: string, fetchHandler: FetchHandler) {
  vi.resetModules();
  const root = { innerHTML: '', textContent: '' };
  const storage = new Map<string, string>([['cert-study:fe:token', 'test-token']]);
  const locationState = { hash: initialRoute };
  const mockButton = new Button({ mock: 'fe-A-mini' });
  const submitButton = new Button();
  const formButton = new Button();
  const choiceButtons = [0, 1, 2, 3].map((choice) => new Button({ choice: String(choice) }));
  let hashChange: (() => void) | undefined;
  const config = read<ExamConfig>('content/fe/exam.json');
  const syllabus = read<Syllabus>('content/fe/syllabus.json');
  const questions = read<Question[]>('test/fixtures/fe.json');
  vi.stubGlobal('document', {
    getElementById: () => root,
    querySelector: (selector: string) =>
      ({ '#submit': submitButton, '#practice-form': formButton })[selector] ?? null,
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
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  });
  vi.stubGlobal(
    'FormData',
    class {
      get(name: string): string {
        return name === 'count' ? '1' : '';
      }
      has(): boolean {
        return false;
      }
    },
  );
  vi.stubGlobal('setInterval', () => 1);
  vi.stubGlobal('clearInterval', () => undefined);
  vi.stubGlobal('confirm', () => true);
  vi.stubGlobal('fetch', async (path: string, options?: RequestInit) => {
    if (path === '/api/content') return Response.json({ exam: config, syllabus, questions });
    if (path === '/api/auth/check') return Response.json({ ok: true });
    return fetchHandler(path, options);
  });
  await import('../src/client/app');
  await vi.waitFor(() => expect(root.innerHTML).toContain('<h2>'));
  return {
    root,
    storage,
    mockButton,
    submitButton,
    formButton,
    choiceButtons,
    navigate: (route: string) => {
      locationState.hash = route;
      hashChange?.();
    },
  };
}

afterEach(() => vi.unstubAllGlobals());

it('解答の POST 失敗時に解答とセッションを端末に保存して通知する', async () => {
  const ui = await setup('#mock', async (path) => {
    if (path === '/api/progress') return Response.json(emptyProgress());
    if (path === '/api/attempts') return Response.json({ error: '失敗' }, { status: 500 });
    throw new Error(`想定外の通信: ${path}`);
  });
  ui.mockButton.click();
  ui.submitButton.click();
  await vi.waitFor(() => expect(ui.root.innerHTML).toContain('<h2>結果</h2>'));
  const saved = JSON.parse(ui.storage.get('cert-study:fe:progress') ?? '{}') as Progress;
  expect(saved.attempts).toHaveLength(2);
  expect(saved.sessions).toHaveLength(1);
  expect(ui.root.innerHTML).toContain('今回の履歴と以降の履歴をこの端末に保存');
});

it('セッションの POST 失敗時にセッションを端末に保存して通知する', async () => {
  const ui = await setup('#mock', async (path) => {
    if (path === '/api/progress') return Response.json(emptyProgress());
    if (path === '/api/attempts') return Response.json({ states: [] });
    if (path === '/api/sessions') return Response.json({ error: '失敗' }, { status: 500 });
    throw new Error(`想定外の通信: ${path}`);
  });
  ui.mockButton.click();
  ui.submitButton.click();
  await vi.waitFor(() => expect(ui.root.innerHTML).toContain('<h2>結果</h2>'));
  const saved = JSON.parse(ui.storage.get('cert-study:fe:progress') ?? '{}') as Progress;
  expect(saved.sessions).toHaveLength(1);
  expect(ui.root.innerHTML).toContain('今回の履歴と以降の履歴をこの端末に保存');
});

it('進捗取得が遅れても遷移先に解答を表示し、応答後に再描画する', async () => {
  let resolveProgress: ((response: Response) => void) | undefined;
  const delayedProgress = new Promise<Response>((resolve) => {
    resolveProgress = resolve;
  });
  let progressRequests = 0;
  let posted: Attempt[] = [];
  const ui = await setup('#practice', async (path, options) => {
    if (path === '/api/progress') {
      progressRequests++;
      return progressRequests === 1 ? Response.json(emptyProgress()) : delayedProgress;
    }
    if (path === '/api/attempts') {
      posted = JSON.parse(String(options?.body)) as Attempt[];
      return Response.json({ states: [] });
    }
    throw new Error(`想定外の通信: ${path}`);
  });
  ui.formButton.submit();
  ui.choiceButtons[0].click();
  await vi.waitFor(() => expect(progressRequests).toBe(2));
  ui.navigate('#home');
  expect(ui.root.innerHTML).toContain('解答数</span><strong>1問');
  resolveProgress?.(Response.json({ ...emptyProgress(), attempts: [posted[0], posted[0]] }));
  await vi.waitFor(() => expect(ui.root.innerHTML).toContain('解答数</span><strong>2問'));
});
