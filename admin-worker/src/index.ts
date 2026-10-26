
import {
    getPendingIncidentPage,
    reviewIncident,
    type ReviewDecision,
} from "./db/incidents";

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

const REVIEW_PATH =
    /^\/api\/admin\/incidents\/([^/]+)\/(approve|reject)$/;

const UUID_PATTERN =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

            /**
             * Verify Cloudflare Access identity
             * and the moderator allowlist.
             */
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

            /**
             * Validate query parameters.
             */
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
         * POST /api/admin/incidents/:id/approve
         * POST /api/admin/incidents/:id/reject
         *
         * Moderator-only mutation routes.
         */
        const reviewMatch =
            pathname.match(REVIEW_PATH);

        if (reviewMatch) {
            /**
             * Handle CORS preflight.
             */
            if (request.method === "OPTIONS") {
                return reviewPreflight(request);
            }

            if (request.method !== "POST") {
                return methodNotAllowed(
                    "POST, OPTIONS"
                );
            }

            /**
             * Origin-based CSRF protection.
             */
            if (!isTrustedWriteOrigin(request)) {
                return jsonResponse(
                    { error: "UNTRUSTED_ORIGIN" },
                    403
                );
            }

            /**
             * Production write kill switch.
             */
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

            /**
             * Authenticate through Cloudflare Access.
             *
             * Never trust arbitrary email headers
             * or email addresses in request bodies.
             */
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
                /**
                 * Conditional database update and
                 * audit record insertion are atomic.
                 */
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
                        error:
                            "INCIDENT_REVIEW_FAILED",
                    },
                    503
                );
            }
        }

        return jsonResponse(
            { error: "NOT_FOUND" },
            404
        );
    },
};

export default adminWorker;
