
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
				new URL("./migrations/", import.meta.url)
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
					},
				},
			};
		}),
	],

	test: {
		setupFiles: ["./test/setup.ts"],
	},
});
