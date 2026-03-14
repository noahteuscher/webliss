import chalk from "chalk";
import { LogEvent, PageData, NetworkData } from "./events.js";

export type OutputFormat = "pretty" | "json" | "agent";

export interface FormatterOptions {
  format: OutputFormat;
  noColor: boolean;
  showBodies: boolean;
  bodyLines: number;
  maxBodyChars: number;
  showHeaders: boolean;
  stripIds: boolean;
  absoluteTime: boolean;
}

export interface CommandFormatterOptions {
  json?: boolean;
  pretty?: boolean;
  noColor?: boolean;
  bodies?: boolean;
  fullBodies?: boolean;
  bodyLines?: number;
  maxBody?: number;
  headers?: boolean;
  stripIds?: boolean;
  absolute?: boolean;
}

export function createFormatterFromOptions(
  commandOptions: CommandFormatterOptions,
): LogFormatter {
  const isAgent = !commandOptions.json && !commandOptions.pretty;
  return new LogFormatter({
    format: commandOptions.json
      ? "json"
      : commandOptions.pretty
        ? "pretty"
        : "agent",
    noColor: commandOptions.noColor ?? isAgent,
    showBodies: commandOptions.bodies || commandOptions.fullBodies,
    bodyLines: commandOptions.fullBodies ? 0 : (commandOptions.bodyLines ?? 50),
    maxBodyChars: commandOptions.maxBody ?? 0,
    showHeaders: commandOptions.headers ?? false,
    stripIds: commandOptions.stripIds ?? isAgent,
    absoluteTime: commandOptions.absolute ?? false,
  });
}

export class LogFormatter {
  private options: FormatterOptions;

  constructor(options: Partial<FormatterOptions> = {}) {
    // Force chalk colors when pretty mode is used, colors aren't disabled, and NO_COLOR isn't set
    if (options.format === "pretty" && !options.noColor && !process.env.NO_COLOR && chalk.level === 0) {
      chalk.level = 3;
    }
    this.options = {
      format: options.format ?? "pretty",
      noColor: options.noColor ?? false,
      showBodies: options.showBodies ?? false,
      bodyLines: options.bodyLines ?? 50,
      maxBodyChars: options.maxBodyChars ?? 0,
      showHeaders: options.showHeaders ?? false,
      stripIds: options.stripIds ?? false,
      absoluteTime: options.absoluteTime ?? false,
    };
  }

  private style(fn: (s: string) => string, text: string): string {
    return this.options.noColor ? text : fn(text);
  }

  format(event: LogEvent): string {
    switch (this.options.format) {
      case "json":
        return this.formatJson(event);
      case "agent":
        return this.formatAgent(event);
      case "pretty":
      default:
        return this.formatPretty(event);
    }
  }

  private formatJson(event: LogEvent): string {
    if (!event.network) return JSON.stringify(event);
    const net = { ...event.network };
    if (!this.options.showBodies) {
      delete net.requestBody;
      delete net.responseBody;
    }
    if (!this.options.showHeaders) {
      delete net.requestHeaders;
      delete net.responseHeaders;
    }
    return JSON.stringify({ ...event, network: net });
  }

  private formatPretty(event: LogEvent): string {
    const timestamp = this.options.absoluteTime
      ? this.formatTimestamp(event.timestamp)
      : this.style(chalk.dim, `[${this.formatRelativeTime(event.timestamp)}]`);
    const domain = this.style(
      chalk.dim,
      `[${this.extractDomain(event.tabUrl)}]`,
    );

    if (event.type === "console" && event.console) {
      const typeBadge = this.options.noColor
        ? "console"
        : chalk.bgBlue.white(" console ");
      const level = this.applyLevelColor(
        event.console.level,
        event.console.level.toUpperCase().padEnd(5),
      );
      let output = `${timestamp} ${domain} ${typeBadge} ${level} ${event.console.message}`;
      if (event.console.stack) {
        output +=
          "\n" +
          event.console.stack
            .split("\n")
            .map((line) => this.style(chalk.dim, "    " + line))
            .join("\n");
      }
      return output;
    }

    if (event.type === "network" && event.network) {
      const typeBadge = this.options.noColor
        ? "network"
        : chalk.bgCyan.black(" network ");
      const net = event.network;
      const method = this.style(chalk.bold, net.method.padEnd(7));
      const status = net.status
        ? this.applyStatusColor(net.status)
        : this.style(chalk.dim, "...");
      const timing = net.timing
        ? this.style(chalk.dim, ` ${net.timing}ms`)
        : "";
      const url = this.truncateUrl(net.url, 100);

      let output = `${timestamp} ${domain} ${typeBadge} ${method} ${status} ${url}${timing}`;
      if (net.error)
        output += "\n" + this.style(chalk.red, "    Error: " + net.error);

      if (this.options.showHeaders) {
        if (net.requestHeaders && Object.keys(net.requestHeaders).length > 0) {
          output += "\n" + this.style(chalk.dim, "    ← Request Headers:");
          output += "\n" + this.formatHeaders(net.requestHeaders);
        }
        if (
          net.responseHeaders &&
          Object.keys(net.responseHeaders).length > 0
        ) {
          output += "\n" + this.style(chalk.dim, "    → Response Headers:");
          output += "\n" + this.formatHeaders(net.responseHeaders);
        }
      }

      if (this.options.showBodies) {
        if (net.requestBody) {
          output += "\n" + this.style(chalk.dim, "    ← Request Body:");
          output += "\n" + this.formatBody(net.requestBody);
        }
        if (net.responseBody) {
          output += "\n" + this.style(chalk.dim, "    → Response Body:");
          output += "\n" + this.formatBody(net.responseBody);
        }
      }
      return output;
    }

    if (event.type === "error") {
      const typeBadge = this.options.noColor
        ? "console"
        : chalk.bgRed.white(" console ");
      const level = this.options.noColor ? "ERROR" : chalk.red.bold("ERROR");
      const message = event.console?.message || "Unknown error";
      let output = `${timestamp} ${domain} ${typeBadge} ${level} ${message}`;
      if (event.console?.stack) {
        output +=
          "\n" +
          event.console.stack
            .split("\n")
            .map((line) => this.style(chalk.red, "    " + line))
            .join("\n");
      }
      return output;
    }

    if (event.type === "warning") {
      const typeBadge = this.options.noColor
        ? "console"
        : chalk.bgYellow.black(" console ");
      const level = this.options.noColor ? "WARN " : chalk.yellow.bold("WARN ");
      return `${timestamp} ${domain} ${typeBadge} ${level} ${event.console?.message || "Unknown warning"}`;
    }

    if (event.type === "page" && event.page) {
      return this.formatPagePretty(timestamp, domain, event.page);
    }

    return `${timestamp} ${domain} ${event.type}`;
  }

  private formatAgent(event: LogEvent): string {
    const relTime = this.formatRelativeTime(event.timestamp);

    if (event.type === "console" && event.console) {
      const level =
        event.console.level === "log" ? "info" : event.console.level;
      const message = this.truncateMessage(event.console.message, 200);
      let output = `[${relTime}] console.${level} "${message}"`;
      if (event.console.stack && (level === "error" || level === "warning")) {
        output += ` (${event.console.stack.split("\n")[0].trim()})`;
      }
      return output;
    }
    if (event.type === "network" && event.network) {
      const net = event.network;
      const path = this.extractPath(net.url);
      const timing = net.timing ? ` ${net.timing}ms` : "";
      let output = `[${relTime}] ${net.method} ${net.status || "..."} ${path}${timing}`;
      if (net.error) output += ` ERR: ${net.error}`;
      if (this.options.showBodies) {
        if (net.requestBody) {
          output += `\n  Request: ${this.truncateBodyByChars(net.requestBody, this.options.maxBodyChars || 500)}`;
        }
        if (net.responseBody) {
          output += `\n  Response: ${this.truncateBodyByChars(net.responseBody, this.options.maxBodyChars || 500)}`;
        }
      }
      return output;
    }
    if (event.type === "error") {
      const message = this.truncateMessage(
        event.console?.message || "Unknown error",
        200,
      );
      let output = `[${relTime}] console.error "${message}"`;
      if (event.console?.stack)
        output += ` (${event.console.stack.split("\n")[0].trim()})`;
      return output;
    }
    if (event.type === "warning") {
      return `[${relTime}] console.warn "${this.truncateMessage(event.console?.message || "Unknown warning", 200)}"`;
    }
    if (event.type === "page" && event.page) {
      return `[${relTime}] page.${event.page.event} ${this.extractPath(event.page.url)}`;
    }
    return `[${relTime}] ${event.type}`;
  }

  private formatRelativeTime(ts: number): string {
    const diff = Date.now() - ts;
    if (diff < 1000) return "now";
    if (diff < 60000) return `${Math.floor(diff / 1000)}s ago`;
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    return `${Math.floor(diff / 86400000)}d ago`;
  }

  private extractPath(url: string): string {
    try {
      const parsed = new URL(url);
      let path = parsed.pathname + parsed.search;
      if (this.options.stripIds) path = this.stripUuids(path);
      return path;
    } catch {
      return this.options.stripIds ? this.stripUuids(url) : url;
    }
  }

  private stripUuids(text: string): string {
    return text
      .replace(
        /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
        "*",
      )
      .replace(/\/[0-9]{6,}\b/g, "/*")
      .replace(/[?&]([^=]+)=[0-9a-f]{32,}/gi, "?$1=*");
  }

  private truncateMessage(msg: string, maxLen: number): string {
    const clean = msg.replace(/\s+/g, " ").trim();
    if (clean.length <= maxLen) return clean;
    return clean.slice(0, maxLen - 3) + "...";
  }

  private truncateBodyByChars(body: string, maxChars: number): string {
    if (maxChars === 0) return body.replace(/\s+/g, " ").trim();
    const clean = body.replace(/\s+/g, " ").trim();
    if (clean.length <= maxChars) return clean;
    return clean.slice(0, maxChars - 3) + "...";
  }

  private formatTimestamp(ts: number): string {
    const date = new Date(ts);
    const time = date.toLocaleTimeString("en-US", {
      hour12: false,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    const ms = date.getMilliseconds().toString().padStart(3, "0");
    return this.style(chalk.dim, `${time}.${ms}`);
  }

  private applyLevelColor(level: string, text: string): string {
    if (this.options.noColor) return text;
    switch (level) {
      case "error":
        return chalk.red(text);
      case "warning":
        return chalk.yellow(text);
      case "info":
        return chalk.blue(text);
      case "debug":
      case "trace":
        return chalk.dim(text);
      default:
        return text;
    }
  }

  private applyStatusColor(status: number): string {
    const text = status.toString();
    if (this.options.noColor) return text;
    if (status >= 200 && status < 300) return chalk.green(text);
    if (status >= 300 && status < 400) return chalk.cyan(text);
    if (status >= 400 && status < 500) return chalk.yellow(text);
    if (status >= 500) return chalk.red(text);
    return text;
  }

  private truncateUrl(url: string, maxLength: number): string {
    let processedUrl = this.options.stripIds ? this.stripUuids(url) : url;
    if (processedUrl.length <= maxLength) return processedUrl;
    try {
      const parsed = new URL(processedUrl);
      const base = parsed.origin;
      const path = parsed.pathname + parsed.search;
      if (path.length > maxLength - base.length - 3) {
        return base + "/..." + path.slice(-(maxLength - base.length - 6));
      }
      return processedUrl;
    } catch {
      return processedUrl.slice(0, maxLength - 3) + "...";
    }
  }

  private formatHeaders(headers: Record<string, string>): string {
    return Object.entries(headers)
      .map(
        ([key, value]) =>
          `      ${this.style(chalk.cyan, key)}: ${this.style(chalk.dim, value)}`,
      )
      .join("\n");
  }

  private formatBody(body: string): string {
    const indent = "      ";
    const maxLines = this.options.bodyLines;
    const maxChars = this.options.maxBodyChars;

    if (maxChars > 0) {
      const clean = body.replace(/\s+/g, " ").trim();
      const truncated =
        clean.length > maxChars ? clean.slice(0, maxChars - 3) + "..." : clean;
      return indent + this.style(chalk.green, truncated);
    }

    const unlimited = maxLines === 0 || maxLines === Infinity;
    try {
      const parsed = JSON.parse(body);
      const pretty = JSON.stringify(parsed, null, 2);
      const lines = pretty.split("\n");
      const truncated =
        !unlimited && lines.length > maxLines
          ? [
              ...lines.slice(0, maxLines),
              `... ${lines.length - maxLines} more lines`,
            ]
          : lines;
      return truncated
        .map((line) => indent + this.style(chalk.green, line))
        .join("\n");
    } catch {
      const allLines = body.split("\n");
      const lines = unlimited ? allLines : allLines.slice(0, maxLines);
      if (!unlimited && allLines.length > maxLines) lines.push("... truncated");
      return lines
        .map((line) => {
          const truncatedLine =
            line.length > 200 ? line.slice(0, 200) + "..." : line;
          return indent + this.style(chalk.dim, truncatedLine);
        })
        .join("\n");
    }
  }

  private formatPagePretty(
    timestamp: string,
    domain: string,
    page: PageData,
  ): string {
    const typeBadge = this.options.noColor
      ? "page"
      : chalk.bgMagenta.black(" page ");
    const eventType = this.applyPageEventColor(page.event);
    const url = this.truncateUrl(page.url, 100);
    return `${timestamp} ${domain} ${typeBadge}    ${eventType} ${url}`;
  }

  private applyPageEventColor(event: string): string {
    if (this.options.noColor) return event.toUpperCase().padEnd(10);
    switch (event) {
      case "navigate":
        return chalk.cyan("NAVIGATE  ");
      case "load":
        return chalk.green("LOAD      ");
      case "domReady":
        return chalk.blue("DOM READY ");
      case "historyPush":
        return chalk.magenta("HISTORY→  ");
      case "historyPop":
        return chalk.magenta("←HISTORY  ");
      default:
        return event.toUpperCase().padEnd(10);
    }
  }

  private extractDomain(url: string): string {
    try {
      return new URL(url).hostname.replace(/^www\./, "");
    } catch {
      return url.slice(0, 40);
    }
  }

  formatBytesHuman(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  formatDurationHuman(ms: number): string {
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${Math.round(ms / 1000)}s`;
    if (ms < 3600000) return `${Math.round(ms / 60000)}m`;
    return `${Math.round(ms / 3600000)}h`;
  }
}
