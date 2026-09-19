import { matchesSwiftMethodDeclaration, SwiftMethodSignature } from "./swiftMethodSignature";

const authenticate: SwiftMethodSignature = {
  methodName: "authenticate",
  argLabels: ["user", ""],
  argTypeNames: ["Swift.String", "Swift.String"],
  retTypeName: "Swift.Bool",
};
const noArgs: SwiftMethodSignature = { methodName: "logout", argLabels: [], argTypeNames: [], retTypeName: "void" };

describe("matchesSwiftMethodDeclaration()", () => {
  it("matches every overload by the plain method name", () => {
    expect(matchesSwiftMethodDeclaration(authenticate, "authenticate")).toBeTruthy();
    expect(matchesSwiftMethodDeclaration(noArgs, "authenticate")).toBeFalsy();
  });

  it("matches by argument labels, `_` being an unlabeled argument", () => {
    expect(matchesSwiftMethodDeclaration(authenticate, "authenticate(user:_:)")).toBeTruthy();
    expect(matchesSwiftMethodDeclaration(authenticate, "authenticate(user:password:)")).toBeFalsy();
    expect(matchesSwiftMethodDeclaration(authenticate, "authenticate(user:)")).toBeFalsy();
  });

  it("matches a method without arguments by empty parentheses", () => {
    expect(matchesSwiftMethodDeclaration(noArgs, "logout()")).toBeTruthy();
    expect(matchesSwiftMethodDeclaration(authenticate, "authenticate()")).toBeFalsy();
  });

  it("does not match a malformed declaration", () => {
    expect(matchesSwiftMethodDeclaration(authenticate, "authenticate(user)")).toBeFalsy();
    expect(matchesSwiftMethodDeclaration(authenticate, "")).toBeFalsy();
  });
});
