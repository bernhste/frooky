import { FrookyAgent } from "../FrookyAgent";
import { LogEvent } from "./event/logEvent";

export type LogLevel = "none" | "error" | "warn" | "info" | "debug";
export type LogTo = "console" | "eventlog";

const levelOrder: Record<LogLevel, number> = {
  none: 0,
  error: 1,
  warn: 2,
  info: 3,
  debug: 4,
};

let frooky: FrookyAgent;
let verbosity: LogLevel = "error";
let logTo: LogTo = "console";

function shouldLog(level: LogLevel): boolean {
  return levelOrder[verbosity] >= levelOrder[level];
}

/** Plain text only: the level is conveyed by the console method, and the host does the coloring. */
function format(msg: string | string[]): string {
  return Array.isArray(msg) ? msg.join("\n") : msg;
}

function emit(level: LogLevel, msg: string | string[]): void {
  if (!shouldLog(level)) return;

  const out = format(msg);

  if (logTo === "console") {
    switch (level) {
      case "info":
        console.log(out);
        break;
      case "warn":
        console.warn(out);
        break;
      case "error":
        console.error(out);
        break;
      case "debug":
        console.debug(out);
        break;
      default:
        console.log(out);
        break;
    }
  } else if (logTo === "eventlog") {
    if (!frooky) {
      console.error("Cannot log to eventLog, since no frooky agent is set. Make sure to set the agent using setAgent(frookyAgent) first.");
      return;
    }
    frooky.addEventToLog(new LogEvent(level, out));
  }
}

/**
 * Sets the level of logging.
 * 0: No logging
 * 1: Errors only
 * 2: Errors + Warnings
 * 3: Errors + Warnings + Info
 * 4: Errors + Warnings + Info + Debug
 *
 * Will log using frooky messaging for logging by default.
 * If you want to use Frida `console` for logging, set `logTo = "console"`
 */
export const logger = {
  setAgent: (agent: FrookyAgent) => {
    frooky = agent;
  },
  setVerbosity: (level: LogLevel) => {
    verbosity = level;
  },
  setLogTo: (target: LogTo) => {
    logTo = target;
  },
  debug: (msg: string | string[]) => emit("debug", msg),
  info: (msg: string | string[]) => emit("info", msg),
  warn: (msg: string | string[]) => emit("warn", msg),
  error: (msg: string | string[]) => emit("error", msg),
};

export type Logger = typeof logger;
