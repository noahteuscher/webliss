import { CDP } from "../cdp.js";
import { LogEvent, generateId, truncate } from "./events.js";

const MAX_BODY_SIZE = 100 * 1024; // 100KB

interface PendingRequest {
  event: Partial<LogEvent>;
  chromeTimestamp?: number;
}

interface ObservationState {
  pendingRequests: Map<string, PendingRequest>;
  captureBodies: boolean;
  tabId: string;
  tabUrl: string;
  tabTitle: string;
}

function formatStackTrace(stackTrace: {
  callFrames?: Array<{
    functionName: string;
    url: string;
    lineNumber: number;
    columnNumber: number;
  }>;
}): string {
  if (!stackTrace?.callFrames) return "";
  return stackTrace.callFrames
    .map((frame) => {
      const fn = frame.functionName || "(anonymous)";
      const url = frame.url || "";
      const line = frame.lineNumber ?? "";
      const col = frame.columnNumber ?? "";
      return `    at ${fn} (${url}:${line}:${col})`;
    })
    .join("\n");
}

function formatObjectPreview(preview: {
  type: string;
  subtype?: string;
  description?: string;
  properties?: Array<{ name: string; value?: string }>;
}): unknown {
  if (preview.type === "object") {
    if (preview.subtype === "array") return preview.description;
    const props: Record<string, string | undefined> = {};
    for (const prop of preview.properties || []) {
      props[prop.name] = prop.value;
    }
    return props;
  }
  return preview.description;
}

export type EventCallback = (event: LogEvent) => void;

/**
 * Register CDP event handlers for console, network, and page observation.
 * Returns an unsubscribe function.
 */
export function registerObservationHandlers(
  cdp: CDP,
  sessionId: string,
  state: ObservationState,
  onEvent: EventCallback,
): () => void {
  const unsubscribers: (() => void)[] = [];

  // Sweep pending requests older than 60s to prevent memory leaks
  const PENDING_TTL = 60_000;
  const sweepInterval = setInterval(() => {
    const now = Date.now();
    for (const [requestId, pending] of state.pendingRequests) {
      const age = now - (pending.event.timestamp ?? 0);
      if (age > PENDING_TTL) {
        state.pendingRequests.delete(requestId);
      }
    }
  }, PENDING_TTL);

  function getTabInfo() {
    return {
      tabId: state.tabId,
      tabUrl: state.tabUrl,
      tabTitle: state.tabTitle,
    };
  }

  // Console.messageAdded
  unsubscribers.push(
    cdp.onEvent("Console.messageAdded", (params: any) => {
      if (params.sessionId && params.sessionId !== sessionId) return;
      const msg = params.message;
      const { tabId, tabUrl, tabTitle } = getTabInfo();
      onEvent({
        id: generateId(),
        timestamp: Date.now(),
        tabId,
        tabUrl,
        tabTitle,
        type:
          msg.level === "error"
            ? "error"
            : msg.level === "warning"
              ? "warning"
              : "console",
        console: {
          level: msg.level,
          message: msg.text,
          source: msg.source,
          lineNumber: msg.line,
          columnNumber: msg.column,
        },
      });
    }),
  );

  // Runtime.consoleAPICalled
  unsubscribers.push(
    cdp.onEvent("Runtime.consoleAPICalled", (params: any) => {
      if (params.sessionId && params.sessionId !== sessionId) return;
      const { tabId, tabUrl, tabTitle } = getTabInfo();

      const args =
        params.args?.map((arg: any) => {
          if (arg.type === "string") return arg.value;
          if (arg.type === "number") return arg.value;
          if (arg.type === "boolean") return arg.value;
          if (arg.type === "undefined") return undefined;
          if (arg.type === "object" && arg.preview)
            return formatObjectPreview(arg.preview);
          return arg.description || arg.value || `[${arg.type}]`;
        }) || [];

      const message = args
        .map((a: any) => (typeof a === "string" ? a : JSON.stringify(a)))
        .join(" ");

      const cdpType = params.type;
      const level =
        cdpType === "assert"
          ? "error"
          : ["log", "info", "warning", "error", "debug", "trace"].includes(
                cdpType,
              )
            ? cdpType
            : "log";

      onEvent({
        id: generateId(),
        timestamp: Date.now(),
        tabId,
        tabUrl,
        tabTitle,
        type:
          cdpType === "error" || cdpType === "assert"
            ? "error"
            : cdpType === "warning"
              ? "warning"
              : "console",
        console: {
          level,
          message,
          args,
          stack: params.stackTrace
            ? formatStackTrace(params.stackTrace)
            : undefined,
        },
      });
    }),
  );

  // Runtime.exceptionThrown
  unsubscribers.push(
    cdp.onEvent("Runtime.exceptionThrown", (params: any) => {
      if (params.sessionId && params.sessionId !== sessionId) return;
      const { tabId, tabUrl, tabTitle } = getTabInfo();
      const ex = params.exceptionDetails;
      onEvent({
        id: generateId(),
        timestamp: Date.now(),
        tabId,
        tabUrl,
        tabTitle,
        type: "error",
        console: {
          level: "error",
          message: ex.text || ex.exception?.description || "Unknown error",
          lineNumber: ex.lineNumber,
          columnNumber: ex.columnNumber,
          stack: ex.stackTrace ? formatStackTrace(ex.stackTrace) : undefined,
        },
      });
    }),
  );

  // Network.requestWillBeSent
  unsubscribers.push(
    cdp.onEvent("Network.requestWillBeSent", (params: any) => {
      if (params.sessionId && params.sessionId !== sessionId) return;
      const { tabId, tabUrl, tabTitle } = getTabInfo();
      const request = params.request;
      const requestId = params.requestId;

      state.pendingRequests.set(requestId, {
        event: {
          id: generateId(),
          timestamp: Date.now(),
          tabId,
          tabUrl,
          tabTitle,
          type: "network",
          network: {
            requestId,
            method: request.method,
            url: request.url,
            requestHeaders: request.headers,
            requestBody: state.captureBodies
              ? truncate(request.postData, MAX_BODY_SIZE)
              : undefined,
            resourceType: params.type,
          },
        },
        chromeTimestamp: params.timestamp ? params.timestamp * 1000 : undefined,
      });
    }),
  );

  // Network.responseReceived
  unsubscribers.push(
    cdp.onEvent("Network.responseReceived", (params: any) => {
      if (params.sessionId && params.sessionId !== sessionId) return;
      const response = params.response;
      const requestId = params.requestId;

      const pending = state.pendingRequests.get(requestId);
      if (pending && pending.event.network) {
        pending.event.network.status = response.status;
        pending.event.network.statusText = response.statusText;
        pending.event.network.responseHeaders = response.headers;
        pending.event.network.mimeType = response.mimeType;

        if (params.timestamp && pending.chromeTimestamp) {
          pending.event.network.timing = Math.round(
            params.timestamp * 1000 - pending.chromeTimestamp,
          );
        }
      }
    }),
  );

  // Resource types worth capturing response bodies for
  const BODY_RESOURCE_TYPES = new Set([
    "XHR", "Fetch", "Document", "Other",
  ]);

  // Network.loadingFinished
  unsubscribers.push(
    cdp.onEvent("Network.loadingFinished", async (params: any) => {
      if (params.sessionId && params.sessionId !== sessionId) return;
      const requestId = params.requestId;
      const pending = state.pendingRequests.get(requestId);

      if (pending) {
        const net = pending.event.network;
        if (state.captureBodies && net) {
          const shouldCapture = BODY_RESOURCE_TYPES.has(net.resourceType || "");
          if (shouldCapture) {
            try {
              const result = await cdp.send(
                "Network.getResponseBody",
                { requestId },
                sessionId,
              );
              if (result && result.body) {
                net.responseBody = truncate(
                  result.base64Encoded ? "[base64 encoded]" : result.body,
                  MAX_BODY_SIZE,
                );
              }
            } catch {
              // Response body unavailable (e.g. redirects, streaming)
            }
          }
        }

        onEvent(pending.event as LogEvent);
        state.pendingRequests.delete(requestId);
      }
    }),
  );

  // Network.loadingFailed
  unsubscribers.push(
    cdp.onEvent("Network.loadingFailed", (params: any) => {
      if (params.sessionId && params.sessionId !== sessionId) return;
      const requestId = params.requestId;
      const pending = state.pendingRequests.get(requestId);

      if (pending && pending.event.network) {
        pending.event.network.error = params.errorText;
        onEvent(pending.event as LogEvent);
        state.pendingRequests.delete(requestId);
      }
    }),
  );

  // Page.frameNavigated
  unsubscribers.push(
    cdp.onEvent("Page.frameNavigated", (params: any) => {
      if (params.sessionId && params.sessionId !== sessionId) return;
      const frame = params.frame;
      if (frame.parentId) return; // Only main frame

      const { tabId, tabTitle } = getTabInfo();
      // Update state with new URL
      state.tabUrl = frame.url;

      onEvent({
        id: generateId(),
        timestamp: Date.now(),
        tabId,
        tabUrl: frame.url,
        tabTitle,
        type: "page",
        page: {
          event: "navigate",
          url: frame.url,
          title: frame.name || undefined,
        },
      });
    }),
  );

  // Page.loadEventFired
  unsubscribers.push(
    cdp.onEvent("Page.loadEventFired", (params: any) => {
      if (params.sessionId && params.sessionId !== sessionId) return;
      const { tabId, tabUrl, tabTitle } = getTabInfo();
      onEvent({
        id: generateId(),
        timestamp: Date.now(),
        tabId,
        tabUrl,
        tabTitle,
        type: "page",
        page: {
          event: "load",
          url: tabUrl,
        },
      });
    }),
  );

  // Page.domContentEventFired
  unsubscribers.push(
    cdp.onEvent("Page.domContentEventFired", (params: any) => {
      if (params.sessionId && params.sessionId !== sessionId) return;
      const { tabId, tabUrl, tabTitle } = getTabInfo();
      onEvent({
        id: generateId(),
        timestamp: Date.now(),
        tabId,
        tabUrl,
        tabTitle,
        type: "page",
        page: {
          event: "domReady",
          url: tabUrl,
        },
      });
    }),
  );

  // Page.navigatedWithinDocument
  unsubscribers.push(
    cdp.onEvent("Page.navigatedWithinDocument", (params: any) => {
      if (params.sessionId && params.sessionId !== sessionId) return;
      const { tabId, tabTitle } = getTabInfo();
      state.tabUrl = params.url;

      onEvent({
        id: generateId(),
        timestamp: Date.now(),
        tabId,
        tabUrl: params.url,
        tabTitle,
        type: "page",
        page: {
          event: "historyPush",
          url: params.url,
        },
      });
    }),
  );

  return () => {
    clearInterval(sweepInterval);
    for (const unsub of unsubscribers) unsub();
  };
}

/**
 * Enable CDP domains needed for observation.
 */
export async function enableObservationDomains(
  cdp: CDP,
  sessionId: string,
): Promise<void> {
  await cdp.send("Console.enable", {}, sessionId);
  await cdp.send("Runtime.enable", {}, sessionId);
  await cdp.send("Network.enable", {}, sessionId);
  try {
    await cdp.send("Page.enable", {}, sessionId);
  } catch {
    // Page.enable not available on some targets
  }
}
