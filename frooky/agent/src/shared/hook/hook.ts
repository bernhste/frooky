import { RetType } from "../decoders/decodable";
import { DecoderSettings, HookSettings } from "../frookySettings";

export interface Hook {
  hookSettings: HookSettings;
  decoderSettings: DecoderSettings;
  retType?: RetType;
  // calls dropped by the callerFilter or an argFilter, for the host's hook statistics
  filteredCalls?: number;
  // calls dropped in native code before reaching JS, while counted there (see NativeFilteredListener)
  nativeFilteredCalls?: () => number;
}

export function filteredCallCount(hook: Hook): number {
  return (hook.filteredCalls ?? 0) + (hook.nativeFilteredCalls?.() ?? 0);
}

// a field on the hook, as it runs for most calls of a hot function
export function countFilteredCall(hook: Hook): void {
  hook.filteredCalls = (hook.filteredCalls ?? 0) + 1;
}
