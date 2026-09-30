import Java from "frida-java-bridge";
import { DEFAULT_DECODER_SETTINGS } from "../../../../shared/defaultValues";
import { ByteBufferDecoder } from "./ByteBufferDecoder";

const ByteBuffer = () => Java.use("java.nio.ByteBuffer");

describe("ByteBufferDecoder", () => {
  it("decodes the bytes between position and limit without moving the position", () => {
    const buffer = ByteBuffer().wrap(Java.array("byte", [1, 2, 3, 4, 5, 6, 7, 8]));
    // position() and limit() are declared by Buffer
    const base = Java.cast(buffer, Java.use("java.nio.Buffer"));
    base.position(2);
    base.limit(6);
    const decoder = new ByteBufferDecoder({ type: "java.nio.HeapByteBuffer", settings: DEFAULT_DECODER_SETTINGS });

    expect(decoder.decode(buffer)).toEqual({
      type: "java.nio.HeapByteBuffer",
      value: { position: 2, limit: 6, capacity: 8, direct: false, readOnly: false, remaining: "0x03040506" },
    });
    expect(base.position()).toBe(2);
  });

  it("limits the remaining bytes to maxItems", () => {
    const buffer = ByteBuffer().wrap(Java.array("byte", [1, 2, 3, 4]));
    const decoder = new ByteBufferDecoder({ type: "java.nio.ByteBuffer", settings: { ...DEFAULT_DECODER_SETTINGS, maxItems: 2 } });

    expect((decoder.decode(buffer).value as Record<string, unknown>).remaining).toBe("0x0102...");
  });

  it("decodes direct and read-only buffers", () => {
    const direct = ByteBuffer().allocateDirect(2);
    direct.put(0, 0x7f);
    const decoder = new ByteBufferDecoder({ type: "java.nio.ByteBuffer", settings: DEFAULT_DECODER_SETTINGS });

    expect(decoder.decode(direct.asReadOnlyBuffer()).value).toEqual({
      position: 0,
      limit: 2,
      capacity: 2,
      direct: true,
      readOnly: true,
      remaining: "0x7f00",
    });
  });

  it("decodes an empty buffer", () => {
    const decoder = new ByteBufferDecoder({ type: "java.nio.ByteBuffer", settings: DEFAULT_DECODER_SETTINGS });

    expect((decoder.decode(ByteBuffer().allocate(0)).value as Record<string, unknown>).remaining).toBe("0x");
  });
});
