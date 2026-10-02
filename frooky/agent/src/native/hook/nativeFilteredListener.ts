import { logger } from "../../shared/logger";

// Drops the calls of a hooked function whose return address is outside the callerFilter's modules in native
// code, before Frida enters the JS runtime: on a hot function like malloc that is ~0.2 µs per call instead of
// ~2 µs per JS callback. Calls from inside the modules are passed on to JS, without the CPU context: no native
// stack traces and no float/double values, see NativeHookManager.
const SOURCE = `
#include <gum/guminterceptor.h>

typedef struct {
  guint64 filtered;
  gpointer * ranges; /* count, then a start and end per module */
  guint id;
  guint n_args;
} Filter;

extern guint frooky_enter (guint id, gpointer * args, gpointer return_address, gpointer sp);
extern void frooky_leave (guint call_id, gpointer return_value, gint system_error);

void on_enter (GumInvocationContext * ic) {
  Filter * f = GUM_IC_GET_FUNC_DATA (ic, Filter *);
  guint * call_id = GUM_IC_GET_INVOCATION_DATA (ic, guint);
  gpointer ra = gum_invocation_context_get_return_address (ic);
  gpointer * r = f->ranges;
  gsize n = (gsize) r[0];
  *call_id = 0;
  for (gsize i = 0; i != n; i++) {
    if (ra >= r[1 + 2 * i] && ra < r[2 + 2 * i]) {
      gpointer args[16];
      for (guint j = 0; j != f->n_args; j++)
        args[j] = gum_invocation_context_get_nth_argument (ic, j);
      /* args is on this thread's stack, just below the call's */
      *call_id = frooky_enter (f->id, args, ra, args);
      return;
    }
  }
  f->filtered++;
}

void on_leave (GumInvocationContext * ic) {
  guint call_id = *GUM_IC_GET_INVOCATION_DATA (ic, guint);
  if (call_id != 0)
    frooky_leave (call_id, gum_invocation_context_get_return_value (ic), ic->system_error);
}
`;

// the most arguments the CModule passes on, see `args` in SOURCE
export const MAX_FILTERED_ARGS = 16;

// Filter in SOURCE: `filtered` first, so the layout is the same on 32 and 64 bit apart from the pointer size
const FILTERED_OFFSET = 0;
const RANGES_OFFSET = 8;
const ID_OFFSET = 8 + Process.pointerSize;
const N_ARGS_OFFSET = 12 + Process.pointerSize;
const FILTER_SIZE = 16 + Process.pointerSize;

export type ModuleRange = { base: NativePointer; end: NativePointer };

// Called for a call that passed the native filter: the state to pass to onLeave, or undefined to skip it.
// `sp` is a stack address of the calling thread, for the unsafe context checks.
type EnterHandler = (args: NativePointer[], returnAddress: NativePointer, sp: NativePointer) => unknown;
type LeaveHandler = (state: unknown, returnValue: NativePointer, errno: number) => void;

const handlers = new Map<number, { enter: EnterHandler; leave: LeaveHandler; argCount: () => number }>();
// the calls between onEnter and onLeave, by call id. A call that never returns (longjmp) leaves its entry.
const callStates = new Map<number, { leave: LeaveHandler; state: unknown }>();
let nextHandlerId = 1;
let nextCallId = 1;

let compiled: { cm: CModule; callbacks: NativeCallback<any, any>[] } | undefined;
// e.g. a CModule compiler error, rethrown instead of compiling again for every hook
let compileError: unknown;

function compile(): CModule {
  if (compiled) return compiled.cm;
  if (compileError !== undefined) throw compileError;
  const enter = new NativeCallback(
    (id: number, args: NativePointer, returnAddress: NativePointer, sp: NativePointer): number => {
      const handler = handlers.get(id);
      if (!handler) return 0;
      try {
        const argValues: NativePointer[] = [];
        for (let i = 0, n = handler.argCount(); i < n; i++) argValues.push(args.add(i * Process.pointerSize).readPointer());
        const state = handler.enter(argValues, returnAddress, sp);
        if (state === undefined) return 0;
        const callId = nextCallId;
        // 0 means "no call" in the CModule
        nextCallId = nextCallId >= 0xffffffff ? 1 : nextCallId + 1;
        callStates.set(callId, { leave: handler.leave, state });
        return callId;
      } catch (e) {
        logger.error(`Error in a native caller filter's onEnter: ${e}`);
        return 0;
      }
    },
    "uint",
    ["uint", "pointer", "pointer", "pointer"],
  );
  const leave = new NativeCallback(
    (callId: number, returnValue: NativePointer, errno: number): void => {
      const call = callStates.get(callId);
      if (!call) return;
      callStates.delete(callId);
      try {
        call.leave(call.state, returnValue, errno);
      } catch (e) {
        logger.error(`Error in a native caller filter's onLeave: ${e}`);
      }
    },
    "void",
    ["uint", "pointer", "int"],
  );
  let cm: CModule;
  try {
    cm = new CModule(SOURCE, { frooky_enter: enter, frooky_leave: leave });
  } catch (e) {
    compileError = e;
    throw e;
  }
  // the callbacks must live as long as the CModule
  compiled = { cm, callbacks: [enter, leave] };
  return cm;
}

// An Interceptor listener on `address` whose callerFilter runs in native code, see SOURCE
export class NativeFilteredListener {
  readonly listener: InvocationListener;
  private readonly data: NativePointer;
  private readonly id: number;
  // every table written: a thread in on_enter can still read the one before the last update
  private readonly tables: NativePointer[] = [];

  // Throws if the CModule doesn't compile or the Interceptor can't hook `address`
  constructor(address: NativePointer, ranges: ModuleRange[], argCount: number, enter: EnterHandler, leave: LeaveHandler) {
    const cm = compile();
    this.id = nextHandlerId++;
    this.data = Memory.alloc(FILTER_SIZE);
    this.data.add(ID_OFFSET).writeU32(this.id);
    this.setArgCount(argCount);
    this.setRanges(ranges);
    handlers.set(this.id, { enter, leave, argCount: () => this.data.add(N_ARGS_OFFSET).readU32() });
    try {
      this.listener = Interceptor.attach(address, { onEnter: cm.on_enter, onLeave: cm.on_leave }, this.data);
    } catch (e) {
      handlers.delete(this.id);
      throw e;
    }
  }

  // how many calls the native filter dropped so far
  get filteredCalls(): number {
    return this.data.add(FILTERED_OFFSET).readU64().toNumber();
  }

  setArgCount(argCount: number): void {
    this.data.add(N_ARGS_OFFSET).writeU32(Math.min(argCount, MAX_FILTERED_ARGS));
  }

  // Replaces the modules whose calls are passed on. The CModule reads the table through one pointer, which is
  // written last, so it sees either the old table or the new one.
  setRanges(ranges: ModuleRange[]): void {
    const table = Memory.alloc((1 + 2 * ranges.length) * Process.pointerSize);
    table.writePointer(ptr(ranges.length));
    ranges.forEach((range, i) => {
      table.add((1 + 2 * i) * Process.pointerSize).writePointer(range.base);
      table.add((2 + 2 * i) * Process.pointerSize).writePointer(range.end);
    });
    this.tables.push(table);
    this.data.add(RANGES_OFFSET).writePointer(table);
  }

  detach(): void {
    this.listener.detach();
    // without it, a listener with the same CModule callbacks attached to the same function before Frida
    // commits the detach never runs
    Interceptor.flush();
    // a call between onEnter and onLeave still finishes: its state keeps its leave handler
    handlers.delete(this.id);
  }
}
