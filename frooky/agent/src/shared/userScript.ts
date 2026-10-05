// A bridge a -l script can import, e.g. `frida-java-bridge`, and the global it can use it as, e.g. `Java`
export type UserScriptBridge = { module: string; global: string; value: unknown };

export type UserScriptLogLevel = "info" | "debug" | "warning" | "error";

// a -l script's console output and send() messages, see the host's create_message_handler()
export type UserScriptMessage =
  { frooky: "userLog"; script: string; level: UserScriptLogLevel; text: string } | { frooky: "userSend"; script: string; payload: unknown };

type Post = (message: UserScriptMessage, data?: ArrayBuffer | number[] | null) => void;

// like Frida's console: arguments joined by spaces, ArrayBuffers as a hexdump
function formatLogArgs(args: unknown[]): string {
  return args.map((arg) => (arg instanceof ArrayBuffer ? hexdump(arg) : String(arg))).join(" ");
}

// Runs a -l script in the agent's script, so that it uses the agent's `bridges`. `source` is compiled by the host
// into an IIFE, with imports of the bridges turned into require() calls. The script gets its own `console`, `send`
// and `rpc`: its output goes to the host tagged with `name`, and its `rpc.exports` don't replace the agent's.
// Throws if the script throws while it runs.
export function runUserScript(name: string, source: string, bridges: UserScriptBridge[], post: Post = send): void {
  const log =
    (level: UserScriptLogLevel) =>
    (...args: unknown[]) =>
      post({ frooky: "userLog", script: name, level, text: formatLogArgs(args) });
  const scope: Record<string, unknown> = {
    console: { log: log("info"), info: log("info"), debug: log("debug"), warn: log("warning"), error: log("error") },
    send: (payload: unknown, data?: ArrayBuffer | number[] | null) => post({ frooky: "userSend", script: name, payload }, data),
    rpc: { exports: {} },
    require: (id: string) => {
      const bridge = bridges.find((b) => b.module === id);
      if (!bridge) throw new Error(`Cannot find module "${id}"`);
      return bridge.value;
    },
  };
  for (const bridge of bridges) scope[bridge.global] = bridge.value;
  const names = Object.keys(scope);
  // `source` starts on the first line, so the line numbers in its stack traces stay the same
  const run: (...args: unknown[]) => void = Script.evaluate(name, `(function (${names.join(", ")}) {${source}\n})`);
  run.apply(
    globalThis,
    names.map((n) => scope[n]),
  );
}
