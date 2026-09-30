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

    expect(decoder.decode(Java.use("java.util.concurrent.TimeUnit").SECONDS.value)).toEqual({
      type: "java.lang.Object",
      value: { type: "java.util.concurrent.TimeUnit", value: "SECONDS" },
    });
  });

  it("decodes null", () => {
    const decoder = new EnumDecoder({ type: "java.lang.Enum", settings: DEFAULT_DECODER_SETTINGS });

    expect(decoder.decode(null as never)).toEqual({ type: "java.lang.Enum", value: null });
  });
});
