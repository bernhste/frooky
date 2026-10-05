# Value Passing Java

The app implements Java / Kotlin code which passes various values to methods which in turn return the same value again.

Examples are:

1. **Primitives**
   - `int`, `long`, `short`, `byte`
   - `float`, `double`
   - `boolean`
   - `char`

1. **Strings & Text**
   - `String`
   - `CharSequence`

1. **Arrays**
   - Primitive arrays (e.g., `int[]`, `byte[]`)
   - `String[]`
   - Object arrays

1. **Collections**
   - `List` / `ArrayList`
   - `Map` / `HashMap`
   - `Set` / `HashSet`
   - `LinkedList`

1. **Android-specific / Wrapped Types**
   - `Bundle` (key-value pairs passed between components)
   - `Intent` (used to pass data between activities)
   - `Uri`
   - `Parcelable` / `Serializable` (for passing objects)
   - `Bitmap` (image data)

1. **Nullable / Optional Wrappers**
   - Boxed primitives: `Integer`, `Long`, `Float`, `Double`, `Boolean`

The methods are then called with the according arguments.

This app can be used to test frooky's built-in argument decoders.

For the examples in `docs/examples/android/`, the app also has:

- Overloads (`receiveOverloaded`), a constructor (`Secret`) and a static method (the top-level `receiveStatic`)
- Methods that write into their arguments (`fillSecret`, `toggleCase`)
- `receiveMode`, whose argument matches the constants `MODE_ENCRYPT`/`MODE_DECRYPT`
- `receiveBase64`, called with the base64 of a text and of 16 binary bytes, for `decoder: base64`
- `trackEvent`, called both directly and through `ThirdPartySdk`, for stack traces and stack trace filters
- `CloudBackup.upload` and `LocalBackup.upload`, two classes with the same method, for class wildcards
