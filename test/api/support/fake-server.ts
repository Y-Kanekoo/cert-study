// 外部APIの代わりに 127.0.0.1 の空きポートで JSON を返すフェイクサーバー（API 段階用）。
// const fake = await startFakeServer(); fake.route("GET", "/v1/items", 200, {...});
// fake.url をテスト対象のクライアントへ渡す。受けたリクエストは fake.requests に残る。
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

export interface FakeRequest {
  method: string;
  path: string;
  body: string;
}

export interface FakeServer {
  url: string;
  requests: FakeRequest[];
  route: (method: string, path: string, status: number, body: unknown) => void;
  close: () => Promise<void>;
}

export async function startFakeServer(): Promise<FakeServer> {
  const routes = new Map<string, { status: number; body: unknown }>();
  const requests: FakeRequest[] = [];
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      const method = request.method ?? "GET";
      const path = request.url ?? "/";
      requests.push({ method, path, body: Buffer.concat(chunks).toString("utf8") });
      const hit = routes.get(`${method} ${path.split("?")[0]}`) ?? {
        status: 404,
        body: { error: "未登録の経路" },
      };
      response.writeHead(hit.status, { "content-type": "application/json; charset=utf-8" });
      response.end(JSON.stringify(hit.body));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    route: (method, path, status, body) =>
      routes.set(`${method.toUpperCase()} ${path}`, { status, body }),
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  };
}
