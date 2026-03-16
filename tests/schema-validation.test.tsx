/** @jsxImportSource smithers */
import { describe, expect, test } from "bun:test";
import { Workflow, Task, runWorkflow } from "../src/index";
import { createTestSmithers } from "./helpers";
import { z } from "zod";

describe("schema validation", () => {
  test("static payload with wrong type fails validation", async () => {
    const { smithers, outputs, cleanup } = createTestSmithers({
      out: z.object({ count: z.number() }),
    });

    const workflow = smithers(() => (
      <Workflow name="bad-type">
        <Task id="t" output={outputs.out}>
          {{ count: "not-a-number" }}
        </Task>
      </Workflow>
    ));

    const r = await runWorkflow(workflow, { input: {} });
    expect(r.status).toBe("failed");
    cleanup();
  });

  test("static payload with missing required field fails", async () => {
    const { smithers, outputs, cleanup } = createTestSmithers({
      out: z.object({ name: z.string(), age: z.number() }),
    });

    const workflow = smithers(() => (
      <Workflow name="missing-field">
        <Task id="t" output={outputs.out}>
          {{ name: "test" }}
        </Task>
      </Workflow>
    ));

    const r = await runWorkflow(workflow, { input: {} });
    expect(r.status).toBe("failed");
    cleanup();
  });

  test("compute callback with valid schema succeeds", async () => {
    const { smithers, outputs, tables, db, cleanup } = createTestSmithers({
      out: z.object({ name: z.string(), score: z.number() }),
    });

    const workflow = smithers(() => (
      <Workflow name="valid-compute">
        <Task id="t" output={outputs.out}>
          {() => ({ name: "test", score: 95 })}
        </Task>
      </Workflow>
    ));

    const r = await runWorkflow(workflow, { input: {} });
    expect(r.status).toBe("finished");
    const rows = (db as any).select().from(tables.out).all();
    expect(rows[0].name).toBe("test");
    expect(rows[0].score).toBe(95);
    cleanup();
  });

  test("agent schema retry parses text on second attempt", async () => {
    const { smithers, outputs, tables, db, cleanup } = createTestSmithers({
      out: z.object({ val: z.number() }),
    });

    let calls = 0;
    const agent: any = {
      id: "schema-retry",
      tools: {},
      generate: async () => {
        calls++;
        if (calls === 1) return { text: "not json at all" };
        return { text: '{"val": 42}' };
      },
    };

    const workflow = smithers(() => (
      <Workflow name="schema-retry">
        <Task id="t" output={outputs.out} agent={agent}>
          Return val.
        </Task>
      </Workflow>
    ));

    const r = await runWorkflow(workflow, { input: {} });
    expect(r.status).toBe("finished");
    expect(calls).toBe(2);
    const rows = (db as any).select().from(tables.out).all();
    expect(rows[0].val).toBe(42);
    cleanup();
  });

  test("schema with optional fields succeeds when fields omitted", async () => {
    const { smithers, outputs, tables, db, cleanup } = createTestSmithers({
      out: z.object({
        required: z.string(),
        optional: z.string().optional(),
      }),
    });

    const workflow = smithers(() => (
      <Workflow name="optional-fields">
        <Task id="t" output={outputs.out}>
          {{ required: "yes" }}
        </Task>
      </Workflow>
    ));

    const r = await runWorkflow(workflow, { input: {} });
    expect(r.status).toBe("finished");
    const rows = (db as any).select().from(tables.out).all();
    expect(rows[0].required).toBe("yes");
    cleanup();
  });

  test("schema with array field stores as JSON", async () => {
    const { smithers, outputs, tables, db, cleanup } = createTestSmithers({
      out: z.object({ tags: z.array(z.string()) }),
    });

    const workflow = smithers(() => (
      <Workflow name="array-field">
        <Task id="t" output={outputs.out}>
          {{ tags: ["a", "b", "c"] }}
        </Task>
      </Workflow>
    ));

    const r = await runWorkflow(workflow, { input: {} });
    expect(r.status).toBe("finished");
    const rows = (db as any).select().from(tables.out).all();
    expect(rows[0].tags).toEqual(["a", "b", "c"]);
    cleanup();
  });

  test("schema with nested object stores as JSON", async () => {
    const { smithers, outputs, tables, db, cleanup } = createTestSmithers({
      out: z.object({ meta: z.object({ key: z.string(), val: z.number() }) }),
    });

    const workflow = smithers(() => (
      <Workflow name="nested-obj">
        <Task id="t" output={outputs.out}>
          {{ meta: { key: "x", val: 42 } }}
        </Task>
      </Workflow>
    ));

    const r = await runWorkflow(workflow, { input: {} });
    expect(r.status).toBe("finished");
    const rows = (db as any).select().from(tables.out).all();
    expect(rows[0].meta).toEqual({ key: "x", val: 42 });
    cleanup();
  });

  test("boolean fields stored and retrieved correctly", async () => {
    const { smithers, outputs, tables, db, cleanup } = createTestSmithers({
      out: z.object({ active: z.boolean() }),
    });

    const workflow = smithers(() => (
      <Workflow name="bool-field">
        <Task id="t" output={outputs.out}>
          {{ active: true }}
        </Task>
      </Workflow>
    ));

    const r = await runWorkflow(workflow, { input: {} });
    expect(r.status).toBe("finished");
    const rows = (db as any).select().from(tables.out).all();
    expect(rows[0].active).toBeTruthy();
    cleanup();
  });
});
