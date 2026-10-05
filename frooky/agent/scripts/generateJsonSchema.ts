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

// `config.class` and `config.fields` read constants from a Java class, so native hooks don't offer them
function removeJavaConfigOptions(node: JsonSchemaNode | undefined) {
  if (!node || typeof node !== "object") return;
  const configOptions = node.properties?.config?.properties;
  if (configOptions) {
    delete configOptions.class;
    delete configOptions.fields;
  }
  Object.values(node.properties ?? {}).forEach(removeJavaConfigOptions);
  if (Array.isArray(node.items)) node.items.forEach(removeJavaConfigOptions);
  else removeJavaConfigOptions(node.items);
  node.anyOf?.forEach(removeJavaConfigOptions);
}

const javaDecoderNames = decoderNames(javaDecoderNameSchema);
const nativeDecoderNames = decoderNames(nativeDecoderNameSchema);
setDecoderNames(jsonSchema, [...new Set([...javaDecoderNames, ...nativeDecoderNames])]);
const hookCollectionVariants = jsonSchema.properties.hookCollection.items.anyOf;
hookCollectionVariants.forEach((variant, i) => {
  // a copy, as the variants may share nodes with the top-level settings
  const copy = structuredClone(variant);
  setDecoderNames(copy, copy.properties?.javaClass ? javaDecoderNames : nativeDecoderNames);
  if (!copy.properties?.javaClass) removeJavaConfigOptions(copy);
  hookCollectionVariants[i] = copy;
});

writeFileSync(outPath, JSON.stringify(jsonSchema, null, 2) + "\n");

console.log(`Wrote JSON schema to ${outPath}`);
