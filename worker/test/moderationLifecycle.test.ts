
import {
	afterEach,
	describe,
	expect,
	it,
	vi,
} from "vitest";

import { env } from "cloudflare:workers";

import publicWorker from "../src/index";
import adminWorker from "../../admin-worker/src/index";

import {
	DASHBOARD_ORIGIN,
} from "../../admin-worker/src/security/requestOrigin";

type PublicEnv = Parameters<typeof publicWorker.fetch>[1];
type AdminEnv = Parameters<typeof adminWorker.fetch>[1];
type AdminContext = Parameters<typeof adminWorker.fetch>[2];

const PUBLIC_URL = "http://localhost/api/incidents";
const ARCHIVE_URL = "http://localhost/api/incidents/approved";
const ADMIN_URL = "http://localhost/api/admin/incidents";

const TEST_SECRET = "1x0000000000000000000000000000000AA";
const TEST_TOKEN = "XXXX.DUMMY.TOKEN.XXXX";

const STORY_APPROVE =
	"Integration test: the roboRIO unexpectedly disconnected during our elimination match.";

const STORY_REJECT =
	"Integration test: the roboRIO demanded a retirement party before autonomous.";

const publicEnv = {
	...env,
	DEPLOYMENT_ENV: "development",
	ENABLE_INCIDENT_SUBMISSIONS: "true",
	TURNSTILE_TEST_MODE: "true",
	TURNSTILE_SECRET_KEY: TEST_SECRET,
	INCIDENT_LIMITER: {
		limit: async () => ({ success: true }),
	},
} as PublicEnv;

const adminEnv = {
	...env,
	ADMIN_API_ENABLED: "true",
	ADMIN_QUEUE_ENABLED: "true",
	MODERATOR_EMAILS: "admin@example.com",
} as AdminEnv;

const moderatorContext = {
	access: {
		getIdentity: async () => ({
			email: "admin@example.com",
		}),
	},
} as unknown as AdminContext;

function mockTurnstile() {
	return vi.spyOn(globalThis, "fetch").mockImplementation(
		async () =>
			Response.json({
				success: true,
				metadata: {
					result_with_testing_key: true,
				},
			})
	);
}

function submissionRequest(
	key: string,
	story: string
): Request {
	return new Request(PUBLIC_URL, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			"CF-Connecting-IP": "192.0.2.253",
		},
		body: JSON.stringify({
			story,
			submissionKey: key,
			turnstileToken: TEST_TOKEN,
		}),
	});
}

async function submit(
	key: string,
	story: string
): Promise<Response> {
	return publicWorker.fetch(
		submissionRequest(key, story),
		publicEnv
	);
}

async function getQueue(): Promise<Response> {
	return adminWorker.fetch(
		new Request(ADMIN_URL, {
			headers: {
				Origin: DASHBOARD_ORIGIN,
			},
		}),
		adminEnv,
		moderatorContext
	);
}

async function review(
	id: string,
	action: "approve" | "reject"
): Promise<Response> {
	return adminWorker.fetch(
		new Request(`${ADMIN_URL}/${id}/${action}`, {
			method: "POST",
			headers: {
				Origin: DASHBOARD_ORIGIN,
			},
		}),
		adminEnv,
		moderatorContext
	);
}

async function getArchive(): Promise<Response> {
	return publicWorker.fetch(
		new Request(ARCHIVE_URL),
		publicEnv
	);
}

async function getIncident(id: string) {
	return env.DB.prepare(
		`SELECT id, story, status, reviewed_at, published_at
         FROM incidents
         WHERE id = ?`
	)
		.bind(id)
		.first<{
			id: string;
			story: string;
			status: string;
			reviewed_at: string | null;
			published_at: string | null;
		}>();
}

async function getAuditCount(id: string): Promise<number> {
	const result = await env.DB
		.prepare(
			`SELECT COUNT(*) AS total
             FROM moderation_audit
             WHERE incident_id = ?`
		)
		.bind(id)
		.first<{ total: number }>();

	return result?.total ?? 0;
}

async function cleanUp(id: string) {
	await env.DB
		.prepare(
			"DELETE FROM incident_withdrawal_audit WHERE incident_id = ?"
		)
		.bind(id)
		.run();

	await env.DB
		.prepare(
			"DELETE FROM moderation_audit WHERE incident_id = ?"
		)
		.bind(id)
		.run();

	await env.DB
		.prepare(
			"DELETE FROM incidents WHERE id = ?"
		)
		.bind(id)
		.run();
}

afterEach(() => {
	vi.restoreAllMocks();
});

describe("Complete incident moderation lifecycle", () => {
	it("submits, approves, audits, and publishes an incident", async () => {
		mockTurnstile();

		const key = crypto.randomUUID();
		let incidentId: string | null = null;

		try {
			const submission = await submit(
				key,
				STORY_APPROVE
			);

			expect(submission.status).toBe(201);

			const receipt = await submission.json() as {
				id: string;
				status: string;
				moderation: string;
			};

			incidentId = receipt.id;

			expect(receipt.status).toBe("received");
			expect(receipt.moderation).toBe("pending");

			const pending = await getIncident(incidentId);

			expect(pending?.status).toBe("pending");
			expect(pending?.published_at).toBeNull();

			const beforeArchive = await getArchive();

			expect(beforeArchive.status).toBe(200);

			const beforeData = await beforeArchive.json() as {
				incidents: Array<{ id: string }>;
			};

			expect(
				beforeData.incidents.some(
					(item) => item.id === incidentId
				)
			).toBe(false);

			const queueResponse = await getQueue();

			expect(queueResponse.status).toBe(200);

			const queue = await queueResponse.json() as {
				incidents: Array<{ id: string }>;
			};

			expect(
				queue.incidents.some(
					(item) => item.id === incidentId
				)
			).toBe(true);

			const approval = await review(
				incidentId,
				"approve"
			);

			expect(approval.status).toBe(200);

			const approved = await getIncident(incidentId);

			expect(approved?.status).toBe("approved");
			expect(approved?.reviewed_at).not.toBeNull();
			expect(approved?.published_at).not.toBeNull();
			expect(await getAuditCount(incidentId)).toBe(1);

			const afterArchive = await getArchive();

			expect(afterArchive.status).toBe(200);

			const published = await afterArchive.json() as {
				incidents: Array<{
					id: string;
					story: string;
				}>;
			};

			expect(published.incidents).toEqual(
				expect.arrayContaining([
					expect.objectContaining({
						id: incidentId,
						story: STORY_APPROVE,
					}),
				])
			);

			const replay = await submit(
				key,
				STORY_APPROVE
			);

			expect(replay.status).toBe(200);

			const replayReceipt = await replay.json() as {
				id: string;
				moderation: string;
			};

			expect(replayReceipt.id).toBe(incidentId);

			// A replay never reveals current moderation status.
			expect(replayReceipt.moderation).toBe("pending");
		} finally {
			if (incidentId) {
				await cleanUp(incidentId);
			}
		}
	});

	it("rejects, audits, and never publishes an incident", async () => {
		mockTurnstile();

		const key = crypto.randomUUID();
		let incidentId: string | null = null;

		try {
			const submission = await submit(
				key,
				STORY_REJECT
			);

			expect(submission.status).toBe(201);

			const receipt = await submission.json() as {
				id: string;
			};

			incidentId = receipt.id;

			const rejection = await review(
				incidentId,
				"reject"
			);

			expect(rejection.status).toBe(200);

			const rejected = await getIncident(incidentId);

			expect(rejected?.status).toBe("rejected");
			expect(rejected?.reviewed_at).not.toBeNull();
			expect(rejected?.published_at).toBeNull();
			expect(await getAuditCount(incidentId)).toBe(1);

			const archiveResponse = await getArchive();

			expect(archiveResponse.status).toBe(200);

			const archive = await archiveResponse.json() as {
				incidents: Array<{ id: string }>;
			};

			expect(
				archive.incidents.some(
					(item) => item.id === incidentId
				)
			).toBe(false);

			const secondReview = await review(
				incidentId,
				"approve"
			);

			expect(secondReview.status).toBe(409);
			expect(await getAuditCount(incidentId)).toBe(1);
		} finally {
			if (incidentId) {
				await cleanUp(incidentId);
			}
		}
	});


	it("removes a withdrawn incident from the public Memorial", async () => {
		mockTurnstile();

		const key = crypto.randomUUID();
		const story =
			"Integration test: the roboRIO mysteriously lost communications during the championship match.";

		const reason =
			"Privacy removal requested by the incident submitter.";

		let incidentId: string | null = null;

		try {
			// 1. Submit a new incident.
			const submission = await submit(key, story);

			expect(submission.status).toBe(201);

			const receipt = await submission.json() as {
				id: string;
			};

			incidentId = receipt.id;

			// 2. Approve the incident through the Admin API.
			const approval = await review(
				incidentId,
				"approve"
			);

			expect(approval.status).toBe(200);

			// 3. Confirm that it appears publicly.
			const beforeResponse = await getArchive();

			expect(beforeResponse.status).toBe(200);

			const before = await beforeResponse.json() as {
				incidents: Array<{ id: string }>;
			};

			expect(
				before.incidents.some(
					(item) => item.id === incidentId
				)
			).toBe(true);

			// 4. Withdraw the report using the real Admin API.
			const withdrawal = await adminWorker.fetch(
				new Request(
					`${ADMIN_URL}/${incidentId}/withdraw`,
					{
						method: "POST",
						headers: {
							Origin: DASHBOARD_ORIGIN,
							"Content-Type": "application/json",
						},
						body: JSON.stringify({ reason }),
					}
				),
				adminEnv,
				moderatorContext
			);

			expect(withdrawal.status).toBe(200);

			// 5. The report stays approved but is unpublished.
			const incident = await env.DB
				.prepare(
					`SELECT
                    status,
                    published_at,
                    withdrawn_at
                 FROM incidents
                 WHERE id = ?`
				)
				.bind(incidentId)
				.first<{
					status: string;
					published_at: string | null;
					withdrawn_at: string | null;
				}>();

			expect(incident?.status).toBe("approved");
			expect(incident?.published_at).toBeNull();
			expect(incident?.withdrawn_at).not.toBeNull();

			// 6. Confirm it has disappeared from the public API.
			const afterResponse = await getArchive();

			expect(afterResponse.status).toBe(200);

			const after = await afterResponse.json() as {
				incidents: Array<{ id: string }>;
			};

			expect(
				after.incidents.some(
					(item) => item.id === incidentId
				)
			).toBe(false);

			// 7. Confirm the private withdrawal audit exists.
			const audit = await env.DB
				.prepare(
					`SELECT moderator_email, reason
                 FROM incident_withdrawal_audit
                 WHERE incident_id = ?`
				)
				.bind(incidentId)
				.first<{
					moderator_email: string;
					reason: string;
				}>();

			expect(audit).toEqual({
				moderator_email: "admin@example.com",
				reason,
			});

			// 8. Repeated withdrawal must fail.
			const secondWithdrawal = await adminWorker.fetch(
				new Request(
					`${ADMIN_URL}/${incidentId}/withdraw`,
					{
						method: "POST",
						headers: {
							Origin: DASHBOARD_ORIGIN,
							"Content-Type": "application/json",
						},
						body: JSON.stringify({ reason }),
					}
				),
				adminEnv,
				moderatorContext
			);

			expect(secondWithdrawal.status).toBe(409);
		} finally {
			if (incidentId) {
				await cleanUp(incidentId);
			}
		}
	});

});
