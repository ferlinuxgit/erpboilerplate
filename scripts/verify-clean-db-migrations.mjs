#!/usr/bin/env node

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";

const root = process.cwd();
const drizzleDir = path.join(root, "drizzle");
const schemaPath = path.join(root, "src/db/schema.ts");

function splitStatements(sql) {
  return sql
    .split(/-->\s*statement-breakpoint/g)
    .map((statement) => statement.trim())
    .filter(Boolean);
}

function extractPgTables(schemaSource) {
  return [...schemaSource.matchAll(/pgTable\(\s*["`]([^"`]+)["`]/g)]
    .map((match) => match[1])
    .sort();
}

async function main() {
  const journalPath = path.join(drizzleDir, "meta/_journal.json");
  const journal = JSON.parse(await readFile(journalPath, "utf8"));
  const migrationTags = journal.entries.map((entry) => entry.tag);
  const sqlFiles = (await readdir(drizzleDir))
    .filter((file) => file.endsWith(".sql"))
    .map((file) => path.basename(file, ".sql"))
    .sort();

  const missingFromJournal = sqlFiles.filter((file) => !migrationTags.includes(file));
  const missingSqlFiles = migrationTags.filter((tag) => !sqlFiles.includes(tag));
  if (missingFromJournal.length || missingSqlFiles.length) {
    throw new Error(
      `Migration journal mismatch. Missing from journal: ${missingFromJournal.join(", ") || "none"}. Missing SQL files: ${missingSqlFiles.join(", ") || "none"}.`,
    );
  }

  const db = new PGlite();
  try {
    for (const tag of migrationTags) {
      const sql = await readFile(path.join(drizzleDir, `${tag}.sql`), "utf8");
      for (const statement of splitStatements(sql)) {
        await db.exec(statement);
      }
    }

    const expectedTables = extractPgTables(await readFile(schemaPath, "utf8"));
    const { rows } = await db.query(
      "select tablename from pg_catalog.pg_tables where schemaname = 'public' order by tablename",
    );
    const actualTables = rows.map((row) => row.tablename).sort();
    const missingTables = expectedTables.filter((table) => !actualTables.includes(table));

    if (missingTables.length) {
      throw new Error(`Clean migration completed but missed schema tables: ${missingTables.join(", ")}`);
    }

    console.log(
      `Clean migration verification passed: ${migrationTags.length} migration(s), ${actualTables.length} public table(s).`,
    );
  } finally {
    await db.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
