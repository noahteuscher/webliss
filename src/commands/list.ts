import { writeFileSync } from "fs";
import { connectToSocket, sendCommand, listDaemonSockets } from "../ipc.js";
import { CDP, getWsUrl } from "../cdp.js";

const PAGES_CACHE = "/tmp/webliss-pages.json";

export async function executeList(): Promise<void> {
  let pages: any[] | undefined;

  // Try existing daemon first
  const existingSock = listDaemonSockets()[0]?.socketPath;
  if (existingSock) {
    try {
      const conn = await connectToSocket(existingSock);
      const resp = await sendCommand(conn, { cmd: "list_raw" });
      if (resp.ok) pages = JSON.parse(resp.result);
    } catch {
      // Daemon unavailable, fall through to direct CDP connection
    }
  }

  if (!pages) {
    // No daemon — connect directly
    const cdp = new CDP();
    await cdp.connect(getWsUrl());
    const { targetInfos } = await cdp.send("Target.getTargets");
    pages = targetInfos.filter(
      (t: any) => t.type === "page" && !t.url.startsWith("chrome://"),
    );
    cdp.close();
  }

  writeFileSync(PAGES_CACHE, JSON.stringify(pages));

  const connectedIds = new Set(listDaemonSockets().map((d) => d.targetId));
  const prefixLen = getDisplayPrefixLength(pages!.map((p: any) => p.targetId));
  for (const p of pages!) {
    const id = p.targetId.slice(0, prefixLen).padEnd(prefixLen);
    const title = p.title.substring(0, 50).padEnd(50);
    const status = connectedIds.has(p.targetId) ? "●" : "○";
    console.log(`${status} ${id}  ${title}  ${p.url}`);
  }

}

export function getDisplayPrefixLength(targetIds: string[]): number {
  const MIN = 8;
  if (targetIds.length === 0) return MIN;
  const maxLen = Math.max(...targetIds.map((id: string) => id.length));
  for (let len = MIN; len <= maxLen; len++) {
    const prefixes = new Set(
      targetIds.map((id: string) => id.slice(0, len).toUpperCase()),
    );
    if (prefixes.size === targetIds.length) return len;
  }
  return maxLen;
}
