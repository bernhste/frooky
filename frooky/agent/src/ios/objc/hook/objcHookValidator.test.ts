import { DEFAULT_DECODER_SETTINGS, DEFAULT_HOOK_SETTINGS } from "../../../shared/defaultValues";
import { InputFrookyConfig } from "../../../shared/frookyConfig";
import { FrookySettings } from "../../../shared/frookySettings";
import { InputObjcHookCollection } from "../../../shared/inputParsing/inputObjcHookCollection";
import { ObjcHookValidator } from "./objcHookValidator";

const defaultSettings: FrookySettings = {
  hookSettings: { ...DEFAULT_HOOK_SETTINGS },
  decoderSettings: { ...DEFAULT_DECODER_SETTINGS },
};

describe("ObjcHookValidator", () => {
  const validator = new ObjcHookValidator();

  it("only returns the objc hook groups of a mixed hookCollection", () => {
    const objcGroup: InputObjcHookCollection = { objcClass: "NSData", hooks: [] };
    const config = {
      hookCollection: [{ type: "native", module: "libSystem.B.dylib", hooks: [] }, objcGroup],
    } as unknown as InputFrookyConfig;
    expect(validator.getPlatformHookCollections(config)).toEqual([objcGroup]);
  });

  it("normalizes a plain selector using the default settings", () => {
    const config: InputFrookyConfig = { hookCollection: [{ objcClass: "NSData", hooks: ["-length"] }] };
    const [hook] = validator.validateAndNormalizeHooks(config, defaultSettings);
    expect(hook.objcClass).toBe("NSData");
    expect(hook.method).toBe("-length");
    expect(hook.decoderSettings).toEqual(DEFAULT_DECODER_SETTINGS);
  });

  it("skips an invalid hook without dropping the valid ones of the same group", () => {
    const config = {
      hookCollection: [{ objcClass: "NSData", hooks: ["-length", { method: 42 }, "+dataWithBytes:length:"] }],
    } as unknown as InputFrookyConfig;
    expect(validator.validateAndNormalizeHooks(config, defaultSettings).map((hook) => hook.method)).toEqual(["-length", "+dataWithBytes:length:"]);
  });
});
