
import { env } from "cloudflare:workers";
import { applyD1Migrations } from "cloudflare:test";

import type { D1Migration } from "cloudflare:test";

const testEnv = env as typeof env & {
	DB: D1Database;
	TEST_MIGRATIONS: D1Migration[];
};

await applyD1Migrations(
	testEnv.DB,
	testEnv.TEST_MIGRATIONS
);
