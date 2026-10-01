import Java from "frida-java-bridge";

// Java.registerClass() for tests. The class lives in a class loader of its own, which Java.use() doesn't search,
// like a class of an app that loads a dex itself. registerClass() writes a dex file (the default /data/local/tmp
// isn't writable for the app) and switches Java.use() to the new class loader, which the other tests don't expect.
export function registerTestClass(spec: Java.ClassSpec): Java.Wrapper {
  const { loader, cacheDir } = Java.classFactory;
  const packageName: string = Java.use("android.app.ActivityThread").currentPackageName();
  Java.classFactory.cacheDir = `/data/data/${packageName}/cache`;
  try {
    return Java.registerClass(spec);
  } finally {
    (Java.classFactory as { loader: Java.Wrapper | null }).loader = loader;
    Java.classFactory.cacheDir = cacheDir;
  }
}
