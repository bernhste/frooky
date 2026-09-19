import { DEFAULT_DECODER_SETTINGS, DEFAULT_HOOK_SETTINGS } from "../../../shared/defaultValues";
import { InputFrookyConfig } from "../../../shared/frookyConfig";
import { FrookySettings } from "../../../shared/frookySettings";
import { InputSwiftHookCollection } from "../../../shared/inputParsing/inputSwiftHookCollection";
import { SwiftHookValidator } from "./swiftHookValidator";

const defaultSettings: FrookySettings = {
  hookSettings: { ...DEFAULT_HOOK_SETTINGS },
  decoderSettings: { ...DEFAULT_DECODER_SETTINGS },
};

describe("SwiftHookValidator", () => {
  const validator = new SwiftHookValidator();

  it("only returns the swift hook groups of a mixed hookCollection", () => {
    const swiftGroup: InputSwiftHookCollection = { swiftClass: "MyApp.Foo", hooks: [] };
    const config = {
      hookCollection: [{ objcClass: "NSData", hooks: [] }, swiftGroup],
    } as unknown as InputFrookyConfig;
    expect(validator.getPlatformHookCollections(config)).toEqual([swiftGroup]);
  });

  it("normalizes a plain method name using the default settings", () => {
    const config: InputFrookyConfig = { hookCollection: [{ swiftClass: "MyApp.Foo", hooks: ["authenticate(user:_:)"] }] };
    const [hook] = validator.validateAndNormalizeHooks(config, defaultSettings);
    expect("swiftClass" in hook && hook.swiftClass).toBe("MyApp.Foo");
    expect(hook.method).toBe("authenticate(user:_:)");
    expect(hook.decoderSettings).toEqual(DEFAULT_DECODER_SETTINGS);
  });

  it("normalizes struct and enum hooks", () => {
    const config: InputFrookyConfig = {
      hookCollection: [
        { swiftStruct: "MyApp.Credentials", hooks: ["validate"] },
        { swiftEnum: "MyApp.LoginState", hooks: ["isFinal"] },
      ],
    };
    const hooks = validator.validateAndNormalizeHooks(config, defaultSettings);
    expect("swiftStruct" in hooks[0] && hooks[0].swiftStruct).toBe("MyApp.Credentials");
    expect("swiftEnum" in hooks[1] && hooks[1].swiftEnum).toBe("MyApp.LoginState");
  });

  it("skips an invalid hook without dropping the valid ones of the same group", () => {
    const config = {
      hookCollection: [{ swiftClass: "MyApp.Foo", hooks: ["a", { method: 42 }, "b"] }],
    } as unknown as InputFrookyConfig;
    expect(validator.validateAndNormalizeHooks(config, defaultSettings).map((hook) => hook.method)).toEqual(["a", "b"]);
  });
});
