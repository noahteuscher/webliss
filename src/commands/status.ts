import chalk from "chalk";
import { connectToSocket, sendCommand, listDaemonSockets } from "../ipc.js";
import { LogFormatter } from "../observe/formatter.js";

export async function executeStatus(): Promise<void> {
  const daemons = listDaemonSockets();

  if (daemons.length === 0) {
    console.log("No daemons running");
    return;
  }

  const formatter = new LogFormatter();

  for (const daemon of daemons) {
    try {
      const conn = await connectToSocket(daemon.socketPath);
      const response = await sendCommand(conn, { cmd: "get-status" });
      if (response.ok) {
        const status = JSON.parse(response.result);
        const id = status.targetId.slice(0, 8);
        const title = (status.tabTitle || "Untitled").slice(0, 40);
        const bufferInfo = `buffer: ${status.bufferSize} events (${formatter.formatBytesHuman(status.bufferBytes)})`;
        const uptime = `uptime: ${formatter.formatDurationHuman(status.uptime)}`;
        console.log(
          `${chalk.cyan(id)}  ${title.padEnd(42)}  ${bufferInfo}  ${uptime}`,
        );
      }
    } catch {
      // Daemon not responding
      const id = daemon.targetId.slice(0, 8);
      console.log(`${chalk.dim(id)}  ${chalk.dim("(stale socket)")}`);
    }
  }
}
