import type { MessageKey } from "@/i18n/zh-CN";

type JourneyStep = {
  path: string;
  title: MessageKey;
  description: MessageKey;
  stage?: "motion";
};
type Journey = {
  id: string;
  title: MessageKey;
  description: MessageKey;
  native: boolean;
  steps: readonly JourneyStep[];
};

export const JOURNEYS = [
  {
    id: "interface",
    title: "experience.interface",
    description: "experience.interfaceHint",
    native: false,
    steps: [
      {
        path: "/components",
        title: "experience.interface.1",
        description: "experience.interface.1Hint",
      },
      {
        path: "/data-studio",
        title: "experience.interface.2",
        description: "experience.interface.2Hint",
      },
      {
        path: "/media",
        title: "experience.interface.3",
        description: "experience.interface.3Hint",
      },
      {
        path: "/components",
        stage: "motion",
        title: "experience.interface.4",
        description: "experience.interface.4Hint",
      },
    ],
  },
  {
    id: "files",
    title: "experience.files",
    description: "experience.filesHint",
    native: true,
    steps: [
      {
        path: "/workbench",
        title: "experience.files.1",
        description: "experience.files.1Hint",
      },
      {
        path: "/workbench",
        title: "experience.files.2",
        description: "experience.files.2Hint",
      },
      {
        path: "/database",
        title: "experience.files.3",
        description: "experience.files.3Hint",
      },
      {
        path: "/database",
        title: "experience.files.4",
        description: "experience.files.4Hint",
      },
    ],
  },
  {
    id: "tasks",
    title: "experience.tasks",
    description: "experience.tasksHint",
    native: true,
    steps: [
      {
        path: "/tasks",
        title: "experience.tasks.1",
        description: "experience.tasks.1Hint",
      },
      {
        path: "/tasks",
        title: "experience.tasks.2",
        description: "experience.tasks.2Hint",
      },
      {
        path: "/tasks",
        title: "experience.tasks.3",
        description: "experience.tasks.3Hint",
      },
      {
        path: "/tasks",
        title: "experience.tasks.4",
        description: "experience.tasks.4Hint",
      },
    ],
  },
  {
    id: "reliability",
    title: "experience.reliability",
    description: "experience.reliabilityHint",
    native: true,
    steps: [
      {
        path: "/database",
        title: "experience.reliability.1",
        description: "experience.reliability.1Hint",
      },
      {
        path: "/system",
        title: "experience.reliability.2",
        description: "experience.reliability.2Hint",
      },
      {
        path: "/database",
        title: "experience.reliability.3",
        description: "experience.reliability.3Hint",
      },
      {
        path: "/database",
        title: "experience.reliability.4",
        description: "experience.reliability.4Hint",
      },
    ],
  },
  {
    id: "extensions",
    title: "experience.extensions",
    description: "experience.extensionsHint",
    native: true,
    steps: [
      {
        path: "/extensions",
        title: "experience.extensions.1",
        description: "experience.extensions.1Hint",
      },
      {
        path: "/extensions",
        title: "experience.extensions.2",
        description: "experience.extensions.2Hint",
      },
      {
        path: "/extensions",
        title: "experience.extensions.3",
        description: "experience.extensions.3Hint",
      },
      {
        path: "/extensions",
        title: "experience.extensions.4",
        description: "experience.extensions.4Hint",
      },
    ],
  },
] as const satisfies readonly Journey[];

export function journeyLink(journey: Journey, index = 0) {
  const step = journey.steps[index];
  if (!step) return "/catalog";
  const params = new URLSearchParams({
    journey: journey.id,
    step: String(index),
  });
  if ("stage" in step && step.stage) params.set("stage", step.stage);
  return `${step.path}?${params.toString()}`;
}

/** 体验步骤只是 URL 导览；不执行命令，也不推断用户已完成操作。 */
export function currentJourney(
  pathname: string,
  search: string,
  minimal = false,
) {
  const params = new URLSearchParams(search);
  const journey = JOURNEYS.find((item) => item.id === params.get("journey"));
  const index = Number(params.get("step") ?? 0);
  if (
    !journey ||
    (minimal && !journey.native) ||
    !Number.isInteger(index) ||
    index < 0
  )
    return null;
  const step = journey.steps[index];
  return step?.path === pathname &&
    (!("stage" in step) || params.get("stage") === step.stage)
    ? { journey, step, index }
    : null;
}
