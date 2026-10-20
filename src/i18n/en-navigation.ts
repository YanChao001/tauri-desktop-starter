import type { zhNavigation } from "./zh-navigation";

export const enNavigation = {
  "navGroup.experience": "Experience",
  "navGroup.capabilities": "Desktop capabilities",
  "navGroup.system": "System",
  "navContext.browse": "Explore",
  "navContext.location": "Current location",
  "navContext.commands": "Quick actions",
} as const satisfies Record<keyof typeof zhNavigation, string>;
