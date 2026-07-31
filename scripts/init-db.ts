/**
 * Out-of-band migration runner (spec §6.2): creates the database file if
 * missing (SQLite) and applies pending drizzle migrations. Run before deploy —
 * never from container startup, to avoid concurrent-replica migration races.
 *
 *   npm run db:init
 */
import { loadConfig } from "../src/config.js";
import { createDbConnection, runMigrations } from "../src/db/client.js";

const config = loadConfig();
const conn = await createDbConnection(config);
await runMigrations(conn);
console.log(
  `Migrations applied (${conn.kind}) for DATABASE_URL=${
    conn.kind === "sqlite" ? config.databaseUrl : "<postgres>"
  }`,
);
await conn.close();
