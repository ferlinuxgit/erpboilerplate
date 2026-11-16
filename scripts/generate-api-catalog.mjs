#!/usr/bin/env node
/**
 * Catálogo de TODA la API del ERP (lo usan el servidor MCP y /api/openapi.json): recorre
 * src/app/api/**\/route.ts y, por cada método exportado, extrae ruta, parámetros, permiso,
 * parámetros de consulta, descripción (comentario de la función o del fichero) y el texto de los
 * esquemas zod que validan el cuerpo (de la propia ruta o del módulo del que se importan).
 *
 * Uso: node scripts/generate-api-catalog.mjs         (escribe src/server/mcp/api-catalog.generated.json)
 *      node scripts/generate-api-catalog.mjs --check (falla si el fichero no está al día)
 */
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const API_DIR = path.join(ROOT, "src/app/api");
const OUTPUT = path.join(ROOT, "src/server/mcp/api-catalog.generated.json");
const MAX_SCHEMA_CHARS = 2400;

function walk(dir) {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) return walk(full);
    return entry === "route.ts" ? [full] : [];
  });
}

function apiPath(file) {
  const relative = path.relative(path.join(ROOT, "src/app"), path.dirname(file)).split(path.sep);
  return `/${relative
    .filter((segment) => !(segment.startsWith("(") && segment.endsWith(")")))
    .map((segment) => segment.replace(/^\[\[?\.\.\.(\w+)\]?\]$/, "{$1*}").replace(/^\[(\w+)\]$/, "{$1}"))
    .join("/")}`;
}

/** Comentario (JSDoc o líneas //) inmediatamente anterior a `index`. */
function commentBefore(source, index) {
  const before = source.slice(0, index).replace(/\s+$/, "");
  if (before.endsWith("*/")) {
    const start = before.lastIndexOf("/**");
    if (start >= 0) return cleanComment(before.slice(start));
  }
  const lines = before.split("\n");
  const collected = [];
  for (let i = lines.length - 1; i >= 0 && lines[i].trim().startsWith("//"); i -= 1) collected.unshift(lines[i].trim().replace(/^\/\/\s?/, ""));
  return collected.join(" ").trim();
}

function cleanComment(text) {
  return text
    .replace(/^\/\*\*?/, "")
    .replace(/\*\/$/, "")
    .split("\n")
    .map((line) => line.replace(/^\s*\*\s?/, "").trim())
    .filter((line) => line && !line.startsWith("```"))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Cuerpo de cada handler: desde su `export` hasta el siguiente `export` de nivel superior. */
function handlers(source) {
  const pattern = /^export\s+(?:async\s+)?(?:function\s+(GET|POST|PUT|PATCH|DELETE)\b|const\s+(GET|POST|PUT|PATCH|DELETE)\s*=)/gm;
  const found = [];
  for (const match of source.matchAll(pattern)) found.push({ method: match[1] ?? match[2], index: match.index });
  return found.map((entry, position) => ({ ...entry, body: source.slice(entry.index, found[position + 1]?.index ?? source.length) }));
}

/** Imports con nombre: identificador → ruta del módulo. */
function namedImports(source, file) {
  const map = new Map();
  for (const match of source.matchAll(/import\s*\{([^}]+)\}\s*from\s*["']([^"']+)["']/g)) {
    const resolved = resolveModule(match[2], file);
    if (!resolved) continue;
    for (const name of match[1].split(",").map((part) => part.trim().replace(/^type\s+/, "").split(/\s+as\s+/).pop()).filter(Boolean)) map.set(name, resolved);
  }
  return map;
}

function resolveModule(specifier, fromFile) {
  let base;
  if (specifier.startsWith("@/")) base = path.join(ROOT, "src", specifier.slice(2));
  else if (specifier.startsWith(".")) base = path.resolve(path.dirname(fromFile), specifier);
  else return null;
  for (const candidate of [`${base}.ts`, `${base}.tsx`, path.join(base, "index.ts")]) if (existsSync(candidate)) return candidate;
  return null;
}

/** Texto de la declaración `const name = …;` (paréntesis y llaves equilibrados). */
function declarationText(source, name) {
  const match = new RegExp(`(?:export\\s+)?const\\s+${name}\\s*(?::[^=]+)?=\\s*`, "m").exec(source);
  if (!match) return null;
  let depth = 0;
  let index = match.index + match[0].length;
  const start = match.index;
  for (; index < source.length; index += 1) {
    const char = source[index];
    if (char === "(" || char === "{" || char === "[") depth += 1;
    else if (char === ")" || char === "}" || char === "]") depth -= 1;
    else if (char === ";" && depth === 0) break;
    else if (char === "\n" && depth === 0 && /^\s*(export|const|function|async|type|\/\*\*)/.test(source.slice(index + 1, index + 40))) break;
  }
  return source.slice(start, index).replace(/^export\s+/, "").trim();
}

const fileCache = new Map();
function readSource(file) {
  if (!fileCache.has(file)) fileCache.set(file, readFileSync(file, "utf8"));
  return fileCache.get(file);
}

/** Esquema usado por el handler (+ esquemas que menciona de su mismo módulo, un nivel). */
function schemaTexts(name, routeSource, routeFile, imports) {
  const sourceFile = imports.get(name) ?? routeFile;
  const source = sourceFile === routeFile ? routeSource : readSource(sourceFile);
  const text = declarationText(source, name);
  if (!text) return [];
  const texts = [{ name, text }];
  for (const dependency of new Set([...text.matchAll(/\b([a-zA-Z]+Schema)\b/g)].map((match) => match[1]))) {
    if (dependency === name) continue;
    const dependencyModule = sourceFile === routeFile ? imports.get(dependency) ?? routeFile : namedImports(source, sourceFile).get(dependency) ?? sourceFile;
    const dependencyText = declarationText(dependencyModule === routeFile ? routeSource : readSource(dependencyModule), dependency);
    if (dependencyText) texts.push({ name: dependency, text: dependencyText });
  }
  return texts;
}

function truncate(text, max) {
  return text.length > max ? `${text.slice(0, max)} …` : text;
}

const PERMISSION_PATTERNS = [
  /require(?:Api)?Context\(\s*"([a-zA-Z]+\.[a-zA-Z]+)"/g,
  /requirePermission\(\s*"([a-zA-Z]+\.[a-zA-Z]+)"/g,
  /hasApiActorPermission\([^,]+,\s*"([a-zA-Z]+\.[a-zA-Z]+)"/g,
  /\bcan\([^,]+,\s*"([a-zA-Z]+\.[a-zA-Z]+)"/g,
  /require[A-Z]\w*Access\(\s*"([a-zA-Z]+\.[a-zA-Z]+)"/g,
];

export function buildCatalog() {
  const entries = [];
  for (const file of walk(API_DIR).sort()) {
    const source = readSource(file);
    const routePath = apiPath(file);
    const imports = namedImports(source, file);
    const fileComment = (() => {
      const first = source.indexOf("export ");
      const header = source.slice(0, first);
      const block = header.lastIndexOf("/**");
      return block >= 0 ? cleanComment(header.slice(block, header.indexOf("*/", block) + 2)) : "";
    })();
    for (const handler of handlers(source)) {
      const permissions = [...new Set(PERMISSION_PATTERNS.flatMap((pattern) => [...handler.body.matchAll(pattern)].map((match) => match[1])))];
      const query = [...new Set([...handler.body.matchAll(/searchParams\.get\(\s*"([^"]+)"\s*\)/g)].map((match) => match[1]))];
      if (/parseListParams\(/.test(handler.body)) query.push("page", "pageSize", "q", "sort", "dir");
      const schemaNames = [...new Set([...handler.body.matchAll(/\b([a-zA-Z]+(?:Schema|schema))\.(?:safeParse|parse)\(/g)].map((match) => match[1]))];
      const schemas = schemaNames.flatMap((name) => schemaTexts(name, source, file, imports));
      const summary = commentBefore(source, handler.index) || fileComment;
      entries.push({
        method: handler.method,
        path: routePath,
        area: routePath.split("/")[2] ?? "",
        summary: truncate(summary, 600),
        permissions,
        ...(query.length ? { query: [...new Set(query)] } : {}),
        ...(schemas.length ? { body: truncate(schemas.map((schema) => schema.text).join("\n\n"), MAX_SCHEMA_CHARS) } : {}),
        ...(/multipart\/form-data|formData\(\)/.test(handler.body) ? { multipart: true } : {}),
      });
    }
  }
  return entries;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const content = `${JSON.stringify(buildCatalog(), null, 1)}\n`;
  if (process.argv.includes("--check")) {
    const current = existsSync(OUTPUT) ? readFileSync(OUTPUT, "utf8") : "";
    if (current !== content) {
      console.error("api-catalog.generated.json no está al día: ejecuta `npm run api:catalog`.");
      process.exit(1);
    }
    console.log("Catálogo de la API al día.");
  } else {
    writeFileSync(OUTPUT, content);
    console.log(`Catálogo de la API: ${JSON.parse(content).length} acciones → ${path.relative(ROOT, OUTPUT)}`);
  }
}
