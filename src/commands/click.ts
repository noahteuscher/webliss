import { resolveTargetId, getOrStartDaemon } from "./target.js";
import { sendCommand } from "../ipc.js";

export async function executeClick(
  targetPrefix: string,
  selector: string,
): Promise<void> {
  const targetId = resolveTargetId(targetPrefix);
  const conn = await getOrStartDaemon(targetId);
  const response = await sendCommand(conn, { cmd: "click", args: [selector] });
  if (response.ok) {
    if (response.result) console.log(response.result);
  } else {
    console.error("Error:", response.error);
    process.exitCode = 1;
  }
}

export async function executeClickXy(
  targetPrefix: string,
  x: string,
  y: string,
): Promise<void> {
  const targetId = resolveTargetId(targetPrefix);
  const conn = await getOrStartDaemon(targetId);
  const response = await sendCommand(conn, { cmd: "clickxy", args: [x, y] });
  if (response.ok) {
    if (response.result) console.log(response.result);
  } else {
    console.error("Error:", response.error);
    process.exitCode = 1;
  }
}
