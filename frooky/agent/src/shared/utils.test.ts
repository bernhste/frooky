import {
  base64ToBytes,
  decodeBase64Value,
  FilterMismatchError,
  formatHashCode,
  sleepMilliseconds,
  sleepSeconds,
  toAscii,
  toHex,
  trimIncompleteUtf8Tail,
  truncateString,
  uuidv4,
  wildcardPatternToRegExp,
} from "./utils";

describe("Utils", () => {
  describe("wildcardPatternToRegExp()", () => {
    it("matches a pattern without wildcards only against the exact string", () => {
      const pattern = wildcardPatternToRegExp("org.owasp.mastestapp.MainActivity");

      expect(pattern.test("org.owasp.mastestapp.MainActivity")).toBeTruthy();
      expect(pattern.test("org.owasp.mastestapp.MainActivityOther")).toBeFalsy();
      expect(pattern.test("org.owasp.mastestapp.sub.MainActivity")).toBeFalsy();
    });

    it("matches '*' against exactly one dot-separated segment", () => {
      const pattern = wildcardPatternToRegExp("org.owasp.*.HttpClient");

      expect(pattern.test("org.owasp.network.HttpClient")).toBeTruthy();
      expect(pattern.test("org.owasp.HttpClient")).toBeFalsy();
      expect(pattern.test("org.owasp.network.extra.HttpClient")).toBeFalsy();
    });

    it("does not let '*' cross package boundaries", () => {
      const pattern = wildcardPatternToRegExp("org.*.HttpClient");

      expect(pattern.test("org.owasp.network.HttpClient")).toBeFalsy();
    });

    it("supports multiple wildcards in one pattern", () => {
      const pattern = wildcardPatternToRegExp("org.*.*.HttpClient");

      expect(pattern.test("org.owasp.network.HttpClient")).toBeTruthy();
      expect(pattern.test("org.owasp.HttpClient")).toBeFalsy();
    });

    it("escapes regex-special characters in the literal segments", () => {
      const pattern = wildcardPatternToRegExp("Outer$Inner");

      expect(pattern.test("Outer$Inner")).toBeTruthy();
      expect(pattern.test("OuterXInner")).toBeFalsy();
    });
  });

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
      const uuidV4Regex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

      expect(uuidV4Regex.test(uuid)).toBeTruthy();
      expect(uuid.length).toBe(36);
      expect(uuid[8]).toBe("-");
      expect(uuid[13]).toBe("-");
      expect(uuid[14]).toBe("4");
      expect(uuid[18]).toBe("-");
      expect(["8", "9", "a", "b"].includes(uuid[19])).toBeTruthy();
      expect(uuid[23]).toBe("-");
    });

    it("generates valid RFC 4122 UUIDs across multiple iterations", () => {
      const uuidV4Regex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
      const seen = new Set<string>();
      for (let i = 0; i < 200; i++) {
        const u = uuidv4();
        expect(uuidV4Regex.test(u)).toBeTruthy();
        seen.add(u);
      }
      expect(seen.size).toBe(200);
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

  describe("formatHashCode()", () => {
    it("formats a hash code as unsigned hex like Java's Integer.toHexString()", () => {
      expect(formatHashCode(0x1a2b)).toBe("1a2b");
      expect(formatHashCode(-1)).toBe("ffffffff");
      expect(formatHashCode(0)).toBe("0");
    });
  });

  describe("truncateString()", () => {
    it("keeps a string of at most limit characters unchanged", () => {
      expect(truncateString("abc", 3)).toBe("abc");
      expect(truncateString("", 3)).toBe("");
    });

    it("cuts a longer string to limit characters and appends an ellipsis", () => {
      expect(truncateString("abcdef", 3)).toBe("abc...");
    });

    it("drops a surrogate pair cut in half at the end", () => {
      // "a📱b": the emoji is 2 UTF-16 code units
      expect(truncateString("a📱b", 2)).toBe("a...");
      expect(truncateString("a📱b", 3)).toBe("a📱...");
    });
  });

  describe("trimIncompleteUtf8Tail()", () => {
    it("keeps bytes whose last character is complete", () => {
      const bytes = new Uint8Array([0x61, 0xc3, 0xbc]); // "aü"
      expect(Array.from(trimIncompleteUtf8Tail(bytes))).toEqual([0x61, 0xc3, 0xbc]);
    });

    it("removes a 2-byte character missing its continuation byte", () => {
      expect(Array.from(trimIncompleteUtf8Tail(new Uint8Array([0x61, 0xc3])))).toEqual([0x61]);
    });

    it("removes a 4-byte character missing its last continuation byte", () => {
      // "a🙂" is 0x61 0xf0 0x9f 0x99 0x82
      expect(Array.from(trimIncompleteUtf8Tail(new Uint8Array([0x61, 0xf0, 0x9f, 0x99])))).toEqual([0x61]);
    });

    it("keeps plain ASCII and empty input unchanged", () => {
      expect(Array.from(trimIncompleteUtf8Tail(new Uint8Array([0x61, 0x62])))).toEqual([0x61, 0x62]);
      expect(Array.from(trimIncompleteUtf8Tail(new Uint8Array([])))).toEqual([]);
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

  describe("sleepMilliseconds()", () => {
    it("resolves", async () => {
      await expect(sleepMilliseconds(1)).resolves.toBeUndefined();
    });

    it("waits at least the given number of milliseconds before resolving", async () => {
      const start = Date.now();
      await sleepMilliseconds(20);
      expect(Date.now() - start).toBeGreaterThan(14);
    });
  });

  describe("sleepSeconds()", () => {
    it("resolves", async () => {
      await expect(sleepSeconds(0.001)).resolves.toBeUndefined();
    });

    it("waits at least the given number of seconds before resolving", async () => {
      const start = Date.now();
      await sleepSeconds(0.02);
      expect(Date.now() - start).toBeGreaterThan(14);
    });
  });

  describe("base64ToBytes()", () => {
    it("decodes standard padded base64 strings", () => {
      // "Hello World" -> "SGVsbG8gV29ybGQ="
      expect(Array.from(base64ToBytes("SGVsbG8gV29ybGQ="))).toEqual([72, 101, 108, 108, 111, 32, 87, 111, 114, 108, 100]);
      // "M" -> "TQ=="
      expect(Array.from(base64ToBytes("TQ=="))).toEqual([77]);
      // "Ma" -> "TWE="
      expect(Array.from(base64ToBytes("TWE="))).toEqual([77, 97]);
      // "Man" -> "TWFu"
      expect(Array.from(base64ToBytes("TWFu"))).toEqual([77, 97, 110]);
    });

    it("decodes unpadded base64 strings", () => {
      expect(Array.from(base64ToBytes("SGVsbG8gV29ybGQ"))).toEqual([72, 101, 108, 108, 111, 32, 87, 111, 114, 108, 100]);
      expect(Array.from(base64ToBytes("TQ"))).toEqual([77]);
      expect(Array.from(base64ToBytes("TWE"))).toEqual([77, 97]);
    });

    it("decodes URL-safe base64 strings (- and _)", () => {
      // 0xfb, 0xff, 0xfe in base64: "+//+" or url-safe "-__-"
      expect(Array.from(base64ToBytes("-__-"))).toEqual([0xfb, 0xff, 0xfe]);
      expect(Array.from(base64ToBytes("+//+"))).toEqual([0xfb, 0xff, 0xfe]);
    });

    it("ignores whitespace", () => {
      expect(Array.from(base64ToBytes("  SGVs\r\n bG8= \t"))).toEqual([72, 101, 108, 108, 111]);
    });

    it("decodes an empty string to an empty byte array", () => {
      expect(Array.from(base64ToBytes(""))).toEqual([]);
      expect(Array.from(base64ToBytes("   "))).toEqual([]);
    });

    it("throws an error for invalid base64 characters", () => {
      expect(() => base64ToBytes("SGVsbG8*")).toThrow("Invalid base64 character");
    });

    it("throws an error for invalid base64 string length", () => {
      expect(() => base64ToBytes("A")).toThrow("Invalid base64 string length");
      expect(() => base64ToBytes("AAAAA")).toThrow("Invalid base64 string length");
    });

    it("throws an error for characters outside of Latin-1", () => {
      expect(() => base64ToBytes("€€€€")).toThrow("Invalid base64 character");
      expect(() => base64ToBytes("SGVs中中中中")).toThrow("Invalid base64 character");
    });

    it("throws an error for padding that isn't at the end of a full block", () => {
      expect(() => base64ToBytes("TQ===")).toThrow("Invalid base64 padding");
      expect(() => base64ToBytes("TQ=")).toThrow("Invalid base64 padding");
      expect(() => base64ToBytes("TQ==TQ==")).toThrow("Invalid base64 character");
    });

    it("throws an error for mixed standard and URL-safe alphabets", () => {
      expect(() => base64ToBytes("+_-/")).toThrow("mixes the standard and URL-safe alphabets");
    });
  });

  describe("decodeBase64Value()", () => {
    it("decodes printable text as text", () => {
      expect(decodeBase64Value("SGVsbG8gV29ybGQ=", 100)).toBe("Hello World");
      expect(decodeBase64Value("Z3LDvGV6aSDwn5mC", 100)).toBe("grüezi 🙂");
    });

    it("decodes binary data as hex", () => {
      // the bytes 0x00 to 0x0f, e.g. a key
      expect(decodeBase64Value("AAECAwQFBgcICQoLDA0ODw==", 100)).toBe("0x000102030405060708090a0b0c0d0e0f");
    });

    it("cuts the decoded bytes at maxItems and appends an ellipsis", () => {
      expect(decodeBase64Value("SGVsbG8gV29ybGQ=", 5)).toBe("Hello...");
      expect(decodeBase64Value("AAECAwQFBgcICQoLDA0ODw==", 4)).toBe("0x00010203...");
      expect(decodeBase64Value("SGVsbG8=", 5)).toBe("Hello");
    });

    it("drops a multi-byte character cut at maxItems", () => {
      // "grü": the ü is 2 bytes, the third and fourth byte
      expect(decodeBase64Value("Z3LDvGV6aSDwn5mC", 3)).toBe("gr...");
    });

    it("decodes only the full blocks of a truncated input and appends an ellipsis", () => {
      expect(decodeBase64Value("SGVsbG8gV29y", 100, true)).toBe("Hello Wor...");
      expect(decodeBase64Value("SGVsbG8gV2", 100, true)).toBe("Hello ...");
    });
  });
});

export {};
