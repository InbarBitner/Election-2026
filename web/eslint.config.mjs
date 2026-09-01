import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const compat = new FlatCompat({
  baseDirectory: dirname(fileURLToPath(import.meta.url)),
});

const config = [
  {
    ignores: [
      ".next/**",
      "node_modules/**",
      "next-env.d.ts",
      // Run directly by Node's type stripping, outside the bundler's module
      // resolution, so the .ts import specifiers it needs would be flagged.
      "scripts/**",
    ],
  },
  ...compat.extends("next/core-web-vitals", "next/typescript"),
];

export default config;
