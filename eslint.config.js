import js from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "dist/**",
      "node_modules/**",
      "src-tauri/**",
      // shadcn 原子组件沿用上游编码风格；行为修复仍需类型检查与回归验证
      "src/components/ui/**",
    ],
  },
  {
    files: ["**/*.{js,mjs,cjs,ts,tsx}"],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
    },
    plugins: { "react-hooks": reactHooks },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
  {
    // 应用源码是浏览器环境：误用 process、Buffer 这类 Node API 会直接报错
    files: ["src/**/*.{ts,tsx}"],
    languageOptions: { globals: globals.browser },
  },
  {
    // 构建脚本与配置文件是 Node 环境
    files: ["*.config.{js,ts}", "scripts/**/*.mjs"],
    languageOptions: { globals: globals.node },
  },
  {
    // 架构约束：系统能力只能从 lib/tauri.ts 出去。
    // 这条规则在 architecture.md 里写成「硬规则」，这里是它的执行者——
    // 没有这道校验，越界只能靠 review 时用眼睛发现。
    files: ["src/**/*.{ts,tsx}"],
    // 测试文件需要直接 mock @tauri-apps 模块，属于规则的有效例外
    ignores: [
      "src/lib/tauri.ts",
      "src/**/*.test.{ts,tsx}",
      "src/**/*.spec.{ts,tsx}",
    ],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@tauri-apps/**"],
              message:
                "系统能力统一收敛在 src/lib/tauri.ts。页面、组件、hooks 请调用那里的函数，不要直接引入 Tauri API。",
            },
          ],
        },
      ],
      // no-restricted-imports 只检查静态 import 声明，拦不住 import()。
      // 而本工程的 Tauri 调用恰好都是动态引入，所以这条必须单独补。
      "no-restricted-syntax": [
        "error",
        {
          selector: String.raw`ImportExpression[source.value=/^@tauri-apps\//]`,
          message:
            "系统能力统一收敛在 src/lib/tauri.ts。页面、组件、hooks 请调用那里的函数，不要直接引入 Tauri API。",
        },
      ],
    },
  },
);
