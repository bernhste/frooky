import { Direction } from "./decoders/decodable";
import { DecoderSettings, FrookySettings, HookSettings } from "./frookySettings";

export const DEFAULT_DECODE_AT: Direction = "in";

export const DEFAULT_DECODER_SETTINGS: DecoderSettings = {
  fastDecode: false,
  magicDecode: false,
  maxRecursion: 10,
  decodeLimit: 1000,
  decoder: undefined,
  decoderArg: undefined,
  paramFilter: undefined,
};

export const DEFAULT_HOOK_SETTINGS: HookSettings = {
  stackTraceLimit: 0,
  stackTraceFilter: [],
};

export const DEFAULT_FROOKY_SETTINGS: FrookySettings = {
  hookSettings: DEFAULT_HOOK_SETTINGS,
  decoderSettings: DEFAULT_DECODER_SETTINGS,
};

export const DEFAULT_SETTING_LOG_LEVEL = "info";
export const DEFAULT_SETTING_LOG_TO = "console";
// time we wait until we give up hooking a class we cannot resovle.
export const DEFAULT_SETTING_RESOLVER_TIMEOUT_SECONDS = 5;

// specifies the interval between cached events are send back to the host
export const SEND_INTERVAL_MS = 100;

// specifies the interval during frida module and classes lookup
// we wait this manyt ms befor anoter attemnt is made to resolve unhooked classes
export const HOOK_LOOKUP_INTERVAL_MS = 1000;
