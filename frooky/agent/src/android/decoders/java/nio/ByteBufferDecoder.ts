import Java from "frida-java-bridge";
import { Decoder } from "../../../../shared/decoders/baseDecoder";
import { DecodedValue } from "../../../../shared/decoders/decodedValue";
import { decodeFields, javaBytesToHex, useJavaClass } from "../../utils/javaValues";

// Reads the bytes between position and limit (what a consumer such as Cipher.update(ByteBuffer) would read)
// from a duplicate, so the position of the buffer itself doesn't move.
export class ByteBufferDecoder extends Decoder<Java.Wrapper> {
  readonly decoderName = "ByteBufferDecoder";
  readonly description =
    "Decodes a `java.nio.ByteBuffer`: position, limit, capacity and the remaining bytes as hex, up to `maxItems` bytes, without moving its position.";

  decode(value: Java.Wrapper): DecodedValue {
    if (value == null) return { type: this.type, name: this.name, value: null };
    const buffer = Java.cast(value, useJavaClass("java.nio.ByteBuffer"));
    // declared by Buffer; the ByteBuffer wrapper only has overloads such as position(int) that ByteBuffer declares
    const base = Java.cast(value, useJavaClass("java.nio.Buffer"));
    return {
      type: this.type,
      name: this.name,
      value: decodeFields(this.type, {
        position: () => base.position(),
        limit: () => base.limit(),
        capacity: () => base.capacity(),
        direct: () => base.isDirect(),
        readOnly: () => base.isReadOnly(),
        remaining: () => this.readRemaining(buffer, base.remaining()),
      }),
    };
  }

  private readRemaining(buffer: Java.Wrapper, remaining: number): string | null {
    const length = Math.min(remaining, this.settings.maxItems);
    const bytes = Java.array("byte", new Array(length).fill(0));
    // duplicate() returns the wrapper of an implementation class (e.g. HeapByteBuffer) without get(byte[])
    const duplicate = Java.cast(buffer.duplicate(), useJavaClass("java.nio.ByteBuffer"));
    duplicate.get.overload("[B").call(duplicate, bytes);
    return javaBytesToHex(bytes as unknown as Java.Wrapper, length) + (remaining > length ? "..." : "");
  }
}
