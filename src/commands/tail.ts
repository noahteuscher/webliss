import { resolveTargetId, getOrStartDaemon } from "./target.js";
import { sendCommand, sendStreamingCommand } from "../ipc.js";
import { LogFilter, FilterOptions } from "../observe/filter.js";
import {
  createFormatterFromOptions,
  CommandFormatterOptions,
} from "../observe/formatter.js";
import { LogEvent, LogType } from "../observe/events.js";

export interface TailOptions extends CommandFormatterOptions {
  grep?: string;
  ignoreCase?: boolean;
  exclude?: string;
  excludeIgnoreCase?: boolean;
  types?: string;
  url?: string;
  lines?: number;
  since?: string;
  follow?: boolean;
  bodies?: boolean;
  xhr?: boolean;
}

function parseDuration(value: string): number {
  const match = value.match(/^(\d+)(s|m|h|d)?$/i);
  if (!match)
    throw new Error(
      `Invalid duration "${value}". Use formats like: 30s, 5m, 1h, 2d`,
    );
  const num = parseInt(match[1], 10);
  const unit = (match[2] || "s").toLowerCase();
  const multipliers: Record<string, number> = {
    s: 1000,
    m: 60000,
    h: 3600000,
    d: 86400000,
  };
  return num * multipliers[unit];
}

export async function executeTail(
  targetPrefix: string,
  options: TailOptions,
): Promise<void> {
  const targetId = resolveTargetId(targetPrefix);
  const conn = await getOrStartDaemon(targetId);

  const types = options.types
    ? (options.types
        .split(",")
        .filter((t) =>
          ["network", "console", "page", "error", "warning"].includes(t),
        ) as LogType[])
    : undefined;

  const sinceMs = options.since ? parseDuration(options.since) : undefined;

  const filterOptions: FilterOptions = {
    grep: options.grep,
    grepIgnoreCase: options.ignoreCase,
    exclude: options.exclude,
    excludeIgnoreCase: options.excludeIgnoreCase,
    types,
    urlPattern: options.url,
    since: sinceMs,
    xhrOnly: options.xhr,
  };

  const filter = new LogFilter(filterOptions);
  const formatter = createFormatterFromOptions(options);
  const lines = options.lines ?? 50;

  // Get buffered events
  const response = await sendCommand(conn, {
    cmd: "get-buffer",
    args: [String(lines)],
  });
  if (!response.ok) {
    console.error("Error:", response.error);
    process.exitCode = 1;
    return;
  }

  const events: LogEvent[] = JSON.parse(response.result);
  const filtered = events.filter((event) => filter.matches(event));

  if (filtered.length === 0) {
    console.log("(no matching events)");
  } else {
    for (const event of filtered) {
      console.log(formatter.format(event));
    }
  }

  // Follow mode
  if (options.follow) {
    const followConn = await getOrStartDaemon(targetId);
    sendStreamingCommand(followConn, { cmd: "subscribe" }, (msg) => {
      if (msg.type === "event" && msg.data) {
        const event = msg.data as LogEvent;
        if (filter.matches(event)) {
          console.log(formatter.format(event));
        }
      }
    });

    const shutdown = () => {
      followConn.destroy();
      process.exit(0);
    };
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
    followConn.on("close", () => process.exit(0));
  }
}
