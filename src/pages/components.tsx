import { useState, type ReactNode } from "react";
import {
  BellIcon,
  CheckIcon,
  ChevronDownIcon,
  Grid2x2Icon,
  ListIcon,
  PlusIcon,
  SettingsIcon,
  TrashIcon,
  UserPlusIcon,
} from "lucide-react";
import { toast } from "sonner";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Progress } from "@/components/ui/progress";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useI18n } from "@/providers/i18n";

const MEMBERS = [
  { name: "Yan Chao", initials: "YC", role: "components.roleAdmin" },
  { name: "Ada Lovelace", initials: "AL", role: "components.roleEditor" },
  { name: "Linus T.", initials: "LT", role: "components.roleViewer" },
] as const;

function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint: string;
  children: ReactNode;
}) {
  return (
    <section className="space-y-3">
      <div className="space-y-0.5">
        <h3 className="text-sm font-medium">{title}</h3>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </div>
      {children}
    </section>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">{label}</Label>
      {children}
    </div>
  );
}

export default function Components() {
  const { t } = useI18n();
  const [dialogOpen, setDialogOpen] = useState(false);

  return (
    <div className="space-y-8">
      <div className="space-y-1.5">
        <h2 className="text-xl font-semibold tracking-tight">
          {t("components.title")}
        </h2>
        <p className="max-w-2xl text-sm text-muted-foreground">
          {t("components.subtitle")}
        </p>
      </div>

      <Section
        title={t("components.buttons")}
        hint={t("components.buttonsHint")}
      >
        <div className="flex flex-wrap items-center gap-2">
          <Button>{t("components.primary")}</Button>
          <Button variant="secondary">{t("components.secondary")}</Button>
          <Button variant="outline">{t("components.outline")}</Button>
          <Button variant="ghost">{t("components.ghost")}</Button>
          <Button variant="destructive">
            <TrashIcon />
            {t("components.destructive")}
          </Button>
          <Button disabled>
            <SettingsIcon className="animate-spin" />
            {t("components.loading")}
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge>{t("components.primary")}</Badge>
          <Badge variant="secondary">{t("components.secondary")}</Badge>
          <Badge variant="outline">{t("components.outline")}</Badge>
          <Badge variant="destructive">{t("components.destructive")}</Badge>
        </div>
      </Section>

      <Section title={t("components.inputs")} hint={t("components.inputsHint")}>
        <Card size="sm">
          <CardContent className="grid gap-4 pt-4 sm:grid-cols-2">
            <Field label={t("components.name")}>
              <Input placeholder={t("components.namePlaceholder")} />
            </Field>
            <Field label={t("components.email")}>
              <Input type="email" placeholder="you@example.com" />
            </Field>
            <Field label={t("components.role")}>
              <Select defaultValue="editor">
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="admin">
                    {t("components.roleAdmin")}
                  </SelectItem>
                  <SelectItem value="editor">
                    {t("components.roleEditor")}
                  </SelectItem>
                  <SelectItem value="viewer">
                    {t("components.roleViewer")}
                  </SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <div className="space-y-1.5">
              <Label className="text-xs">{t("components.plan")}</Label>
              <RadioGroup defaultValue="pro" className="flex gap-4 pt-1">
                {[
                  { value: "basic", label: t("components.planBasic") },
                  { value: "pro", label: t("components.planPro") },
                  { value: "team", label: t("components.planTeam") },
                ].map((item) => (
                  <div key={item.value} className="flex items-center gap-1.5">
                    <RadioGroupItem
                      value={item.value}
                      id={`plan-${item.value}`}
                    />
                    <Label
                      htmlFor={`plan-${item.value}`}
                      className="text-xs font-normal"
                    >
                      {item.label}
                    </Label>
                  </div>
                ))}
              </RadioGroup>
            </div>

            <div className="flex items-center justify-between gap-4 rounded-md border px-3 py-2.5">
              <div className="space-y-0.5">
                <p className="text-xs font-medium">
                  {t("components.notifications")}
                </p>
                <p className="text-[11px] text-muted-foreground">
                  {t("components.notificationsHint")}
                </p>
              </div>
              <Switch
                defaultChecked
                aria-label={t("components.notifications")}
              />
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-xs">{t("components.volume")}</Label>
                <span className="font-mono text-[11px] text-muted-foreground">
                  64
                </span>
              </div>
              <Slider defaultValue={[64]} max={100} step={1} />
            </div>
            <div className="flex items-center gap-2 text-xs">
              <Checkbox id="notify" defaultChecked />
              <Label htmlFor="notify" className="font-normal">
                {t("components.notifications")}
              </Label>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">
                {t("components.notifications")}
              </span>
              <Badge variant="outline">{t("common.sampleData")}</Badge>
            </div>
          </CardContent>
        </Card>
      </Section>

      <Section
        title={t("components.overlays")}
        hint={t("components.overlaysHint")}
      >
        <div className="flex flex-wrap gap-2">
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button variant="outline">{t("components.dialog")}</Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle>{t("components.dialogTitle")}</DialogTitle>
                <DialogDescription>
                  {t("components.dialogBody")}
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button variant="outline" onClick={() => setDialogOpen(false)}>
                  {t("common.cancel")}
                </Button>
                <Button
                  onClick={() => {
                    setDialogOpen(false);
                    toast.success(t("components.toastMessage"));
                  }}
                >
                  <CheckIcon />
                  {t("components.primary")}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline">{t("components.popover")}</Button>
            </PopoverTrigger>
            <PopoverContent className="w-64">
              <PopoverHeader>
                <PopoverTitle>{t("components.popover")}</PopoverTitle>
                <PopoverDescription>
                  {t("components.popoverBody")}
                </PopoverDescription>
              </PopoverHeader>
            </PopoverContent>
          </Popover>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="outline">{t("components.tooltip")}</Button>
            </TooltipTrigger>
            <TooltipContent>{t("components.tooltipBody")}</TooltipContent>
          </Tooltip>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline">
                {t("components.outline")}
                <ChevronDownIcon />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-44">
              <DropdownMenuLabel>{t("components.role")}</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem>
                <UserPlusIcon />
                {t("components.roleAdmin")}
              </DropdownMenuItem>
              <DropdownMenuItem>
                <SettingsIcon />
                {t("components.tabSettings")}
              </DropdownMenuItem>
              <DropdownMenuItem variant="destructive">
                <TrashIcon />
                {t("components.destructive")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <Button onClick={() => toast.success(t("components.toastMessage"))}>
            <BellIcon />
            {t("components.toast")}
          </Button>
        </div>
      </Section>

      <Section title={t("components.data")} hint={t("components.dataHint")}>
        <div className="grid gap-3 lg:grid-cols-5">
          <Card className="lg:col-span-3">
            <CardHeader>
              <CardTitle className="text-sm">{t("components.team")}</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("components.member")}</TableHead>
                    <TableHead>{t("components.role")}</TableHead>
                    <TableHead>{t("components.status")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {MEMBERS.map((member, index) => (
                    <TableRow key={member.name}>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Avatar className="size-7">
                            <AvatarFallback className="text-[10px]">
                              {member.initials}
                            </AvatarFallback>
                          </Avatar>
                          <span className="text-xs">{member.name}</span>
                        </div>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {t(member.role)}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={index === 2 ? "outline" : "secondary"}
                          className="text-[10px]"
                        >
                          {index === 2
                            ? t("components.invited")
                            : t("components.active")}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle className="text-sm">
                {t("components.progress")}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <Progress value={64} />
              <div className="space-y-2">
                <p className="text-[11px] text-muted-foreground">
                  {t("components.skeletonHint")}
                </p>
                <Skeleton className="h-3 w-4/5" />
                <Skeleton className="h-3 w-3/5" />
                <Skeleton className="h-3 w-2/5" />
              </div>
              <div className="flex items-center gap-2">
                <Button size="sm">
                  <PlusIcon />
                  {t("components.primary")}
                </Button>
                <Button size="sm" variant="outline">
                  {t("components.secondary")}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </Section>

      <Section title={t("components.tabs")} hint={t("components.tabsHint")}>
        <div className="grid gap-3 lg:grid-cols-2">
          <Card>
            <CardContent className="pt-4">
              <Tabs defaultValue="overview">
                <TabsList>
                  <TabsTrigger value="overview">
                    {t("components.tabOverview")}
                  </TabsTrigger>
                  <TabsTrigger value="activity">
                    {t("components.tabActivity")}
                  </TabsTrigger>
                  <TabsTrigger value="settings">
                    {t("components.tabSettings")}
                  </TabsTrigger>
                </TabsList>
                <TabsContent
                  value="overview"
                  className="pt-3 text-xs text-muted-foreground"
                >
                  {t("components.tabOverviewBody")}
                </TabsContent>
                <TabsContent
                  value="activity"
                  className="pt-3 text-xs text-muted-foreground"
                >
                  {t("components.tabActivityBody")}
                </TabsContent>
                <TabsContent
                  value="settings"
                  className="pt-3 text-xs text-muted-foreground"
                >
                  {t("components.tabSettingsBody")}
                </TabsContent>
              </Tabs>
              <div className="mt-4 flex items-center justify-between border-t pt-3">
                <span className="text-[11px] text-muted-foreground">
                  {t("components.toggleGroup")}
                </span>
                <ToggleGroup type="single" defaultValue="grid" size="sm">
                  <ToggleGroupItem value="grid" aria-label="grid">
                    <Grid2x2Icon />
                  </ToggleGroupItem>
                  <ToggleGroupItem value="list" aria-label="list">
                    <ListIcon />
                  </ToggleGroupItem>
                </ToggleGroup>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm">{t("components.faq")}</CardTitle>
              <CardDescription className="text-xs">
                {t("components.tabsHint")}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Accordion type="single" collapsible defaultValue="q1">
                <AccordionItem value="q1">
                  <AccordionTrigger className="text-xs">
                    {t("components.faqQ1")}
                  </AccordionTrigger>
                  <AccordionContent className="text-xs text-muted-foreground">
                    {t("components.faqA1")}
                  </AccordionContent>
                </AccordionItem>
                <AccordionItem value="q2">
                  <AccordionTrigger className="text-xs">
                    {t("components.faqQ2")}
                  </AccordionTrigger>
                  <AccordionContent className="text-xs text-muted-foreground">
                    {t("components.faqA2")}
                  </AccordionContent>
                </AccordionItem>
                <AccordionItem value="q3">
                  <AccordionTrigger className="text-xs">
                    {t("components.faqQ3")}
                  </AccordionTrigger>
                  <AccordionContent className="text-xs text-muted-foreground">
                    {t("components.faqA3")}
                  </AccordionContent>
                </AccordionItem>
              </Accordion>
            </CardContent>
          </Card>
        </div>
      </Section>
    </div>
  );
}
