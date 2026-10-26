
import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  globalIgnores([
    // Next.js generated files
    ".next/",
    "**/.next/",
    "out/",
    "**/out/",
    "build/",
    "**/build/",
    "dist/",
    "**/dist/",

    // Dependencies and Cloudflare local state
    "node_modules/",
    "**/node_modules/",
    ".wrangler/",
    "**/.wrangler/",

    // Generated TypeScript definitions
    "next-env.d.ts",
    "**/next-env.d.ts",
    "**/worker-configuration.d.ts",

    // Test coverage
    "coverage/",
    "**/coverage/",
  ]),

  ...nextVitals,
  ...nextTs,
]);

export default eslintConfig;
