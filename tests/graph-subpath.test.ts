import { describe, expect, test } from "bun:test";
import { buildPlanTree } from "smithers-orchestrator/graph";
import type { XmlNode } from "smithers-orchestrator";

describe("graph subpath exports", () => {
  test("buildPlanTree is available from smithers-orchestrator/graph", () => {
    const xml: XmlNode = {
      kind: "element",
      tag: "smithers:workflow",
      props: {},
      children: [
        {
          kind: "element",
          tag: "smithers:task",
          props: { id: "analyze" },
          children: [],
        },
        {
          kind: "element",
          tag: "smithers:parallel",
          props: {},
          children: [
            {
              kind: "element",
              tag: "smithers:task",
              props: { id: "docs" },
              children: [],
            },
            {
              kind: "element",
              tag: "smithers:task",
              props: { id: "tests" },
              children: [],
            },
          ],
        },
      ],
    };

    expect(buildPlanTree(xml)).toEqual({
      plan: {
        kind: "sequence",
        children: [
          { kind: "task", nodeId: "analyze" },
          {
            kind: "parallel",
            children: [
              { kind: "task", nodeId: "docs" },
              { kind: "task", nodeId: "tests" },
            ],
          },
        ],
      },
      ralphs: [],
    });
  });
});
