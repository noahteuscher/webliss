import { unlinkSync } from "fs";
import { connectToSocket, sendCommand, listDaemonSockets } from "../ipc.js";

function resolvePrefix(prefix: string, candidates: string[]): string {
  const upper = prefix.toUpperCase();
  const matches = candidates.filter((c) => c.toUpperCase().startsWith(upper));
  if (matches.length === 0)
    throw new Error(`No daemon matching prefix "${prefix}".`);
  if (matches.length > 1)
    throw new Error(
      `Ambiguous prefix "${prefix}" — matches ${matches.length} daemons.`,
    );
  return matches[0];
}

export async function executeStop(targetPrefix?: string): Promise<void> {
  const daemons = listDaemonSockets();

  if (targetPrefix) {
    const targetId = resolvePrefix(
      targetPrefix,
      daemons.map((d) => d.targetId),
    );
    const daemon = daemons.find((d) => d.targetId === targetId)!;
    try {
      const conn = await connectToSocket(daemon.socketPath);
      await sendCommand(conn, { cmd: "stop" });
      console.log(`Stopped daemon ${targetId.slice(0, 8)}`);
    } catch {
      // Daemon not responding, clean up stale socket
      try {
        unlinkSync(daemon.socketPath);
      } catch {
        // Socket already removed
      }
      console.log(`Cleaned up stale socket for ${targetId.slice(0, 8)}`);
    }
    return;
  }

  if (daemons.length === 0) {
    console.log("No daemons running");
    return;
  }

  for (const daemon of daemons) {
    try {
      const conn = await connectToSocket(daemon.socketPath);
      await sendCommand(conn, { cmd: "stop" });
      console.log(`Stopped daemon ${daemon.targetId.slice(0, 8)}`);
    } catch {
      // Daemon not responding, clean up stale socket
      try {
        unlinkSync(daemon.socketPath);
      } catch {
        // Socket already removed
      }
    }
  }
}
