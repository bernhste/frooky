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
  pattern?: string;
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

// `type` ("java"/"native") is a TS-only discriminator. Hook collections are told apart by duck-typing (`javaClass` vs
// `module`, see isJavaHookScope / isNativeHookCollection), so hook files never set it.
for (const hookCollectionVariant of jsonSchema.properties.hookCollection.items.anyOf) {
  hookCollectionVariant.required = hookCollectionVariant.required?.filter((key) => key !== "type");
}

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

// `config.constants` is a map of names to values, or in a Java hook also a class with an optional pattern for its
// fields, e.g. `javax.crypto.Cipher#*_MODE` (see parseConstantsClass()). Native hooks only get the map.
const CONSTANTS_CLASS_PATTERN = "^[\\w$]+(\\.[\\w$]+)*(#[\\w$*]+)?$";

function setConstantsForms(node: JsonSchemaNode | undefined, allowClass: boolean) {
  if (!node || typeof node !== "object") return;
  const constants = node.properties?.config?.properties?.constants;
  if (constants?.anyOf) {
    const classForm = constants.anyOf.find((form) => form.type === "string");
    if (classForm) classForm.pattern = CONSTANTS_CLASS_PATTERN;
    constants.anyOf = constants.anyOf.filter((form) => allowClass || form.type !== "string");
  }
  Object.values(node.properties ?? {}).forEach((propertySchema) => setConstantsForms(propertySchema, allowClass));
  if (Array.isArray(node.items)) node.items.forEach((item) => setConstantsForms(item, allowClass));
  else setConstantsForms(node.items, allowClass);
  node.anyOf?.forEach((variant) => setConstantsForms(variant, allowClass));
}

const javaDecoderNames = decoderNames(javaDecoderNameSchema);
const nativeDecoderNames = decoderNames(nativeDecoderNameSchema);
setDecoderNames(jsonSchema, [...new Set([...javaDecoderNames, ...nativeDecoderNames])]);
const hookCollectionVariants = jsonSchema.properties.hookCollection.items.anyOf;
hookCollectionVariants.forEach((variant, i) => {
  // a copy, as the variants may share nodes with the top-level settings
  const copy = structuredClone(variant);
  setDecoderNames(copy, copy.properties?.javaClass ? javaDecoderNames : nativeDecoderNames);
  setConstantsForms(copy, Boolean(copy.properties?.javaClass));
  hookCollectionVariants[i] = copy;
});

writeFileSync(outPath, JSON.stringify(jsonSchema, null, 2) + "\n");

console.log(`Wrote JSON schema to ${outPath}`);
