import { Param } from "../../shared/decoders/decodable";
import { parseNativeFridaType } from "../decoders/nativeFridaType";

/**
 * Describes where a by-value float/double parameter's (or a scalar float/double return value's)
 * real bits live: the Nth (0-based) floating-point register, counted only among float/double
 * values in their own sequence - see {@link usesSeparateFloatRegisterFile} for which
 * architectures actually have such a sequence.
 */
export interface FloatArgSlot {
  fpIndex: number;
  byteLength: 4 | 8;
}

/**
 * Where a single declared param's real value lives: either the `argIndex`-th general-purpose
 * argument (Frida's `args[]`, indexed among int/pointer-class params only), or a
 * {@link FloatArgSlot} FP register (indexed among float/double-class params only).
 *
 * These two counters are independent - float/double values don't consume general-purpose
 * argument slots or vice versa - so a param's real index generally isn't just its position in the
 * declared param list once any float/double params are interleaved with other types. E.g. for
 * `f(int a, double b, int c)`: `a` is int-lane index 0, `c` is int-lane index 1 (not 2), and `b`
 * is float-lane index 0.
 */
export type NativeArgSlot = { kind: "float"; fpIndex: number; byteLength: 4 | 8 } | { kind: "int"; argIndex: number };

// Number of registers used for float/double argument passing on the calling conventions handled
// below (SysV x86-64, Windows x64, AAPCS64); a param beyond this is stack-spilled, which isn't
// handled here.
const MAX_FP_ARG_REGISTERS = 8;

/**
 * Classifies every declared param into its {@link NativeArgSlot}. Purely a function of the
 * declared types, so it's computed once per hook rather than per invocation.
 */
export function planArgSlots(params: Param[] | undefined): NativeArgSlot[] {
  if (!params) return [];

  let fpIndex = 0;
  let argIndex = 0;
  return params.map((param) => {
    const fridaType = parseNativeFridaType(param.type);
    if (fridaType === "float" || fridaType === "double") {
      return { kind: "float", fpIndex: fpIndex++, byteLength: fridaType === "float" ? 4 : 8 };
    }
    return { kind: "int", argIndex: argIndex++ };
  });
}

/**
 * A scalar float/double return value comes back in its own dedicated register (XMM0 / D0),
 * always at index 0 regardless of how many floating-point arguments the call used - unlike
 * arguments, a single return value never shares that counter with anything else.
 */
export function planFloatRetTypeSlot(retType: { type: string } | undefined): FloatArgSlot | undefined {
  if (!retType) return undefined;

  const fridaType = parseNativeFridaType(retType.type);
  if (fridaType === "float" || fridaType === "double") {
    return { fpIndex: 0, byteLength: fridaType === "float" ? 4 : 8 };
  }
  return undefined;
}

/**
 * True only for calling conventions where float/double values live in a register file entirely
 * independent of the general-purpose one, with no shared-register/alignment interaction between
 * the two: SysV and Windows x86-64 (detected via `rax`, unique to Frida's X64CpuContext) and
 * AAPCS64/arm64-v8a (detected via `x0`, unique to Arm64CpuContext).
 *
 * False for every other/unrecognized architecture - notably:
 * - 32-bit x86 (`eax`; Frida's Ia32CpuContext also exposes xmm0-7, but the standard cdecl
 *   convention never actually routes a scalar float/double argument through them - they're always
 *   passed on the stack).
 * - 32-bit ARM (`r0`; Android's softfp ABI shares the *same* general-purpose registers between
 *   int and float/double arguments, with alignment-driven padding rules frooky doesn't model).
 *
 * On these, args[]'s own raw positional indexing is used for every param instead, matching
 * frooky's original (pre-existing, still imperfect for interleaved int/float signatures on these
 * two architectures specifically) behavior - there's no independent lane to count separately.
 */
export function usesSeparateFloatRegisterFile(context: CpuContext): boolean {
  const registers = context as unknown as Record<string, unknown>;
  return "rax" in registers || "x0" in registers;
}

function bitsFromArrayBuffer(buffer: ArrayBuffer, byteLength: 4 | 8): NativePointer {
  // XMM registers are little-endian; a scalar float/double argument lives in the low bytes.
  const view = new DataView(buffer);
  return byteLength === 4 ? ptr(view.getUint32(0, true)) : ptr(view.getBigUint64(0, true).toString());
}

function bitsFromNumber(value: number, byteLength: 4 | 8): NativePointer {
  const buffer = new ArrayBuffer(8);
  const view = new DataView(buffer);
  if (byteLength === 4) {
    view.setFloat32(0, value, true);
  } else {
    view.setFloat64(0, value, true);
  }
  return bitsFromArrayBuffer(buffer, byteLength);
}

/**
 * Reads the raw bit pattern of the `slot.fpIndex`-th floating-point register from a CPU context,
 * wrapped as a NativePointer so it can flow through NativeValueDecoder's existing scratch-memory
 * reinterpretation unchanged.
 *
 * Only meaningful when {@link usesSeparateFloatRegisterFile} is true for this context - callers
 * are expected to check that first. Returns null when `slot.fpIndex` falls outside the register
 * file actually used for argument/return-value passing (e.g. a stack-spilled 9th+ float
 * argument), which isn't handled here.
 */
export function readFloatArgBits(context: CpuContext, slot: FloatArgSlot): NativePointer | null {
  if (slot.fpIndex >= MAX_FP_ARG_REGISTERS) return null;

  const registers = context as unknown as Record<string, ArrayBuffer | number | undefined>;

  const xmm = registers[`xmm${slot.fpIndex}`];
  if (xmm instanceof ArrayBuffer) {
    // x86-64.
    return bitsFromArrayBuffer(xmm, slot.byteLength);
  }

  // arm64-v8a: Frida already decodes d<n>/s<n> to a JS number, so its bits are re-derived here
  // rather than reinterpreted, keeping a single NativePointer-based path for both architectures.
  const armRegister = registers[slot.byteLength === 4 ? `s${slot.fpIndex}` : `d${slot.fpIndex}`];
  if (typeof armRegister === "number") {
    return bitsFromNumber(armRegister, slot.byteLength);
  }

  return null;
}
