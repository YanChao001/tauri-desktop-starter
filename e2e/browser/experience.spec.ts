/// <reference lib="dom" />
import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

async function seed(
  page: Page,
  theme = "dark",
  motion = "reduced",
  extra: {
    language?: string;
    sidebarWidth?: number;
    sidebarCollapsed?: boolean;
  } = {},
) {
  await page.addInitScript(
    (value) =>
      localStorage.setItem(
        "tauri-starter:settings",
        JSON.stringify({
          schemaVersion: 3,
          language: "en",
          background: "plain",
          accent: "blue",
          ...value,
        }),
      ),
    { theme, motion, ...extra },
  );
}
const frames = (page: Page, count = 8) =>
  page.evaluate(
    (count) =>
      new Promise<void>((resolve) => {
        const tick = () => {
          if (--count <= 0) resolve();
          else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }),
    count,
  );

test("guided routes follow real pages, keep same-page state and can be dismissed", async ({
  page,
}) => {
  await seed(page);
  await page.goto("./#/");
  await page.getByRole("link", { name: /Start exploring/ }).click();
  const guide = page.getByRole("region", { name: "Guided experience" });
  await expect(guide).toContainText("1/4");
  await guide.getByRole("link", { name: "Next step" }).click();
  await expect(page).toHaveURL(/#\/data-studio\?journey=interface&step=1$/);
  await guide.getByRole("link", { name: "Next step" }).click();
  await expect(
    page.getByRole("tab", { name: "Content & attachments" }),
  ).toHaveAttribute("aria-selected", "true");
  await guide.getByRole("link", { name: "Close guide" }).click();
  await expect(guide).toHaveCount(0);
  await page.goto("./#/workbench?journey=files&step=0&keep=1");
  await expect(
    page.getByText("Choose or drop a file", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("region", { name: "Guided experience" })
    .getByRole("link", { name: "Next step" })
    .click();
  await expect(page).toHaveURL(/workbench\?journey=files&step=1$/);
  await expect(
    page.getByText("This is a walkthrough of this page.", { exact: false }),
  ).toBeVisible();
  await page.goto("./#/tasks?journey=tasks&step=0&keep=1");
  await page.getByRole("link", { name: "Close guide" }).click();
  await expect(page).toHaveURL(/tasks\?keep=1$/);
});

test("workspace supports keyboard trees, context actions, resizing, drag moves and searchable type filters", async ({
  page,
}) => {
  await seed(page);
  await page.goto("./#/components");
  await page.getByRole("tab", { name: /Workspace/ }).click();
  const tree = page.getByRole("tree", { name: "Sample resource tree" });
  await tree
    .getByRole("treeitem", { name: "Creative assets", exact: true })
    .focus();
  await page.keyboard.press("ArrowRight");
  await expect(
    tree.getByRole("treeitem", { name: "brief.md", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Shift+F10");
  await page.getByRole("menuitem", { name: "Rename", exact: true }).click();
  await page
    .getByRole("textbox", { name: "File name", exact: true })
    .fill("sketch.md");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Save", exact: true })
    .click();
  const file = tree.getByRole("treeitem", { name: "sketch.md", exact: true });
  await expect(file).toBeVisible();
  await expect(file).toBeFocused();
  await file.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Duplicate", exact: true }).click();
  await expect(
    tree.getByRole("treeitem", { name: "Copy of sketch.md", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Undo last change", exact: true })
    .click();
  await expect(
    tree.getByRole("treeitem", { name: "Copy of sketch.md", exact: true }),
  ).toHaveCount(0);
  const separator = page.getByRole("separator", {
    name: "Resize resource panel",
  });
  const initial = Number(await separator.getAttribute("aria-valuenow"));
  await separator.focus();
  await page.keyboard.press("ArrowRight");
  await expect(separator).toHaveAttribute(
    "aria-valuenow",
    String(initial + 10),
  );
  await file.dragTo(
    tree.getByRole("treeitem", { name: "Code & data", exact: true }),
  );
  await tree
    .getByRole("treeitem", { name: "Creative assets", exact: true })
    .click();
  await expect(file).toBeVisible();
  await page.getByRole("button", { name: /Filter file types/ }).click();
  await page.getByRole("textbox", { name: "Search types" }).fill("code");
  await page.getByRole("checkbox", { name: "Code", exact: true }).uncheck();
  await page.keyboard.press("Escape");
  await expect(
    tree.getByRole("treeitem", { name: "motion.ts", exact: true }),
  ).toHaveCount(0);
  expect(
    await page
      .locator("main")
      .evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
  ).toBe(true);
});

test("data tabs retain input; columns resize, hide and reveal a real record detail", async ({
  page,
}) => {
  await seed(page);
  await page.goto("./#/data-studio");
  await page.getByRole("button", { name: "Show or hide columns" }).click();
  await page.getByRole("checkbox", { name: "Email", exact: true }).uncheck();
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("button", { name: "Show or hide columns" }),
  ).toBeFocused();
  await expect(page.getByRole("columnheader", { name: "Email" })).toHaveCount(
    0,
  );
  const width = page.getByRole("separator", { name: "Resize Name column" });
  await width.focus();
  await page.keyboard.press("End");
  await expect(width).toHaveAttribute("aria-valuenow", "400");
  await page
    .getByRole("button", { name: "View record 7", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toContainText("Demo 00007");
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("button", { name: "View record 7", exact: true }),
  ).toBeFocused();
  await page
    .getByRole("tab", { name: "Conditional form", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "Applicant", exact: true })
    .fill("Keep this input");
  await page.getByRole("tab", { name: "Records", exact: true }).click();
  await page
    .getByRole("tab", { name: "Conditional form", exact: true })
    .click();
  await expect(
    page.getByRole("textbox", { name: "Applicant", exact: true }),
  ).toHaveValue("Keep this input");
});

test("media sections load charts on demand and keep the local Markdown edit", async ({
  page,
}) => {
  await seed(page);
  await page.goto("./#/media");
  const source = page.locator("#markdown-source");
  await source.fill("# Keep this local edit");
  await page
    .getByRole("tab", { name: "Data visualization", exact: true })
    .click();
  await expect(
    page.getByRole("img", { name: /One week of demo metrics/ }),
  ).toBeVisible();
  expect(
    (
      await new AxeBuilder({ page })
        .include("main")
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
  await page
    .getByRole("tab", { name: "Live connections", exact: true })
    .click();
  await expect(
    page.getByText("Tabs keep this page’s state.", { exact: false }),
  ).toBeVisible();
  expect(
    (
      await new AxeBuilder({ page })
        .include("main")
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
  await page
    .getByRole("tab", { name: "Content & attachments", exact: true })
    .click();
  await expect(source).toHaveValue("# Keep this local edit");
});

test("spring dragging snaps to a target; orbital trails pause and stop offscreen", async ({
  page,
}) => {
  await seed(page, "dark", "full");
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("./#/motion");
  const orb = page.locator(".lab-spring-handle");
  await orb.scrollIntoViewIfNeeded();
  await expect
    .poll(async () => Number(await orb.getAttribute("cx")))
    .toBeGreaterThan(400);
  const box = await orb.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.down();
  await page.mouse.move(box!.x - 200, box!.y + box!.height / 2, { steps: 12 });
  await page.mouse.up();
  await expect
    .poll(async () => Number(await orb.getAttribute("cx")))
    .toBeLessThan(250);
  await page.getByRole("tab", { name: "Stellar paths", exact: true }).click();
  const trail = page.locator(".lab-orbit-trail").first();
  const position = () =>
    trail.evaluate((el) => (el as SVGPathElement).style.strokeDashoffset);
  const first = await position();
  await expect.poll(position).not.toBe(first);
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await frames(page, 2);
  const paused = await position();
  await frames(page);
  expect(await position()).toBe(paused);
  await page.getByRole("button", { name: "Resume", exact: true }).click();
  await expect.poll(position).not.toBe(paused);
  await page.locator("main").evaluate((el) => {
    const spacer = document.createElement("div");
    spacer.style.height = "2000px";
    el.append(spacer);
    el.scrollTop = el.scrollHeight;
  });
  await frames(page, 3);
  const hidden = await position();
  await frames(page);
  expect(await position()).toBe(hidden);
});

for (const viewport of [
  { width: 390, height: 844 },
  { width: 880, height: 600 },
]) {
  test(`new scenes fit the window: ${viewport.width}px`, async ({ page }) => {
    test.setTimeout(60_000);
    await page.setViewportSize(viewport);
    await seed(page, viewport.width === 390 ? "dark" : "light", "reduced", {
      language: viewport.width === 390 ? "zh" : "en",
      sidebarWidth: 360,
    });
    await page.goto("./#/motion");
    for (let scene = 0; scene < 4; scene++) {
      await page.locator(".lab-scene-tabs [role=tab]").nth(scene).click();
      expect(
        await page
          .locator("main")
          .evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
      ).toBe(true);
    }
    await page.goto("./#/components");
    await page.getByRole("tab", { name: /Workspace|工作区/ }).click();
    await expect(page.locator("#workspace-content")).toBeVisible();
    expect(
      await page
        .locator("main")
        .evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
    ).toBe(true);
    await page.goto("./#/catalog");
    await expect(page.locator(".experience-route")).toHaveCount(4);
    expect(
      await page
        .locator("main")
        .evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
    ).toBe(true);
  });
}

for (const [theme, motion] of [
  ["light", "reduced"],
  ["dark", "reduced"],
  ["light", "full"],
  ["dark", "full"],
]) {
  test(`every motion scene and the workspace pass WCAG scans: ${theme}, ${motion}`, async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await seed(page, theme, motion);
    if (motion === "full")
      await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.goto("./#/motion");
    await page.locator(".motion-lab").waitFor();
    await page
      .locator(".app-route-enter")
      .evaluate((el) =>
        Promise.all(
          el
            .getAnimations()
            .map((animation) => animation.finished.catch(() => {})),
        ),
      );
    for (const name of [
      "Spring physics",
      "Shared space",
      "Light & touch",
      "Stellar paths",
    ]) {
      await page.getByRole("tab", { name, exact: true }).click();
      if (
        motion === "full" &&
        (await page.getByRole("button", { name: "Pause", exact: true }).count())
      ) {
        await page.getByRole("button", { name: "Pause", exact: true }).click();
        await frames(page, 2);
      }
      const scan = await new AxeBuilder({ page })
        .include("main")
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
        .analyze();
      expect(scan.violations, name).toEqual([]);
    }
    await page.goto("./#/components");
    await page.getByRole("tab", { name: /Workspace/ }).click();
    await page
      .locator(".playground-stage:not([hidden])")
      .evaluate((el) =>
        Promise.all(
          el
            .getAnimations()
            .map((animation) => animation.finished.catch(() => {})),
        ),
      );
    const scan = await new AxeBuilder({ page })
      .include("main")
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    expect(scan.violations).toEqual([]);
  });
}
