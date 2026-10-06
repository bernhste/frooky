import Java from "frida-java-bridge";
import { Resolution, Waiting } from "../../shared/hook/hookManager";
import { logger } from "../../shared/logger";
import { plural, wildcardPatternToRegExp } from "../../shared/utils";

// Runs after every call of `method`, see AndroidHookManager.observe()
export type MethodObserver = (instance: Java.Wrapper, args: any[], returnValue: any) => void;
export type ObserveMethod = (method: Java.Method, methodName: string, observer: MethodObserver) => void;

// Called with the classes found for a lookup. With `installNow`, hooks are installed in the callback, e.g. while
// a new class loader is created, so they are in place before the app runs code of these classes.
export type OnClassesFound<T> = (classes: Java.Wrapper[], installNow: boolean) => T;

type Lookup = {
  javaClass: string; // a class name or a wildcard pattern, e.g. `org.owasp.*.HttpClient`
  pattern?: RegExp;
  classLoader?: string;
  found: (classes: Java.Wrapper[], installNow: boolean) => void;
};

// Watched for new class loaders. In spawn mode, the constructors are hooked before the app runs, and then
// `new PathClassLoader(...)` doesn't reach the hook on its BaseDexClassLoader super constructor, only the
// framework's own calls do. So the framework's subclasses are watched too. Not every Android version has all of them.
const LOADER_CLASSES = [
  "dalvik.system.BaseDexClassLoader",
  "dalvik.system.PathClassLoader",
  "dalvik.system.DexClassLoader",
  "dalvik.system.InMemoryDexClassLoader",
  "dalvik.system.DelegateLastClassLoader",
];

// Finds Java classes in every class loader of the app, including the ones it creates later (e.g. WebView's or a
// plugin's), without polling:
// - a class name is looked up in the default class loader, then in every class loader once the app runs, then in
//   every new BaseDexClassLoader (Path-, Dex-, InMemoryDex- and DelegateLastClassLoader) while it is created
// - a wildcard pattern is matched against the loaded classes and the dex files of every class loader once the app
//   runs, then against the dex files of every new class loader while it is created
// - with `classLoader`, a class (or pattern) is only looked up in instances of that ClassLoader subclass, also when
//   one of them loads it later, for custom class loaders that define classes themselves
export class JavaClassResolver {
  private readonly lookups = new Set<Lookup>();
  // identityHashCode() of the class loaders seen so far: the watched constructors call each other
  private readonly seenLoaders = new Set<number>();
  private watchingNewLoaders = false;
  private readonly watchedLoaderClasses = new Map<string, Java.Wrapper | null>();
  // set while this resolver loads classes itself, which runs the observed methods again
  private resolving = false;
  private javaSystem: Java.Wrapper | undefined;

  constructor(
    private readonly observe: ObserveMethod,
    private readonly targetReady: () => Promise<void>,
  ) {}

  // The result of `onFound` for the classes of `javaClass`: right away if the default class loader has the class, else a
  // Resolution decided once the lookups at targetReady have run. A class found later, at any time while the app runs,
  // settles its Waiting.
  find<T>(javaClass: string, classLoader: string | undefined, onFound: OnClassesFound<T>): Resolution<T> {
    // most classes are in the default class loader, also before the app runs
    if (!javaClass.includes("*") && !classLoader) {
      const javaClassWrapper = this.use(javaClass);
      if (javaClassWrapper) {
        logger.debug(`Java class '${javaClass}' resolved.`);
        return onFound([javaClassWrapper], false);
      }
    }

    return new Promise<T | Waiting<T>>((resolve, reject) => {
      // set once the lookups at targetReady haven't found the class
      let later: { resolve: (result: T) => void; reject: (reason: unknown) => void } | undefined;
      const lookup: Lookup = {
        javaClass,
        pattern: javaClass.includes("*") ? wildcardPatternToRegExp(javaClass) : undefined,
        classLoader,
        found: (classes, installNow) => {
          this.lookups.delete(lookup);
          try {
            (later?.resolve ?? resolve)(onFound(classes, installNow));
          } catch (e) {
            (later?.reject ?? reject)(e);
          }
        },
      };
      const stopLookingUp = () => {
        if (this.lookups.has(lookup))
          resolve({ waiting: new Promise<T>((resolveLater, rejectLater) => (later = { resolve: resolveLater, reject: rejectLater })) });
      };

      logger.debug(`Waiting for Java class '${javaClass}'${classLoader ? ` from class loader '${classLoader}'` : ""}.`);
      this.lookups.add(lookup);
      // in spawn mode on the app's main thread, before its code runs: hooks found here are installed in time
      void this.targetReady().then(() => {
        if (!this.lookups.has(lookup)) return;
        this.watchNewLoaders();
        if (classLoader) this.watchLoaderClass(classLoader);
        if (!lookup.pattern) {
          if (this.lookups.has(lookup)) this.findInLoaders(lookup, this.existingLoaders());
          stopLookingUp();
        } else if (!classLoader) {
          // reads the names of every class in the app, so not on the app's main thread
          setTimeout(() => {
            this.matchPatterns(this.existingLoaders(), true);
            stopLookingUp();
          }, 0);
        } else {
          stopLookingUp();
        }
      });
    });
  }

  // null for a class that `loader` (default: the app's class loader) doesn't have
  private use(javaClass: string, loader?: Java.Wrapper | null): Java.Wrapper | null {
    const wasResolving = this.resolving;
    this.resolving = true;
    try {
      // ClassFactory keeps the loader of a new factory, so not a local reference, e.g. of an observed constructor
      return loader ? Java.ClassFactory.get(Java.retain(loader)).use(javaClass) : Java.use(javaClass);
    } catch (_) {
      return null;
    } finally {
      this.resolving = wasResolving;
    }
  }

  private existingLoaders(): Java.Wrapper[] {
    try {
      return Java.enumerateClassLoadersSync();
    } catch (e) {
      logger.warn(`Failed to list the class loaders: ${e}`);
      return [];
    }
  }

  private isInstanceOf(loader: Java.Wrapper, classLoader: string): boolean {
    const loaderClass = this.watchedLoaderClasses.get(classLoader);
    return !!loaderClass && loaderClass.class.isInstance(loader);
  }

  private findInLoaders(lookup: Lookup, loaders: Java.Wrapper[]): void {
    for (const loader of loaders) {
      if (lookup.classLoader && !this.isInstanceOf(loader, lookup.classLoader)) continue;
      const javaClassWrapper = this.use(lookup.javaClass, loader);
      if (javaClassWrapper) {
        logger.debug(`Java class '${lookup.javaClass}' resolved in class loader ${loader.$className}.`);
        lookup.found([javaClassWrapper], true);
        return;
      }
    }
  }

  // Watches the constructors of BaseDexClassLoader, which every class loader that reads dex files extends, and of
  // its subclasses in LOADER_CLASSES.
  private watchNewLoaders(): void {
    if (this.watchingNewLoaders) return;
    this.watchingNewLoaders = true;
    for (const loaderClass of LOADER_CLASSES) {
      const wrapper = this.use(loaderClass);
      if (!wrapper) {
        logger.debug(`Class loader class '${loaderClass}' not found, not watched.`);
        continue;
      }
      try {
        for (const constructor of wrapper.$init.overloads) {
          this.observe(constructor, "$init", (loader) => this.onNewLoader(loader));
        }
      } catch (e) {
        logger.warn(`Failed to watch new instances of ${loaderClass}, classes in them are not found: ${e}`);
      }
    }
  }

  // Runs on the app's thread that creates the class loader, before any class of it is used. Wildcards are matched
  // here too, so their hooks are in place before the app uses the class loader, at the cost of reading the names of
  // the classes in its dex files on that thread (about 0.1 s for a large APK).
  private onNewLoader(loader: Java.Wrapper): void {
    if (this.resolving || this.lookups.size === 0) return;
    this.javaSystem ??= Java.use("java.lang.System");
    const id = this.javaSystem.identityHashCode(loader) as number;
    if (this.seenLoaders.has(id)) return;
    this.seenLoaders.add(id);

    let hasPattern = false;
    for (const lookup of [...this.lookups]) {
      if (lookup.classLoader) continue;
      if (lookup.pattern) hasPattern = true;
      else this.findInLoaders(lookup, [loader]);
    }
    if (hasPattern) this.matchPatterns([loader], false);
  }

  // Matches the wildcard lookups against the classes in the dex files of `loaders`, and with `includeLoaded`
  // against every loaded class (e.g. the framework's, which are in no dex file of a class loader).
  private matchPatterns(loaders: Java.Wrapper[], includeLoaded: boolean): void {
    const patternLookups = [...this.lookups].filter((lookup) => lookup.pattern && !lookup.classLoader);
    if (patternLookups.length === 0) return;

    // class name -> the class loader with that class in its dex file, or null for a loaded class
    const candidates = new Map<string, Java.Wrapper | null>();
    if (includeLoaded) {
      for (const name of Java.enumerateLoadedClassesSync()) candidates.set(name, null);
    }
    for (const loader of loaders) {
      for (const name of this.classNamesOf(loader)) {
        if (!candidates.get(name)) candidates.set(name, loader);
      }
    }

    for (const lookup of patternLookups) {
      const classes: Java.Wrapper[] = [];
      for (const [name, loader] of candidates) {
        if (!lookup.pattern!.test(name)) continue;
        const javaClassWrapper = this.use(name, loader);
        if (javaClassWrapper) classes.push(javaClassWrapper);
        else logger.debug(`Failed to resolve matched Java class '${name}'.`);
      }
      if (classes.length === 0) continue;
      logger.debug(`${plural(classes.length, "Java class", "Java classes")} matching wildcard pattern '${lookup.javaClass}' resolved.`);
      lookup.found(classes, true);
    }
  }

  // The names of the classes in the dex files of a BaseDexClassLoader, empty for other class loaders
  private classNamesOf(loader: Java.Wrapper): string[] {
    try {
      const baseDexClassLoader = Java.use("dalvik.system.BaseDexClassLoader");
      if (!baseDexClassLoader.class.isInstance(loader)) return [];
      const dexFileClass = Java.use("dalvik.system.DexFile");
      const names: string[] = [];
      for (const element of Java.cast(loader, baseDexClassLoader).pathList.value.dexElements.value) {
        const dexFile = element.dexFile.value;
        if (dexFile !== null) names.push(...dexFileClass.getClassNameList(dexFile.mCookie.value));
      }
      return names;
    } catch (e) {
      logger.debug(`Failed to list the classes of class loader ${loader.$className}: ${e}`);
      return [];
    }
  }

  // Watches `loadClass(String)` of the ClassLoader subclass `classLoader`, which a custom class loader that
  // defines classes itself (e.g. with DexFile.loadClass()) runs for every class it loads.
  private watchLoaderClass(classLoader: string): void {
    if (this.watchedLoaderClasses.has(classLoader)) return;
    const loaderClass = this.use(classLoader) ?? this.findInEveryLoader(classLoader);
    this.watchedLoaderClasses.set(classLoader, loaderClass);
    if (!loaderClass) {
      logger.warn(`Class loader '${classLoader}' not found. Its classes are not hooked.`);
      return;
    }
    try {
      this.observe(this.mostDerivedLoadClass(loaderClass), "loadClass", (loader, args, loadedClass) =>
        this.onLoadClass(classLoader, loader, args, loadedClass),
      );
    } catch (e) {
      logger.warn(`Failed to watch class loader '${classLoader}': ${e}`);
    }
    for (const lookup of [...this.lookups]) {
      if (lookup.classLoader === classLoader && !lookup.pattern) this.findInLoaders(lookup, this.existingLoaders());
    }
  }

  private findInEveryLoader(javaClass: string): Java.Wrapper | null {
    for (const loader of this.existingLoaders()) {
      const javaClassWrapper = this.use(javaClass, loader);
      if (javaClassWrapper) return javaClassWrapper;
    }
    return null;
  }

  // The loadClass(String) that runs for instances of `loaderClass`: its own, or the one it inherits
  private mostDerivedLoadClass(loaderClass: Java.Wrapper): Java.Method {
    const stringClass = Java.use("java.lang.String").class;
    for (let javaClass = loaderClass.class; javaClass !== null; javaClass = javaClass.getSuperclass()) {
      try {
        javaClass.getDeclaredMethod("loadClass", Java.array("java.lang.Class", [stringClass]));
      } catch (_) {
        continue;
      }
      const declaringClass = this.use(javaClass.getName(), javaClass.getClassLoader());
      if (!declaringClass) break;
      return declaringClass.loadClass.overload("java.lang.String");
    }
    throw new Error(`'${loaderClass.$className}' has no loadClass(String)`);
  }

  // Runs on the app's thread before loadClass() returns the class, so hooks are in place before it is used
  private onLoadClass(classLoader: string, loader: Java.Wrapper, args: any[], loadedClass: Java.Wrapper | null): void {
    if (this.resolving || loadedClass === null || !this.isInstanceOf(loader, classLoader)) return;
    const name = String(args[0]);
    for (const lookup of [...this.lookups]) {
      if (lookup.classLoader !== classLoader) continue;
      if (lookup.pattern ? !lookup.pattern.test(name) : lookup.javaClass !== name) continue;
      const javaClassWrapper = this.use(loadedClass.getName(), loadedClass.getClassLoader());
      if (!javaClassWrapper) continue;
      logger.debug(`Java class '${name}' loaded by class loader '${classLoader}'.`);
      lookup.found([javaClassWrapper], true);
    }
  }
}
