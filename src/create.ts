import type {
  SmithersWorkflow,
  SmithersWorkflowOptions,
  SchemaRegistryEntry,
} from "./types";
import type { SmithersCtx, WorkflowProps } from "./types";
import { Database } from "bun:sqlite";
import { drizzle, type BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import { sqliteTable, text } from "drizzle-orm/sqlite-core";
import React from "react";
import { createSmithersContext } from "./context";
import { Workflow as BaseWorkflow, Task as BaseTask } from "./components";
import type { TaskProps } from "./types";
import { getTableName } from "drizzle-orm";
import { zodToTable, zodToCreateTableSQL, camelToSnake } from "./zod-to-table";
import type { z } from "zod";

export type CreateSmithersApi<Schema = any> = {
  Workflow: (props: WorkflowProps) => React.ReactElement;
  Task: <Row>(props: TaskProps<Row>) => React.ReactElement;
  useCtx: () => SmithersCtx<Schema>;
  smithers: (
    build: (ctx: SmithersCtx<Schema>) => React.ReactElement,
    opts?: SmithersWorkflowOptions,
  ) => SmithersWorkflow<Schema>;
  db: BunSQLiteDatabase<any>;
  tables: { [K in keyof Schema]: any };
};

/**
 * Schema-driven API — users define only Zod schemas, the framework owns the entire storage layer.
 *
 * @example
 * ```ts
 * const { Workflow, useCtx, smithers } = createSmithers({
 *   discover: discoverOutputSchema,
 *   research: researchOutputSchema,
 * });
 *
 * export default smithers((ctx) => (
 *   <Workflow name="my-workflow">
 *     <Task id="discover" output="discover" agent={myAgent}>...</Task>
 *   </Workflow>
 * ));
 * ```
 */
export function createSmithers<
  Schemas extends Record<string, z.ZodObject<any>>,
>(
  schemas: Schemas,
  opts?: { dbPath?: string; journalMode?: string },
): CreateSmithersApi<Schemas> {
  // 1. Generate Drizzle tables from Zod schemas
  const tables: Record<string, any> = {};
  const inputTable = sqliteTable("input", {
    runId: text("run_id").primaryKey(),
    payload: text("payload", { mode: "json" }).$type<Record<string, unknown>>(),
  });

  for (const [name, zodSchema] of Object.entries(schemas)) {
    const tableName = camelToSnake(name);
    tables[name] = zodToTable(tableName, zodSchema);
  }

  // 2. Create SQLite db
  const dbPath = opts?.dbPath ?? "./smithers.db";
  const sqlite = new Database(dbPath);
  sqlite.exec(`PRAGMA journal_mode = ${opts?.journalMode ?? "WAL"}`);
  sqlite.exec("PRAGMA foreign_keys = ON");

  // 3. Auto-create tables using CREATE TABLE IF NOT EXISTS
  sqlite.exec(
    `CREATE TABLE IF NOT EXISTS "input" (run_id TEXT PRIMARY KEY, payload TEXT)`,
  );
  try {
    const cols = sqlite.query(`PRAGMA table_info("input")`).all() as Array<{
      name?: string;
    }>;
    const hasPayload = cols.some((col) => col?.name === "payload");
    if (!hasPayload) {
      sqlite.exec(`ALTER TABLE "input" ADD COLUMN payload TEXT`);
    }
  } catch {
    // ignore - older SQLite or permission issues; input payload remains best-effort
  }

  for (const [name, zodSchema] of Object.entries(schemas)) {
    const tableName = camelToSnake(name);
    const ddl = zodToCreateTableSQL(tableName, zodSchema);
    sqlite.exec(ddl);
  }

  // 4. Create Drizzle instance with all tables in the schema
  const drizzleSchema: Record<string, any> = { input: inputTable };
  for (const [key, table] of Object.entries(tables)) {
    drizzleSchema[key] = table;
  }
  const db = drizzle(sqlite, { schema: drizzleSchema });

  // 5. Build schema registry for engine resolution of string output keys
  const schemaRegistry = new Map<string, SchemaRegistryEntry>();
  for (const [name, zodSchema] of Object.entries(schemas)) {
    schemaRegistry.set(name, { table: tables[name], zodSchema });
  }

  // 6. Build reverse lookup: Drizzle table name → Zod schema
  const tableNameToZodSchema = new Map<string, z.ZodObject<any>>();
  for (const [name, zodSchema] of Object.entries(schemas)) {
    const tableName = camelToSnake(name);
    tableNameToZodSchema.set(tableName, zodSchema);
    // Also map the original key name for string-keyed outputs
    tableNameToZodSchema.set(name, zodSchema);
  }

  // 7. Context + hooks
  const { SmithersContext, useCtx } = createSmithersContext<any>();
  const ctxRef = { current: null as SmithersCtx<any> | null };

  function Workflow(props: WorkflowProps) {
    return React.createElement(
      SmithersContext.Provider,
      { value: ctxRef.current },
      React.createElement(BaseWorkflow, props, props.children),
    );
  }

  /**
   * Task wrapper that auto-injects outputSchema from the schema registry
   * when output is a Drizzle table or string key and outputSchema is not
   * explicitly provided.
   */
  function Task<Row>(props: TaskProps<Row>) {
    if (!props.outputSchema && props.output) {
      let tableName: string | undefined;
      if (typeof props.output === "string") {
        tableName = props.output;
      } else {
        try {
          tableName = getTableName(props.output as any);
        } catch {}
      }
      if (tableName) {
        const zodSchema = tableNameToZodSchema.get(tableName);
        if (zodSchema) {
          return React.createElement(BaseTask, {
            ...props,
            outputSchema: zodSchema,
          } as any);
        }
      }
    }
    return React.createElement(BaseTask, props as any);
  }

  function boundSmithers(
    build: (ctx: SmithersCtx<any>) => React.ReactElement,
    smithersOpts?: SmithersWorkflowOptions,
  ): SmithersWorkflow<any> {
    return {
      db,
      build: (ctx: SmithersCtx<any>) => {
        ctxRef.current = ctx;
        return build(ctx);
      },
      opts: smithersOpts ?? {},
      schemaRegistry,
    } as SmithersWorkflow<any>;
  }

  return {
    Workflow,
    Task,
    useCtx,
    smithers: boundSmithers,
    db,
    tables: tables as { [K in keyof Schemas]: any },
  };
}
