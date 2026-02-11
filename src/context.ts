import React from "react";
import type { SmithersCtx, OutputKey, InferRow } from "./types";
import { getTableName } from "drizzle-orm";
import { getTableColumns } from "drizzle-orm/utils";

export type OutputSnapshot = {
  [tableName: string]: Array<any>;
};

export function buildContext<Schema>(opts: {
  runId: string;
  iteration: number;
  iterations?: Record<string, number>;
  input: any;
  outputs: OutputSnapshot;
}): SmithersCtx<Schema> {
  const { runId, iteration, iterations, input, outputs } = opts;

  const outputsFn: any = (table: any) => {
    const name = typeof table === "string" ? table : getTableName(table);
    return outputs[name] ?? [];
  };

  for (const [name, rows] of Object.entries(outputs)) {
    outputsFn[name] = rows;
  }

  function resolveRow<T>(table: any, key: OutputKey): T | undefined {
    let name: string;
    let hasIteration: boolean;
    if (typeof table === "string") {
      name = table;
      hasIteration = true; // string-keyed tables always have iteration (auto-generated)
    } else {
      name = getTableName(table);
      const cols = getTableColumns(table as any) as Record<string, any>;
      hasIteration = Boolean(cols.iteration);
    }
    const rows = outputs[name] ?? [];
    return rows.find((row) => {
      if (row.nodeId !== key.nodeId) return false;
      if (!hasIteration) return true;
      return (row.iteration ?? 0) === (key.iteration ?? iteration);
    });
  }

  return {
    runId,
    iteration,
    iterations,
    input,
    outputs: outputsFn,
    output<T extends keyof Schema>(table: Schema[T], key: OutputKey): InferRow<Schema[T]> {
      const row = resolveRow<InferRow<Schema[T]>>(table as any, key);
      if (!row) {
        throw new Error(`Missing output for nodeId=${key.nodeId} iteration=${key.iteration ?? 0}`);
      }
      return row;
    },
    outputMaybe<T extends keyof Schema>(table: Schema[T], key: OutputKey): InferRow<Schema[T]> | undefined {
      return resolveRow<InferRow<Schema[T]>>(table as any, key);
    },
    latest(table: any, nodeId: string): any {
      const name = typeof table === "string" ? table : getTableName(table);
      const tableRows = outputs[name] ?? [];
      let best: any = undefined;
      let bestIteration = -Infinity;
      for (const row of tableRows) {
        if (!row || row.nodeId !== nodeId) continue;
        const iter = Number.isFinite(Number(row.iteration)) ? Number(row.iteration) : 0;
        if (!best || iter >= bestIteration) {
          best = row;
          bestIteration = iter;
        }
      }
      return best;
    },
    latestArray(value: unknown, schema: import("zod").ZodType): any[] {
      if (value == null) return [];
      let arr: unknown[];
      if (typeof value === "string") {
        try {
          const parsed = JSON.parse(value);
          arr = Array.isArray(parsed) ? parsed : [parsed];
        } catch {
          return [];
        }
      } else if (Array.isArray(value)) {
        arr = value;
      } else {
        arr = [value];
      }
      const result: any[] = [];
      for (const item of arr) {
        const parsed = schema.safeParse(item);
        if (parsed.success) {
          result.push(parsed.data);
        }
      }
      return result;
    },
    iterationCount(table: any, nodeId: string): number {
      const name = typeof table === "string" ? table : getTableName(table);
      const tableRows = outputs[name] ?? [];
      const seen = new Set<number>();
      for (const row of tableRows) {
        if (!row || row.nodeId !== nodeId) continue;
        const iter = Number.isFinite(Number(row.iteration)) ? Number(row.iteration) : 0;
        seen.add(iter);
      }
      return seen.size;
    },
  };
}

export function createSmithersContext<Schema>() {
  const SmithersContext = React.createContext<SmithersCtx<Schema> | null>(null);

  function useCtx(): SmithersCtx<Schema> {
    const ctx = React.useContext(SmithersContext);
    if (!ctx) {
      throw new Error("useCtx() must be called inside a <Workflow> created by createSmithers()");
    }
    return ctx;
  }

  return { SmithersContext, useCtx };
}
