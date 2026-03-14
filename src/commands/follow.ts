import { resolveTargetId, getOrStartDaemon } from "./target.js";
import { sendStreamingCommand } from "../ipc.js";
import { LogFilter, FilterOptions } from "../observe/filter.js";
import {
  createFormatterFromOptions,
  CommandFormatterOptions,
} from "../observe/formatter.js";
import { LogEvent, LogType } from "../observe/events.js";

export interface FollowOptions extends CommandFormatterOptions {
  grep?: string;
  ignoreCase?: boolean;
  exclude?: string;
  excludeIgnoreCase?: boolean;
  types?: string;
  url?: string;
  bodies?: boolean;
  xhr?: boolean;
}

export async function executeFollow(
  targetPrefix: string,
  options: FollowOptions,
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

  const filterOptions: FilterOptions = {
    grep: options.grep,
    grepIgnoreCase: options.ignoreCase,
    exclude: options.exclude,
    excludeIgnoreCase: options.excludeIgnoreCase,
    types,
    urlPattern: options.url,
    xhrOnly: options.xhr,
  };

  const filter = new LogFilter(filterOptions);
  const formatter = createFormatterFromOptions(options);

  // Subscribe to live events
  sendStreamingCommand(conn, { cmd: "subscribe" }, (msg) => {
    if (msg.type === "event" && msg.data) {
      const event = msg.data as LogEvent;
      if (filter.matches(event)) {
        console.log(formatter.format(event));
      }
    }
  });

  // Handle cleanup
  const shutdown = () => {
    conn.destroy();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  conn.on("close", () => process.exit(0));
  conn.on("error", () => process.exit(1));
}
