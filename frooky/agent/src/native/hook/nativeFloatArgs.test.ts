import { Param } from "../../shared/decoders/decodable";
import { DEFAULT_DECODER_SETTINGS } from "../../shared/defaultValues";
import { collectArgs, planArgSlots, planFloatRetTypeSlot, readFloatArgBits, usesSeparateFloatRegisterFile } from "./nativeFloatArgs";

const param = (type: string): Param => ({ type, direction: "in", settings: DEFAULT_DECODER_SETTINGS });

function xmmBufferFor(value: number, byteLength: 4 | 8): ArrayBuffer {
  // A real XMM register is 128 bits; only the low bytes matter for a scalar float/double.
  const buffer = new ArrayBuffer(16);
  const view = new DataView(buffer);
  if (byteLength === 4) {
    view.setFloat32(0, value, true);
  } else {
    view.setFloat64(0, value, true);
  }
  return buffer;
}

describe("planArgSlots", () => {
  it("returns an empty array when there are no params", () => {
    expect(planArgSlots(undefined)).toEqual([]);
  });

  it("indexes int/pointer-class params in their own sequence, independent of float/double params", () => {
    // f(int a, double b, int c, float d, int e): a=int0, b=float0, c=int1, d=float1, e=int2
    const slots = planArgSlots([param("int"), param("double"), param("int"), param("float"), param("int")]);
    expect(slots).toEqual([
      { kind: "int", argIndex: 0 },
      { kind: "float", fpIndex: 0, byteLength: 8 },
      { kind: "int", argIndex: 1 },
      { kind: "float", fpIndex: 1, byteLength: 4 },
      { kind: "int", argIndex: 2 },
    ]);
  });

  it("does not treat a pointer to a float as a by-value float", () => {
    expect(planArgSlots([param("float *")])).toEqual([{ kind: "int", argIndex: 0 }]);
  });
});

describe("planFloatRetTypeSlot", () => {
  it("returns undefined when there is no retType", () => {
    expect(planFloatRetTypeSlot(undefined)).toBeUndefined();
  });

  it("returns fpIndex 0 for a float retType", () => {
    expect(planFloatRetTypeSlot({ type: "float" })).toEqual({ fpIndex: 0, byteLength: 4 });
  });

  it("returns fpIndex 0 for a double retType", () => {
    expect(planFloatRetTypeSlot({ type: "double" })).toEqual({ fpIndex: 0, byteLength: 8 });
  });

  it("returns undefined for a non-float retType", () => {
    expect(planFloatRetTypeSlot({ type: "int" })).toBeUndefined();
  });

  it("does not treat a pointer to a float as a by-value float return", () => {
    expect(planFloatRetTypeSlot({ type: "float *" })).toBeUndefined();
  });
});

describe("usesSeparateFloatRegisterFile", () => {
  it("is true for x86-64 (detected via rax)", () => {
    expect(usesSeparateFloatRegisterFile({ rax: ptr(0) } as unknown as CpuContext)).toBe(true);
  });

  it("is true for arm64-v8a (detected via x0)", () => {
    expect(usesSeparateFloatRegisterFile({ x0: ptr(0) } as unknown as CpuContext)).toBe(true);
  });

  it("is false for 32-bit x86, even though Ia32CpuContext also exposes xmm0-7", () => {
    // cdecl passes float/double arguments on the stack, not in xmm registers
    const context = { eax: ptr(0), xmm0: xmmBufferFor(1, 4) } as unknown as CpuContext;
    expect(usesSeparateFloatRegisterFile(context)).toBe(false);
  });

  it("is false for 32-bit ARM, even though ArmCpuContext also exposes d0-d31/s0-s31", () => {
    // Android's softfp ABI shares the general-purpose registers between int and float args.
    const context = { r0: ptr(0), d0: 1 } as unknown as CpuContext;
    expect(usesSeparateFloatRegisterFile(context)).toBe(false);
  });

  it("infers from Process.arch when context is omitted", () => {
    const expected = Process.arch === "arm64" || Process.arch === "x64";
    expect(usesSeparateFloatRegisterFile()).toBe(expected);
  });
});

describe("readFloatArgBits", () => {
  it("reads a float from an x86-64 xmm register (ArrayBuffer)", () => {
    const context = { pc: ptr(0), sp: ptr(0), xmm0: xmmBufferFor(1.5, 4) } as unknown as CpuContext;
    const bits = readFloatArgBits(context, { fpIndex: 0, byteLength: 4 });
    expect(bits).not.toBeNull();
    // 1.5 as float32 bits is 0x3fc00000.
    expect(bits!.toString()).toBe(ptr(0x3fc00000).toString());
  });

  it("reads a double from a different xmm register by index", () => {
    const context = { pc: ptr(0), sp: ptr(0), xmm1: xmmBufferFor(1, 8) } as unknown as CpuContext;
    const bits = readFloatArgBits(context, { fpIndex: 1, byteLength: 8 });
    expect(bits).not.toBeNull();
    // 1.0 as float64 bits is 0x3ff0000000000000.
    expect(bits!.toString()).toBe(ptr("0x3ff0000000000000").toString());
  });

  it("reads a double from arm64's d<n> register (already a decoded JS number)", () => {
    const context = { x0: ptr(0), d0: 1 } as unknown as CpuContext;
    const bits = readFloatArgBits(context, { fpIndex: 0, byteLength: 8 });
    expect(bits).not.toBeNull();
    expect(bits!.toString()).toBe(ptr("0x3ff0000000000000").toString());
  });

  it("reads a float from arm64's s<n> register", () => {
    const context = { x0: ptr(0), s0: 1.5 } as unknown as CpuContext;
    const bits = readFloatArgBits(context, { fpIndex: 0, byteLength: 4 });
    expect(bits).not.toBeNull();
    expect(bits!.toString()).toBe(ptr(0x3fc00000).toString());
  });

  it("returns null when fpIndex is beyond the registers used for argument passing", () => {
    const context = { pc: ptr(0), sp: ptr(0), xmm0: xmmBufferFor(1, 4) } as unknown as CpuContext;
    expect(readFloatArgBits(context, { fpIndex: 8, byteLength: 4 })).toBeNull();
  });

  it("returns null for a context with no recognizable float register at all", () => {
    const context = { eax: ptr(0) } as unknown as CpuContext;
    expect(readFloatArgBits(context, { fpIndex: 0, byteLength: 4 })).toBeNull();
  });
});

describe("collectArgs", () => {
  it("reads float/double params from the FP registers and the others from args[] by their int position", () => {
    // f(int a, double b, int c): args[] holds a and c, b is in the first FP register
    const slots = planArgSlots([param("int"), param("double"), param("int")]);
    const context = { pc: ptr(0), sp: ptr(0), xmm0: xmmBufferFor(2.5, 8) } as unknown as CpuContext;

    const collected = collectArgs([ptr(1), ptr(3)], context, slots);

    expect(collected.map((value) => value.toString())).toEqual([
      ptr(1).toString(),
      readFloatArgBits(context, { fpIndex: 0, byteLength: 8 })!.toString(),
      ptr(3).toString(),
    ]);
  });

  it("reads a float param past the FP argument registers as 0", () => {
    const slots = planArgSlots(Array.from({ length: 9 }, () => param("float")));
    const context = { pc: ptr(0), sp: ptr(0) } as unknown as CpuContext;

    expect(collectArgs([], context, slots)[8].toString()).toBe(ptr(0).toString());
  });
});
