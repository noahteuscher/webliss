import net from "net";
import { readdirSync } from "fs";

const SOCK_PREFIX = "/tmp/webliss-";

export function sockPath(targetId: string): string {
  return `${SOCK_PREFIX}${targetId}.sock`;
}

export function listDaemonSockets(): Array<{
  targetId: string;
  socketPath: string;
}> {
  return readdirSync("/tmp")
    .filter((f: string) => f.startsWith("webliss-") && f.endsWith(".sock"))
    .map((f: string) => ({
      targetId: f.slice("webliss-".length, -5),
      socketPath: `/tmp/${f}`,
    }));
}

export function connectToSocket(sp: string): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const conn = net.connect(sp);
    conn.on("connect", () => resolve(conn));
    conn.on("error", reject);
  });
}

export function sendCommand(
  conn: net.Socket,
  req: { cmd: string; args?: string[] },
): Promise<any> {
  return new Promise((resolve, reject) => {
    let buf = "";
    let settled = false;

    const cleanup = () => {
      conn.off("data", onData);
      conn.off("error", onError);
      conn.off("end", onEnd);
      conn.off("close", onClose);
    };

    const onData = (chunk: Buffer) => {
      buf += chunk.toString();
      const idx = buf.indexOf("\n");
      if (idx === -1) return;
      settled = true;
      cleanup();
      resolve(JSON.parse(buf.slice(0, idx)));
      conn.end();
    };

    const settle = (error: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };

    const onError = (error: Error) => settle(error);
    const onEnd = () => settle(new Error("Connection closed before response"));
    const onClose = () =>
      settle(new Error("Connection closed before response"));

    conn.on("data", onData);
    conn.on("error", onError);
    conn.on("end", onEnd);
    conn.on("close", onClose);
    conn.write(JSON.stringify({ ...req, id: 1 }) + "\n");
  });
}

/**
 * Send a command and keep the connection open for streaming responses.
 * Calls onMessage for each NDJSON line received.
 * Returns the connection for cleanup.
 */
export function sendStreamingCommand(
  conn: net.Socket,
  req: { cmd: string; args?: string[] },
  onMessage: (msg: any) => void,
): net.Socket {
  let buf = "";
  conn.on("data", (chunk: Buffer) => {
    buf += chunk.toString();
    const lines = buf.split("\n");
    buf = lines.pop() || "";
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        onMessage(JSON.parse(line));
      } catch {
        // Skip malformed
      }
    }
  });
  conn.write(JSON.stringify({ ...req, id: 1 }) + "\n");
  return conn;
}
