import { mkdir } from "node:fs/promises";
import path from "node:path";
import BetterSqlite3 from "better-sqlite3";
import pg from "pg";
import { drizzle as drizzleSqlite, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { migrate as migrateSqlite } from "drizzle-orm/better-sqlite3/migrator";
import { drizzle as drizzlePg, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { migrate as migratePg } from "drizzle-orm/node-postgres/migrator";
import type { AppConfig } from "../config.js";
import { PACKAGE_ROOT } from "../paths.js";
import * as sqliteSchema from "./schema.sqlite.js";
import * as pgSchema from "./schema.pg.js";

export type DbConnection =
  | {
      kind: "sqlite";
      db: BetterSQLite3Database;
      renders: typeof sqliteSchema.renders;
      close: () => Promise<void>;
    }
  | {
      kind: "pg";
      db: NodePgDatabase;
      renders: typeof pgSchema.renders;
      pool: pg.Pool;
      close: () => Promise<void>;
    };

export function isPostgresUrl(url: string): boolean {
  // Accept SQLAlchemy-style scheme variants (postgresql+asyncpg://...) so a
  // DATABASE_URL carried over from the Python app works unchanged.
  return /^postgres(ql)?(\+[a-z0-9]+)?:\/\//i.test(url);
}

export interface NormalizedPgConfig {
  connectionString: string;
  ssl: pg.PoolConfig["ssl"];
}

/**
 * Normalize a Python-style URL for node-postgres (spec §6.2): strip the
 * `+driver` scheme suffix and the libpq-style ssl/sslmode query params, and
 * express TLS via an explicit ssl option instead. libpq's `require` means
 * "encrypt, don't verify", hence rejectUnauthorized: false for that case;
 * production without an explicit param still defaults to TLS.
 */
export function normalizePostgresUrl(url: string, production: boolean): NormalizedPgConfig {
  const cleaned = url.replace(/^postgres(ql)?\+[a-z0-9]+:\/\//i, "postgresql://");
  const parsed = new URL(cleaned);
  const sslParam = (
    parsed.searchParams.get("ssl") ??
    parsed.searchParams.get("sslmode") ??
    ""
  ).toLowerCase();
  parsed.searchParams.delete("ssl");
  parsed.searchParams.delete("sslmode");

  let ssl: pg.PoolConfig["ssl"];
  if (["require", "true", "1", "prefer", "allow"].includes(sslParam)) {
    ssl = { rejectUnauthorized: false };
  } else if (["verify-ca", "verify-full"].includes(sslParam)) {
    ssl = true;
  } else if (sslParam === "disable" || sslParam === "false") {
    ssl = undefined;
  } else {
    // No explicit param: always TLS against production Postgres (spec §6.2).
    ssl = production ? { rejectUnauthorized: false } : undefined;
  }
  return { connectionString: parsed.toString(), ssl };
}

export async function createDbConnection(config: AppConfig): Promise<DbConnection> {
  if (isPostgresUrl(config.databaseUrl)) {
    const { connectionString, ssl } = normalizePostgresUrl(
      config.databaseUrl,
      config.environment === "production",
    );
    const pool = new pg.Pool({ connectionString, ssl });
    return {
      kind: "pg",
      db: drizzlePg(pool),
      renders: pgSchema.renders,
      pool,
      close: () => pool.end(),
    };
  }

  const filePath = config.databaseUrl.replace(/^sqlite:/, "");
  await mkdir(path.dirname(path.resolve(filePath)), { recursive: true });
  const sqlite = new BetterSqlite3(filePath);
  sqlite.pragma("journal_mode = WAL");
  return {
    kind: "sqlite",
    db: drizzleSqlite(sqlite),
    renders: sqliteSchema.renders,
    close: async () => {
      sqlite.close();
    },
  };
}

/**
 * Apply migrations. In production this must be run out-of-band via
 * scripts/init-db.ts before deploy — never at container startup (spec §6.2,
 * concurrent-replica migration races). Dev startup may call it directly as the
 * auto-create shortcut.
 */
export async function runMigrations(conn: DbConnection): Promise<void> {
  if (conn.kind === "sqlite") {
    migrateSqlite(conn.db, { migrationsFolder: path.join(PACKAGE_ROOT, "drizzle", "sqlite") });
  } else {
    await migratePg(conn.db, { migrationsFolder: path.join(PACKAGE_ROOT, "drizzle", "pg") });
  }
}
