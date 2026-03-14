import { resolveTargetId, getOrStartDaemon } from "./target.js";
import { sendCommand } from "../ipc.js";

export async function executeEvalRaw(
  targetPrefix: string,
  method: string,
  paramsJson?: string,
): Promise<void> {
  const targetId = resolveTargetId(targetPrefix);
  const conn = await getOrStartDaemon(targetId);
  const args = paramsJson ? [method, paramsJson] : [method];
  const response = await sendCommand(conn, { cmd: "evalraw", args });
  if (response.ok) {
    if (response.result) console.log(response.result);
  } else {
    console.error("Error:", response.error);
    process.exitCode = 1;
  }
}
