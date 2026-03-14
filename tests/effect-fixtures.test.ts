import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, Layer } from "effect";
import { Smithers } from "../src";
import {
  IncidentInput,
  Oncall,
  Resolution,
  workflow,
} from "./fixtures/effect-incident";

function makeDbPath() {
  const dir = mkdtempSync(join(tmpdir(), "smithers-effect-fixture-"));
  return {
    dir,
    dbPath: join(dir, "smithers.db"),
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

describe("Effect API fixtures", () => {
  test("incident triage workflow produces a resolution", async () => {
    const db = makeDbPath();
    try {
      const layer = Layer.mergeAll(
        Smithers.sqlite({ filename: db.dbPath }),
        Layer.succeed(Oncall, {
          assign: (severity: string) =>
            Effect.succeed(severity === "critical" ? "oncall" : "support"),
        }),
      );

      const result = await Effect.runPromise(
        workflow
          .execute({ title: "Auth outage", severity: "critical" })
          .pipe(Effect.provide(layer)),
      );

      expect(result).toBeInstanceOf(Resolution);
      expect((result as Resolution).status).toBe("stabilized");
      expect((result as Resolution).notes).toContain("Auth outage");
    } finally {
      db.cleanup();
    }
  });
});
