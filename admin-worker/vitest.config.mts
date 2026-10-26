
import {
    cloudflareTest,
    readD1Migrations,
} from "@cloudflare/vitest-plugin";

import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
    plugins: [
        cloudflareTest(async () => {
            const migrationsPath = fileURLToPath(
                new URL("../integration/migrations/", import.meta.url)
            );

            const migrations = await readD1Migrations(
                migrationsPath
            );

            return {
                wrangler: {
                    configPath: "./wrangler.jsonc",
                },
                miniflare: {
                    bindings: {
                        TEST_MIGRATIONS: migrations,
                        ADMIN_API_ENABLED: "true",
                    },
                },
            };
        }),
    ],

    test: {
        setupFiles: ["./test/setup.ts"],
    },
});
