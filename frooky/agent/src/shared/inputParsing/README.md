# YAML Parsing

The types in this folder are used for the public YAML files. They extend certain types which make it easier to write short hook files, but are cumbersome to parse internally.

**Example 1**: Method names

In the YAML file we can use the following different ways to declare a method:

```yaml
hookCollection:
  - javaClass: android.security.AttestedKeyPair
    hooks:
      - $init
      - getKeyPair

  - javaClass: android.security.AttestedKeyPair
    hooks:
      - method: $init
      - method: getKeyPair
```

**Example 2**: Parameters

```yaml
- module: libssl.so
  hooks:
    - symbol: EVP_EncryptInit_ex
      retType: int
      params:
        - "EVP_CIPHER_CTX *"
        - ["const EVP_CIPHER *", type]
        - { type: "ENGINE *", name: "impl" }
```

These are all valid ways which give the user flexibility. But internally it introduces complexity when working with the different types.

We therefore only use normalized objects internally: `JavaHookDeclaration` and `NativeHookDeclaration` in [`../hook/hookDeclaration.ts`](../hook/hookDeclaration.ts), with `Param` and `RetType` objects and complete settings (e.g. `{ type: "ENGINE *", name: "impl", direction: "in", settings: { maxDepth: 10, maxItems: 100 } }`).

The types in this folder describe the YAML only. They don't reuse the normalized types, which require fields that hook files leave out.

## Zod Schemas

This folder contains **automatically** generated [zod schemas](./zodSchemas) via [zod](https://zod.dev/).

They are used to validate the frooky configuration during initialization: the settings, and each hook declaration before it is normalized.

Run `npm run build:zodSchema` to build them manually.

> [!WARNING]
> Do not change these files, as they are automatically overwritten every time the frooky type changes.
