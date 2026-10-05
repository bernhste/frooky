import Java from "frida-java-bridge";
import { logger } from "../shared/logger";
import { RetiredReplacements } from "./hook/retiredReplacements";
import { asFrooky, trackScriptReplacements } from "./scriptReplacements";

const TARGET = "java.lang.Long.toOctalString";
const retiredReplacements = new RetiredReplacements();

// Long.toOctalString(long), with `implementation` set by a -l script or, in asFrooky(), by frooky
function toOctalString(): Java.Method {
  return Java.use("java.lang.Long").toOctalString;
}

function hookAsScript(result: string): void {
  toOctalString().implementation = () => result;
}

function hookAsFrooky(result: string): void {
  asFrooky(TARGET, () => (toOctalString().implementation = () => result));
}

function unhookAsFrooky(): void {
  asFrooky(TARGET, () => retiredReplacements.revert(toOctalString(), { inFlight: 0, finished: 0 }));
}

describe("trackScriptReplacements()", () => {
  let warnSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    trackScriptReplacements();
    warnSpy = spyOn(logger, "warn");
  });

  afterEach(() => {
    warnSpy.mockRestore();
    toOctalString().implementation = null;
  });

  it("warns when frooky hooks a method a -l script hooked, whose hook frooky's then replaces", () => {
    hookAsScript("script");
    hookAsFrooky("frooky");

    expect(String(toOctalString().call(Java.use("java.lang.Long"), 8))).toBe("frooky");
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(String(warnSpy.mock.calls[0][0])).toContain(`${TARGET} is also hooked by a -l script`);
  });

  it("warns when a -l script hooks a method frooky hooked, whose hook the script's then replaces", () => {
    hookAsFrooky("frooky");
    hookAsScript("script");

    expect(String(toOctalString().call(Java.use("java.lang.Long"), 8))).toBe("script");
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(String(warnSpy.mock.calls[0][0])).toContain(`A -l script hooks ${TARGET}, which frooky hooks too`);
  });

  it("doesn't warn for a method only frooky hooks, or after the -l script unhooked it", () => {
    hookAsFrooky("frooky");
    unhookAsFrooky();
    hookAsScript("script");
    toOctalString().implementation = null;
    hookAsFrooky("frooky");

    expect(warnSpy).toHaveBeenCalledTimes(0);
  });
});
