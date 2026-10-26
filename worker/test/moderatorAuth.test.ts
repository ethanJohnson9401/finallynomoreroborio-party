
import { describe, expect, it } from "vitest";

import {
	authorizeModerator,
} from "../src/security/moderatorAuth";

const config = {
	MODERATOR_EMAILS: "admin@example.com",
};

describe("Moderator authentication", () => {
	it("rejects unauthenticated requests", async () => {
		const result = await authorizeModerator(
			{},
			config
		);

		expect(result).toEqual({
			authorized: false,
			reason: "UNAUTHENTICATED",
		});
	});

	it("allows an approved moderator", async () => {
		const result = await authorizeModerator(
			{
				access: {
					getIdentity: async () => ({
						email: "admin@example.com",
					}),
				},
			},
			config
		);

		expect(result).toEqual({
			authorized: true,
			moderator: {
				email: "admin@example.com",
			},
		});
	});

	it("rejects unknown users", async () => {
		const result = await authorizeModerator(
			{
				access: {
					getIdentity: async () => ({
						email: "unknown@example.com",
					}),
				},
			},
			config
		);

		expect(result).toEqual({
			authorized: false,
			reason: "FORBIDDEN",
		});
	});

	it("rejects missing moderator configuration", async () => {
		const result = await authorizeModerator(
			{
				access: {
					getIdentity: async () => ({
						email: "admin@example.com",
					}),
				},
			},
			{}
		);

		expect(result.authorized).toBe(false);
	});

	it("rejects identity lookup failures", async () => {
		const result = await authorizeModerator(
			{
				access: {
					getIdentity: async () => {
						throw new Error("Access unavailable");
					},
				},
			},
			config
		);

		expect(result).toEqual({
			authorized: false,
			reason: "UNAUTHENTICATED",
		});
	});
});
