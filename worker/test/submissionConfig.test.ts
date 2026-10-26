
import { describe, expect, it } from "vitest";

import {
	checkSubmissionAccess,
} from "../src/security/submissionConfig";

const TEST_SECRET =
	"1x0000000000000000000000000000000AA";

const EXAMPLE_PRODUCTION_SECRET =
	"non-test-placeholder-used-only-in-tests";

describe("Submission configuration security", () => {
	it("allows development with testing credentials", () => {
		const result = checkSubmissionAccess({
			DEPLOYMENT_ENV: "development",
			ENABLE_INCIDENT_SUBMISSIONS: "true",
			TURNSTILE_TEST_MODE: "true",
			TURNSTILE_SECRET_KEY: TEST_SECRET,
		});

		expect(result).toEqual({
			allowed: true,
			testMode: true,
		});
	});

	it("rejects testing credentials in production", () => {
		const result = checkSubmissionAccess({
			DEPLOYMENT_ENV: "production",
			ENABLE_INCIDENT_SUBMISSIONS: "true",
			TURNSTILE_TEST_MODE: "true",
			TURNSTILE_SECRET_KEY: TEST_SECRET,
		});

		expect(result).toEqual({
			allowed: false,
			reason: "TEST_CREDENTIALS_IN_PRODUCTION",
		});
	});

	it("rejects test secrets even with test mode disabled", () => {
		const result = checkSubmissionAccess({
			DEPLOYMENT_ENV: "production",
			ENABLE_INCIDENT_SUBMISSIONS: "true",
			TURNSTILE_TEST_MODE: "false",
			TURNSTILE_SECRET_KEY: TEST_SECRET,
		});

		expect(result.allowed).toBe(false);
	});

	it("rejects missing deployment configuration", () => {
		const result = checkSubmissionAccess({
			ENABLE_INCIDENT_SUBMISSIONS: "true",
			TURNSTILE_TEST_MODE: "false",
			TURNSTILE_SECRET_KEY:
			EXAMPLE_PRODUCTION_SECRET,
		});

		expect(result).toEqual({
			allowed: false,
			reason: "INVALID_DEPLOYMENT_ENV",
		});
	});

	it("rejects disabled submissions", () => {
		const result = checkSubmissionAccess({
			DEPLOYMENT_ENV: "production",
			ENABLE_INCIDENT_SUBMISSIONS: "false",
			TURNSTILE_TEST_MODE: "false",
			TURNSTILE_SECRET_KEY:
			EXAMPLE_PRODUCTION_SECRET,
		});

		expect(result).toEqual({
			allowed: false,
			reason: "SUBMISSIONS_DISABLED",
		});
	});

	it("accepts production with non-test credentials", () => {
		const result = checkSubmissionAccess({
			DEPLOYMENT_ENV: "production",
			ENABLE_INCIDENT_SUBMISSIONS: "true",
			TURNSTILE_TEST_MODE: "false",
			TURNSTILE_SECRET_KEY:
			EXAMPLE_PRODUCTION_SECRET,
		});

		expect(result).toEqual({
			allowed: true,
			testMode: false,
		});
	});
});
