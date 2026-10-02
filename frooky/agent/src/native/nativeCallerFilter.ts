import { logger } from "../shared/logger";
import { compileCallerFilter } from "../shared/platformStackTrace";

type ModuleRange = { name: string; base: NativePointer; end: NativePointer };

// The loaded modules by base address and the filters of installed hooks, both kept up to date by one module observer.
// Hooks can be registered inside the linker while it loads a module, where enumerating modules isn't safe.
const loadedModules = new Map<string, Module>();
const activeFilters = new Set<NativeCallerFilter>();
let moduleObserver: ModuleObserver | undefined;

function observeModules(): void {
  // attaching calls onAdded() for every loaded module
  moduleObserver ??= Process.attachModuleObserver({
    // runs on the thread that loads the module, inside the linker, before its constructors
    onAdded: (module) => {
      loadedModules.set(module.base.toString(), module);
      activeFilters.forEach((filter) => filter.addModule(module));
    },
    onRemoved: (module) => {
      loadedModules.delete(module.base.toString());
      activeFilters.forEach((filter) => filter.removeModule(module));
    },
  });
}

// A native hook's callerFilter: whether a return address is in a module whose name matches one of its patterns.
// Checked on every call of the hooked function, so it only compares addresses.
export class NativeCallerFilter {
  private readonly regExps: RegExp[];
  private ranges: ModuleRange[] = [];

  // `target` names the hooked function in debug logs, e.g. `libc.so!malloc`
  constructor(
    private readonly patterns: string[],
    private readonly target: string,
  ) {
    this.regExps = compileCallerFilter(patterns);
    observeModules();
    loadedModules.forEach((module) => this.addModule(module, false));
    activeFilters.add(this);
  }

  // e.g. `Caller filter on libc.so!malloc: records calls from libapp.so`
  describe(): string {
    if (this.ranges.length === 0) {
      return `Caller filter on ${this.target}: no loaded module matches ${this.patterns.join(", ")}, all calls are dropped until one loads`;
    }
    return `Caller filter on ${this.target}: records calls from ${this.ranges.map((range) => range.name).join(", ")}`;
  }

  matches(address: NativePointer): boolean {
    const ranges = this.ranges;
    // no for...of: its iterator costs on every call of a hot function under QuickJS
    for (let i = 0; i < ranges.length; i++) {
      if (address.compare(ranges[i].base) >= 0 && address.compare(ranges[i].end) < 0) return true;
    }
    return false;
  }

  // stops following module loads; the filter matches nothing afterwards
  dispose(): void {
    activeFilters.delete(this);
    this.ranges = [];
  }

  addModule(module: Module, log = true): void {
    if (!this.regExps.some((regExp) => regExp.test(module.name))) return;
    if (this.ranges.some((range) => range.base.equals(module.base))) return;
    this.ranges.push({ name: module.name, base: module.base, end: module.base.add(module.size) });
    if (log) logger.debug(`Caller filter on ${this.target}: records calls from ${module.name}, which was loaded`);
  }

  removeModule(module: Module): void {
    const count = this.ranges.length;
    this.ranges = this.ranges.filter((range) => !range.base.equals(module.base));
    if (this.ranges.length < count) logger.debug(`Caller filter on ${this.target}: ${module.name} was unloaded`);
  }
}
