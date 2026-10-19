#!/usr/bin/env node
import { appendFileSync } from "node:fs";
import { resolve } from "node:path";
import { checkVersions } from "./version.mjs";

const tag =
  process.argv[2] ?? process.env.GITHUB_REF?.match(/^refs\/tags\/(.+)$/)?.[1];
try {
  const version = checkVersions(resolve(import.meta.dirname, ".."), tag);
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(
      process.env.GITHUB_OUTPUT,
      `version=${version}\nprerelease=${version.split("+")[0].includes("-")}\n`,
    );
  }
  console.log(`项目版本一致：${version}${tag ? `（${tag}）` : ""}`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
