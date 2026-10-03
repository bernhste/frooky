import { Direction } from "./decoders/decodable";
import { DecoderSettings, FrookySettings, HookSettings } from "./frookySettings";

export const DEFAULT_DECODE_AT: Direction = "in";

export const DEFAULT_DECODER_SETTINGS: DecoderSettings = {
  maxDepth: 10,
  maxItems: 100,
  decoder: undefined,
  decoderArgs: undefined,
  constants: undefined,
  argFilter: undefined,
};

export const DEFAULT_HOOK_SETTINGS: HookSettings = {
  maxStackFrames: 5,
  nativeStackTrace: false,
  platformStackTrace: false,
  callerFilter: [],
  early: false,
};

export const DEFAULT_FROOKY_SETTINGS: FrookySettings = {
  hookSettings: DEFAULT_HOOK_SETTINGS,
  decoderSettings: DEFAULT_DECODER_SETTINGS,
};

export const DEFAULT_SETTING_LOG_LEVEL = "info";
export const DEFAULT_SETTING_LOG_TO = "console";
// interval for sending cached events to the host
export const SEND_INTERVAL_MS = 100;

// maximum number of events held on the agent before sending them
export const SEND_BATCH_SIZE = 200;

// minimum interval between two progress reports to the host
export const PROGRESS_INTERVAL_MS = 250;
