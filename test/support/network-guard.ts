// テスト共通: ループバック以外への通信を遮断する（外部通信はモックかローカルのフェイクのみ）。
// vitest.config.ts の setupFiles で読み込む。直接 import しても二重には適用されない。
import net from "node:net";

const loopback = new Set(["127.0.0.1", "::1", "localhost", "[::1]"]);
const marker = Symbol.for("development-hub.network-guard");
const state = globalThis as typeof globalThis & { [marker]?: boolean };

function assertLoopback(host: string | undefined): void {
  if (host !== undefined && !loopback.has(host)) {
    throw new Error(`テストから外部ネットワークへの接続は禁止です（モックを使う）: ${host}`);
  }
}

if (!state[marker]) {
  state[marker] = true;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    assertLoopback(new URL(url).hostname);
    return originalFetch(input, init);
  };
  const originalConnect = net.Socket.prototype.connect;
  net.Socket.prototype.connect = function (this: net.Socket, ...args: unknown[]) {
    const [first, second] = args;
    if (typeof first === "object" && first !== null && "port" in first) {
      assertLoopback((first as net.TcpNetConnectOpts).host ?? "localhost");
    } else if (typeof first === "number" || (typeof first === "string" && /^\d+$/u.test(first))) {
      assertLoopback(typeof second === "string" ? second : "localhost");
    }
    return (originalConnect as (...a: unknown[]) => net.Socket).apply(this, args);
  } as typeof net.Socket.prototype.connect;
}
