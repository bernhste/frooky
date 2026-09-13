import { InputObjcHookGroup, isObjcHookScope } from "./inputIosHookGroup";

describe("inputIosHookGroup", () => {
  describe("isObjcHookScope()", () => {
    it("returns true for a valid InputObjcHookGroup", () => {
      const objcHookGroup: InputObjcHookGroup = {
        type: "objc",
        objcClass: "NSString",
        hooks: [],
      };
      expect(isObjcHookScope(objcHookGroup)).toBeTruthy();
    });

    it("returns false for a Java hook group (no objcClass property)", () => {
      expect(isObjcHookScope({ type: "java", javaClass: "com.example.Foo", hooks: [] })).toBeFalsy();
    });

    it("returns false for a native hook group (no objcClass property)", () => {
      expect(isObjcHookScope({ type: "native", module: "libc.so", hooks: [] })).toBeFalsy();
    });

    it("returns true when objcClass is the only property present", () => {
      expect(isObjcHookScope({ objcClass: "NSObject" })).toBeTruthy();
    });

    it("returns true even when objcClass is an empty string, since only key presence is checked", () => {
      expect(isObjcHookScope({ objcClass: "" })).toBeTruthy();
    });

    it("returns false for an empty object", () => {
      expect(isObjcHookScope({})).toBeFalsy();
    });
  });
});

export {};
