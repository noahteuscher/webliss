import { existsSync, readFileSync } from "fs";
import { homedir } from "os";
import { resolve } from "path";

const TIMEOUT = 15000;

export const NAVIGATION_TIMEOUT = 30000;

export function getWsUrl(): string {
  const candidates = [
    resolve(
      homedir(),
      "Library/Application Support/Google/Chrome/DevToolsActivePort",
    ),
    resolve(homedir(), ".config/google-chrome/DevToolsActivePort"),
  ];
  const portFile = candidates.find((path) => existsSync(path));
  if (!portFile)
    throw new Error(
      `Could not find DevToolsActivePort file in: ${candidates.join(", ")}`,
    );
  const lines = readFileSync(portFile, "utf8").trim().split("\n");
  return `ws://127.0.0.1:${lines[0]}${lines[1]}`;
}

export class CDP {
  private ws!: WebSocket;
  private id = 0;
  private pending = new Map<
    number,
    { resolve: (value: any) => void; reject: (reason: any) => void }
  >();
  private eventHandlers = new Map<
    string,
    Set<(params: any, msg?: any) => void>
  >();
  private closeHandlers: (() => void)[] = [];

  async connect(wsUrl: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(wsUrl);
      this.ws.onopen = () => resolve();
      this.ws.onerror = (e: any) =>
        reject(new Error("WebSocket error: " + (e.message || e.type)));
      this.ws.onclose = () => this.closeHandlers.forEach((h) => h());
      this.ws.onmessage = (ev: any) => {
        const msg = JSON.parse(
          typeof ev.data === "string" ? ev.data : ev.data.toString(),
        );
        if (msg.id && this.pending.has(msg.id)) {
          const { resolve, reject } = this.pending.get(msg.id)!;
          this.pending.delete(msg.id);
          if (msg.error) reject(new Error(msg.error.message));
          else resolve(msg.result);
        } else if (msg.method && this.eventHandlers.has(msg.method)) {
          for (const handler of [...this.eventHandlers.get(msg.method)!]) {
            handler(msg.params || {}, msg);
          }
        }
      };
    });
  }

  send(
    method: string,
    params: Record<string, any> = {},
    sessionId?: string,
  ): Promise<any> {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      const msg: any = { id, method, params };
      if (sessionId) msg.sessionId = sessionId;
      this.ws.send(JSON.stringify(msg));
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`Timeout: ${method}`));
        }
      }, TIMEOUT);
    });
  }

  onEvent(
    method: string,
    handler: (params: any, msg?: any) => void,
  ): () => void {
    if (!this.eventHandlers.has(method))
      this.eventHandlers.set(method, new Set());
    const handlers = this.eventHandlers.get(method)!;
    handlers.add(handler);
    return () => {
      handlers.delete(handler);
      if (handlers.size === 0) this.eventHandlers.delete(method);
    };
  }

  waitForEvent(
    method: string,
    timeout = TIMEOUT,
  ): { promise: Promise<any>; cancel: () => void } {
    let settled = false;
    let off: () => void;
    let timer: ReturnType<typeof setTimeout>;
    const promise = new Promise<any>((resolve, reject) => {
      off = this.onEvent(method, (params) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        off();
        resolve(params);
      });
      timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        off();
        reject(new Error(`Timeout waiting for event: ${method}`));
      }, timeout);
    });
    return {
      promise,
      cancel() {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        off?.();
      },
    };
  }

  onClose(handler: () => void): void {
    this.closeHandlers.push(handler);
  }

  close(): void {
    this.ws.close();
  }
}
