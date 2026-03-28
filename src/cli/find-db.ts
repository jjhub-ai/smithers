import { resolve, dirname } from "node:path";
import { existsSync } from "node:fs";
import { SmithersDb } from "../db/adapter";
import { ensureSmithersTables } from "../db/ensure";

/**
 * Walk from `from` (default: cwd) upward looking for smithers.db.
 * Returns the absolute path to the database file.
 */
export function findSmithersDb(from?: string): string {
  let dir = resolve(from ?? process.cwd());
  const root = resolve("/");
  while (true) {
    const candidate = resolve(dir, "smithers.db");
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir || dir === root) {
      throw new Error(
        "No smithers.db found. Run this command from a directory containing a smithers.db, or use 'smithers up <workflow>' to start a run first.",
      );
    }
    dir = parent;
  }
}

/**
 * Open a smithers.db file and return a SmithersDb adapter with cleanup function.
 */
export async function openSmithersDb(dbPath: string): Promise<{ adapter: SmithersDb; cleanup: () => void }> {
  const { Database } = await import("bun:sqlite");
  const { drizzle } = await import("drizzle-orm/bun-sqlite");
  const sqlite = new Database(dbPath);
  const db = drizzle(sqlite);
  ensureSmithersTables(db as any);
  return {
    adapter: new SmithersDb(db as any),
    cleanup: () => {
      try { sqlite.close(); } catch {}
    },
  };
}

/**
 * Find and open the nearest smithers.db.
 */
export async function findAndOpenDb(from?: string): Promise<{ adapter: SmithersDb; dbPath: string; cleanup: () => void }> {
  const dbPath = findSmithersDb(from);
  const { adapter, cleanup } = await openSmithersDb(dbPath);
  return { adapter, dbPath, cleanup };
}
