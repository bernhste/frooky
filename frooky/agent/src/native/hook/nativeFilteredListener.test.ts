import { sleepMilliseconds } from "../../shared/utils";
import { NativeFilteredListener } from "./nativeFilteredListener";

// qsort() calls compare_ints() from libc.so, a NativeFunction call comes from Frida's agent. Module level: its code
// must outlive the hooks on it.
const cm = new CModule(
  `
  extern int *__errno (void);
  int compare_ints (const int *a, const int *b) {
    *__errno () = 7;
    return (*a > *b) - (*a < *b);
  }
`,
  { __errno: Module.getGlobalExportByName("__errno") },
);
const libc = Process.getModuleByName("libc.so");
const qsort = new NativeFunction(libc.getExportByName("qsort"), "void", ["pointer", "size_t", "size_t", "pointer"]);
const compareInts = new NativeFunction(cm.compare_ints, "int", ["pointer", "pointer"]);

function sortTwo(): void {
  const values = Memory.alloc(8);
  values.writeS32(2);
  values.add(4).writeS32(1);
  qsort(values, 2, 4, cm.compare_ints);
}

function compareDirectly(): void {
  const values = Memory.alloc(8);
  compareInts(values, values.add(4));
}

describe("NativeFilteredListener", () => {
  it("passes only calls from the given modules on, with their arguments, return value and errno", async () => {
    const entered: NativePointer[][] = [];
    const left: [unknown, number, number][] = [];
    const listener = new NativeFilteredListener(
      cm.compare_ints,
      [{ base: libc.base, end: libc.base.add(libc.size) }],
      2,
      (args, returnAddress) => {
        entered.push(args);
        return `call from ${Process.findModuleByAddress(returnAddress)?.name}`;
      },
      (state, returnValue, errno) => left.push([state, returnValue.toInt32(), errno]),
    );
    try {
      // the Interceptor commits the listener once no thread runs a JS callback
      for (let i = 0; i < 100 && entered.length === 0; i++) {
        sortTwo();
        if (entered.length === 0) await sleepMilliseconds(10);
      }
      entered.length = 0;
      left.length = 0;
      const before = listener.filteredCalls;

      compareDirectly();
      compareDirectly();
      sortTwo();

      expect(listener.filteredCalls - before).toBe(2);
      expect(entered.length).toBe(1);
      expect(entered[0].length).toBe(2);
      expect(left).toEqual([["call from libc.so", 1, 7]]);
    } finally {
      listener.detach();
    }
  });

  it("follows setRanges()", async () => {
    let entered = 0;
    const listener = new NativeFilteredListener(
      cm.compare_ints,
      [],
      0,
      () => {
        entered++;
        return undefined;
      },
      () => {},
    );
    try {
      for (let i = 0; i < 100 && listener.filteredCalls === 0; i++) {
        sortTwo();
        if (listener.filteredCalls === 0) await sleepMilliseconds(10);
      }
      expect(entered).toBe(0);
      expect(listener.filteredCalls).toBeGreaterThan(0);

      listener.setRanges([{ base: libc.base, end: libc.base.add(libc.size) }]);
      for (let i = 0; i < 100 && entered === 0; i++) {
        sortTwo();
        if (entered === 0) await sleepMilliseconds(10);
      }
      expect(entered).toBeGreaterThan(0);
    } finally {
      listener.detach();
    }
  });
});

export {};
