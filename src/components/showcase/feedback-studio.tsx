import { useState, type FormEvent } from "react";
import {
  BellRingIcon,
  MoreHorizontalIcon,
  PlusIcon,
  Settings2Icon,
  Trash2Icon,
  UsersIcon,
} from "lucide-react";
import { toast } from "sonner";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useI18n } from "@/providers/i18n";

type Member = { email: string; role: "editor" | "viewer" };
const ROLES = [
  { value: "editor", label: "playground.roleEditor" },
  { value: "viewer", label: "playground.roleViewer" },
] as const;
const TONES = [
  { value: "success", label: "playground.toneSuccess" },
  { value: "info", label: "playground.toneInfo" },
  { value: "error", label: "playground.toneError" },
] as const;

export function FeedbackStudio() {
  const { t } = useI18n();
  const [members, setMembers] = useState<Member[]>([
    { email: "mika@example.com", role: "editor" },
    { email: "jules@example.com", role: "viewer" },
  ]);
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Member["role"]>("editor");
  const [error, setError] = useState<"invalid" | "duplicate" | null>(null);
  const [message, setMessage] = useState("");
  const [tone, setTone] = useState<"success" | "info" | "error">("success");
  const [detailed, setDetailed] = useState(true);

  function addMember(event: FormEvent) {
    event.preventDefault();
    const normalized = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
      setError("invalid");
      return;
    }
    if (members.some((member) => member.email === normalized)) {
      setError("duplicate");
      return;
    }
    setMembers((current) => [...current, { email: normalized, role }]);
    setOpen(false);
    setEmail("");
    setError(null);
    toast.success(t("playground.memberAdded"));
  }
  function notify() {
    toast[tone](message.trim() || t("playground.messagePlaceholder"), {
      description: detailed ? t("playground.notificationDetail") : undefined,
    });
  }

  return (
    <section className="playground-feedback" aria-labelledby="feedback-heading">
      <div className="playground-section-heading">
        <span className="playground-kicker">
          02 / {t("playground.feedback")}
        </span>
        <h3 id="feedback-heading">{t("playground.feedbackTitle")}</h3>
        <p>{t("playground.feedbackDescription")}</p>
      </div>
      <div className="feedback-grid">
        <div className="playground-surface feedback-team">
          <div className="feedback-card-heading">
            <span className="feedback-icon">
              <UsersIcon aria-hidden="true" />
            </span>
            <div>
              <h4 className="flex items-center gap-2">
                {t("playground.collaborators")}
              </h4>
              <p aria-live="polite">
                {t("playground.memberCount", { count: members.length })}
              </p>
            </div>
          </div>
          <div className="feedback-members">
            {members.length === 0 ? (
              <p className="playground-muted">{t("playground.noMembers")}</p>
            ) : (
              members.map((member) => (
                <div key={member.email} className="feedback-member">
                  <Avatar className="size-9">
                    <AvatarFallback>
                      {member.email.slice(0, 2).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm">{member.email}</p>
                    <span className="text-xs text-muted-foreground">
                      {t(
                        member.role === "editor"
                          ? "playground.roleEditor"
                          : "playground.roleViewer",
                      )}
                    </span>
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={t("playground.memberActions", {
                          email: member.email,
                        })}
                      >
                        <MoreHorizontalIcon />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      {ROLES.map((item) => (
                        <DropdownMenuItem
                          key={item.value}
                          disabled={member.role === item.value}
                          onSelect={() =>
                            setMembers((current) =>
                              current.map((entry) =>
                                entry.email === member.email
                                  ? { ...entry, role: item.value }
                                  : entry,
                              ),
                            )
                          }
                        >
                          {t(item.label)}
                        </DropdownMenuItem>
                      ))}
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        variant="destructive"
                        onSelect={() => {
                          setMembers((current) =>
                            current.filter(
                              (entry) => entry.email !== member.email,
                            ),
                          );
                          toast.info(t("playground.memberRemoved"));
                        }}
                      >
                        <Trash2Icon />
                        {t("playground.removeMember")}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              ))
            )}
          </div>
          <Dialog
            open={open}
            onOpenChange={(value) => {
              setOpen(value);
              setError(null);
            }}
          >
            <DialogTrigger asChild>
              <Button variant="outline" className="w-full">
                <PlusIcon />
                {t("playground.addCollaborator")}
              </Button>
            </DialogTrigger>
            <DialogContent
              closeLabel={t("common.close")}
              className="sm:max-w-md"
            >
              <DialogHeader>
                <DialogTitle>{t("playground.inviteTitle")}</DialogTitle>
                <DialogDescription>
                  {t("playground.inviteDescription")}
                </DialogDescription>
              </DialogHeader>
              <form onSubmit={addMember} className="space-y-4" noValidate>
                <div className="studio-field">
                  <div className="flex h-6 min-w-0 items-center gap-2">
                    <Label htmlFor="playground-email" className="shrink-0">
                      {t("playground.email")}
                    </Label>
                    <span
                      id="playground-email-error"
                      role={error ? "alert" : undefined}
                      className="min-w-0 flex-1"
                    >
                      {error ? (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <button
                              data-surface="transparent"
                              data-variant="ghost"
                              type="button"
                              className="block w-full truncate rounded-sm text-right text-xs text-destructive underline decoration-dotted underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            >
                              {t(
                                error === "invalid"
                                  ? "playground.invalidEmail"
                                  : "playground.duplicateEmail",
                              )}
                            </button>
                          </TooltipTrigger>
                          <TooltipContent
                            side="bottom"
                            className="max-w-72 leading-relaxed"
                          >
                            {t(
                              error === "invalid"
                                ? "playground.invalidEmail"
                                : "playground.duplicateEmail",
                            )}
                          </TooltipContent>
                        </Tooltip>
                      ) : null}
                    </span>
                  </div>
                  <Input
                    id="playground-email"
                    type="email"
                    required
                    maxLength={254}
                    autoComplete="off"
                    value={email}
                    placeholder={t("playground.emailPlaceholder")}
                    aria-invalid={Boolean(error)}
                    aria-describedby={
                      error ? "playground-email-error" : undefined
                    }
                    onChange={(event) => {
                      setEmail(event.target.value);
                      setError(null);
                    }}
                  />
                </div>
                <div className="studio-field">
                  <Label htmlFor="playground-role">
                    {t("playground.role")}
                  </Label>
                  <Select
                    value={role}
                    onValueChange={(value) => setRole(value as Member["role"])}
                  >
                    <SelectTrigger id="playground-role" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent position="popper">
                      {ROLES.map((item) => (
                        <SelectItem value={item.value} key={item.value}>
                          {t(item.label)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <DialogFooter>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setOpen(false)}
                  >
                    {t("common.cancel")}
                  </Button>
                  <Button type="submit">{t("playground.addMember")}</Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        </div>
        <div className="playground-surface feedback-notifications">
          <div className="feedback-message-art" aria-hidden="true">
            <span className="feedback-message-line" />
            <span className="feedback-message-line" />
            <span className="feedback-message-line" />
            <span className="feedback-bell">
              <BellRingIcon />
            </span>
          </div>
          <h4>{t("playground.notificationTitle")}</h4>
          <div className="studio-field">
            <Label htmlFor="playground-message">
              {t("playground.message")}
            </Label>
            <Input
              id="playground-message"
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              maxLength={140}
              placeholder={t("playground.messagePlaceholder")}
            />
          </div>
          <div className="feedback-notification-actions">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button onClick={notify}>
                  <BellRingIcon />
                  {t("playground.sendNotification")}
                </Button>
              </TooltipTrigger>
              <TooltipContent className="max-w-64">
                {t("playground.notificationTooltip")}
              </TooltipContent>
            </Tooltip>
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  size="icon"
                  aria-label={t("playground.notificationPreferences")}
                >
                  <Settings2Icon />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-72">
                <PopoverHeader>
                  <PopoverTitle>
                    {t("playground.notificationPreferences")}
                  </PopoverTitle>
                  <PopoverDescription>
                    {t("playground.notificationDescription")}
                  </PopoverDescription>
                </PopoverHeader>
                <div className="mt-4 space-y-4">
                  <div className="studio-field">
                    <Label htmlFor="playground-tone">
                      {t("playground.tone")}
                    </Label>
                    <Select
                      value={tone}
                      onValueChange={(value) => setTone(value as typeof tone)}
                    >
                      <SelectTrigger id="playground-tone" className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent position="popper">
                        {TONES.map((item) => (
                          <SelectItem key={item.value} value={item.value}>
                            {t(item.label)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <Label htmlFor="playground-detailed">
                      {t("playground.detailedNotification")}
                    </Label>
                    <Switch
                      id="playground-detailed"
                      checked={detailed}
                      onCheckedChange={setDetailed}
                    />
                  </div>
                </div>
              </PopoverContent>
            </Popover>
          </div>
          <Badge variant="outline" className="mt-4">
            {t(TONES.find((item) => item.value === tone)!.label)}
          </Badge>
        </div>
      </div>
    </section>
  );
}
