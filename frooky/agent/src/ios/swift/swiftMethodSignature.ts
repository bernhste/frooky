import { tryParseSwiftMethodSignature } from "frida-swift-bridge/dist/lib/symbols.js";

// A Swift method, from its demangled symbol, e.g.
// `MyApp.LoginViewModel.authenticate(user: Swift.String, password: Swift.String) -> Swift.Bool`.
export type SwiftMethodSignature = {
  methodName: string;
  // `""` for an unlabeled argument
  argLabels: string[];
  // types of the explicit arguments, without `self`, e.g. `Swift.String`
  argTypeNames: string[];
  // `void` if the method returns nothing
  retTypeName: string;
};

// Parses a demangled method symbol with the bridge's parser, which Swift.Interceptor also uses to map the raw
// arguments to types. undefined for a symbol the bridge can't parse, whose method it can't hook either.
export function parseSwiftMethod(demangledSymbol: string | undefined): SwiftMethodSignature | undefined {
  if (!demangledSymbol) return undefined;
  const parsed = tryParseSwiftMethodSignature(demangledSymbol);
  if (!parsed) return undefined;
  return {
    methodName: parsed.methodName,
    argLabels: parsed.argNames,
    argTypeNames: parsed.argTypeNames,
    retTypeName: parsed.retTypeName,
  };
}

// `authenticate` matches every overload, `authenticate(user:password:)` only the one with these argument
// labels, `_` being an unlabeled argument as in Swift.
export function matchesSwiftMethodDeclaration(signature: SwiftMethodSignature, declaration: string): boolean {
  const match = /^\s*([A-Za-z_]\w*)\s*(?:\((.*)\))?\s*$/.exec(declaration);
  if (!match) return false;

  const [, name, labelList] = match;
  if (name !== signature.methodName) return false;
  if (labelList === undefined) return true;

  const declaredLabels = labelList === "" ? [] : labelList.split(":").slice(0, -1);
  if (labelList !== "" && !labelList.endsWith(":")) return false;
  return (
    declaredLabels.length === signature.argLabels.length &&
    declaredLabels.every((label, i) => (label === "_" ? "" : label) === signature.argLabels[i])
  );
}
