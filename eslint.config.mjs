import js from "@eslint/js";
import ts from "typescript-eslint";
import vue from "eslint-plugin-vue";
import globals from "globals";
export default ts.config(
  {
    ignores: [
      "node_modules/**",
      ".agents/**",
      "**/.playwright-cli/**",
      ".cache/**",
      "**/dist/**",
      "coverage/**",
      "tests/fixtures/**",
      "output/**",
      "test-results/**",
      "playwright-report/**",
    ],
  },
  js.configs.recommended,
  ...ts.configs.recommended,
  ...vue.configs["flat/essential"],
  {
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
    },
  },
  {
    files: ["**/*.vue"],
    languageOptions: { parserOptions: { parser: ts.parser } },
    rules: { "vue/multi-word-component-names": "off" },
  },
);
