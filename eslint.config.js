import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["**/dist/**", "**/node_modules/**", "**/*.min.js"],
  },
  ...tseslint.configs.recommended,
  {
    rules: {
      "no-console": "warn",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/no-explicit-any": "warn",
    },
  },
);
