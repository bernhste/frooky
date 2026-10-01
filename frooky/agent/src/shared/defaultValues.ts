import { Direction } from "./decoders/decodable";
import { DecoderSettings, FrookySettings, HookSettings } from "./frookySettings";

export const DEFAULT_DECODE_AT: Direction = "in";

export const DEFAULT_DECODER_SETTINGS: DecoderSettings = {
  maxDepth: 10,
  maxItems: 100,
  decoder: undefined,
  decoderArg: undefined,
  constants: undefined,
  argFilter: undefined,
};

export const DEFAULT_HOOK_SETTINGS: HookSettings = {
  maxStackFrames: 5,
  stackTraceFilter: [],
  nativeStackTrace: false,
  platformStackTrace: false,
};

export const DEFAULT_FROOKY_SETTINGS: FrookySettings = {
  hookSettings: DEFAULT_HOOK_SETTINGS,
  decoderSettings: DEFAULT_DECODER_SETTINGS,
};

export const DEFAULT_SETTING_LOG_LEVEL = "info";
export const DEFAULT_SETTING_LOG_TO = "console";
// how long a class or module is looked up before its hooks fail
export const DEFAULT_SETTING_RESOLVER_TIMEOUT_SECONDS = 5;

// interval for sending cached events to the host
export const SEND_INTERVAL_MS = 100;

// minimum interval between two progress reports to the host
export const PROGRESS_INTERVAL_MS = 250;

// interval between two lookups of a class or module that isn't loaded yet
export const HOOK_LOOKUP_INTERVAL_MS = 1000;
