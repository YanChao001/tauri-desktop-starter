import { MotionConfig } from "motion/react";
import type { ReactNode } from "react";
import { useDemoMotion } from "@/hooks/use-demo-motion";

export function DemoMotion({ children }: { children: ReactNode }) {
  const { reduced } = useDemoMotion();
  return (
    <MotionConfig
      reducedMotion={reduced ? "always" : "never"}
      transition={
        reduced
          ? { duration: 0 }
          : { type: "spring", stiffness: 330, damping: 32 }
      }
    >
      {children}
    </MotionConfig>
  );
}
