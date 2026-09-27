// Generates convex/_generated without a Convex deployment, using Convex's own codegen templates.
// `npx convex dev` / `npx convex deploy` regenerate these files for real; this script only keeps
// type-checking working before a deployment exists (e.g. in CI or a fresh clone).
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";

const require = createRequire(import.meta.url);
// Deep paths are not in convex's package "exports", so resolve the files directly.
const convexPkgDir = path.dirname(require.resolve("convex/package.json", { paths: [process.cwd()] }));
const tpl = (name) => require(path.join(convexPkgDir, "dist/cjs/cli/codegen_templates", `${name}.js`));
const { apiCodegen } = tpl("api");
const { serverCodegen } = tpl("server");
const { header } = tpl("common");

// Same content as Convex's "dynamic" data model template (dataModel.js pulls CLI-only deps, so it is inlined).
const dynamicDataModelDTS = () => `${header("Generated data model types.")}
import type { DataModelFromSchemaDefinition, DocumentByName, TableNamesInDataModel, SystemTableNames } from "convex/server";
import type { GenericId } from "convex/values";
import schema from "../schema.js";

/** The names of all of your Convex tables. */
export type TableNames = TableNamesInDataModel<DataModel>;

/** The type of a document stored in Convex. */
export type Doc<TableName extends TableNames> = DocumentByName<DataModel, TableName>;

/** An identifier for a document in Convex. */
export type Id<TableName extends TableNames | SystemTableNames> = GenericId<TableName>;

/** A type describing your Convex data model. */
export type DataModel = DataModelFromSchemaDefinition<typeof schema>;
`;

const convexDir = path.resolve("convex");
const genDir = path.join(convexDir, "_generated");
const EXT = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"];

function walk(dir, rel = "") {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const relPath = path.posix.join(rel, entry.name);
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (relPath === "_generated" || relPath.startsWith("_deps")) continue;
      if (fs.existsSync(path.join(abs, "convex.config.ts"))) continue;
      out.push(...walk(abs, relPath));
      continue;
    }
    const base = entry.name;
    if (!EXT.some((e) => base.endsWith(e))) continue;
    if (base.startsWith(".") || base.startsWith("#")) continue;
    if (base === "schema.ts" || base === "schema.js") continue;
    if ((base.match(/\./g) || []).length > 1) continue;
    if (relPath.includes(" ")) continue;
    if (/\.tsx?$/.test(base)) {
      const src = fs.readFileSync(abs, "utf8");
      if (!/^\s{0,100}(import|export)/m.test(src)) continue;
    }
    out.push(relPath);
  }
  return out;
}

const modules = walk(convexDir).sort();
fs.mkdirSync(genDir, { recursive: true });
const api = apiCodegen(modules, { useTypeScript: false });
fs.writeFileSync(path.join(genDir, "api.d.ts"), api.DTS);
fs.writeFileSync(path.join(genDir, "api.js"), api.JS);
const server = serverCodegen({ useTypeScript: false });
fs.writeFileSync(path.join(genDir, "server.d.ts"), server.DTS);
fs.writeFileSync(path.join(genDir, "server.js"), server.JS);
if (!fs.existsSync(path.join(convexDir, "schema.ts"))) throw new Error("convex/schema.ts is required");
fs.writeFileSync(path.join(genDir, "dataModel.d.ts"), dynamicDataModelDTS());
console.log(`convex/_generated written for ${modules.length} module(s): ${modules.join(", ")}`);
