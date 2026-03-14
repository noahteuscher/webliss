import { resolveTargetId, getOrStartDaemon } from "./target.js";
import { sendCommand } from "../ipc.js";

export async function executeLoadAll(
  targetPrefix: string,
  selector: string,
  intervalMs?: string,
): Promise<void> {
  const targetId = resolveTargetId(targetPrefix);
  const conn = await getOrStartDaemon(targetId);
  const args = intervalMs ? [selector, intervalMs] : [selector];
  const response = await sendCommand(conn, { cmd: "loadall", args });
  if (response.ok) {
    if (response.result) console.log(response.result);
  } else {
    console.error("Error:", response.error);
    process.exitCode = 1;
  }
}
