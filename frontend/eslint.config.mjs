// Flat-config wrapper around eslint-config-next.
// INF-05 layers a CI step on top that fails on warnings.
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({ baseDirectory: __dirname });

const config = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    rules: {
      // Auth journey relies on server actions; explicit `any` is banned to keep
      // the server/client boundary clear (AUTH-05).
      "@typescript-eslint/no-explicit-any": "error",
    },
  },
];

export default config;
