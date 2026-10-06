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

// Exposes the bridge under its global name and `default`, and binds methods so destructuring imports work
function wrapBridgeModule(bridgeValue: unknown, globalName: string): unknown {
  if (!bridgeValue || (typeof bridgeValue !== "object" && typeof bridgeValue !== "function")) {
    return bridgeValue;
  }
  let proxy: unknown;
  proxy = new Proxy(bridgeValue as Record<string, unknown>, {
    get(target, prop) {
      if (prop === "default" || prop === globalName) return proxy;
      const val = Reflect.get(target, prop, target);
      return typeof val === "function" ? val.bind(target) : val;
    },
    has(target, prop) {
      return prop === "default" || prop === globalName || Reflect.has(target, prop);
    },
    getOwnPropertyDescriptor(target, prop) {
      if (prop === "default" || prop === globalName) {
        return { value: proxy, writable: false, enumerable: true, configurable: true };
      }
      const ownDesc = Reflect.getOwnPropertyDescriptor(target, prop);
      if (ownDesc) {
        if (typeof ownDesc.value === "function" && ownDesc.configurable) {
          return { ...ownDesc, value: ownDesc.value.bind(target) };
        }
        return ownDesc;
      }
      if (prop in target) {
        const val = target[prop as string];
        return {
          value: typeof val === "function" ? val.bind(target) : val,
          writable: true,
          enumerable: true,
          configurable: true,
        };
      }
      return undefined;
    },
    ownKeys(target) {
      const props = new Set<string | symbol>();
      let curr: object | null = target;
      while (curr && curr !== Object.prototype) {
        for (const name of Object.getOwnPropertyNames(curr)) {
          if (name !== "constructor") props.add(name);
        }
        curr = Object.getPrototypeOf(curr);
      }
      props.add("default");
      props.add(globalName);
      return Array.from(props);
    },
  });
  return proxy;
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
  const bridgeMap = new Map<string, unknown>(bridges.map((b) => [b.module, wrapBridgeModule(b.value, b.global)]));
  const scope: Record<string, unknown> = {
    console: { log: log("info"), info: log("info"), debug: log("debug"), warn: log("warning"), error: log("error") },
    send: (payload: unknown, data?: ArrayBuffer | number[] | null) => post({ frooky: "userSend", script: name, payload }, data),
    rpc: { exports: {} },
    require: (id: string) => {
      const mod = bridgeMap.get(id);
      if (mod === undefined) throw new Error(`Cannot find module "${id}"`);
      return mod;
    },
  };
  for (const bridge of bridges) scope[bridge.global] = bridgeMap.get(bridge.module);
  const names = Object.keys(scope);
  // `source` starts on the first line, so the line numbers in its stack traces stay the same
  const run: (...args: unknown[]) => void = Script.evaluate(name, `(function (${names.join(", ")}) {${source}\n})`);
  run.apply(
    globalThis,
    names.map((n) => scope[n]),
  );
}
