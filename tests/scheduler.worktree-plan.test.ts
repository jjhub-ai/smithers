import { describe, expect, test } from "bun:test";
import type { XmlElement } from "../src/types";
import { buildPlanTree, scheduleTasks } from "../src/engine/scheduler";

function el(tag: string, props: Record<string, string> = {}, children: any[] = []): XmlElement {
  return { kind: "element", tag, props, children } as XmlElement;
}

// Shared minimal descriptor factory for scheduleTasks
function mk(id: string) {
  return {
    nodeId: id,
    ordinal: 0,
    iteration: 0,
    outputTable: null,
    outputTableName: "t",
    needsApproval: false,
    skipIf: false,
    retries: 0,
    timeoutMs: null,
    continueOnFail: false,
  } as any;
}

describe("scheduler: buildPlanTree — <Worktree>", () => {
  test("wraps <smithers:worktree> subtree as a group with correct children", () => {
    const xml: XmlElement = el("smithers:workflow", {}, [
      el("smithers:worktree", { id: "wt", path: "/tmp/wt" }, [
        el("smithers:task", { id: "a" }, []),
        el("smithers:task", { id: "b" }, []),
      ]),
    ]);

    const { plan, ralphs } = buildPlanTree(xml);
    expect(ralphs.length).toBe(0);
    expect(plan && plan.kind).toBe("sequence");
    const seq = plan as any;
    expect(seq.children.length).toBe(1);
    expect(seq.children[0].kind).toBe("group");
    const group = seq.children[0];
    expect(group.children.map((c: any) => c.kind)).toEqual(["task", "task"]);
    expect(group.children.map((c: any) => c.nodeId)).toEqual(["a", "b"]);
  });

  test("inside <Sequence>, worktree group preserves sequential gating", () => {
    const xml: XmlElement = el("smithers:workflow", {}, [
      el("smithers:sequence", {}, [
        el("smithers:worktree", { id: "wt", path: "/tmp/wt" }, [
          el("smithers:task", { id: "wa" }, []),
          el("smithers:task", { id: "wb" }, []),
        ]),
        el("smithers:task", { id: "after" }, []),
      ]),
    ]);

    const { plan } = buildPlanTree(xml);
    const desc = new Map<string, any>([
      ["wa", mk("wa")],
      ["wb", mk("wb")],
      ["after", mk("after")],
    ]);
    const states = new Map<string, any>();
    const ralph = new Map<string, any>();

    // Initially, only wa/wb should be runnable; "after" gated by sequence
    let s = scheduleTasks(plan!, states as any, desc as any, ralph as any);
    expect(s.runnable.map((t) => t.nodeId).sort()).toEqual(["wa", "wb"]);

    // Mark wa/wb finished; now "after" becomes runnable
    states.set("wa::0", "finished");
    states.set("wb::0", "finished");
    s = scheduleTasks(plan!, states as any, desc as any, ralph as any);
    expect(s.runnable.map((t) => t.nodeId)).toEqual(["after"]);
  });

  test("inside <Parallel>, worktree children are runnable alongside siblings", () => {
    const xml: XmlElement = el("smithers:workflow", {}, [
      el("smithers:parallel", { maxConcurrency: "2" }, [
        el("smithers:worktree", { id: "wt", path: "/tmp/wt" }, [
          el("smithers:task", { id: "wa" }, []),
          el("smithers:task", { id: "wb" }, []),
        ]),
        el("smithers:task", { id: "peer" }, []),
      ]),
    ]);

    const { plan } = buildPlanTree(xml);
    expect(plan && plan.kind).toBe("sequence");
    const par = (plan as any).children[0];
    expect(par.kind).toBe("parallel");
    expect(par.maxConcurrency).toBe(2);

    const desc = new Map<string, any>([
      ["wa", mk("wa")],
      ["wb", mk("wb")],
      ["peer", mk("peer")],
    ]);
    const states = new Map<string, any>();
    const ralph = new Map<string, any>();
    const s = scheduleTasks(plan!, states as any, desc as any, ralph as any);
    expect(s.runnable.map((t) => t.nodeId).sort()).toEqual([
      "peer",
      "wa",
      "wb",
    ]);
  });

  test("empty worktree produces group with no children", () => {
    const xml: XmlElement = el("smithers:workflow", {}, [
      el("smithers:worktree", { id: "wt", path: "/tmp/wt" }, []),
    ]);
    const { plan } = buildPlanTree(xml);
    const group = (plan as any).children[0];
    expect(group.kind).toBe("group");
    expect(group.children).toEqual([]);
  });

  test("nested worktrees produce nested groups leading to task", () => {
    const xml: XmlElement = el("smithers:workflow", {}, [
      el("smithers:worktree", { id: "outer", path: "/tmp/outer" }, [
        el("smithers:worktree", { id: "inner", path: "/tmp/inner" }, [
          el("smithers:task", { id: "t" }, []),
        ]),
      ]),
    ]);
    const { plan } = buildPlanTree(xml);
    const outer = (plan as any).children[0];
    expect(outer.kind).toBe("group");
    const inner = outer.children[0];
    expect(inner.kind).toBe("group");
    const leaf = inner.children[0];
    expect(leaf.kind).toBe("task");
    expect(leaf.nodeId).toBe("t");
  });
});
