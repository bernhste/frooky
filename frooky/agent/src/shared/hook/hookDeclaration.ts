import { Param, RetType } from "../decoders/decodable";
import { DecoderSettings, HookSettings } from "../frookySettings";

// Hook declarations as the agent processes them, produced from the `Input*` hook-file types by the `normalize*`
// functions: shorthands are expanded, the class or module is inherited from the collection, and every settings
// object is complete, merged from the defaults, the file, the collection, the hook and the value itself.

// A declared overload of a Java method. Without `retType`, the return value is decoded with the hook's decoderSettings.
export interface JavaOverloadDeclaration {
  params: Param[];
  retType?: DecoderSettings;
}

export interface JavaHookDeclaration {
  javaClass: string;
  classLoader?: string;
  // `$init` for constructors
  method: string;
  // without overloads, every overload of the method is hooked
  overloads?: JavaOverloadDeclaration[];
  hookSettings: HookSettings;
  decoderSettings: DecoderSettings;
}

interface NativeHookDeclarationBase {
  module: string;
  // without params, no arguments are decoded
  params?: Param[];
  // without retType, the return value isn't decoded
  retType?: RetType;
  hookSettings: HookSettings;
  decoderSettings: DecoderSettings;
}

export interface NativeSymbolHookDeclaration extends NativeHookDeclarationBase {
  symbol: string;
  offset?: never;
}

export interface NativeOffsetHookDeclaration extends NativeHookDeclarationBase {
  // lowercase hex, e.g. `0x1a2b4`
  offset: string;
  symbol?: never;
}

export type NativeHookDeclaration = NativeSymbolHookDeclaration | NativeOffsetHookDeclaration;
