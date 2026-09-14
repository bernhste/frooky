# `SwiftHook` Declaration

> [!WARNING]
> Swift hooking is **not currently implemented** in frooky. `InputFrookyConfig.hookGroup` only accepts `JavaHook` and `NativeHook` declarations today. This document describes the intended, planned declaration format for a future release.

This documentation explains how to write Swift hook declarations.

<!-- TOC -->

- [Structure](#structure)
- [Basic Usage](#basic-usage)
- [Decoding Arguments and Return Values](#decoding-arguments-and-return-values)

<!-- /TOC -->

## Structure

A `SwiftHook` declaration is a YAML object with these top level fields:

```yaml
swiftClass: <module-qualified Swift type name>
hooks:
  - <method signature>
  - method: <method signature>
    retType: <type>                   # Optional
    params:                           # Optional
      - <parameter declaration>
```

`swiftClass` is the module-qualified Swift type that declares the method, for example `MyApp.LoginViewController`.

`hooks` is a list of Swift methods or functions to hook. Each item in `hooks` can be written in one of two forms.

Use the **short form** when you only want to hook a method and do not need argument or return value decoding.

```yaml
swiftClass: <module-qualified Swift type name>
hooks:
  - <method signature>
```

Use the **expanded form** when you want frooky to decode arguments and or the return value.

```yaml
swiftClass: <module-qualified Swift type name>
hooks:
  - method: <method signature>
    retType: <type>                   # Optional
    params:                           # Optional
      - <parameter declaration>
```

In the expanded form:

- `method`: Swift method or function signature.
- `retType`: Optional return type of the method.
- `params`: Optional list of parameter declarations.

> [!IMPORTANT]
> Read the documentation for [parameter](./parameter-declaration.md) and [return type](./return-type-declaration.md) declarations to learn how to declare and configure them correctly, once Swift hooking is implemented.
>
> There are multiple ways to declare a parameter. In this document, all examples use [named parameters](./parameter-declaration.md#named-swift-parameters).

## Basic Usage

The minimum required fields are `swiftClass` and `hooks`.

```yaml
swiftClass: <module-qualified Swift type name>
hooks:
  - <method signature>
```

**Example:**

```yaml
swiftClass: MyApp.LoginViewController
hooks:
  - "validateCredentials(username:password:)"
```

This declaration hooks the `validateCredentials(username:password:)` method of `LoginViewController` in the `MyApp` module.

## Decoding Arguments and Return Values

When a method accepts parameters or returns a value, frooky needs to know their types so it can decode them properly.

You can provide that information by declaring `retType` and or `params` for each method.

```yaml
swiftClass: <module-qualified Swift type name>
hooks:
  - method: <method signature>
    retType: <type>                   # Optional
    params:                           # Optional
      - <parameter declaration>
```

**Example:**

```yaml
swiftClass: MyApp.LoginViewController
hooks:
  - method: "validateCredentials(username:password:)"
    retType: Bool
    params:
      - [String, username]
      - [String, password]
```

Depending on the type, frooky will be able to decode arguments and return values using its built in decoders.
