import { writeFileSync } from "fs";
import path, { dirname } from "path";
import { fileURLToPath } from "url";
import { z } from "zod";

import { inputFrookyConfigSchema } from "../src/shared/inputParsing/zodSchemas/frookyConfig.zod.ts";
import { javaDecoderNameSchema, nativeDecoderNameSchema } from "../src/shared/inputParsing/zodSchemas/frookySettings.zod.ts";

const rootDir = dirname(fileURLToPath(import.meta.url));
const outPath = path.join(rootDir, "..", "..", "..", "docs", "schema", "frooky-config.schema.json");

type JsonSchemaNode = {
  type?: string;
  const?: string;
  enum?: string[];
  properties?: Record<string, JsonSchemaNode>;
  items?: JsonSchemaNode | JsonSchemaNode[];
  anyOf?: JsonSchemaNode[];
  required?: string[];
};

const jsonSchema = z.toJSONSchema(inputFrookyConfigSchema, {
  target: "draft-7",
  io: "input",
}) as unknown as JsonSchemaNode & { properties: { hookCollection: { items: { anyOf: JsonSchemaNode[] } } } };

// ts-to-zod turns InputJavaHookCollection/InputNativeHookCollection into JSON schema literally,
// but two of their fields aren't actually required in the YAML *input* format the way they are
// on the normalized TS types:
// - `type` ("java"/"native") is a TS-only discriminator. At runtime hook collections are told
//   apart by duck-typing (presence of `javaClass` vs `module`, see isJavaHookScope /
//   isNativeHookCollection), and no docs/examples/*.yaml file ever sets it.
// - a per-hook object entry's `javaClass`/`module` is always inherited from its parent
//   collection (see normalizeJavaHook/normalizeNativeHook, which overwrite it unconditionally),
//   so individual hooks only ever specify their own `method`/`symbol`/`offset`.
// Leaving these required would make the schema flag every real hook file as invalid. `classLoader` is inherited the
// same way, so it is left out of individual hooks entirely.
for (const hookCollectionVariant of jsonSchema.properties.hookCollection.items.anyOf) {
  const inheritedKey = hookCollectionVariant.required?.find((key) => key === "javaClass" || key === "module");
  hookCollectionVariant.required = hookCollectionVariant.required?.filter((key) => key !== "type");

  const hooksItems = hookCollectionVariant.properties?.hooks?.items;
  if (hooksItems && !Array.isArray(hooksItems) && hooksItems.anyOf) {
    // A detailed hook that is itself a union (native: `symbol` or `offset`) nests an anyOf
    // inside the hook's anyOf. Flatten it so each object variant is reached below.
    hooksItems.anyOf = hooksItems.anyOf.flatMap((variant) => (variant.anyOf && !variant.type ? variant.anyOf : [variant]));
  }
  const hookVariants = (!Array.isArray(hooksItems) && hooksItems?.anyOf) || [];
  for (const hookVariant of hookVariants) {
    if (hookVariant.type === "object" && inheritedKey) {
      hookVariant.required = hookVariant.required?.filter((key) => key !== inheritedKey);
      delete hookVariant.properties?.classLoader;
    }
  }
}

// DecoderSettings/HookSettings are always applied via validateAndRepairDecoderSettings /
// validateAndRepairHookSettings, which merge whatever partial object is given over the current
// defaults (see configValidator.ts) - every field is independently optional. ts-to-zod still
// marks them fully required wherever the *normalized* type (DecoderSettings/HookSettings,
// e.g. in the `[type, DecoderSettings]` tuple shorthand) is used instead of the partial
// InputDecoderSettings/InputHookSettings it's aliased from. Strip `required` from any object
// node whose own properties are exactly a decoder- or hook-settings shape, wherever it's nested.
const decoderSettingsKeys = ["maxDepth", "maxItems", "decoder", "decoderArgs", "constants", "argFilter"];
const hookSettingsKeys = ["maxStackFrames", "nativeStackTrace", "platformStackTrace", "callerFilter"];

function isExactly(propertyKeys: string[], knownKeys: string[]): boolean {
  return propertyKeys.length > 0 && propertyKeys.every((key) => knownKeys.includes(key));
}

function stripSettingsRequired(node: JsonSchemaNode | undefined, seen = new Set<JsonSchemaNode>()) {
  if (!node || typeof node !== "object" || seen.has(node)) return;
  seen.add(node);

  if (node.properties) {
    const propertyKeys = Object.keys(node.properties);
    // ParamSettings adds `direction` on top of the decoder-settings keys - still settings-shaped.
    const withoutDirection = propertyKeys.filter((key) => key !== "direction");
    if (isExactly(withoutDirection, decoderSettingsKeys) || isExactly(propertyKeys, hookSettingsKeys)) {
      delete node.required;
    }
    for (const propertySchema of Object.values(node.properties)) stripSettingsRequired(propertySchema, seen);
  }
  if (Array.isArray(node.items)) node.items.forEach((item) => stripSettingsRequired(item, seen));
  else stripSettingsRequired(node.items, seen);
  node.anyOf?.forEach((variant) => stripSettingsRequired(variant, seen));
}

stripSettingsRequired(jsonSchema);

// `decoder` is a DecoderName, the union of the Java and native decoder names, which ts-to-zod turns into nested
// anyOfs of consts. Each hook collection only accepts the decoders of its platform, so the schema offers the Java
// names below `javaClass` and the native names below `module`, and both in the top-level settings.
function decoderNames(schema: z.ZodType): string[] {
  const names = new Set<string>();
  const collect = (node: JsonSchemaNode) => {
    if (node.const !== undefined) names.add(node.const);
    node.anyOf?.forEach(collect);
  };
  collect(z.toJSONSchema(schema) as JsonSchemaNode);
  return [...names];
}

function setDecoderNames(node: JsonSchemaNode | undefined, names: string[]) {
  if (!node || typeof node !== "object") return;
  if (node.properties?.decoder) {
    node.properties.decoder = { type: "string", enum: names };
  }
  Object.values(node.properties ?? {}).forEach((propertySchema) => setDecoderNames(propertySchema, names));
  if (Array.isArray(node.items)) node.items.forEach((item) => setDecoderNames(item, names));
  else setDecoderNames(node.items, names);
  node.anyOf?.forEach((variant) => setDecoderNames(variant, names));
}

const javaDecoderNames = decoderNames(javaDecoderNameSchema);
const nativeDecoderNames = decoderNames(nativeDecoderNameSchema);
setDecoderNames(jsonSchema, [...new Set([...javaDecoderNames, ...nativeDecoderNames])]);
const hookCollectionVariants = jsonSchema.properties.hookCollection.items.anyOf;
hookCollectionVariants.forEach((variant, i) => {
  // a copy, as the variants may share nodes with the top-level settings
  const copy = structuredClone(variant);
  setDecoderNames(copy, copy.properties?.javaClass ? javaDecoderNames : nativeDecoderNames);
  hookCollectionVariants[i] = copy;
});

writeFileSync(outPath, JSON.stringify(jsonSchema, null, 2) + "\n");

console.log(`Wrote JSON schema to ${outPath}`);
