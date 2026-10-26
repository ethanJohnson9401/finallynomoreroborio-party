
import { env } from "cloudflare:workers";
import {
    applyD1Migrations,
    type D1Migration,
} from "cloudflare:test";

type TestBindings = typeof env & {
    DB: D1Database;
    TEST_MIGRATIONS: D1Migration[];
};

const testEnv = env as TestBindings;

await applyD1Migrations(
    testEnv.DB,
    testEnv.TEST_MIGRATIONS
);
