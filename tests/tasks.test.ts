import { describe, expect, it } from "vitest";
import {
  MAX_TASK,
  cleanTask,
  inOrder,
  nextOrder,
  taskHeading,
  taskProgress,
  taskSummary,
  type Task,
} from "../lib/tasks";

const task = (id: string, order: number, done = false): Task => ({
  id,
  text: `task ${id}`,
  done,
  order,
});

describe("cleanTask", () => {
  it("takes a real task and trims it", () => {
    expect(cleanTask("  call the bank  ")).toBe("call the bank");
  });

  it("collapses the whitespace a phone keyboard leaves behind", () => {
    expect(cleanTask("submit   the\n\nform")).toBe("submit the form");
  });

  it("refuses what isn't a task", () => {
    expect(cleanTask("   ")).toBeNull();
    expect(cleanTask("")).toBeNull();
    expect(cleanTask(null)).toBeNull();
    expect(cleanTask(42)).toBeNull();
  });

  it("bounds a task nobody typed by hand", () => {
    expect(cleanTask("x".repeat(500))).toHaveLength(MAX_TASK);
  });
});

describe("inOrder", () => {
  it("shows tasks as they were written", () => {
    const tasks = [task("c", 2), task("a", 0), task("b", 1)];
    expect(inOrder(tasks).map((t) => t.id)).toEqual(["a", "b", "c"]);
  });

  it("leaves a ticked task exactly where it is", () => {
    // The list must not move under a finger that is touching it: sinking a
    // done item means the next tap lands on something else.
    const tasks = [task("a", 0, true), task("b", 1), task("c", 2)];
    expect(inOrder(tasks).map((t) => t.id)).toEqual(["a", "b", "c"]);
  });

  it("is stable when two tasks share an order", () => {
    const tasks = [task("b", 0), task("a", 0)];
    expect(inOrder(tasks).map((t) => t.id)).toEqual(["a", "b"]);
  });

  it("leaves the caller's array alone", () => {
    const tasks = [task("c", 2), task("a", 0)];
    const copy = [...tasks];
    inOrder(tasks);
    expect(tasks).toEqual(copy);
  });
});

describe("nextOrder", () => {
  it("puts a new task after everything already there", () => {
    expect(nextOrder([task("a", 0), task("b", 3)])).toBe(4);
  });

  it("starts at zero on an empty day", () => {
    expect(nextOrder([])).toBe(0);
  });
});

describe("taskProgress", () => {
  it("counts what is done", () => {
    expect(taskProgress([task("a", 0, true), task("b", 1)])).toEqual({
      done: 1,
      total: 2,
      cleared: false,
    });
  });

  it("only calls it cleared when there was something to clear", () => {
    expect(taskProgress([]).cleared).toBe(false);
    expect(taskProgress([task("a", 0, true)]).cleared).toBe(true);
  });
});

describe("taskSummary", () => {
  it("says what is left without scolding", () => {
    expect(taskSummary([])).toBe("Nothing on the list yet");
    expect(taskSummary([task("a", 0), task("b", 1)])).toBe("0 of 2 done");
    expect(taskSummary([task("a", 0, true), task("b", 1)])).toBe("1 of 2 done");
  });

  it("says so plainly when the day is cleared", () => {
    expect(taskSummary([task("a", 0, true)])).toBe("Done");
    expect(taskSummary([task("a", 0, true), task("b", 1, true)])).toBe("All 2 done");
  });
});

describe("taskHeading", () => {
  const today = "2026-08-23";
  const tomorrow = "2026-08-24";

  it("names the day it is actually about", () => {
    expect(taskHeading(today, today, tomorrow)).toBe("Have to do it today");
    expect(taskHeading(tomorrow, today, tomorrow)).toBe("Have to do it tomorrow");
    expect(taskHeading("2026-08-22", today, tomorrow)).toBe("Had to do that day");
  });

  it("does not call next week 'tomorrow'", () => {
    // Not reachable from the log today, but a heading that lies is a lie
    // waiting for the day someone links straight to that date.
    expect(taskHeading("2026-08-30", today, tomorrow)).toBe("Have to do it that day");
  });
});
