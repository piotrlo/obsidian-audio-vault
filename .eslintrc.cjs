/** @type {import('eslint').Linter.Config} */
module.exports = {
  root: true,
  env: { es2022: true, browser: true, node: true },
  parser: "@typescript-eslint/parser",
  parserOptions: { ecmaVersion: "latest", sourceType: "module" },
  plugins: ["@typescript-eslint"],
  extends: [
    "eslint:recommended",
    "plugin:@typescript-eslint/recommended"
  ],
  ignorePatterns: [
    "main.js",
    "dist/",
    "docs/",
    "node_modules/",
    "**/*.d.ts"
  ],
  rules: {
    "no-unused-vars": "off",
    "@typescript-eslint/no-unused-vars": "off",
    "@typescript-eslint/no-explicit-any": "off"
  }
};


