import { writeFileSync } from "fs";
import path, { dirname } from "path";
import { fileURLToPath } from "url";
import { z } from "zod";

import { inputFrookyConfigSchema } from "../src/shared/inputParsing/zodSchemas/frookyConfig.zod.ts";

const rootDir = dirname(fileURLToPath(import.meta.url));
const outPath = path.join(rootDir, "..", "..", "..", "docs", "schema", "frooky-config.schema.json");

type JsonSchemaNode = {
  type?: string;
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
//   so individual hooks only ever specify their own `method`/`symbol`.
// Leaving these required would make the schema flag every real hook file as invalid.
for (const hookCollectionVariant of jsonSchema.properties.hookCollection.items.anyOf) {
  const inheritedKey = hookCollectionVariant.required?.find((key) => key === "javaClass" || key === "module");
  hookCollectionVariant.required = hookCollectionVariant.required?.filter((key) => key !== "type");

  const hooksItems = hookCollectionVariant.properties?.hooks?.items;
  const hookVariants = (!Array.isArray(hooksItems) && hooksItems?.anyOf) || [];
  for (const hookVariant of hookVariants) {
    if (hookVariant.type === "object" && inheritedKey) {
      hookVariant.required = hookVariant.required?.filter((key) => key !== inheritedKey);
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
const decoderSettingsKeys = ["maxDepth", "maxItems", "hashCode", "decoder", "decoderArg", "argFilter"];
const hookSettingsKeys = ["stackTraceLimit", "stackTraceFilter"];

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

writeFileSync(outPath, JSON.stringify(jsonSchema, null, 2) + "\n");

console.log(`Wrote JSON schema to ${outPath}`);
