// API 段階の土台（ネットワーク遮断とフェイクサーバー）が働くことの確認。
// 対象プロジェクトの API・外部連携の契約テストは、これを参考に test/api/<対象>.test.ts として追加する。
import "../support/network-guard.ts";
import { afterEach, describe, expect, it } from "vitest";
import { type FakeServer, startFakeServer } from "./support/fake-server.ts";

let fake: FakeServer | undefined;

afterEach(async () => {
  await fake?.close();
  fake = undefined;
});

describe("API テストの土台", () => {
  it("外部ネットワークへの fetch を遮断する", () => {
    expect(() => fetch("https://example.com/")).toThrow(/外部ネットワーク/u);
  });

  it("登録した JSON を返し、リクエストを記録する", async () => {
    fake = await startFakeServer();
    fake.route("GET", "/v1/items", 200, { items: [1, 2] });
    const response = await fetch(`${fake.url}/v1/items?page=1`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ items: [1, 2] });
    expect(fake.requests).toEqual([{ method: "GET", path: "/v1/items?page=1", body: "" }]);
  });

  it("未登録の経路は 404", async () => {
    fake = await startFakeServer();
    expect((await fetch(`${fake.url}/unknown`)).status).toBe(404);
  });
});
