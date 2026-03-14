import { writeFileSync, unlinkSync } from "fs";
import net from "net";
import { CDP, NAVIGATION_TIMEOUT, getWsUrl } from "./cdp.js";
import { MemoryBuffer } from "./observe/buffer.js";
import { LogEvent } from "./observe/events.js";
import {
  registerObservationHandlers,
  enableObservationDomains,
} from "./observe/handlers.js";
import { sockPath } from "./ipc.js";
import { getDisplayPrefixLength } from "./commands/list.js";

const IDLE_TIMEOUT = 20 * 60 * 1000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// Command implementations
// ---------------------------------------------------------------------------

async function getPages(cdp: CDP): Promise<any[]> {
  const { targetInfos } = await cdp.send("Target.getTargets");
  return targetInfos.filter(
    (t: any) => t.type === "page" && !t.url.startsWith("chrome://"),
  );
}


function formatPageList(pages: any[]): string {
  const prefixLen = getDisplayPrefixLength(pages.map((p: any) => p.targetId));
  return pages
    .map((p: any) => {
      const id = p.targetId.slice(0, prefixLen).padEnd(prefixLen);
      const title = p.title.substring(0, 54).padEnd(54);
      return `${id}  ${title}  ${p.url}`;
    })
    .join("\n");
}

function shouldShowAxNode(node: any, compact = false): boolean {
  const role = node.role?.value || "";
  const name = node.name?.value ?? "";
  const value = node.value?.value;
  if (compact && role === "InlineTextBox") return false;
  return (
    role !== "none" &&
    role !== "generic" &&
    !(name === "" && (value === "" || value == null))
  );
}

function formatAxNode(node: any, depth: number): string {
  const role = node.role?.value || "";
  const name = node.name?.value ?? "";
  const value = node.value?.value;
  const indent = "  ".repeat(Math.min(depth, 10));
  let line = `${indent}[${role}]`;
  if (name !== "") line += ` ${name}`;
  if (!(value === "" || value == null)) line += ` = ${JSON.stringify(value)}`;
  return line;
}

function orderedAxChildren(
  node: any,
  nodesById: Map<string, any>,
  childrenByParent: Map<string, any[]>,
): any[] {
  const children: any[] = [];
  const seen = new Set();
  for (const childId of node.childIds || []) {
    const child = nodesById.get(childId);
    if (child && !seen.has(child.nodeId)) {
      seen.add(child.nodeId);
      children.push(child);
    }
  }
  for (const child of childrenByParent.get(node.nodeId) || []) {
    if (!seen.has(child.nodeId)) {
      seen.add(child.nodeId);
      children.push(child);
    }
  }
  return children;
}

async function snapshotStr(cdp: CDP, sid: string): Promise<string> {
  const { nodes } = await cdp.send("Accessibility.getFullAXTree", {}, sid);
  const nodesById = new Map<string, any>(
    nodes.map((node: any) => [node.nodeId, node]),
  );
  const childrenByParent = new Map<string, any[]>();
  for (const node of nodes) {
    if (!node.parentId) continue;
    if (!childrenByParent.has(node.parentId))
      childrenByParent.set(node.parentId, []);
    childrenByParent.get(node.parentId)!.push(node);
  }

  const lines: string[] = [];
  const visited = new Set();
  function visit(node: any, depth: number) {
    if (!node || visited.has(node.nodeId)) return;
    visited.add(node.nodeId);
    if (shouldShowAxNode(node, true)) lines.push(formatAxNode(node, depth));
    for (const child of orderedAxChildren(node, nodesById, childrenByParent)) {
      visit(child, depth + 1);
    }
  }

  const roots = nodes.filter(
    (node: any) => !node.parentId || !nodesById.has(node.parentId),
  );
  for (const root of roots) visit(root, 0);
  for (const node of nodes) visit(node, 0);

  return lines.join("\n");
}

async function evalStr(
  cdp: CDP,
  sid: string,
  expression: string,
): Promise<string> {
  await cdp.send("Runtime.enable", {}, sid);
  const result = await cdp.send(
    "Runtime.evaluate",
    {
      expression,
      returnByValue: true,
      awaitPromise: true,
    },
    sid,
  );
  if (result.exceptionDetails) {
    throw new Error(
      result.exceptionDetails.text ||
        result.exceptionDetails.exception?.description,
    );
  }
  const val = result.result.value;
  return typeof val === "object"
    ? JSON.stringify(val, null, 2)
    : String(val ?? "");
}

async function shotStr(
  cdp: CDP,
  sid: string,
  filePath?: string,
): Promise<string> {
  let dpr = 1;
  try {
    const raw = await evalStr(cdp, sid, "window.devicePixelRatio");
    const parsed = parseFloat(raw);
    if (parsed > 0) dpr = parsed;
  } catch {
    // Default to DPR 1 if unavailable
  }

  const { data } = await cdp.send(
    "Page.captureScreenshot",
    { format: "png" },
    sid,
  );
  const out = filePath || "/tmp/screenshot.png";
  writeFileSync(out, Buffer.from(data, "base64"));

  const lines = [out];
  lines.push(`Screenshot saved. Device pixel ratio (DPR): ${dpr}`);
  lines.push(`Coordinate mapping:`);
  lines.push(
    `  Screenshot pixels → CSS pixels (for CDP Input events): divide by ${dpr}`,
  );
  lines.push(
    `  e.g. screenshot point (${Math.round(100 * dpr)}, ${Math.round(200 * dpr)}) → CSS (100, 200) → use clickxy <target> 100 200`,
  );
  if (dpr !== 1) {
    lines.push(
      `  On this ${dpr}x display: CSS px = screenshot px / ${dpr} ≈ screenshot px × ${Math.round(100 / dpr) / 100}`,
    );
  }
  return lines.join("\n");
}

async function htmlStr(
  cdp: CDP,
  sid: string,
  selector?: string,
): Promise<string> {
  const expr = selector
    ? `document.querySelector(${JSON.stringify(selector)})?.outerHTML || 'Element not found'`
    : `document.documentElement.outerHTML`;
  return evalStr(cdp, sid, expr);
}

async function waitForDocumentReady(
  cdp: CDP,
  sid: string,
  timeoutMs = NAVIGATION_TIMEOUT,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastState = "";
  let lastError: Error | undefined;
  while (Date.now() < deadline) {
    try {
      const state = await evalStr(cdp, sid, "document.readyState");
      lastState = state;
      if (state === "complete") return;
    } catch (e: any) {
      lastError = e;
    }
    await sleep(200);
  }
  if (lastState)
    throw new Error(
      `Timed out waiting for navigation to finish (last readyState: ${lastState})`,
    );
  if (lastError)
    throw new Error(
      `Timed out waiting for navigation to finish (${lastError.message})`,
    );
  throw new Error("Timed out waiting for navigation to finish");
}

async function navStr(cdp: CDP, sid: string, url: string): Promise<string> {
  await cdp.send("Page.enable", {}, sid);
  const loadEvent = cdp.waitForEvent("Page.loadEventFired", NAVIGATION_TIMEOUT);
  const result = await cdp.send("Page.navigate", { url }, sid);
  if (result.errorText) {
    loadEvent.cancel();
    throw new Error(result.errorText);
  }
  if (result.loaderId) {
    await loadEvent.promise;
  } else {
    loadEvent.cancel();
  }
  await waitForDocumentReady(cdp, sid, 5000);
  return `Navigated to ${url}`;
}

async function clickStr(
  cdp: CDP,
  sid: string,
  selector: string,
): Promise<string> {
  if (!selector) throw new Error("CSS selector required");
  const expr = `
    (function() {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return { ok: false, error: 'Element not found: ' + ${JSON.stringify(selector)} };
      el.scrollIntoView({ block: 'center' });
      el.click();
      return { ok: true, tag: el.tagName, text: el.textContent.trim().substring(0, 80) };
    })()
  `;
  const result = await evalStr(cdp, sid, expr);
  const r = JSON.parse(result);
  if (!r.ok) throw new Error(r.error);
  return `Clicked <${r.tag}> "${r.text}"`;
}

async function clickXyStr(
  cdp: CDP,
  sid: string,
  x: string,
  y: string,
): Promise<string> {
  const cx = parseFloat(x);
  const cy = parseFloat(y);
  if (isNaN(cx) || isNaN(cy))
    throw new Error("x and y must be numbers (CSS pixels)");
  const base = { x: cx, y: cy, button: "left", clickCount: 1, modifiers: 0 };
  await cdp.send(
    "Input.dispatchMouseEvent",
    { ...base, type: "mouseMoved" },
    sid,
  );
  await cdp.send(
    "Input.dispatchMouseEvent",
    { ...base, type: "mousePressed" },
    sid,
  );
  await sleep(50);
  await cdp.send(
    "Input.dispatchMouseEvent",
    { ...base, type: "mouseReleased" },
    sid,
  );
  return `Clicked at CSS (${cx}, ${cy})`;
}

async function typeStr(cdp: CDP, sid: string, text: string): Promise<string> {
  if (text == null || text === "") throw new Error("text required");
  await cdp.send("Input.insertText", { text }, sid);
  return `Typed ${text.length} characters`;
}

async function loadAllStr(
  cdp: CDP,
  sid: string,
  selector: string,
  intervalMs = 1500,
): Promise<string> {
  if (!selector) throw new Error("CSS selector required");
  let clicks = 0;
  const deadline = Date.now() + 5 * 60 * 1000;
  while (Date.now() < deadline) {
    const exists = await evalStr(
      cdp,
      sid,
      `!!document.querySelector(${JSON.stringify(selector)})`,
    );
    if (exists !== "true") break;
    const clickExpr = `
      (function() {
        const el = document.querySelector(${JSON.stringify(selector)});
        if (!el) return false;
        el.scrollIntoView({ block: 'center' });
        el.click();
        return true;
      })()
    `;
    const clicked = await evalStr(cdp, sid, clickExpr);
    if (clicked !== "true") break;
    clicks++;
    await sleep(intervalMs);
  }
  return `Clicked "${selector}" ${clicks} time(s) until it disappeared`;
}

async function evalRawStr(
  cdp: CDP,
  sid: string,
  method: string,
  paramsJson?: string,
): Promise<string> {
  if (!method) throw new Error('CDP method required (e.g. "DOM.getDocument")');
  let params = {};
  if (paramsJson) {
    try {
      params = JSON.parse(paramsJson);
    } catch {
      throw new Error(`Invalid JSON params: ${paramsJson}`);
    }
  }
  const result = await cdp.send(method, params, sid);
  return JSON.stringify(result, null, 2);
}

// ---------------------------------------------------------------------------
// Daemon
// ---------------------------------------------------------------------------

export async function runDaemon(targetId: string): Promise<void> {
  const sp = sockPath(targetId);

  const cdp = new CDP();
  try {
    await cdp.connect(getWsUrl());
  } catch (e: any) {
    process.stderr.write(`Daemon: cannot connect to Chrome: ${e.message}\n`);
    process.exit(1);
  }

  let sessionId: string;
  try {
    const res = await cdp.send("Target.attachToTarget", {
      targetId,
      flatten: true,
    });
    sessionId = res.sessionId;
  } catch (e: any) {
    process.stderr.write(`Daemon: attach failed: ${e.message}\n`);
    cdp.close();
    process.exit(1);
  }

  // Get initial tab info
  let tabUrl = "";
  let tabTitle = "";
  try {
    const { targetInfos } = await cdp.send("Target.getTargets");
    const target = targetInfos.find((t: any) => t.targetId === targetId);
    if (target) {
      tabUrl = target.url;
      tabTitle = target.title;
    }
  } catch {
    // Tab info unavailable, proceed without it
  }

  // Observation state
  const buffer = new MemoryBuffer();
  const subscribers = new Set<net.Socket>();
  const observationState = {
    pendingRequests: new Map(),
    captureBodies: true,
    tabId: targetId,
    tabUrl,
    tabTitle,
  };

  // Enable observation domains
  try {
    await enableObservationDomains(cdp, sessionId);
  } catch (e: any) {
    process.stderr.write(`Daemon: observation setup warning: ${e.message}\n`);
  }

  // Register event handlers
  registerObservationHandlers(
    cdp,
    sessionId,
    observationState,
    (event: LogEvent) => {
      buffer.push(event);
      // Broadcast to subscribers
      const msg = JSON.stringify({ type: "event", data: event }) + "\n";
      for (const sub of subscribers) {
        try {
          sub.write(msg);
        } catch {
          subscribers.delete(sub);
        }
      }
    },
  );

  // Shutdown
  let alive = true;
  function shutdown() {
    if (!alive) return;
    alive = false;
    server.close();
    try {
      unlinkSync(sp);
    } catch {
      // Socket already removed
    }
    cdp.close();
    process.exit(0);
  }

  cdp.onEvent("Target.targetDestroyed", (params: any) => {
    if (params.targetId === targetId) shutdown();
  });
  cdp.onEvent("Target.detachedFromTarget", (params: any) => {
    if (params.sessionId === sessionId) shutdown();
  });
  cdp.onClose(() => shutdown());
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);

  // Idle timer
  let idleTimer = setTimeout(shutdown, IDLE_TIMEOUT);
  function resetIdle() {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(shutdown, IDLE_TIMEOUT);
  }

  // Handle a command
  async function handleCommand(req: {
    cmd: string;
    args?: string[];
  }): Promise<any> {
    resetIdle();
    const args = req.args || [];
    try {
      let result: string;
      switch (req.cmd) {
        case "list": {
          const pages = await getPages(cdp);
          result = formatPageList(pages);
          break;
        }
        case "list_raw": {
          const pages = await getPages(cdp);
          return { ok: true, result: JSON.stringify(pages) };
        }
        case "snap":
        case "snapshot":
          result = await snapshotStr(cdp, sessionId);
          break;
        case "eval":
          result = await evalStr(cdp, sessionId, args[0]);
          break;
        case "shot":
        case "screenshot":
          result = await shotStr(cdp, sessionId, args[0]);
          break;
        case "html":
          result = await htmlStr(cdp, sessionId, args[0]);
          break;
        case "nav":
        case "navigate":
          result = await navStr(cdp, sessionId, args[0]);
          break;
        case "click":
          result = await clickStr(cdp, sessionId, args[0]);
          break;
        case "clickxy":
          result = await clickXyStr(cdp, sessionId, args[0], args[1]);
          break;
        case "type":
          result = await typeStr(cdp, sessionId, args[0]);
          break;
        case "loadall":
          result = await loadAllStr(
            cdp,
            sessionId,
            args[0],
            args[1] ? parseInt(args[1]) : 1500,
          );
          break;
        case "evalraw":
          result = await evalRawStr(cdp, sessionId, args[0], args[1]);
          break;
        case "stop":
          return { ok: true, result: "", stopAfter: true };

        // Observation commands
        case "subscribe":
          return { ok: true, result: "", subscribe: true };
        case "get-buffer": {
          const n = args[0] ? parseInt(args[0]) : 50;
          const events = buffer.getLast(n);
          return { ok: true, result: JSON.stringify(events) };
        }
        case "get-status": {
          return {
            ok: true,
            result: JSON.stringify({
              targetId,
              tabUrl: observationState.tabUrl,
              tabTitle: observationState.tabTitle,
              bufferSize: buffer.length,
              bufferBytes: buffer.bytes,
              evicted: buffer.evicted,
              uptime: buffer.uptime,
            }),
          };
        }
        case "clear-buffer":
          buffer.clear();
          return { ok: true, result: "Buffer cleared" };
        default:
          return { ok: false, error: `Unknown command: ${req.cmd}` };
      }
      return { ok: true, result: result ?? "" };
    } catch (e: any) {
      return { ok: false, error: e.message };
    }
  }

  // Unix socket server — NDJSON protocol
  const server = net.createServer((conn) => {
    let buf = "";
    conn.on("data", (chunk) => {
      buf += chunk.toString();
      const lines = buf.split("\n");
      buf = lines.pop()!;
      for (const line of lines) {
        if (!line.trim()) continue;
        let req: any;
        try {
          req = JSON.parse(line);
        } catch {
          conn.write(
            JSON.stringify({
              ok: false,
              error: "Invalid JSON request",
              id: null,
            }) + "\n",
          );
          continue;
        }
        handleCommand(req).then((res) => {
          const payload = JSON.stringify({ ...res, id: req.id }) + "\n";
          if (res.subscribe) {
            // Send ack then add to subscribers
            conn.write(payload);
            subscribers.add(conn);
            conn.on("close", () => subscribers.delete(conn));
            conn.on("error", () => subscribers.delete(conn));
          } else if (res.stopAfter) {
            conn.end(payload, shutdown);
          } else {
            conn.write(payload);
          }
        });
      }
    });
    conn.on("error", () => {});
  });

  try {
    unlinkSync(sp);
  } catch {}
  server.listen(sp);
}
