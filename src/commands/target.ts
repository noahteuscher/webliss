import { readFileSync, existsSync, unlinkSync } from "fs";
import { spawn } from "child_process";
import { connectToSocket, listDaemonSockets, sockPath } from "../ipc.js";
import net from "net";

const PAGES_CACHE = "/tmp/webliss-pages.json";
const DAEMON_CONNECT_RETRIES = 20;
const DAEMON_CONNECT_DELAY = 300;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function resolvePrefix(
  prefix: string,
  candidates: string[],
  noun = "target",
  missingHint = "",
): string {
  const upper = prefix.toUpperCase();
  const matches = candidates.filter((c) => c.toUpperCase().startsWith(upper));
  if (matches.length === 0) {
    const hint = missingHint ? ` ${missingHint}` : "";
    throw new Error(`No ${noun} matching prefix "${prefix}".${hint}`);
  }
  if (matches.length > 1) {
    throw new Error(
      `Ambiguous prefix "${prefix}" — matches ${matches.length} ${noun}s. Use more characters.`,
    );
  }
  return matches[0];
}

function loadPagesCache(): any[] | null {
  if (!existsSync(PAGES_CACHE)) return null;
  try {
    return JSON.parse(readFileSync(PAGES_CACHE, "utf8"));
  } catch {
    // Corrupted cache file
    return null;
  }
}

function isHexPrefix(s: string): boolean {
  return /^[0-9a-f]+$/i.test(s);
}

/**
 * Match target by URL/domain or title pattern (case-insensitive substring).
 * Returns matching targetIds from the pages cache.
 */
function matchByPattern(query: string, pages: any[]): string[] {
  const lower = query.toLowerCase();
  return pages
    .filter((p: any) => {
      const url = (p.url || "").toLowerCase();
      const title = (p.title || "").toLowerCase();
      return url.includes(lower) || title.includes(lower);
    })
    .map((p: any) => p.targetId);
}

export function resolveTargetId(target: string): string {
  const daemonSockets = listDaemonSockets();
  const daemonTargetIds = daemonSockets.map((d) => d.targetId);
  const pages = loadPagesCache();

  // If it looks like a hex prefix, try ID-based resolution first
  if (isHexPrefix(target)) {
    const daemonMatches = daemonTargetIds.filter((id) =>
      id.toUpperCase().startsWith(target.toUpperCase()),
    );
    if (daemonMatches.length > 0) {
      return resolvePrefix(target, daemonTargetIds, "daemon");
    }
    if (pages) {
      const pageIds = pages.map((p: any) => p.targetId);
      const pageMatches = pageIds.filter((id: string) =>
        id.toUpperCase().startsWith(target.toUpperCase()),
      );
      if (pageMatches.length > 0) {
        return resolvePrefix(target, pageIds, "target", 'Run "webliss tabs".');
      }
    }
  }

  // Try URL/title pattern match against pages cache
  if (pages) {
    const matches = matchByPattern(target, pages);
    if (matches.length === 1) return matches[0];
    if (matches.length > 1) {
      throw new Error(
        `"${target}" matches ${matches.length} tabs. Be more specific, or use a tab ID prefix from "webliss tabs".`,
      );
    }
  }

  // Fall back to ID prefix if nothing else matched
  if (!isHexPrefix(target)) {
    const hint = pages ? "" : ' Run "webliss tabs" first.';
    throw new Error(`No tab matching "${target}".${hint}`);
  }

  if (!pages) {
    throw new Error('No page list cached. Run "webliss tabs" first.');
  }
  return resolvePrefix(
    target,
    pages.map((p: any) => p.targetId),
    "target",
    'Run "webliss tabs".',
  );
}

export async function getOrStartDaemon(targetId: string): Promise<net.Socket> {
  const sp = sockPath(targetId);

  // Try existing daemon
  try {
    return await connectToSocket(sp);
  } catch {
    // No running daemon, start one
  }

  // Clean stale socket
  try {
    unlinkSync(sp);
  } catch {
    // Socket doesn't exist yet
  }

  // Spawn daemon
  const child = spawn(
    process.execPath,
    [process.argv[1], "_daemon", targetId],
    { detached: true, stdio: "ignore" },
  );
  child.unref();

  // Wait for socket
  for (let i = 0; i < DAEMON_CONNECT_RETRIES; i++) {
    await sleep(DAEMON_CONNECT_DELAY);
    try {
      return await connectToSocket(sp);
    } catch {
      // Daemon not ready yet, retry
    }
  }
  throw new Error("Daemon failed to start — did you click Allow in Chrome?");
}
