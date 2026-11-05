import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // `.claude/**` holds app/session state and app-managed git worktrees (full repo copies);
    // linting it would flag another checkout's code, so keep `npm run lint` scoped to this tree.
    ignores: ["dist/**", "node_modules/**", "web/**", ".claude/**"],
  },
  {
    files: ["src/**/*.ts"],
    rules: {
      "no-console": ["error", { allow: ["error"] }],
    },
  },
);
