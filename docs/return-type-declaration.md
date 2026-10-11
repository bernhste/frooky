# Return Type Declaration

`returns` declares how the return value of a hooked function or method is decoded. The return value is decoded once the call returns, and appears in the event as `returnValue`, see [Output](./output.md).

<!-- TOC -->

- [Native Return Types](#native-return-types)
- [Java Return Types](#java-return-types)

<!-- /TOC -->

## Native Return Types

A native hook only records the return value if it declares `returns`, as a C type:

| Form            | Example                                                |
| --------------- | ------------------------------------------------------ |
| Type            | `returns: int`                                         |
| Type + settings | `returns: ["char *", { maxItems: 256 }]`               |
| Object          | `returns: { type: int, name: result, decoder: errno }` |

```yaml
module: libcrypto.so
hooks:
  - symbol: EVP_DigestFinal_ex
    returns: int
    params:
      - ["EVP_MD_CTX *", ctx]
      - ["unsigned char *", md, { direction: out, length: s }]
      - ["unsigned int *", s, { direction: out }]
```

This hooks [`EVP_DigestFinal_ex`](https://docs.openssl.org/3.0/man3/EVP_DigestInit/), which returns `1` on success and `0` on failure:

```c
int EVP_DigestFinal_ex(EVP_MD_CTX *ctx, unsigned char *md, unsigned int *s);
```

A parameter can use the return value as its length with `length: $ret`, which needs `returns`. The return value itself takes `maxDepth`, `maxItems`, `decoder` and `decoderOptions`; the settings of a parameter (`direction`, `length`, `offset`, `argFilter`) are rejected on it. See [Return Values](./decoders-native.md#return-values) for decoding options.

## Java Return Types

Java hooks get the return type by reflection, so `returns` declares no type, only the decoder settings of the return value (`maxDepth`, `maxItems`, `decoder`, `decoderOptions`), on an overload:

```yaml
javaClass: org.owasp.mastestapp.MastgTest
hooks:
  - method: receiveBase64
    overloads:
      - params:
          - [java.lang.String, encoded]
        returns: { decoder: base64 }
```

Without `returns`, the return value is decoded with the hook's decoder settings. See [Return Values](./decoders-java.md#return-values) for more examples.
