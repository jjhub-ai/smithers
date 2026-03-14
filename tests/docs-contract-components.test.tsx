/** @jsxImportSource smithers */
import { describe, expect, test } from "bun:test";
import {
  Branch,
  Loop,
  Parallel,
  Sequence,
  Task,
  Workflow,
  renderFrame,
  runWorkflow,
} from "../src/index";
import { createTestSmithers, sleep } from "./helpers";
import { outputSchemas } from "./schema";
import { z } from "zod";

const TaskAny = Task as any;

describe("docs: <Task>", () => {
  test("compute callbacks run at execution time, not render time", async () => {
    const { smithers, outputs, cleanup } = createTestSmithers(outputSchemas);
    let invoked = false;

    const workflow = smithers(() => (
      <Workflow name="compute-timing">
        <Task id="compute" output={outputs.outputA}>
          {() => {
            invoked = true;
            return { value: 1 };
          }}
        </Task>
      </Workflow>
    ));

    expect(invoked).toBe(false);
    const result = await runWorkflow(workflow, { input: {} });
    expect(result.status).toBe("finished");
    expect(invoked).toBe(true);
    cleanup();
  });

  test("static payloads are written directly to the output table", async () => {
    const { smithers, outputs, tables, db, cleanup } = createTestSmithers(
      outputSchemas,
    );

    const workflow = smithers(() => (
      <Workflow name="static-mode">
        <Task id="config" output={outputs.outputA}>
          {{ value: 42 }}
        </Task>
      </Workflow>
    ));

    const result = await runWorkflow(workflow, { input: {} });
    expect(result.status).toBe("finished");

    const rows = await (db as any).select().from(tables.outputA);
    expect(rows.length).toBe(1);
    expect(rows[0].value).toBe(42);
    cleanup();
  });

  test("skipIf bypasses the task entirely", async () => {
    const { smithers, outputs, tables, db, cleanup } = createTestSmithers(
      outputSchemas,
    );

    const workflow = smithers(() => (
      <Workflow name="skip-task">
        <Task id="skip" output={outputs.outputA} skipIf>
          {{ value: 1 }}
        </Task>
      </Workflow>
    ));

    const result = await runWorkflow(workflow, { input: {} });
    expect(result.status).toBe("finished");

    const rows = await (db as any).select().from(tables.outputA);
    expect(rows.length).toBe(0);
    cleanup();
  });

  test("compute callbacks respect timeoutMs", async () => {
    const { smithers, outputs, cleanup } = createTestSmithers(outputSchemas);

    const workflow = smithers(() => (
      <Workflow name="compute-timeout">
        <Task id="slow" output={outputs.outputA} timeoutMs={20}>
          {async () => {
            await sleep(200);
            return { value: 1 };
          }}
        </Task>
      </Workflow>
    ));

    const result = await runWorkflow(workflow, { input: {} });
    expect(result.status).toBe("failed");
    cleanup();
  });

  test("static payloads are validated against the schema", async () => {
    const { smithers, outputs, cleanup } = createTestSmithers({
      output: z.object({ value: z.number() }),
    });

    const workflow = smithers(() => (
      <Workflow name="static-validate">
        <Task id="bad" output={outputs.output}>
          {{ value: "not-a-number" }}
        </Task>
      </Workflow>
    ));

    const result = await runWorkflow(workflow, { input: {} });
    expect(result.status).toBe("failed");
    cleanup();
  });

  test("schema keys can be referenced by string (docs: output prop)", async () => {
    const { smithers, tables, db, cleanup } = createTestSmithers({
      output: z.object({ value: z.number() }),
    });

    const workflow = smithers(() => (
      <Workflow name="string-output">
        <TaskAny id="t" output="output">
          {{ value: 7 }}
        </TaskAny>
      </Workflow>
    ));

    const result = await runWorkflow(workflow, { input: {} });
    expect(result.status).toBe("finished");

    const rows = await (db as any).select().from(tables.output);
    expect(rows.length).toBe(1);
    expect(rows[0].value).toBe(7);
    cleanup();
  });

  test("outputSchema injects schema into MDX prompt components", async () => {
    const analysisSchema = z.object({ summary: z.string(), risk: z.string() });
    const { smithers, outputs, cleanup } = createTestSmithers({
      analysis: analysisSchema,
    });

    let seenPrompt = "";
    const agent: any = {
      id: "schema-agent",
      tools: {},
      async generate({ prompt }: { prompt: string }) {
        seenPrompt = prompt;
        return { output: { summary: "ok", risk: "low" } };
      },
    };

    function Prompt(props: { schema?: string }) {
      return (
        <>
          Expected schema:
          {"\n"}
          {props.schema}
        </>
      );
    }

    const workflow = smithers(() => (
      <Workflow name="schema-injection">
        <TaskAny
          id="analyze"
          output={outputs.analysis}
          agent={agent}
          outputSchema={analysisSchema}
        >
          <Prompt />
        </TaskAny>
      </Workflow>
    ));

    const result = await runWorkflow(workflow, { input: {} });
    expect(result.status).toBe("finished");
    expect(seenPrompt).toContain("summary");
    expect(seenPrompt).toContain("risk");
    cleanup();
  });
});

describe("docs: control flow components", () => {
  test("<Sequence> skipIf removes all child tasks", async () => {
    const { smithers, outputs, cleanup } = createTestSmithers(outputSchemas);
    const workflow = smithers(() => (
      <Workflow name="seq-skip">
        <Sequence skipIf>
          <Task id="a" output={outputs.outputA}>
            {{ value: 1 }}
          </Task>
        </Sequence>
      </Workflow>
    ));

    const snapshot = await renderFrame(workflow, {
      runId: "seq-skip",
      iteration: 0,
      input: {},
      outputs: {},
    });
    expect(snapshot.tasks.length).toBe(0);
    cleanup();
  });

  test("<Parallel> skipIf removes all child tasks", async () => {
    const { smithers, outputs, cleanup } = createTestSmithers(outputSchemas);
    const workflow = smithers(() => (
      <Workflow name="par-skip">
        <Parallel skipIf>
          <Task id="a" output={outputs.outputA}>
            {{ value: 1 }}
          </Task>
        </Parallel>
      </Workflow>
    ));

    const snapshot = await renderFrame(workflow, {
      runId: "par-skip",
      iteration: 0,
      input: {},
      outputs: {},
    });
    expect(snapshot.tasks.length).toBe(0);
    cleanup();
  });

  test("<Branch> skipIf removes both branches", async () => {
    const { smithers, outputs, cleanup } = createTestSmithers(outputSchemas);
    const workflow = smithers(() => (
      <Workflow name="branch-skip">
        <Branch
          skipIf
          if={true}
          then={
            <Task id="then" output={outputs.outputA}>
              {{ value: 1 }}
            </Task>
          }
          else={
            <Task id="else" output={outputs.outputB}>
              {{ value: 2 }}
            </Task>
          }
        />
      </Workflow>
    ));

    const snapshot = await renderFrame(workflow, {
      runId: "branch-skip",
      iteration: 0,
      input: {},
      outputs: {},
    });
    expect(snapshot.tasks.length).toBe(0);
    cleanup();
  });

  test("<Branch> with no else runs nothing when condition is false", async () => {
    const { smithers, outputs, tables, db, cleanup } = createTestSmithers(
      outputSchemas,
    );

    const workflow = smithers(() => (
      <Workflow name="branch-no-else">
        <Branch
          if={false}
          then={
            <Task id="then" output={outputs.outputA}>
              {{ value: 1 }}
            </Task>
          }
        />
      </Workflow>
    ));

    const result = await runWorkflow(workflow, { input: {} });
    expect(result.status).toBe("finished");

    const rowsA = await (db as any).select().from(tables.outputA);
    expect(rowsA.length).toBe(0);
    cleanup();
  });

  test("<Branch> switches based on completed outputs", async () => {
    const { smithers, outputs, tables, db, cleanup } = createTestSmithers(
      outputSchemas,
    );

    const workflow = smithers((ctx) => (
      <Workflow name="branch-switch">
        <Sequence>
          <Task id="seed" output={outputs.outputA}>
            {{ value: 1 }}
          </Task>
          <Branch
            if={ctx.outputMaybe("outputA", { nodeId: "seed" })?.value === 1}
            then={
              <Task id="then" output={outputs.outputB}>
                {{ value: 2 }}
              </Task>
            }
            else={
              <Task id="else" output={outputs.outputC}>
                {{ value: 3 }}
              </Task>
            }
          />
        </Sequence>
      </Workflow>
    ));

    const result = await runWorkflow(workflow, { input: {} });
    expect(result.status).toBe("finished");

    const rowsB = await (db as any).select().from(tables.outputB);
    const rowsC = await (db as any).select().from(tables.outputC);
    expect(rowsB.length).toBe(1);
    expect(rowsC.length).toBe(0);
    cleanup();
  });

  test("<Loop> skipIf removes loop children", async () => {
    const { smithers, outputs, cleanup } = createTestSmithers(outputSchemas);
    const workflow = smithers(() => (
      <Workflow name="loop-skip">
        <Loop id="loop" until={false} skipIf>
          <Task id="step" output={outputs.outputA}>
            {{ value: 1 }}
          </Task>
        </Loop>
      </Workflow>
    ));

    const snapshot = await renderFrame(workflow, {
      runId: "loop-skip",
      iteration: 0,
      input: {},
      outputs: {},
    });
    expect(snapshot.tasks.length).toBe(0);
    cleanup();
  });

  test("<Loop> defaults to maxIterations=5 and returns last output", async () => {
    const { smithers, outputs, tables, db, cleanup } = createTestSmithers(
      outputSchemas,
    );

    const workflow = smithers((ctx) => (
      <Workflow name="loop-default-max">
        <Loop id="loop" until={false}>
          <Task id="step" output={outputs.outputA}>
            {{ value: ctx.iteration }}
          </Task>
        </Loop>
      </Workflow>
    ));

    const result = await runWorkflow(workflow, { input: {} });
    expect(result.status).toBe("finished");

    const rows = await (db as any).select().from(tables.outputA);
    expect(rows.length).toBe(5);
    const iterations = rows
      .map((row: any) => row.iteration)
      .sort((a: number, b: number) => a - b);
    expect(iterations).toEqual([0, 1, 2, 3, 4]);
    cleanup();
  });

  test("<Loop> onMaxReached=fail stops the workflow", async () => {
    const { smithers, outputs, cleanup } = createTestSmithers(outputSchemas);

    const workflow = smithers(() => (
      <Workflow name="loop-fail">
        <Loop id="loop" until={false} onMaxReached="fail" maxIterations={2}>
          <Task id="step" output={outputs.outputA}>
            {{ value: 1 }}
          </Task>
        </Loop>
      </Workflow>
    ));

    const result = await runWorkflow(workflow, { input: {} });
    expect(result.status).toBe("failed");
    cleanup();
  });

  test("<Loop> exposes ctx.iteration and ctx.iterations", async () => {
    const { smithers, outputs, tables, db, cleanup } = createTestSmithers({
      output: z.object({ iteration: z.number(), mapValue: z.number() }),
    });

    const workflow = smithers((ctx) => (
      <Workflow name="loop-ctx">
        <Loop id="review-loop" until={ctx.outputs("output").length >= 3}>
          <Task id="step" output={outputs.output}>
            {{
              iteration: ctx.iteration,
              mapValue: ctx.iterations?.["review-loop"] ?? -1,
            }}
          </Task>
        </Loop>
      </Workflow>
    ));

    const result = await runWorkflow(workflow, { input: {} });
    expect(result.status).toBe("finished");

    const rows = await (db as any).select().from(tables.output);
    const byIter = rows.sort((a: any, b: any) => a.iteration - b.iteration);
    expect(byIter.length).toBe(3);
    expect(byIter[0].iteration).toBe(0);
    expect(byIter[0].mapValue).toBe(0);
    expect(byIter[1].iteration).toBe(1);
    expect(byIter[1].mapValue).toBe(1);
    expect(byIter[2].iteration).toBe(2);
    expect(byIter[2].mapValue).toBe(2);
    cleanup();
  });

  test("ctx.iterationCount counts completed iterations", async () => {
    const { smithers, outputs, tables, db, cleanup } = createTestSmithers({
      output: z.object({ count: z.number(), iteration: z.number() }),
    });

    const workflow = smithers((ctx) => (
      <Workflow name="loop-iteration-count">
        <Loop
          id="count-loop"
          until={ctx.iterationCount("output", "step") >= 2}
          maxIterations={5}
        >
          <Task id="step" output={outputs.output}>
            {{
              count: ctx.iterationCount("output", "step"),
              iteration: ctx.iteration,
            }}
          </Task>
        </Loop>
      </Workflow>
    ));

    const result = await runWorkflow(workflow, { input: {} });
    expect(result.status).toBe("finished");

    const rows = await (db as any).select().from(tables.output);
    const counts = rows
      .map((row: any) => row.count)
      .sort((a: number, b: number) => a - b);
    expect(counts).toEqual([0, 1]);
    cleanup();
  });
});
