import chalk from "chalk";
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

const levelColors: Record<LogLevel, (msg: string) => string> = {
  none: (msg) => msg,
  info: chalk.blue,
  warn: chalk.yellow,
  error: chalk.red,
  debug: chalk.green,
};

let frooky: FrookyAgent;
let verbosity: LogLevel = "error";
let logTo: LogTo = "console";

function shouldLog(level: LogLevel): boolean {
  return levelOrder[verbosity] >= levelOrder[level];
}

function format(level: LogLevel, msg: string | string[]): string {
  if (Array.isArray(msg)) {
    const lines = msg.map((m) => `    ${m}`).join("\n");
    return `[${level}]:\n${lines}`;
  }
  return `[${level}] ${msg}`;
}

function emit(level: LogLevel, msg: string | string[]): void {
  if (!shouldLog(level)) return;

  const formatted = format(level, msg);

  if (logTo === "console") {
    const out = levelColors[level](formatted);
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
    frooky.addEventToLog(new LogEvent(level, formatted));
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
  init: (agent: FrookyAgent, verbosity: LogLevel = "error", logTo: LogTo = "console") => {
    frooky = agent;
    verbosity = verbosity;
    logTo = logTo;
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
