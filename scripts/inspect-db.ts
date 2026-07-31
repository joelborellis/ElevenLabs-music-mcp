/**
 * Read-only inspection of the configured database: lists tables and, if a
 * `renders` table exists, its columns. Useful before running db:init against
 * a database that may already contain the Python app's schema.
 *
 *   npx tsx scripts/inspect-db.ts
 */
import pg from "pg";
import { loadConfig } from "../src/config.js";
import { isPostgresUrl, normalizePostgresUrl } from "../src/db/client.js";

const config = loadConfig();
if (!isPostgresUrl(config.databaseUrl)) {
  console.log(`DATABASE_URL is SQLite (${config.databaseUrl}) — nothing to inspect remotely.`);
  process.exit(0);
}

const { connectionString, ssl } = normalizePostgresUrl(
  config.databaseUrl,
  config.environment === "production",
);
const client = new pg.Client({ connectionString, ssl, connectionTimeoutMillis: 15_000 });
await client.connect();
try {
  const tables = await client.query(
    "select table_name from information_schema.tables where table_schema='public' order by table_name",
  );
  console.log("tables:", tables.rows.map((r) => r.table_name).join(", ") || "(none)");
  const cols = await client.query(
    "select column_name, data_type, is_nullable from information_schema.columns where table_schema='public' and table_name='renders' order by ordinal_position",
  );
  for (const row of cols.rows) {
    console.log(`  renders.${row.column_name}: ${row.data_type} nullable=${row.is_nullable}`);
  }
  if (cols.rows.length > 0) {
    const idx = await client.query(
      "select indexname from pg_indexes where schemaname='public' and tablename='renders' order by indexname",
    );
    console.log("indexes:", idx.rows.map((r) => r.indexname).join(", "));
    const count = await client.query("select count(*)::int as n from renders");
    console.log("row count:", count.rows[0].n);
  }
} finally {
  await client.end();
}
