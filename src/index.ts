#!/usr/bin/env node
import { Command } from "commander";
import { runDaemon } from "./daemon.js";
import { executeList } from "./commands/list.js";
import { executeSnap } from "./commands/snap.js";
import { executeShot } from "./commands/shot.js";
import { executeEval } from "./commands/eval.js";
import { executeHtml } from "./commands/html.js";
import { executeNav } from "./commands/nav.js";
import { executeClick, executeClickXy } from "./commands/click.js";
import { executeType } from "./commands/type.js";
import { executeLoadAll } from "./commands/loadall.js";
import { executeEvalRaw } from "./commands/evalraw.js";
import { executeStop } from "./commands/stop.js";
import { executeFollow } from "./commands/follow.js";
import { executeTail } from "./commands/tail.js";
import { executeStatus } from "./commands/status.js";
import { executeConnect } from "./commands/connect.js";

// ---------------------------------------------------------------------------
// Arg transform: type aliases → tail with --types
// e.g. "webliss console 60A6" → "webliss tail 60A6 --types console,error,warning"
//      "webliss network 60A6 --grep api" → "webliss tail 60A6 --types network --grep api"
//      "webliss console follow 60A6" → "webliss follow 60A6 --types console,error,warning"
// ---------------------------------------------------------------------------
const TYPE_MODIFIERS: Record<string, string> = {
  console: "console,error,warning",
  network: "network",
  page: "page",
};
const ACTION_COMMANDS = new Set(["follow", "tail"]);
const KNOWN_COMMANDS = new Set([
  "tabs", "connect", "snap", "snapshot", "shot", "screenshot", "eval", "html",
  "nav", "navigate", "click", "clickxy", "type", "loadall", "evalraw", "stop",
  "follow", "tail", "status", "_daemon", "help",
]);
const FLAGS_WITH_VALUES = new Set([
  "-g", "--grep", "-x", "--exclude", "--tab", "-u", "--url",
  "-n", "--lines", "--since", "--body-lines", "--max-body", "--types",
]);

function transformArgs(argv: string[]): string[] {
  const [runtime, script, ...args] = argv;
  if (args.length === 0) return argv;

  // Scan for type modifiers anywhere in the args
  const types: string[] = [];
  let action: string | null = null;
  const remaining: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    // Skip flags and their values
    if (arg.startsWith("-")) {
      remaining.push(arg);
      if (
        i + 1 < args.length &&
        !args[i + 1].startsWith("-") &&
        FLAGS_WITH_VALUES.has(arg)
      ) {
        remaining.push(args[++i]);
      }
      continue;
    }

    // Type modifier
    if (arg in TYPE_MODIFIERS) {
      types.push(TYPE_MODIFIERS[arg]);
      continue;
    }

    // Action command
    if (ACTION_COMMANDS.has(arg) && !action) {
      action = arg;
      continue;
    }

    // Everything else (target, etc.)
    remaining.push(arg);
  }

  // Type modifiers found — rewrite to tail/follow with --types
  if (types.length > 0) {
    if (!action) action = "tail";
    return [runtime, script, action, ...remaining, "--types", types.join(",")];
  }

  // No type modifiers — check if first arg is a bare target (not a known command)
  // e.g. "webliss localhost" → "webliss tail localhost"
  if (args.length >= 1 && !KNOWN_COMMANDS.has(args[0]) && !args[0].startsWith("-")) {
    return [runtime, script, "tail", ...args];
  }

  return argv;
}

const program = new Command();

program
  .name("webliss")
  .description("Browser observation & control CLI via Chrome DevTools Protocol")
  .version("1.0.0");

// Internal daemon mode
program
  .command("_daemon", { hidden: true })
  .argument("<targetId>")
  .action((targetId) => runDaemon(targetId));

// --- Interactive commands (from cdp.mjs) ---

program
  .command("tabs")
  .description("List open Chrome tabs")
  .action(() => run(executeList));

program
  .command("connect")
  .description("Start collecting events from a tab")
  .argument("<target>", "Target ID prefix, URL, or title")
  .action((target) => run(() => executeConnect(target)));

program
  .command("snap")
  .alias("snapshot")
  .description("Accessibility tree snapshot")
  .argument("<target>", 'Target ID prefix from "webliss list"')
  .action((target) => run(() => executeSnap(target)));

program
  .command("shot")
  .alias("screenshot")
  .description("Screenshot (default: /tmp/screenshot.png)")
  .argument("<target>", "Target ID prefix")
  .argument("[file]", "Output file path")
  .action((target, file) => run(() => executeShot(target, file)));

program
  .command("eval")
  .description("Evaluate JS expression")
  .argument("<target>", "Target ID prefix")
  .argument("<expression...>", "JS expression")
  .action((target, exprParts) =>
    run(() => executeEval(target, exprParts.join(" "))),
  );

program
  .command("html")
  .description("Get HTML (full page or CSS selector)")
  .argument("<target>", "Target ID prefix")
  .argument("[selector]", "CSS selector")
  .action((target, selector) => run(() => executeHtml(target, selector)));

program
  .command("nav")
  .alias("navigate")
  .description("Navigate to URL and wait for load")
  .argument("<target>", "Target ID prefix")
  .argument("<url>", "URL to navigate to")
  .action((target, url) => run(() => executeNav(target, url)));

program
  .command("click")
  .description("Click element by CSS selector")
  .argument("<target>", "Target ID prefix")
  .argument("<selector>", "CSS selector")
  .action((target, selector) => run(() => executeClick(target, selector)));

program
  .command("clickxy")
  .description("Click at CSS pixel coordinates")
  .argument("<target>", "Target ID prefix")
  .argument("<x>", "X coordinate (CSS pixels)")
  .argument("<y>", "Y coordinate (CSS pixels)")
  .action((target, x, y) => run(() => executeClickXy(target, x, y)));

program
  .command("type")
  .description("Type text at current focus")
  .argument("<target>", "Target ID prefix")
  .argument("<text...>", "Text to type")
  .action((target, textParts) =>
    run(() => executeType(target, textParts.join(" "))),
  );

program
  .command("loadall")
  .description("Repeatedly click selector until it disappears")
  .argument("<target>", "Target ID prefix")
  .argument("<selector>", "CSS selector")
  .argument("[interval]", "Interval in ms (default 1500)")
  .action((target, selector, interval) =>
    run(() => executeLoadAll(target, selector, interval)),
  );

program
  .command("evalraw")
  .description("Send raw CDP command")
  .argument("<target>", "Target ID prefix")
  .argument("<method>", 'CDP method (e.g. "DOM.getDocument")')
  .argument("[params]", "JSON params")
  .action((target, method, params) =>
    run(() => executeEvalRaw(target, method, params)),
  );

program
  .command("stop")
  .description("Stop daemon(s)")
  .argument("[target]", "Target ID prefix (omit to stop all)")
  .action((target) => run(() => executeStop(target)));

// --- Observation commands (new in v2) ---

function addFilterOptions(cmd: Command): Command {
  return cmd
    .option("-g, --grep <pattern>", "Filter by regex pattern")
    .option("-i, --ignore-case", "Case-insensitive grep")
    .option("-x, --exclude <pattern>", "Exclude matching pattern")
    .option("-I, --exclude-ignore-case", "Case-insensitive exclude")
    .option("-u, --url <pattern>", "Filter by URL pattern")
    .option("--xhr", "Network: only show XHR/Fetch requests (hide JS/CSS/images)")
    .option("-b, --bodies", "Show request/response bodies")
    .option("-B, --full-bodies", "Show complete bodies")
    .option("--body-lines <n>", "Max lines per body (default 50)", parseInt)
    .option("--max-body <n>", "Max characters per body", parseInt)
    .option("-H, --headers", "Show request/response headers")
    .option("--json", "Output as JSON lines")
    .option("--pretty", "Pretty-printed output with colors")
    .option("--no-color", "Disable colors")
    .option("--strip-ids", "Strip UUIDs and long IDs from URLs")
    .option("--absolute", "Show absolute timestamps")
    .option(
      "--types <types>",
      "Filter by types: console,network,page,error,warning",
    );
}

const followCmd = program
  .command("follow")
  .description("Stream live console + network events")
  .argument("<target>", "Target ID prefix");
addFilterOptions(followCmd).action((target, options) =>
  run(() => executeFollow(target, options)),
);

const tailCmd = program
  .command("tail")
  .description("Show recent buffered events")
  .argument("<target>", "Target ID prefix");
addFilterOptions(tailCmd)
  .option("-n, --lines <count>", "Number of events to show", "50")
  .option("--since <duration>", "Show events from last N (e.g., 30s, 5m, 1h)")
  .option("-f, --follow", "Follow after showing initial events")
  .action((target, options) =>
    run(() =>
      executeTail(target, { ...options, lines: parseInt(options.lines) }),
    ),
  );

program
  .command("status")
  .description("Show running daemons with buffer stats")
  .action(() => run(executeStatus));

// --- Run wrapper ---

function run(fn: () => Promise<void>): void {
  fn().catch((e: Error) => {
    console.error(e.message);
    process.exit(1);
  });
}

program.parse(transformArgs(process.argv));
