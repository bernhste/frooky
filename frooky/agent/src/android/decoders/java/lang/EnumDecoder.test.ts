import Java from "frida-java-bridge";
import { DEFAULT_DECODER_SETTINGS } from "../../../../shared/defaultValues";
import { ReferenceTypeDecoder } from "../../builtin/ReferenceTypeDecoder";
import { EnumDecoder } from "./EnumDecoder";

describe("EnumDecoder", () => {
  it("decodes a constant as its name", () => {
    const decoder = new EnumDecoder({ type: "java.lang.Thread$State", settings: DEFAULT_DECODER_SETTINGS });

    expect(decoder.decode(Java.use("java.lang.Thread$State").RUNNABLE.value)).toEqual({ type: "java.lang.Thread$State", value: "RUNNABLE" });
  });

  it("is chosen for any enum declared as Object", () => {
    const decoder = new ReferenceTypeDecoder({ type: "java.lang.Object", settings: DEFAULT_DECODER_SETTINGS });

    // its constants have no class bodies, unlike e.g. TimeUnit's on Android 12, whose runtime class is TimeUnit$4
    expect(decoder.decode(Java.use("java.math.RoundingMode").HALF_UP.value)).toEqual({
      type: "java.lang.Object",
      value: { type: "java.math.RoundingMode", value: "HALF_UP" },
    });
  });

  // a constant with a class body (e.g. TimeUnit$4 on Android 12) is an instance of an anonymous subclass of its enum
  it("is chosen for TimeUnit, whose constants have class bodies on some Android versions", () => {
    const decoder = new ReferenceTypeDecoder({ type: "java.lang.Object", settings: DEFAULT_DECODER_SETTINGS });
    const seconds = Java.use("java.util.concurrent.TimeUnit").SECONDS.value;
    const runtimeClass: string = Java.cast(seconds, Java.use("java.lang.Object")).getClass().getName();

    expect(decoder.decode(seconds)).toEqual({ type: "java.lang.Object", value: { type: runtimeClass, value: "SECONDS" } });
  });

  it("decodes null", () => {
    const decoder = new EnumDecoder({ type: "java.lang.Enum", settings: DEFAULT_DECODER_SETTINGS });

    expect(decoder.decode(null as never)).toEqual({ type: "java.lang.Enum", value: null });
  });
});
