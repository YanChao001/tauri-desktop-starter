import {
  isRecord,
  migrateSettings,
  normalizeSettingsPatch,
  settingsDocument,
  type AppSettings,
} from "./settings-model";

export type PersistenceStatus = "loading" | "saving" | "saved" | "error";
export type SettingsSnapshot = { revision: number; settings: unknown };
export type SettingsBackend = {
  load(): Promise<SettingsSnapshot>;
  save(
    settings: ReturnType<typeof settingsDocument>,
    revision: number,
  ): Promise<SettingsSnapshot>;
  subscribe(handler: (snapshot: SettingsSnapshot) => void): Promise<() => void>;
};
type State = {
  settings: AppSettings;
  status: PersistenceStatus;
  error: string | null;
};
const codeOf = (error: unknown) =>
  isRecord(error) && typeof error.code === "string"
    ? error.code
    : "STORAGE_UNAVAILABLE";

/** 保留本地字段变更，直至基于版本校验的写入成功，避免被远端快照覆盖。 */
export class SettingsSync {
  private base: AppSettings;
  private pending: Partial<AppSettings> = {};
  private inFlight: Partial<AppSettings> = {};
  private revision = -1;
  private ready = false;
  private saving = false;
  private loading = false;
  private stopped = false;
  private blocked = false;
  private needsSeed = false;
  private error: string | null = null;
  private initialization: Promise<void> | null = null;
  private unlisten?: () => void;
  private completions = new Set<{
    resolve: () => void;
    reject: (error: { code: string }) => void;
  }>();

  constructor(
    initial: AppSettings,
    private backend: SettingsBackend,
    private changed: (state: State) => void,
  ) {
    this.base = initial;
  }

  private settings() {
    return { ...this.base, ...this.inFlight, ...this.pending };
  }
  private emit() {
    if (this.stopped) return;
    const status: PersistenceStatus = this.error
      ? "error"
      : this.loading || !this.ready
        ? "loading"
        : this.saving || this.needsSeed || Object.keys(this.pending).length
          ? "saving"
          : "saved";
    this.changed({ settings: this.settings(), status, error: this.error });
    if (status === "saved" || status === "error") {
      for (const completion of this.completions) {
        if (this.error) completion.reject({ code: this.error });
        else completion.resolve();
      }
      this.completions.clear();
    }
  }
  private fail(error: unknown) {
    this.error = codeOf(error);
    if (this.error === "FUTURE_SETTINGS_VERSION") this.blocked = true;
    this.emit();
  }

  private accept(snapshot: SettingsSnapshot) {
    if (!Number.isSafeInteger(snapshot.revision) || snapshot.revision < 0)
      throw new Error("Invalid settings revision");
    if (snapshot.revision <= this.revision) return;
    const first = this.revision < 0;
    let next: AppSettings;
    try {
      next = migrateSettings(snapshot.settings);
    } catch (error) {
      // 保留版本号，确保显式重置可以安全替换更高版本的结构。
      if (codeOf(error) === "FUTURE_SETTINGS_VERSION")
        this.revision = snapshot.revision;
      throw error;
    }
    this.revision = snapshot.revision;
    if (
      first &&
      isRecord(snapshot.settings) &&
      Object.keys(snapshot.settings).length === 0
    ) {
      // 新建原生存档时，仅用现有浏览器偏好初始化一次。
      this.needsSeed = true;
    } else {
      this.base = next;
      this.needsSeed = false;
    }
    if (this.blocked) {
      this.blocked = false;
      this.error = null;
    }
  }

  start(): Promise<void> {
    if (this.stopped || this.ready) return Promise.resolve();
    return this.initialize();
  }

  private initialize(): Promise<void> {
    if (this.initialization) return this.initialization;
    this.loading = true;
    if (!this.blocked) this.error = null;
    this.emit();
    const operation = async () => {
      if (this.stopped) return;
      try {
        if (!this.unlisten) {
          const stop = await this.backend.subscribe((snapshot) => {
            if (this.stopped) return;
            try {
              this.accept(snapshot);
              this.emit();
            } catch (error) {
              this.fail(error);
            }
          });
          if (this.stopped) {
            stop();
            return;
          }
          this.unlisten = stop;
        }
        const snapshot = await this.backend.load();
        if (this.stopped) return;
        this.accept(snapshot);
        this.ready = true;
      } catch (error) {
        if (!this.stopped) this.fail(error);
      } finally {
        this.loading = false;
        this.emit();
      }
      await this.flush();
    };
    this.initialization = Promise.resolve()
      .then(operation)
      .finally(() => {
        this.initialization = null;
      });
    return this.initialization;
  }

  update(patch: Partial<AppSettings>) {
    if (this.stopped) return;
    this.pending = {
      ...this.pending,
      ...normalizeSettingsPatch(this.settings(), patch),
    };
    this.emit();
    void this.flush();
  }

  reset(settings: AppSettings): Promise<void> {
    if (this.stopped) return Promise.reject({ code: "STORAGE_UNAVAILABLE" });
    const completion = new Promise<void>((resolve, reject) => {
      this.completions.add({ resolve, reject });
    });
    this.blocked = false;
    this.error = null;
    this.pending = migrateSettings(settings);
    if (this.revision >= 0 && this.unlisten) this.ready = true;
    this.emit();
    if (!this.ready) void this.initialize();
    else void this.flush();
    return completion;
  }

  async retry() {
    if (this.stopped || this.saving) return;
    await this.initialize();
  }

  private async flush() {
    if (
      !this.ready ||
      this.loading ||
      this.saving ||
      this.stopped ||
      this.blocked ||
      this.error
    )
      return;
    this.saving = true;
    let conflicts = 0;
    try {
      while (
        !this.stopped &&
        !this.blocked &&
        !this.error &&
        (this.needsSeed || Object.keys(this.pending).length)
      ) {
        const seeding = this.needsSeed;
        this.needsSeed = false;
        this.inFlight = this.pending;
        this.pending = {};
        this.emit();
        const revision = this.revision;
        try {
          const snapshot = await this.backend.save(
            settingsDocument(this.settings()),
            revision,
          );
          if (this.stopped) return;
          this.accept(snapshot);
          this.inFlight = {};
          conflicts = 0;
        } catch (error) {
          this.needsSeed ||= seeding && this.revision === revision;
          this.pending = { ...this.inFlight, ...this.pending };
          this.inFlight = {};
          if (this.stopped) return;
          if (codeOf(error) === "SETTINGS_CONFLICT" && conflicts++ < 3) {
            const snapshot = await this.backend.load();
            if (this.stopped) return;
            this.accept(snapshot);
            continue;
          }
          this.fail(error);
        }
      }
    } catch (error) {
      if (!this.stopped) this.fail(error);
    } finally {
      this.saving = false;
      this.emit();
    }
  }

  /** 返回未保存字段，供提供器生命周期重放时恢复本地变更。 */
  stop(): Partial<AppSettings> {
    this.stopped = true;
    this.unlisten?.();
    this.unlisten = undefined;
    for (const completion of this.completions)
      completion.reject({ code: "STORAGE_UNAVAILABLE" });
    this.completions.clear();
    return { ...this.inFlight, ...this.pending };
  }
}
