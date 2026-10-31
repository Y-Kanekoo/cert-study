import { readFileSync } from 'node:fs';
import { expect, it, vi } from 'vitest';
import { serializeAttemptsCsv } from '../src/shared/csv';
import { emptyProgress, type ExamConfig, type Question, type Syllabus } from '../src/shared/types';

const read = <T>(path: string): T => JSON.parse(readFileSync(path, 'utf8')) as T;

it.each(['local', 'server'])('%sモードで画面の回答履歴をCSVダウンロードに使う', async (mode) => {
  const exam = read<ExamConfig>('content/fe/exam.json');
  const syllabus = read<Syllabus>('content/fe/syllabus.json');
  const questions = read<Question[]>('test/fixtures/fe.json');
  const local = emptyProgress();
  local.attempts = [
    {
      questionId: questions[0].id,
      mode: 'practice',
      correct: true,
      choice: 0,
      elapsedMs: 1000,
      createdAt: '2026-10-01T00:00:00.000Z',
    },
  ];
  const server = {
    ...emptyProgress(),
    attempts: [{ ...local.attempts[0], mode: 'review' as const, correct: false }],
  };
  const root = { innerHTML: '', textContent: '' };
  let exportCsv: (() => void) | undefined;
  const link = { href: '', download: '', click: vi.fn() };
  let downloaded: Blob | undefined;
  const createUrl = vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => {
    downloaded = blob as Blob;
    return 'blob:csv-test';
  });
  const revokeUrl = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
  vi.stubGlobal('document', {
    getElementById: () => root,
    querySelector: (selector: string) =>
      selector === '#export-csv'
        ? { addEventListener: (_type: string, listener: () => void) => (exportCsv = listener) }
        : null,
    querySelectorAll: () => [],
    createElement: () => link,
  });
  vi.stubGlobal('location', { hash: '#settings' });
  vi.stubGlobal('window', { addEventListener: () => undefined });
  vi.stubGlobal('localStorage', {
    getItem: (key: string) =>
      key.endsWith(':progress')
        ? JSON.stringify(local)
        : key.endsWith(':token') && mode === 'server'
          ? 'test-token'
          : null,
  });
  const fetchMock = vi.fn(async (path: string) => {
    if (path === '/api/content') return Response.json({ exam, syllabus, questions });
    if (path === '/api/auth/check') return Response.json({ ok: true });
    if (path === '/api/progress') return Response.json(server);
    throw new Error(`想定外の通信: ${path}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  try {
    vi.resetModules();
    await import('../src/client/app');
    await vi.waitFor(() => expect(exportCsv).toBeDefined());
    expect(root.innerHTML).toContain('回答履歴をCSVで書き出す');
    const requestCount = fetchMock.mock.calls.length;
    exportCsv?.();
    expect(fetchMock).toHaveBeenCalledTimes(requestCount);
    expect(link.download).toBe('fe-attempts.csv');
    expect(link.click).toHaveBeenCalledOnce();
    expect(downloaded?.type).toBe('text/csv;charset=utf-8');
    const expected = serializeAttemptsCsv((mode === 'server' ? server : local).attempts, questions, syllabus);
    expect(new Uint8Array(await downloaded!.arrayBuffer())).toEqual(new TextEncoder().encode(expected));
    expect(revokeUrl).toHaveBeenCalledWith('blob:csv-test');
  } finally {
    createUrl.mockRestore();
    revokeUrl.mockRestore();
    vi.unstubAllGlobals();
  }
});
