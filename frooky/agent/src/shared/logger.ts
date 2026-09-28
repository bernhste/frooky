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

// the thread that loads the script: Frida's JS thread, which also runs RPC calls and timers
const jsThreadId = Process.getCurrentThreadId();
// messages logged on app threads, e.g. in hook callbacks
const pendingLogs: { level: LogLevel; msg: string }[] = [];

function shouldLog(level: LogLevel): boolean {
  return levelOrder[verbosity] >= levelOrder[level];
}

// Messages from app threads are queued and written from the JS thread: writing on an app thread can deadlock
// the app while libc read/write are hooked. JS thread messages queue behind pending ones to keep the order.
function emit(level: LogLevel, msg: string): void {
  if (!shouldLog(level)) return;

  if (pendingLogs.length > 0 || Process.getCurrentThreadId() !== jsThreadId) {
    if (pendingLogs.push({ level, msg }) === 1) setTimeout(writePendingLogs, 0);
    return;
  }
  write(level, msg);
}

function writePendingLogs(): void {
  for (const { level, msg } of pendingLogs.splice(0)) write(level, msg);
}

// plain text: the console method carries the level, the host does the coloring
function write(level: LogLevel, msg: string): void {
  if (logTo === "console") {
    switch (level) {
      case "info":
        console.log(msg);
        break;
      case "warn":
        console.warn(msg);
        break;
      case "error":
        console.error(msg);
        break;
      case "debug":
        console.debug(msg);
        break;
      default:
        console.log(msg);
        break;
    }
  } else if (logTo === "eventlog") {
    if (!frooky) {
      console.error("Cannot log to eventLog, since no frooky agent is set. Make sure to set the agent using setAgent(frookyAgent) first.");
      return;
    }
    frooky.addEventToLog(new LogEvent(level, msg));
  }
}

// Logs to Frida's console (default) or, with `setLogTo("eventlog")`, as LogEvents.
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
  // guards building expensive messages on hot paths
  isEnabled: (level: LogLevel) => shouldLog(level),
  debug: (msg: string) => emit("debug", msg),
  info: (msg: string) => emit("info", msg),
  warn: (msg: string) => emit("warn", msg),
  error: (msg: string) => emit("error", msg),
};

export type Logger = typeof logger;
