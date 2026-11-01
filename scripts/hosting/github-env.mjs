import { appendFileSync } from "node:fs";

/** GitHub Actions 环境协议；其他脚本不直接依赖其变量名或输出格式。 */
export function tagFromEnvironment(env = process.env) {
  return env.GITHUB_REF?.match(/^refs\/tags\/(.+)$/)?.[1];
}

export function writeOutput(name, value, env = process.env) {
  if (/[\r\n=]/.test(name) || /[\r\n]/.test(String(value)))
    throw new Error("CI outputs must be single-line values");
  if (env.GITHUB_OUTPUT)
    appendFileSync(env.GITHUB_OUTPUT, `${name}=${value}\n`);
}

export function writeEnvironment(name, value, env = process.env) {
  if (/[\r\n=]/.test(name) || /[\r\n]/.test(String(value)))
    throw new Error("CI environment values must be single-line values");
  if (env.GITHUB_ENV) appendFileSync(env.GITHUB_ENV, `${name}=${value}\n`);
}
