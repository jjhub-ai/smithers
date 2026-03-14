import { Context, Effect, Schema } from "effect";
import { Model } from "@effect/sql";
import { Smithers } from "../../src";

export class IncidentInput extends Schema.Class<IncidentInput>(
  "IncidentInput",
)({
  title: Schema.String,
  severity: Schema.String,
}) {}

export class Triage extends Model.Class<Triage>("Triage")({
  owner: Schema.String,
  action: Schema.String,
}) {}

export class Resolution extends Model.Class<Resolution>("Resolution")({
  status: Schema.String,
  notes: Schema.String,
}) {}

export class Oncall extends Context.Tag("Oncall")<
  Oncall,
  {
    readonly assign: (severity: string) => Effect.Effect<string>;
  }
>() {}

export const workflow = Smithers.workflow({
  name: "incident-triage",
  input: IncidentInput,
}).build(($) => {
  const triage = $.step("triage", {
    output: Triage,
    run: ({ input }) =>
      Effect.gen(function* () {
        const oncall = yield* Oncall;
        const owner = yield* oncall.assign((input as IncidentInput).severity);
        const action =
          (input as IncidentInput).severity === "critical"
            ? "rollback"
            : "monitor";
        return new Triage({ owner, action });
      }),
  });

  const resolve = $.step("resolve", {
    output: Resolution,
    needs: { triage },
    run: ({ input, triage }) =>
      Effect.succeed(
        new Resolution({
          status: "stabilized",
          notes: `${(triage as Triage).owner} handled ${(input as IncidentInput).title}`,
        }),
      ),
  });

  return $.sequence(triage, resolve);
});
