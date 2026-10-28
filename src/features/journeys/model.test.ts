import { describe, expect, it } from "vitest";
import { currentJourney, JOURNEYS, journeyLink } from "./model";

describe("体验流程 URL", () => {
  it("拒绝伪造步骤、越界索引和与当前页面不相符的导览", () => {
    expect(currentJourney("/tasks", "?journey=tasks&step=1")?.step.title).toBe(
      "experience.tasks.2",
    );
    for (const search of [
      "?journey=missing",
      "?journey=tasks&step=-1",
      "?journey=tasks&step=99",
      "?journey=tasks&step=NaN",
      "?journey=tasks&step=1.5",
      "?journey=interface&step=0",
    ])
      expect(currentJourney("/tasks", search)).toBeNull();
    expect(
      currentJourney("/components", "?journey=interface&step=0", true),
    ).toBeNull();
    expect(journeyLink(JOURNEYS[1], 1)).toBe("/workbench?journey=files&step=1");
    const motionLink = journeyLink(JOURNEYS[0], 3);
    expect(motionLink).toBe(
      "/components?journey=interface&step=3&stage=motion",
    );
    expect(
      currentJourney("/components", motionLink.split("?")[1]!)?.step.title,
    ).toBe("experience.interface.4");
    expect(
      currentJourney("/components", "?journey=interface&step=3"),
    ).toBeNull();
  });
});
