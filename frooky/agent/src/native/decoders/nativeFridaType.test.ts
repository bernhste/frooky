import { parseNativeFridaType } from "./nativeFridaType";

describe("parseNativeFridaType", () => {
  describe("fundamental types", () => {
    it("should resolve a plain type", () => {
      expect(parseNativeFridaType("char")).toBe("char");
    });

    it("should be case-insensitive", () => {
      expect(parseNativeFridaType("INT")).toBe("int");
    });

    it("should trim surrounding whitespace", () => {
      expect(parseNativeFridaType(" int ")).toBe("int");
    });

    it("should collapse internal whitespace in multi-word declarations", () => {
      expect(parseNativeFridaType("unsigned    long")).toBe("ulong");
    });

    it("should strip a leading const qualifier", () => {
      expect(parseNativeFridaType("const char")).toBe("char");
    });

    it("should strip a trailing const qualifier", () => {
      expect(parseNativeFridaType("int const")).toBe("int");
    });

    it("should strip a volatile qualifier", () => {
      expect(parseNativeFridaType("volatile int")).toBe("int");
    });

    it("should resolve _Bool and boolean aliases to bool", () => {
      expect(parseNativeFridaType("_Bool")).toBe("bool");
      expect(parseNativeFridaType("boolean")).toBe("bool");
    });

    it("should resolve 'long long int' to the signed 64-bit type", () => {
      expect(parseNativeFridaType(" long long int ")).toBe("int64");
    });

    it("should resolve 'unsigned long long' to the unsigned 64-bit type", () => {
      expect(parseNativeFridaType("unsigned long long")).toBe("uint64");
    });

    it("should resolve short-form aliases", () => {
      expect(parseNativeFridaType("short")).toBe("int16");
      expect(parseNativeFridaType("unsigned short")).toBe("uint16");
    });

    it("should resolve the standard fixed-width typedefs", () => {
      expect(parseNativeFridaType("int8_t")).toBe("int8");
      expect(parseNativeFridaType("uint8_t")).toBe("uint8");
      expect(parseNativeFridaType("int32_t")).toBe("int32");
      expect(parseNativeFridaType("uint32_t")).toBe("uint32");
      expect(parseNativeFridaType("int64_t")).toBe("int64");
      expect(parseNativeFridaType("uint64_t")).toBe("uint64");
    });

    it("should resolve the pointer/word-sized POSIX typedefs", () => {
      expect(parseNativeFridaType("intptr_t")).toBe("long");
      expect(parseNativeFridaType("uintptr_t")).toBe("ulong");
      expect(parseNativeFridaType("ptrdiff_t")).toBe("long");
      expect(parseNativeFridaType("off_t")).toBe("long");
      expect(parseNativeFridaType("time_t")).toBe("long");
    });

    it("should return undefined for an unrecognized fundamental type", () => {
      expect(parseNativeFridaType("SomeStruct")).toBeUndefined();
    });
  });

  describe("pointer types", () => {
    it("should resolve a single-level pointer", () => {
      expect(parseNativeFridaType("char*")).toEqual({ pointee: "char", depth: 1 });
    });

    it("should resolve a multi-level pointer and count its depth", () => {
      expect(parseNativeFridaType("unsigned char**")).toEqual({ pointee: "uchar", depth: 2 });
      expect(parseNativeFridaType("int ***")).toEqual({ pointee: "int", depth: 3 });
    });

    it("should tolerate arbitrary whitespace around the stars", () => {
      expect(parseNativeFridaType(" char ** ")).toEqual({ pointee: "char", depth: 2 });
      expect(parseNativeFridaType("char * *")).toEqual({ pointee: "char", depth: 2 });
    });

    it("should strip a leading const qualifier on the pointee", () => {
      expect(parseNativeFridaType("const char*")).toEqual({ pointee: "char", depth: 1 });
    });

    it("should strip a const qualifier on the pointer itself", () => {
      expect(parseNativeFridaType("char* const")).toEqual({ pointee: "char", depth: 1 });
    });

    it("should strip const qualifiers on both the pointee and the pointer", () => {
      expect(parseNativeFridaType("const char * const")).toEqual({ pointee: "char", depth: 1 });
    });

    it("should strip a volatile qualifier on a pointer", () => {
      expect(parseNativeFridaType("int * volatile")).toEqual({ pointee: "int", depth: 1 });
    });

    it("should return undefined for a pointer to an unrecognized base type", () => {
      expect(parseNativeFridaType("MyStruct*")).toBeUndefined();
      expect(parseNativeFridaType("FILE*")).toBeUndefined();
    });
  });
});
