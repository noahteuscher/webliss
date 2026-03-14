import { resolveTargetId, getOrStartDaemon } from "./target.js";
import { sendCommand } from "../ipc.js";
import { LogFormatter } from "../observe/formatter.js";

export async function executeConnect(targetPrefix: string): Promise<void> {
  const targetId = resolveTargetId(targetPrefix);
  const conn = await getOrStartDaemon(targetId);
  const response = await sendCommand(conn, { cmd: "get-status" });

  if (!response.ok) {
    console.error("Failed to connect:", response.error);
    process.exitCode = 1;
    return;
  }

  const status = JSON.parse(response.result);
  const formatter = new LogFormatter();
  const id = status.targetId.slice(0, 8);
  const title = status.tabTitle || "Untitled";
  const bufferInfo = `${status.bufferSize} events (${formatter.formatBytesHuman(status.bufferBytes)})`;

  console.log(`Connected to ${id} — ${title}`);
  console.log(`Buffer: ${bufferInfo}`);
  console.log(`URL: ${status.tabUrl}`);
}
