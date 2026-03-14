import { LogEvent, LogType } from "./events.js";

export interface FilterOptions {
  grep?: string;
  grepIgnoreCase?: boolean;
  exclude?: string;
  excludeIgnoreCase?: boolean;
  types?: LogType[];
  tabId?: string;
  urlPattern?: string;
  since?: number; // ms ago
  xhrOnly?: boolean;
}

export class LogFilter {
  private options: FilterOptions;
  private grepRegex: RegExp | null = null;
  private excludeRegex: RegExp | null = null;
  private urlRegex: RegExp | null = null;

  constructor(options: FilterOptions = {}) {
    this.options = options;

    if (options.grep) {
      try {
        this.grepRegex = new RegExp(
          options.grep,
          options.grepIgnoreCase ? "i" : "",
        );
      } catch {
        const escaped = options.grep.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        this.grepRegex = new RegExp(escaped, options.grepIgnoreCase ? "i" : "");
      }
    }

    if (options.exclude) {
      try {
        this.excludeRegex = new RegExp(
          options.exclude,
          options.excludeIgnoreCase ? "i" : "",
        );
      } catch {
        const escaped = options.exclude.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        this.excludeRegex = new RegExp(
          escaped,
          options.excludeIgnoreCase ? "i" : "",
        );
      }
    }

    if (options.urlPattern) {
      try {
        this.urlRegex = new RegExp(options.urlPattern, "i");
      } catch {
        const escaped = options.urlPattern.replace(
          /[.*+?^${}()|[\]\\]/g,
          "\\$&",
        );
        this.urlRegex = new RegExp(escaped, "i");
      }
    }
  }

  matches(event: LogEvent): boolean {
    // Filter by types
    if (this.options.types && this.options.types.length > 0) {
      if (!this.options.types.includes(event.type)) return false;
    }

    // Filter by tab ID (prefix match)
    if (this.options.tabId) {
      if (
        !event.tabId.toUpperCase().startsWith(this.options.tabId.toUpperCase())
      )
        return false;
    }

    // XHR-only: skip static assets for network events
    if (this.options.xhrOnly && event.type === "network" && event.network) {
      const rt = event.network.resourceType;
      if (rt && !["XHR", "Fetch", "Document"].includes(rt)) return false;
    }

    // Filter by URL pattern
    if (this.urlRegex && !this.urlRegex.test(event.tabUrl)) return false;

    // Filter by time
    if (this.options.since) {
      const cutoff = Date.now() - this.options.since;
      if (event.timestamp < cutoff) return false;
    }

    // Grep
    if (this.grepRegex) {
      if (!this.grepRegex.test(this.getSearchableText(event))) return false;
    }

    // Exclude
    if (this.excludeRegex) {
      if (this.excludeRegex.test(this.getSearchableText(event))) return false;
    }

    return true;
  }

  private getSearchableText(event: LogEvent): string {
    const parts: string[] = [];

    if (event.console) {
      parts.push(event.console.message);
      if (event.console.stack) parts.push(event.console.stack);
      if (event.console.args) parts.push(JSON.stringify(event.console.args));
    }

    if (event.network) {
      parts.push(event.network.method);
      parts.push(event.network.url);
      if (event.network.status) parts.push(event.network.status.toString());
      if (event.network.statusText) parts.push(event.network.statusText);
      if (event.network.mimeType) parts.push(event.network.mimeType);
      if (event.network.error) parts.push(event.network.error);
      if (event.network.requestBody) parts.push(event.network.requestBody);
      if (event.network.responseBody) parts.push(event.network.responseBody);
    }

    if (event.page) {
      parts.push(event.page.event);
      parts.push(event.page.url);
      if (event.page.title) parts.push(event.page.title);
    }

    return parts.join(" ");
  }
}
