declare module 'node:fs/promises' {
  export function readFile(path: string, encoding: 'utf8'): Promise<string>;
  export function readdir(path: string): Promise<string[]>;
  export function mkdir(path: string, options?: { recursive?: boolean }): Promise<void>;
  export function writeFile(path: string, data: string | Uint8Array): Promise<void>;
}
declare module 'node:path' {
  export function join(...parts: string[]): string;
}
declare module 'node:fs' {
  export function readFileSync(path: string, encoding: 'utf8'): string;
}
declare module 'node:sqlite' {
  export class DatabaseSync {
    constructor(path: string);
    exec(sql: string): void;
    prepare(sql: string): {
      all(...params: unknown[]): Record<string, unknown>[];
      get(...params: unknown[]): Record<string, unknown> | undefined;
      run(...params: unknown[]): { changes: number; lastInsertRowid: number };
    };
  }
}
declare module 'node:http' {
  type IncomingMessage = AsyncIterable<Uint8Array> & {
    url?: string;
    method?: string;
    headers: Record<string, string | string[] | undefined>;
  };
  type ServerResponse = {
    writeHead(status: number, headers: Record<string, string>): void;
    end(body: Uint8Array | string): void;
  };
  export function createServer(handler: (incoming: IncomingMessage, outgoing: ServerResponse) => void): {
    listen(port: number, hostname: string): void;
  };
}
declare const process: {
  argv: string[];
  env: Record<string, string | undefined>;
  exitCode?: number;
  exit(code?: number): never;
};
