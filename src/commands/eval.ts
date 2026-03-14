import { resolveTargetId, getOrStartDaemon } from "./target.js";
import { sendCommand } from "../ipc.js";

export async function executeEval(
  targetPrefix: string,
  expression: string,
): Promise<void> {
  const targetId = resolveTargetId(targetPrefix);
  const conn = await getOrStartDaemon(targetId);
  const response = await sendCommand(conn, { cmd: "eval", args: [expression] });
  if (response.ok) {
    if (response.result) console.log(response.result);
  } else {
    console.error("Error:", response.error);
    process.exitCode = 1;
  }
}
