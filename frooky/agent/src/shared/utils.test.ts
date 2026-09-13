import { FilterMismatchError, sleepMilliseconds, sleepSeconds, toAscii, toHex, toHexAndAscii, uuidv4 } from "./utils";

describe("Utils", () => {
  describe("FilterMismatchError", () => {
    it("is an Error carrying the given message", () => {
      const error = new FilterMismatchError("mismatch");
      expect(error instanceof Error).toBeTruthy();
      expect(error instanceof FilterMismatchError).toBeTruthy();
      expect(error.message).toBe("mismatch");
    });

    it("can be thrown and matched via toThrow()", () => {
      expect(() => {
        throw new FilterMismatchError("boom");
      }).toThrow(new FilterMismatchError("boom"));
    });
  });

  describe("uuidv4()", () => {
    it("should calculate a valid UUIDv4", () => {
      const uuid = uuidv4();

      // UUID v4 regex pattern
      const uuidV4Regex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

      expect(uuidV4Regex.test(uuid)).toBeTruthy();
    });

    it("generates different values on subsequent calls", () => {
      expect(uuidv4()).not.toBe(uuidv4());
    });
  });

  describe("toHex()", () => {
    it("converts bytes to a lowercase hex string prefixed with 0x", () => {
      const bytes = Uint8Array.from([0x00, 0xff, 0x10, 0xab]);
      expect(toHex(bytes)).toBe("0x00ff10ab");
    });

    it("returns '0x' for an empty array", () => {
      expect(toHex(new Uint8Array([]))).toBe("0x");
    });

    it("decodes only the given length and appends an ellipsis when truncated", () => {
      const bytes = Uint8Array.from([0x00, 0xff, 0x10, 0xab]);
      expect(toHex(bytes, 2)).toBe("0x00ff...");
    });

    it("does not append an ellipsis when length matches or exceeds the array length", () => {
      const bytes = Uint8Array.from([0x00, 0xff, 0x10, 0xab]);
      expect(toHex(bytes, 4)).toBe("0x00ff10ab");
      expect(toHex(bytes, 10)).toBe("0x00ff10ab");
    });

    it("throws a RangeError for a negative length", () => {
      const bytes = Uint8Array.from([0x00]);
      expect(() => toHex(bytes, -1)).toThrow("Length cannot be negative");
    });
  });

  describe("toAscii()", () => {
    it("decodes printable bytes to their ASCII characters", () => {
      const bytes = Uint8Array.from([72, 101, 108, 108, 111]); // "Hello"
      expect(toAscii(bytes)).toBe("Hello");
    });

    it("replaces non-printable bytes with the default placeholder and keeps tab/newline/CR", () => {
      const bytes = Uint8Array.from([72, 0, 9, 10, 13, 127, 32, 126]);
      expect(toAscii(bytes)).toBe("H.\t\n\r. ~");
    });

    it("uses a custom placeholder for non-printable bytes", () => {
      const bytes = Uint8Array.from([72, 0, 105]);
      expect(toAscii(bytes, Infinity, "?")).toBe("H?i");
    });

    it("decodes only the given length and appends an ellipsis when truncated", () => {
      const bytes = Uint8Array.from([72, 101, 108, 108, 111]); // "Hello"
      expect(toAscii(bytes, 3)).toBe("Hel...");
    });

    it("throws a RangeError for a negative length", () => {
      const bytes = Uint8Array.from([72]);
      expect(() => toAscii(bytes, -1)).toThrow("Length cannot be negative");
    });
  });

  describe("toHexAndAscii()", () => {
    it("returns the same tuple as calling toHex() and toAscii() separately", () => {
      const bytes = Uint8Array.from([72, 101, 108, 108, 111]);
      expect(toHexAndAscii(bytes)).toEqual([toHex(bytes), toAscii(bytes)]);
    });

    it("applies the length truncation and ellipsis to both parts", () => {
      const bytes = Uint8Array.from([72, 101, 108, 108, 111]);
      expect(toHexAndAscii(bytes, 3)).toEqual(["0x48656c...", "Hel..."]);
    });

    it("applies a custom placeholder to the ASCII part only", () => {
      const bytes = Uint8Array.from([72, 0, 105]);
      expect(toHexAndAscii(bytes, Infinity, "?")).toEqual(["0x480069", "H?i"]);
    });

    it("throws a RangeError for a negative length", () => {
      const bytes = Uint8Array.from([72]);
      expect(() => toHexAndAscii(bytes, -1)).toThrow("Length cannot be negative");
    });
  });

  describe("sleepMilliseconds()", () => {
    it("resolves", async () => {
      await expect(() => sleepMilliseconds(1)).toResolve();
    });

    it("waits at least the given number of milliseconds before resolving", async () => {
      const start = Date.now();
      await sleepMilliseconds(20);
      expect(Date.now() - start).toBeGreaterThan(14);
    });
  });

  describe("sleepSeconds()", () => {
    it("resolves", async () => {
      await expect(() => sleepSeconds(0.001)).toResolve();
    });

    it("waits at least the given number of seconds before resolving", async () => {
      const start = Date.now();
      await sleepSeconds(0.02);
      expect(Date.now() - start).toBeGreaterThan(14);
    });
  });
});

export {};
