import { toast } from "sonner";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/providers/i18n";
import { ControlStates } from "./control-states";

const VARIANTS = [
  { variant: "default", label: "playground.variantPrimary", badge: "default" },
  {
    variant: "secondary",
    label: "playground.variantSecondary",
    badge: "secondary",
  },
  { variant: "outline", label: "playground.variantOutline", badge: "outline" },
  { variant: "ghost", label: "playground.variantGhost", badge: "outline" },
  { variant: "link", label: "playground.variantLink", badge: "outline" },
  {
    variant: "destructive",
    label: "playground.variantDestructive",
    badge: "destructive",
  },
] as const;

export function ControlReference() {
  const { t } = useI18n();
  return (
    <section
      className="playground-reference"
      aria-labelledby="playground-reference-heading"
    >
      <h3 id="playground-reference-heading">{t("playground.reference")}</h3>
      <p>{t("playground.referenceDescription")}</p>
      <Accordion type="single" collapsible defaultValue="states">
        <AccordionItem value="states">
          <AccordionTrigger>{t("playground.controlStates")}</AccordionTrigger>
          <AccordionContent>
            <ControlStates />
          </AccordionContent>
        </AccordionItem>
        <AccordionItem value="variants">
          <AccordionTrigger>{t("playground.buttonVariants")}</AccordionTrigger>
          <AccordionContent>
            <div className="playground-variants">
              {VARIANTS.map(({ variant, badge, label }) => (
                <div key={variant}>
                  <Button
                    variant={variant}
                    onClick={() =>
                      toast.info(
                        t("playground.variantClicked", { variant: t(label) }),
                      )
                    }
                  >
                    {t(label)}
                  </Button>
                  <Badge variant={badge}>{t(label)}</Badge>
                </div>
              ))}
            </div>
          </AccordionContent>
        </AccordionItem>
        <AccordionItem value="keyboard">
          <AccordionTrigger>{t("playground.referenceHelp")}</AccordionTrigger>
          <AccordionContent className="max-w-2xl leading-relaxed text-muted-foreground">
            {t("playground.referenceHelpBody")}
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </section>
  );
}
