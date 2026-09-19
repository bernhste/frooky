import { tryParseSwiftMethodSignature } from "frida-swift-bridge/dist/lib/symbols.js";

/**
 * A Swift method, described by its demangled symbol, e.g.
 * `MyApp.LoginViewModel.authenticate(user: Swift.String, password: Swift.String) -> Swift.Bool`.
 */
export type SwiftMethodSignature = {
  methodName: string;
  /** Argument labels, `""` for an unlabeled argument. */
  argLabels: string[];
  /** Fully qualified type names of the explicit arguments (`self` excluded), e.g. `Swift.String`. */
  argTypeNames: string[];
  /** `void` if the method does not return anything. */
  retTypeName: string;
};

/**
 * Parses a demangled method symbol using the parser of the bridge, which is also what `Swift.Interceptor` uses to map
 * the raw arguments to types. Returns `undefined` for symbols the bridge is not able to parse.
 * A method we cannot parse cannot be hooked by the bridge either.
 */
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

/**
 * Checks if a method matches the declaration of a hook.
 *
 * @param declaration - `authenticate` matches every overload, `authenticate(user:password:)` only the one with these labels.
 *   `_` stands for an unlabeled argument, as in Swift.
 */
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
