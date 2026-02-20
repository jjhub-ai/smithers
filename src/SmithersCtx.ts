import type { OutputKey } from "./OutputKey";
import type { OutputAccessor, InferOutputEntry } from "./OutputAccessor";

export interface SmithersCtx<Schema> {
  runId: string;
  iteration: number;
  iterations?: Record<string, number>;
  input: Schema extends { input: infer T } ? T : Record<string, unknown>;
  outputs: OutputAccessor<Schema>;

  output<K extends keyof Schema & string>(
    table: K | Schema[K],
    key: OutputKey,
  ): InferOutputEntry<Schema[K]>;

  outputMaybe<K extends keyof Schema & string>(
    table: K | Schema[K],
    key: OutputKey,
  ): InferOutputEntry<Schema[K]> | undefined;

  latest<K extends keyof Schema & string>(
    table: K | Schema[K],
    nodeId: string,
  ): InferOutputEntry<Schema[K]> | undefined;

  latestArray(value: unknown, schema: import("zod").ZodType): any[];

  iterationCount(table: any, nodeId: string): number;
}
