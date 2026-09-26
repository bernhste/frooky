#!/usr/bin/env node
// Validates frooky hook files against docs/schema/frooky-config.schema.json.
// Usage: node .agents/skills/write-hook-file/validate.cjs <hook.yaml> [...]
// Reuses ajv + js-yaml from frooky/agent/node_modules (run `npm ci` there first).
const { createRequire } = require("module");
const fs = require("fs");
const path = require("path");

const repoRoot = path.resolve(__dirname, "..", "..", "..");
const agentRequire = createRequire(path.join(repoRoot, "frooky", "agent", "package.json"));
const Ajv = agentRequire("ajv");
const yaml = agentRequire("js-yaml");

const schema = JSON.parse(fs.readFileSync(path.join(repoRoot, "docs", "schema", "frooky-config.schema.json"), "utf8"));
const validate = new Ajv({ allErrors: true }).compile(schema);

let failed = false;
for (const file of process.argv.slice(2)) {
  const doc = yaml.load(fs.readFileSync(file, "utf8"));
  if (validate(doc)) {
    console.log(`OK       ${file}`);
    continue;
  }
  failed = true;
  console.log(`INVALID  ${file}`);
  // anyOf failures are noisy; show the deepest paths, they point at the actual mistake
  const errors = [...validate.errors].sort((a, b) => b.dataPath.length - a.dataPath.length).slice(0, 8);
  for (const e of errors) console.log(`  ${e.dataPath || "/"} ${e.message}`);
}
process.exit(failed ? 1 : 0);
