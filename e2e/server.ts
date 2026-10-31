import { createServer } from 'node:http';
import type { ExamId } from '../src/shared/types';
import { createD1 } from './d1';

const ports: Record<ExamId, number> = { fe: 8781, ap: 8782, jstqb: 8783 };
const exam = process.argv[2] as ExamId;
if (!(exam in ports)) throw new Error('試験 ID を指定してください');
const worker = (await import(`../dist/${exam}/worker.js`)) as {
  default: {
    fetch: (
      request: Request,
      env: { DB: D1Database; TOKEN_SHA256: string; EXAM: string },
    ) => Promise<Response>;
  };
};
const env = {
  DB: createD1(),
  TOKEN_SHA256: [
    ...new Uint8Array(
      await crypto.subtle.digest(
        'SHA-256',
        new TextEncoder().encode('e2e-test-token-0123456789abcdef0123456789'),
      ),
    ),
  ]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join(''),
  EXAM: exam,
};
const server = createServer(async (incoming, outgoing) => {
  try {
    const chunks: Uint8Array[] = [];
    for await (const chunk of incoming) chunks.push(Buffer.from(chunk));
    const request = new Request(`http://127.0.0.1:${ports[exam]}${incoming.url ?? '/'}`, {
      method: incoming.method,
      headers: incoming.headers as HeadersInit,
      body: chunks.length ? Buffer.concat(chunks) : undefined,
    });
    const response = await worker.default.fetch(request, env);
    outgoing.writeHead(response.status, Object.fromEntries(response.headers));
    outgoing.end(Buffer.from(await response.arrayBuffer()));
  } catch {
    outgoing.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    outgoing.end('テストサーバー処理に失敗しました');
  }
});
server.listen(ports[exam], '127.0.0.1');
