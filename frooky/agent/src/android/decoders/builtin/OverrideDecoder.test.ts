import type Java from "frida-java-bridge";
import { Decoder } from "../../../shared/decoders/baseDecoder";
import { Decodable } from "../../../shared/decoders/decodable";
import { DecoderArgValues } from "../../../shared/decoders/decoderArgs";
import { DecodedValue } from "../../../shared/decoders/decodedValue";
import { DEFAULT_DECODER_SETTINGS } from "../../../shared/defaultValues";
import { OverrideDecoder } from "./OverrideDecoder";

class FailingDecoder extends Decoder<Java.Wrapper> {
  readonly decoderName = "FailingDecoder";
  calls = 0;

  decode(): DecodedValue {
    this.calls++;
    throw new Error("not decodable");
  }
}

class EchoDecoder extends Decoder<Java.Wrapper> {
  readonly decoderName = "EchoDecoder";

  decode(value: Java.Wrapper, args?: DecoderArgValues): DecodedValue {
    return { type: this.type, name: this.name, value: args === undefined ? value : [value, args] };
  }
}

const decodable: Decodable = { type: "int", name: "flags", settings: { ...DEFAULT_DECODER_SETTINGS, decoder: "constant" } };

describe("OverrideDecoder", () => {
  it("takes the name of the override", () => {
    const decoder = new OverrideDecoder(decodable, new FailingDecoder(decodable), new EchoDecoder(decodable));

    expect(decoder.decoderName).toBe("FailingDecoder");
  });

  it("returns the result of the override and passes the decoderArgs", () => {
    const decoder = new OverrideDecoder(decodable, new EchoDecoder(decodable), new FailingDecoder(decodable));

    expect(decoder.decode(5 as unknown as Java.Wrapper, { length: 7 })).toEqual({ type: "int", name: "flags", value: [5, { length: 7 }] });
  });

  it("decodes with the fallback decoder when the override throws, on every call", () => {
    const override = new FailingDecoder(decodable);
    const decoder = new OverrideDecoder(decodable, override, new EchoDecoder(decodable));

    expect(decoder.decode(5 as unknown as Java.Wrapper)).toEqual({ type: "int", name: "flags", value: 5 });
    expect(decoder.decode(6 as unknown as Java.Wrapper)).toEqual({ type: "int", name: "flags", value: 6 });
    expect(override.calls).toBe(2);
  });
});
