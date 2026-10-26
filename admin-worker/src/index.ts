
import { getPendingIncidents } from "./db/incidents";
import { authorizeModerator } from "./security/moderatorAuth";

interface Env {
    DB: D1Database;
    MODERATOR_EMAILS?: string;
    ADMIN_API_ENABLED?: string;
}

function jsonResponse(
    body: unknown,
    status = 200
): Response {
    return Response.json(body, {
        status,
        headers: {
            "Cache-Control": "no-store",
        },
    });
}

export default {
    async fetch(
        request: Request,
        env: Env,
        ctx: ExecutionContext
    ): Promise<Response> {
        const url = new URL(request.url);

        /**
         * Health check.
         * Does not expose private incident data.
         */
        if (
            url.pathname === "/api/health" &&
            request.method === "GET"
        ) {
            return jsonResponse({
                status: "ok",
                service: "roborio-trauma-admin-api",
            });
        }

        /**
         * Everything except the supported moderation
         * endpoint is unavailable.
         */
        if (url.pathname !== "/api/admin/incidents") {
            return jsonResponse(
                { error: "NOT_FOUND" },
                404
            );
        }

        /**
         * Only read operations are supported.
         */
        if (request.method !== "GET") {
            return jsonResponse(
                { error: "METHOD_NOT_ALLOWED" },
                405
            );
        }

        /**
         * Additional deployment-controlled kill switch.
         */
        if (env.ADMIN_API_ENABLED !== "true") {
            return jsonResponse(
                { error: "ADMIN_API_DISABLED" },
                503
            );
        }

        /**
         * Require verified Cloudflare Access identity
         * and an approved moderator email.
         *
         * Never trust identity headers from requests.
         */
        const auth = await authorizeModerator(
            { access: ctx?.access },
            env
        );

        if (!auth.authorized) {
            return jsonResponse(
                { error: auth.reason },
                auth.reason === "UNAUTHENTICATED"
                    ? 401
                    : 403
            );
        }

        /**
         * Authorization succeeded.
         * Only now may we read pending reports.
         */
        try {
            const incidents = await getPendingIncidents(
                env.DB
            );

            return jsonResponse({
                status: "ok",
                incidents,
                count: incidents.length,
            });
        } catch (error) {
            console.error(
                "Moderation queue query failed:",
                error
            );

            return jsonResponse(
                { error: "MODERATION_QUEUE_UNAVAILABLE" },
                503
            );
        }
    },
};
