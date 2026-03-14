import { LogEvent } from "./events.js";

const DEFAULT_BUFFER_MEMORY = 50 * 1024 * 1024; // 50MB
const MAX_SINGLE_EVENT_SIZE = 1 * 1024 * 1024; // 1MB per event

export class MemoryBuffer {
  private events: LogEvent[] = [];
  private currentBytes = 0;
  private maxBytes: number;
  private evictedCount = 0;
  private createdAt = Date.now();

  constructor(maxBytes = DEFAULT_BUFFER_MEMORY) {
    this.maxBytes = maxBytes;
  }

  push(event: LogEvent): boolean {
    const size = this.estimateSize(event);

    if (size > MAX_SINGLE_EVENT_SIZE) {
      event = this.truncateEvent(event, MAX_SINGLE_EVENT_SIZE);
    }

    const eventSize = this.estimateSize(event);

    while (
      this.currentBytes + eventSize > this.maxBytes &&
      this.events.length > 0
    ) {
      const removed = this.events.shift()!;
      this.currentBytes -= this.estimateSize(removed);
      this.evictedCount++;
    }

    this.events.push(event);
    this.currentBytes += eventSize;
    return true;
  }

  getAll(): LogEvent[] {
    return [...this.events];
  }

  getLast(n: number): LogEvent[] {
    return this.events.slice(-n);
  }

  clear(): void {
    this.events = [];
    this.currentBytes = 0;
    this.evictedCount = 0;
  }

  get length(): number {
    return this.events.length;
  }

  get bytes(): number {
    return this.currentBytes;
  }

  get evicted(): number {
    return this.evictedCount;
  }

  get uptime(): number {
    return Date.now() - this.createdAt;
  }

  private estimateSize(event: LogEvent): number {
    try {
      return JSON.stringify(event).length * 2;
    } catch {
      return 1000;
    }
  }

  private truncateEvent(event: LogEvent, maxSize: number): LogEvent {
    const truncated = { ...event };

    if (truncated.network) {
      truncated.network = { ...truncated.network };
      const bodyLimit = Math.floor(maxSize / 4);

      if (
        truncated.network.requestBody &&
        truncated.network.requestBody.length > bodyLimit
      ) {
        const originalSize = truncated.network.requestBody.length;
        truncated.network.requestBody =
          truncated.network.requestBody.substring(0, bodyLimit) +
          ` [truncated, ${Math.round(originalSize / 1024)}KB total]`;
      }

      if (
        truncated.network.responseBody &&
        truncated.network.responseBody.length > bodyLimit
      ) {
        const originalSize = truncated.network.responseBody.length;
        truncated.network.responseBody =
          truncated.network.responseBody.substring(0, bodyLimit) +
          ` [truncated, ${Math.round(originalSize / 1024)}KB total]`;
      }
    }

    if (truncated.console) {
      truncated.console = { ...truncated.console };
      const messageLimit = Math.floor(maxSize / 2);

      if (
        truncated.console.message &&
        truncated.console.message.length > messageLimit
      ) {
        truncated.console.message =
          truncated.console.message.substring(0, messageLimit) + " [truncated]";
      }

      if (
        truncated.console.stack &&
        truncated.console.stack.length > messageLimit
      ) {
        truncated.console.stack =
          truncated.console.stack.substring(0, messageLimit) +
          "\n[stack truncated]";
      }
    }

    return truncated;
  }
}
