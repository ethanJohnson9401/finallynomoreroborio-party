
import {
    getPendingIncidentPage,
    reviewIncident,
    withdrawIncident,
    type ReviewDecision,
} from "./db/incidents";

import {
    findIncidentForModerator,
} from "./db/incidentLookup";

import {
    authorizeModerator,
} from "./security/moderatorAuth";

import {
    DASHBOARD_ORIGIN,
    isTrustedWriteOrigin,
    writeCorsHeaders,
} from "./security/requestOrigin";

interface Env {
    DB: D1Database;
    MODERATOR_EMAILS?: string;
    ADMIN_API_ENABLED?: string;
    ADMIN_QUEUE_ENABLED?: string;
}

const QUEUE_PATH = "/api/admin/incidents";

const INCIDENT_LOOKUP_PATH =
    /^\/api\/admin\/incidents\/([^/]+)$/;

const REVIEW_PATH =
    /^\/api\/admin\/incidents\/([^/]+)\/(approve|reject)$/;

const WITHDRAW_PATH =
    /^\/api\/admin\/incidents\/([^/]+)\/withdraw$/;

const UUID_PATTERN =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const MAX_WITHDRAWAL_BODY_BYTES = 2048;

/**
 * Generate a JSON API response.
 */
function jsonResponse(
    body: unknown,
    status = 200
): Response {
    return Response.json(body, {
        status,
        headers: {
            "Cache-Control": "no-store",
            "X-Content-Type-Options": "nosniff",
        },
    });
}

/**
 * Attach credentialed CORS headers only
 * for the trusted admin dashboard origin.
 */
function reviewResponse(
    request: Request,
    body: unknown,
    status = 200
): Response {
    const response = jsonResponse(body, status);

    response.headers.set("Vary", "Origin");

    if (isTrustedWriteOrigin(request)) {
        const cors = writeCorsHeaders();

        cors.forEach((value, name) => {
            response.headers.set(name, value);
        });
    }

    return response;
}

/**
 * Authenticated read-only response.
 *
 * CORS does not grant authorization.
 */
function readResponse(
    request: Request,
    body: unknown,
    status = 200
): Response {
    const headers = new Headers({
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
        "Vary": "Origin",
        "X-Content-Type-Options": "nosniff",
    });

    if (
        request.headers.get("Origin") ===
        DASHBOARD_ORIGIN
    ) {
        headers.set(
            "Access-Control-Allow-Origin",
            DASHBOARD_ORIGIN
        );

        headers.set(
            "Access-Control-Allow-Credentials",
            "true"
        );
    }

    return new Response(
        JSON.stringify(body),
        {
            status,
            headers,
        }
    );
}

/**
 * Method-not-allowed response.
 */
function methodNotAllowed(
    allowed: string
): Response {
    const response = jsonResponse(
        { error: "METHOD_NOT_ALLOWED" },
        405
    );

    response.headers.set(
        "Allow",
        allowed
    );

    return response;
}

/**
 * CORS preflight for review mutations.
 *
 * Shared by approval, rejection, and withdrawal.
 */
function reviewPreflight(
    request: Request
): Response {
    const requestedMethod =
        request.headers.get(
            "Access-Control-Request-Method"
        );

    const requestedHeaders =
        request.headers.get(
            "Access-Control-Request-Headers"
        );

    const headersAllowed =
        !requestedHeaders ||
        requestedHeaders
            .split(",")
            .every(
                (header) =>
                    header.trim().toLowerCase() ===
                    "content-type"
            );

    if (
        !isTrustedWriteOrigin(request) ||
        requestedMethod !== "POST" ||
        !headersAllowed
    ) {
        return jsonResponse(
            { error: "CORS_PREFLIGHT_DENIED" },
            403
        );
    }

    return new Response(null, {
        status: 204,
        headers: writeCorsHeaders(),
    });
}

/**
 * Runtime feature switches.
 */
function isQueueEnabled(env: Env): boolean {
    return env.ADMIN_QUEUE_ENABLED === "true";
}

function areReviewsEnabled(env: Env): boolean {
    return env.ADMIN_API_ENABLED === "true";
}

/**
 * Parse withdrawal requests without buffering
 * an unbounded body.
 */
async function readWithdrawalBody(
    request: Request
): Promise<
    | { ok: true; body: unknown }
    | {
    ok: false;
    error: string;
    status: number;
}
> {
    const declaredLength =
        request.headers.get("Content-Length");

    if (declaredLength !== null) {
        const length = Number(declaredLength);

        if (
            !Number.isSafeInteger(length) ||
            length < 0 ||
            length > MAX_WITHDRAWAL_BODY_BYTES
        ) {
            return {
                ok: false,
                error: "REQUEST_TOO_LARGE",
                status: 413,
            };
        }
    }

    if (!request.body) {
        return {
            ok: false,
            error: "INVALID_JSON",
            status: 400,
        };
    }

    const reader = request.body.getReader();
    const chunks: Uint8Array[] = [];

    let totalBytes = 0;

    try {
        while (true) {
            const { done, value } =
                await reader.read();

            if (done) {
                break;
            }

            totalBytes += value.byteLength;

            if (
                totalBytes >
                MAX_WITHDRAWAL_BODY_BYTES
            ) {
                void reader.cancel().catch(() => {});

                return {
                    ok: false,
                    error: "REQUEST_TOO_LARGE",
                    status: 413,
                };
            }

            chunks.push(value);
        }
    } catch {
        return {
            ok: false,
            error: "INVALID_JSON",
            status: 400,
        };
    } finally {
        reader.releaseLock();
    }

    const bytes = new Uint8Array(totalBytes);
    let offset = 0;

    for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
    }

    try {
        const text = new TextDecoder(
            "utf-8",
            { fatal: true }
        ).decode(bytes);

        const body: unknown = JSON.parse(text);

        return {
            ok: true,
            body,
        };
    } catch {
        return {
            ok: false,
            error: "INVALID_JSON",
            status: 400,
        };
    }
}

const adminWorker = {
    async fetch(
        request: Request,
        env: Env,
        ctx: ExecutionContext
    ): Promise<Response> {
        const url = new URL(request.url);
        const { pathname } = url;

        /**
         * GET /api/health
         */
        if (pathname === "/api/health") {
            if (request.method !== "GET") {
                return methodNotAllowed("GET");
            }

            return readResponse(request, {
                status: "ok",
                service: "roborio-trauma-admin-api",
            });
        }

        /**
         * GET /api/admin/incidents
         *
         * Authenticated, paginated moderation queue.
         */
        if (pathname === QUEUE_PATH) {
            if (request.method !== "GET") {
                return methodNotAllowed("GET");
            }

            if (!isQueueEnabled(env)) {
                return readResponse(
                    request,
                    { error: "ADMIN_QUEUE_DISABLED" },
                    503
                );
            }

            const auth = await authorizeModerator(
                { access: ctx?.access },
                env
            );

            if (!auth.authorized) {
                return readResponse(
                    request,
                    { error: auth.reason },
                    auth.reason === "UNAUTHENTICATED"
                        ? 401
                        : 403
                );
            }

            const rawCursor =
                url.searchParams.get("cursor");

            const rawLimit =
                url.searchParams.get("limit");

            if (
                rawLimit !== null &&
                !/^(?:[1-9]|[1-4][0-9]|50)$/.test(
                    rawLimit
                )
            ) {
                return readResponse(
                    request,
                    { error: "INVALID_LIMIT" },
                    400
                );
            }

            const limit =
                rawLimit === null
                    ? 25
                    : Number(rawLimit);

            try {
                const page =
                    await getPendingIncidentPage(
                        env.DB,
                        rawCursor,
                        limit
                    );

                return readResponse(request, {
                    status: "ok",
                    incidents: page.incidents,
                    count: page.incidents.length,
                    total: page.total,
                    nextCursor: page.nextCursor,
                });
            } catch (error) {
                if (
                    error instanceof RangeError &&
                    error.message ===
                    "INVALID_CURSOR"
                ) {
                    return readResponse(
                        request,
                        { error: "INVALID_CURSOR" },
                        400
                    );
                }

                console.error(
                    "Moderation queue query failed:",
                    error
                );

                return readResponse(
                    request,
                    {
                        error:
                            "MODERATION_QUEUE_UNAVAILABLE",
                    },
                    503
                );
            }
        }

        /**
         * GET /api/admin/incidents/:id
         *
         * Moderator-only incident lookup.
         *
         * Can retrieve pending, approved, rejected,
         * or withdrawn reports by their receipt ID.
         */
        const lookupMatch =
            pathname.match(INCIDENT_LOOKUP_PATH);

        if (lookupMatch) {
            if (request.method !== "GET") {
                return methodNotAllowed("GET");
            }

            if (!isQueueEnabled(env)) {
                return readResponse(
                    request,
                    { error: "ADMIN_QUEUE_DISABLED" },
                    503
                );
            }

            const id = lookupMatch[1];

            if (!UUID_PATTERN.test(id)) {
                return readResponse(
                    request,
                    { error: "INVALID_INCIDENT_ID" },
                    400
                );
            }

            const auth = await authorizeModerator(
                { access: ctx?.access },
                env
            );

            if (!auth.authorized) {
                return readResponse(
                    request,
                    { error: auth.reason },
                    auth.reason === "UNAUTHENTICATED"
                        ? 401
                        : 403
                );
            }

            try {
                const incident =
                    await findIncidentForModerator(
                        env.DB,
                        id
                    );

                if (!incident) {
                    return readResponse(
                        request,
                        { error: "INCIDENT_NOT_FOUND" },
                        404
                    );
                }

                return readResponse(request, {
                    status: "ok",
                    incident,
                });
            } catch (error) {
                console.error(
                    "Moderator incident lookup failed:",
                    error
                );

                return readResponse(
                    request,
                    { error: "INCIDENT_LOOKUP_FAILED" },
                    503
                );
            }
        }

        /**
         * POST /api/admin/incidents/:id/approve
         * POST /api/admin/incidents/:id/reject
         *
         * Moderator-only review mutations.
         */
        const reviewMatch =
            pathname.match(REVIEW_PATH);

        if (reviewMatch) {
            if (request.method === "OPTIONS") {
                return reviewPreflight(request);
            }

            if (request.method !== "POST") {
                return methodNotAllowed(
                    "POST, OPTIONS"
                );
            }

            if (!isTrustedWriteOrigin(request)) {
                return jsonResponse(
                    { error: "UNTRUSTED_ORIGIN" },
                    403
                );
            }

            if (!areReviewsEnabled(env)) {
                return reviewResponse(
                    request,
                    { error: "ADMIN_API_DISABLED" },
                    503
                );
            }

            const id = reviewMatch[1];
            const action = reviewMatch[2];

            if (!UUID_PATTERN.test(id)) {
                return reviewResponse(
                    request,
                    { error: "INVALID_INCIDENT_ID" },
                    400
                );
            }

            const auth = await authorizeModerator(
                { access: ctx?.access },
                env
            );

            if (!auth.authorized) {
                return reviewResponse(
                    request,
                    { error: auth.reason },
                    auth.reason === "UNAUTHENTICATED"
                        ? 401
                        : 403
                );
            }

            const decision: ReviewDecision =
                action === "approve"
                    ? "approved"
                    : "rejected";

            try {
                const result = await reviewIncident(
                    env.DB,
                    id,
                    decision,
                    auth.moderator.email
                );

                if (result.outcome === "not_found") {
                    return reviewResponse(
                        request,
                        { error: "INCIDENT_NOT_FOUND" },
                        404
                    );
                }

                if (
                    result.outcome ===
                    "already_reviewed"
                ) {
                    return reviewResponse(
                        request,
                        { error: "ALREADY_REVIEWED" },
                        409
                    );
                }

                return reviewResponse(request, {
                    status: "ok",
                    incident: result.incident,
                });
            } catch (error) {
                console.error(
                    "Incident review transaction failed:",
                    error
                );

                return reviewResponse(
                    request,
                    {
                        error: "INCIDENT_REVIEW_FAILED",
                    },
                    503
                );
            }
        }

        /**
         * POST /api/admin/incidents/:id/withdraw
         *
         * Moderator-only withdrawal of
         * an already approved incident.
         */
        const withdrawMatch =
            pathname.match(WITHDRAW_PATH);

        if (withdrawMatch) {
            if (request.method === "OPTIONS") {
                return reviewPreflight(request);
            }

            if (request.method !== "POST") {
                return methodNotAllowed(
                    "POST, OPTIONS"
                );
            }

            if (!isTrustedWriteOrigin(request)) {
                return jsonResponse(
                    { error: "UNTRUSTED_ORIGIN" },
                    403
                );
            }

            if (!areReviewsEnabled(env)) {
                return reviewResponse(
                    request,
                    { error: "ADMIN_API_DISABLED" },
                    503
                );
            }

            const id = withdrawMatch[1];

            if (!UUID_PATTERN.test(id)) {
                return reviewResponse(
                    request,
                    { error: "INVALID_INCIDENT_ID" },
                    400
                );
            }

            const auth = await authorizeModerator(
                { access: ctx?.access },
                env
            );

            if (!auth.authorized) {
                return reviewResponse(
                    request,
                    { error: auth.reason },
                    auth.reason === "UNAUTHENTICATED"
                        ? 401
                        : 403
                );
            }

            /**
             * Require JSON.
             */
            const contentType =
                request.headers.get(
                    "Content-Type"
                ) ?? "";

            if (
                !/^application\/json(?:\s*;|$)/i.test(
                    contentType
                )
            ) {
                return reviewResponse(
                    request,
                    {
                        error: "UNSUPPORTED_MEDIA_TYPE",
                    },
                    415
                );
            }

            /**
             * Parse with a 2048-byte maximum.
             */
            const parsed =
                await readWithdrawalBody(request);

            if (!parsed.ok) {
                return reviewResponse(
                    request,
                    { error: parsed.error },
                    parsed.status
                );
            }

            const body = parsed.body;

            /**
             * Reasons are private moderation data.
             */
            const reason =
                typeof body === "object" &&
                body !== null &&
                !Array.isArray(body) &&
                "reason" in body &&
                typeof body.reason ===
                "string"
                    ? body.reason.trim()
                    : "";

            if (
                reason.length < 10 ||
                reason.length > 500
            ) {
                return reviewResponse(
                    request,
                    {
                        error: "INVALID_WITHDRAWAL_REASON",
                    },
                    400
                );
            }

            try {
                const result =
                    await withdrawIncident(
                        env.DB,
                        id,
                        auth.moderator.email,
                        reason
                    );

                if (
                    result.outcome === "not_found"
                ) {
                    return reviewResponse(
                        request,
                        { error: "INCIDENT_NOT_FOUND" },
                        404
                    );
                }

                if (
                    result.outcome ===
                    "not_withdrawable"
                ) {
                    return reviewResponse(
                        request,
                        {
                            error:
                                "INCIDENT_NOT_WITHDRAWABLE",
                        },
                        409
                    );
                }

                return reviewResponse(
                    request,
                    {
                        status: "ok",
                        incident: result.incident,
                    },
                    200
                );
            } catch (error) {
                console.error(
                    "Incident withdrawal failed:",
                    error
                );

                return reviewResponse(
                    request,
                    {
                        error: "INCIDENT_WITHDRAWAL_FAILED",
                    },
                    503
                );
            }
        }

        /**
         * Unknown API endpoint.
         */
        return jsonResponse(
            { error: "NOT_FOUND" },
            404
        );
    },
};

export default adminWorker;
