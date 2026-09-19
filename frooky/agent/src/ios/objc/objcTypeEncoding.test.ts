import { objcTypeNameFromEncoding, parseObjcMethodEncoding } from "./objcTypeEncoding";

describe("parseObjcMethodEncoding()", () => {
  it("parses a method without explicit arguments", () => {
    expect(parseObjcMethodEncoding("Q16@0:8")).toEqual({ returnType: "unsigned long long", argTypes: [] });
  });

  it("parses object, integer and void types and skips the frame offsets", () => {
    expect(parseObjcMethodEncoding("@32@0:8@16q24")).toEqual({ returnType: "id", argTypes: ["id", "long long"] });
    expect(parseObjcMethodEncoding("v24@0:8@16")).toEqual({ returnType: "void", argTypes: ["id"] });
  });

  it("keeps blocks, classes, selectors and C strings apart", () => {
    expect(parseObjcMethodEncoding("v48@0:8@?16#24:32*40").argTypes).toEqual(["block", "Class", "SEL", "char*"]);
  });

  it("treats a whole struct as one argument", () => {
    expect(parseObjcMethodEncoding("v40@0:8{CGRect={CGPoint=dd}{CGSize=dd}}16").argTypes).toEqual(["struct"]);
  });

  it("ignores type qualifiers and reads pointers as one type", () => {
    expect(parseObjcMethodEncoding("v32@0:8r^v16^@24").argTypes).toEqual(["void*", "void*"]);
    expect(parseObjcMethodEncoding("v24@0:8r*16").argTypes).toEqual(["char*"]);
  });

  it("throws on an encoding that is not a method", () => {
    expect(() => parseObjcMethodEncoding("@")).toThrow();
    expect(() => parseObjcMethodEncoding("v24@0:8{CGRect16")).toThrow();
  });
});

describe("objcTypeNameFromEncoding()", () => {
  it("names a class typed object after its class", () => {
    expect(objcTypeNameFromEncoding('@"NSString"')).toBe("NSString*");
  });
});
