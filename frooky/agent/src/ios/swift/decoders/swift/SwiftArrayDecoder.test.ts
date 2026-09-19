import { parseSwiftArrayElementType } from "./SwiftArrayDecoder";

describe("parseSwiftArrayElementType()", () => {
  it("reads the element type of the demangled and the sugared form", () => {
    expect(parseSwiftArrayElementType("Swift.Array<Swift.String>")).toBe("Swift.String");
    expect(parseSwiftArrayElementType("[Swift.Int]")).toBe("Swift.Int");
  });

  it("adds the Swift module to standard library types declared without it", () => {
    expect(parseSwiftArrayElementType("Array<String>")).toBe("Swift.String");
    expect(parseSwiftArrayElementType("[Bool]")).toBe("Swift.Bool");
  });

  it("keeps the module of other types", () => {
    expect(parseSwiftArrayElementType("Swift.Array<MyApp.Credentials>")).toBe("MyApp.Credentials");
  });

  it("returns undefined for types which are not arrays", () => {
    expect(parseSwiftArrayElementType("Swift.String")).toBeUndefined();
    expect(parseSwiftArrayElementType("Swift.Array<>")).toBeUndefined();
  });
});
