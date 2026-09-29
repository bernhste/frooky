import { Param } from "../../shared/decoders/decodable";
import { parseNativeFridaType } from "../decoders/nativeFridaType";

// The FP register of a float/double param or return value, counted among float/double values only.
interface FloatArgSlot {
  fpIndex: number;
  byteLength: 4 | 8;
}

// Where a param's value lives: `args[argIndex]`, counted among int/pointer params, or an FP register,
// counted among float/double params. E.g. `f(int a, double b, int c)`: a -> int 0, b -> float 0, c -> int 1.
type NativeArgSlot = { kind: "float"; fpIndex: number; byteLength: 4 | 8 } | { kind: "int"; argIndex: number };

// FP argument registers on SysV x86-64, Windows x64 and AAPCS64; further float args are on the stack (not supported)
const MAX_FP_ARG_REGISTERS = 8;

// NativeArgSlot of every declared param
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

// A float/double return value is always in the first FP register (XMM0 / D0).
export function planFloatRetTypeSlot(retType: { type: string } | undefined): FloatArgSlot | undefined {
  if (!retType) return undefined;

  const fridaType = parseNativeFridaType(retType.type);
  if (fridaType === "float" || fridaType === "double") {
    return { fpIndex: 0, byteLength: fridaType === "float" ? 4 : 8 };
  }
  return undefined;
}

// True on x86-64 (`rax`) and arm64 (`x0`), where float/double args are passed in separate FP registers.
// False on 32-bit x86 (cdecl passes them on the stack) and 32-bit ARM (softfp passes them in general-purpose
// registers with alignment padding). There, params are read from args[] by position, which is wrong for
// signatures that mix int and float/double params.
export function usesSeparateFloatRegisterFile(context?: CpuContext): boolean {
  if (context !== undefined) {
    const registers = context as unknown as Record<string, unknown>;
    return "rax" in registers || "x0" in registers;
  }
  return Process.arch === "arm64" || Process.arch === "x64";
}

function bitsFromArrayBuffer(buffer: ArrayBuffer, byteLength: 4 | 8): NativePointer {
  // XMM registers are little-endian, a float/double lives in the low bytes
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

// The raw bits of an FP register as a NativePointer, for NativeValueDecoder. Only valid if
// usesSeparateFloatRegisterFile(). Returns null for a float arg passed on the stack (9th and later).
export function readFloatArgBits(context: CpuContext, slot: FloatArgSlot): NativePointer | null {
  if (slot.fpIndex >= MAX_FP_ARG_REGISTERS) return null;

  const registers = context as unknown as Record<string, ArrayBuffer | number | undefined>;

  const xmm = registers[`xmm${slot.fpIndex}`];
  if (xmm instanceof ArrayBuffer) {
    // x86-64
    return bitsFromArrayBuffer(xmm, slot.byteLength);
  }

  // arm64: Frida returns d<n>/s<n> as numbers, so they are converted back to bits
  const armRegister = registers[slot.byteLength === 4 ? `s${slot.fpIndex}` : `d${slot.fpIndex}`];
  if (typeof armRegister === "number") {
    return bitsFromNumber(armRegister, slot.byteLength);
  }

  return null;
}
