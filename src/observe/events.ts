export type LogType = "console" | "network" | "error" | "warning" | "page";
export type ConsoleLevel =
  | "log"
  | "info"
  | "warning"
  | "error"
  | "debug"
  | "trace";
export type PageEventType =
  | "navigate"
  | "load"
  | "domReady"
  | "historyPush"
  | "historyPop";

export interface ConsoleData {
  level: ConsoleLevel;
  message: string;
  stack?: string;
  args?: unknown[];
  source?: string;
  lineNumber?: number;
  columnNumber?: number;
}

export interface NetworkData {
  requestId: string;
  method: string;
  url: string;
  status?: number;
  statusText?: string;
  requestHeaders?: Record<string, string>;
  responseHeaders?: Record<string, string>;
  requestBody?: string;
  responseBody?: string;
  timing?: number;
  error?: string;
  mimeType?: string;
  resourceType?: string;
}

export interface PageData {
  event: PageEventType;
  url: string;
  oldUrl?: string;
  title?: string;
  frameId?: string;
}

export interface LogEvent {
  id: string;
  timestamp: number;
  tabId: string;
  tabUrl: string;
  tabTitle: string;
  type: LogType;
  console?: ConsoleData;
  network?: NetworkData;
  page?: PageData;
}

export function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
}

export function truncate(
  str: string | undefined,
  maxLength: number,
): string | undefined {
  if (!str) return str;
  if (str.length <= maxLength) return str;
  return str.substring(0, maxLength) + "... [truncated]";
}
