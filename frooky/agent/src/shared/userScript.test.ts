import { runUserScript, UserScriptBridge, UserScriptMessage } from "./userScript";

const bridge = { perform: (cb: () => void) => cb() };
const BRIDGES: UserScriptBridge[] = [{ module: "frida-java-bridge", global: "Java", value: bridge }];

// runs `source` as script.js, returning what it posted
function run(source: string): UserScriptMessage[] {
  const posted: UserScriptMessage[] = [];
  runUserScript("script.js", source, BRIDGES, (message) => posted.push(message));
  return posted;
}

describe("runUserScript()", () => {
  it("gives the script the bridge as its global, via require() and as the default import the host compiles to", () => {
    const posted = run(`
      "use strict";
      (() => {
        var __toESM = (mod) => ({ default: mod });
        var import_bridge = __toESM(require("frida-java-bridge"));
        console.log(Java === require("frida-java-bridge"), import_bridge.default === Java);
        Java.perform(() => console.log("performed"));
      })();
    `);

    expect(posted).toEqual([
      { frooky: "userLog", script: "script.js", level: "info", text: "true true" },
      { frooky: "userLog", script: "script.js", level: "info", text: "performed" },
    ]);
  });

  it("posts console output with its level, and send() payloads, tagged with the script's name", () => {
    const posted = run(`console.warn("careful", 1, null); console.error("bad"); console.debug("detail"); send({ a: 1 });`);

    expect(posted).toEqual([
      { frooky: "userLog", script: "script.js", level: "warning", text: "careful 1 null" },
      { frooky: "userLog", script: "script.js", level: "error", text: "bad" },
      { frooky: "userLog", script: "script.js", level: "debug", text: "detail" },
      { frooky: "userSend", script: "script.js", payload: { a: 1 } },
    ]);
  });

  it("keeps the agent's rpc.exports", () => {
    const exports = rpc.exports;

    run(`rpc.exports = { replaced: () => 1 };`);

    expect(rpc.exports).toBe(exports);
  });

  it("throws for a module that isn't a bridge, and for a syntax error", () => {
    expect(() => run(`require("fs");`)).toThrow('Cannot find module "fs"');
    expect(() => run(`const x = ;`)).toThrow();
  });
});
