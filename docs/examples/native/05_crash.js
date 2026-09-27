// Crashes tests/target-apps/android/value-passing-native on purpose, to test frooky's crash report.
// Load it with 05_crash.yaml, see there.
//
// Replaces the first byte of the string literal "Called functions ..." in libreceiveString.so, which
// receiveStringsJNI returns with NewStringUTF, with 0x80, a UTF-8 continuation byte that cannot start a character.
// ART's CheckJNI then aborts the app with "JNI DETECTED ERROR IN APPLICATION: input is not valid Modified UTF-8",
// the same crash a hook at an offset inside .rodata causes.
function corrupt() {
  const module = Process.findModuleByName("libreceiveString.so");
  if (!module) {
    setTimeout(corrupt, 50);
    return;
  }
  const pattern = "43 61 6c 6c 65 64 20 66 75 6e 63 74 69 6f 6e 73"; // "Called functions"
  const matches = module.enumerateRanges("r--").flatMap((range) => Memory.scanSync(range.base, range.size, pattern));
  if (matches.length === 0) throw new Error(`"Called functions" not found in ${module.name}`);
  Memory.patchCode(matches[0].address, 1, (code) => code.writeU8(0x80));
  console.log(`Corrupted "Called functions" at ${module.name}+0x${matches[0].address.sub(module.base).toString(16)}, tap "Start" to crash the app`);
}
corrupt();
