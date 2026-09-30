import type Java from "frida-java-bridge";

// Cipher, Mac and Signature choose their provider lazily, on init() or first use, from the key they get. Their
// getters that need the provider (getProvider(), getIV(), getBlockSize(), getMacLength(), ...) choose one early if
// none is chosen yet, which can break a later init() with e.g. an Android Keystore key. So the decoders read the
// private fields instead, and call these getters only once a provider is chosen.

// Name of the chosen provider, e.g. "AndroidOpenSSL", or null if none is chosen yet.
export function chosenProviderName(engine: Java.Wrapper): string | null {
  const provider = engine.provider.value;
  return provider == null ? null : provider.getName();
}

// Name of the static final int constant of `javaClass` with this value, e.g. 1 -> "ENCRYPT_MODE" of Cipher.
export function constantName(javaClass: Java.Wrapper, names: string[], value: number): string | number {
  return names.find((name) => javaClass[name].value === value) ?? value;
}
