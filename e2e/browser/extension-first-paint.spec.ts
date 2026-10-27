/// <reference lib="dom" />
import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";

const sdk = await readFile(
  new URL("../../sdk/extension-ui.js", import.meta.url),
  "utf8",
);

for (const mode of ["dark", "light"] as const) {
  for (const motion of ["full", "reduced"] as const) {
    test(`extension controls use ${mode} colors on every first visible frame with ${motion} motion`, async ({
      page,
      context,
    }) => {
      await page.emulateMedia({ reducedMotion: "no-preference" });
      const background =
        mode === "dark" ? "rgb(10, 10, 10)" : "rgb(255, 255, 255)";
      const foreground =
        mode === "dark" ? "rgb(245, 245, 245)" : "rgb(23, 23, 23)";
      const muted = mode === "dark" ? "rgb(38, 38, 38)" : "rgb(229, 229, 229)";
      const snapshot = {
        view: { display: "Tool" },
        fields: {},
        checkpoint: null,
        busy: false,
        dirty: false,
        locale: "en",
        grantedPermissions: [],
        theme: {
          mode,
          motion,
          tokens: {
            "--background": background,
            "--foreground": foreground,
            "--primary": foreground,
            "--primary-foreground": background,
            "--secondary": background,
            "--secondary-foreground": foreground,
            "--muted": muted,
            "--border": foreground,
          },
        },
      };
      await context.addInitScript({ content: sdk });
      await page.route("http://extension-ui.localhost/first-paint", (route) =>
        route.fulfill({
          contentType: "text/html",
          body: `<!doctype html><title>Tool</title>
            <button id="open" type="button" data-variant="secondary">Open</button>
            <input id="input-button" type="button" data-variant="secondary" value="Input button">
            <section id="shadow-host"></section>
            <script>
            const shadow=document.querySelector('#shadow-host').attachShadow({mode:'open'});
            shadow.innerHTML='<button id="shadow-button" data-variant="secondary">Shadow button</button>';
            starter.applyStyles(shadow);
            let count=0;
            function sample(at) {
              for(const control of [document.querySelector('#open'),document.querySelector('#input-button'),shadow.querySelector('#shadow-button')]) {
                const style=getComputedStyle(control);
                parent.postMessage({type:'fixture:sample',at:performance.timeOrigin+at,
                  control:control.id,background:style.backgroundColor,color:style.color,
                  theme:document.documentElement.className,
                  transitions:control.getAnimations().filter(a=>a instanceof CSSTransition).length},'*');
              }
              if(++count<30)requestAnimationFrame(sample);
              else parent.postMessage({type:'fixture:done'},'*');
            }
            requestAnimationFrame(sample);
            </script>`,
        }),
      );
      await page.route("http://first-paint.test/", (route) =>
        route.fulfill({
          contentType: "text/html",
          body: `<!doctype html><title>Navigation</title>
            <style>body{background:${background};color:${foreground}}iframe{width:800px;height:300px;opacity:0;border:0}</style>
            <button id="navigate">Open tool</button><main>Another navigation page</main>
            <script>
            let frame;
            const visible=[];
            const host=[];
            document.querySelector('#navigate').onclick=()=>{
              document.querySelector('main').innerHTML='<iframe title="Tool" sandbox="allow-scripts" src="http://extension-ui.localhost/first-paint"></iframe>';
              frame=document.querySelector('iframe');
            };
            function observe(at){
              if(frame)host.push({at:performance.timeOrigin+at,visible:getComputedStyle(frame).opacity==='1'});
              if(!document.documentElement.dataset.complete)requestAnimationFrame(observe);
            }requestAnimationFrame(observe);
            window.addEventListener('message',event=>{
              if(event.source!==frame?.contentWindow || event.origin!=='null')return;
              if(event.data?.type==='starter:ready'){
                const channel=new MessageChannel();
                event.source.postMessage({type:'starter:connect',version:1},'*',[channel.port2]);
                channel.port1.postMessage({type:'state',value:${JSON.stringify(snapshot)}});
              }else if(event.data?.type==='starter:painted')frame.style.opacity='1';
              else if(event.data?.type==='fixture:sample'){
                if(host.findLast(item=>item.at<=event.data.at)?.visible)visible.push(event.data);
              }else if(event.data?.type==='fixture:done'){
                document.documentElement.dataset.samples=JSON.stringify(visible);
                document.documentElement.dataset.complete='true';
              }
            });
            </script>`,
        }),
      );
      await page.goto("http://first-paint.test/");
      await page.getByRole("button", { name: "Open tool" }).click();
      await expect(page.locator("html")).toHaveAttribute(
        "data-complete",
        "true",
      );
      const samples = JSON.parse(
        (await page.locator("html").getAttribute("data-samples")) ?? "[]",
      ) as {
        control: string;
        background: string;
        color: string;
        theme: string;
        transitions: number;
      }[];
      expect(samples.length).toBeGreaterThan(10);
      expect(new Set(samples.map((sample) => sample.control))).toEqual(
        new Set(["open", "input-button", "shadow-button"]),
      );
      for (const sample of samples) {
        expect(sample.theme).toBe(mode);
        expect(sample.background).toBe(background);
        expect(sample.color).toBe(foreground);
        expect(sample.transitions).toBe(0);
      }
      const control = page
        .frameLocator('iframe[title="Tool"]')
        .locator("#open");
      await control.hover();
      await expect(control).not.toHaveCSS("background-color", background);
      const transitions = await control.evaluate((node) => {
        const style = getComputedStyle(node);
        return {
          properties: style.transitionProperty.split(", "),
          durations: style.transitionDuration.split(", "),
        };
      });
      expect(transitions.properties).toContain("background-color");
      expect(transitions.durations.length).toBeGreaterThan(0);
      expect(
        transitions.durations.every(
          (duration) =>
            duration === (motion === "reduced" ? "0.001s" : "0.15s"),
        ),
      ).toBe(true);
      await expect(
        page
          .frameLocator('iframe[title="Tool"]')
          .locator("[data-starter-initial-paint]"),
      ).toHaveCount(0);
    });
  }
}
