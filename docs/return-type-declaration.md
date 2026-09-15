# Return Type Declaration

The return type declaration is a simpler variant of a [parameter declaration](./parameter-declaration.md).

<!-- TOC -->

- [Return Type vs. Parameter Declaration](#return-type-vs-parameter-declaration)
- [Basic Usage](#basic-usage)
  - [Java Return Types](#java-return-types)
  - [Native Return Types](#native-return-types)
- [Decoders](#decoders)

<!-- /TOC -->

## Return Type vs. Parameter Declaration

Compared with a parameter declaration, a return type declaration differs in the following ways:

- It is declared only once per function or method
- It cannot be named
- It is always decoded after the function or method completes

The following chapter explains how to declare the return type with examples.

## Basic Usage

The return type is declared only by its type. The following chapters will use examples to illustrate this.

### Java Return Types

In Java, the method signature can be retrieved at runtime. Unless you want to override the [default decoder](#decoders), you don't need to provide an explicit return type.

### Native Return Types

```yaml
module: libssl.so
hooks:
  - symbol: EVP_DigestFinal_ex
    retType: int
    params:
      - [ "EVP_MD_CTX *", ctx ]
      - [ "unsigned char *", md ]
      - [ "unsigned int *", s ]
```

This example hooks the following method from [OpenSSL](https://docs.openssl.org/1.0.2/man3/EVP_DigestInit):

```c
int EVP_DigestFinal_ex(EVP_MD_CTX *ctx,
                       unsigned char *md,
                       unsigned int *s);
```

The function returns an integer. It returns 1 on success and 0 on failure.

## Decoders

If you want to configure the decoder for the return value, you can use any of the [decoder settings](./additional-features.md#decoder-settings), for example:

- `decoderArg`
- `maxRecursion`
- `decodeLimit`
- `magicDecode`
- `fastDecode`
- `decoder` (Java only, see [`decoder`](./parameter-declaration.md#customdecoder-option-override-the-decoder))
