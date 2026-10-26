
/**
 * roboRIO Trauma Center
 * Dashboard Static Asset Worker
 *
 * Serves the dashboard frontend.
 *
 * Moderation API requests belong to the
 * separate Access-protected admin Worker.
 */

interface Env {
    ASSETS: Fetcher;
}

const dashboardWorker = {
    async fetch(
        request: Request,
        env: Env
    ): Promise<Response> {
        const url = new URL(request.url);

        /**
         * Never serve dashboard assets in response
         * to API requests.
         */
        if (
            url.pathname === "/api" ||
            url.pathname.startsWith("/api/")
        ) {
            return Response.json(
                {
                    error: "API_NOT_AVAILABLE_HERE",
                },
                {
                    status: 404,
                    headers: {
                        "Cache-Control": "no-store",
                    },
                }
            );
        }

        /**
         * Restrict dashboard requests to reads.
         */
        if (
            request.method !== "GET" &&
            request.method !== "HEAD"
        ) {
            return new Response(
                "Method Not Allowed",
                {
                    status: 405,
                    headers: {
                        "Allow": "GET, HEAD",
                    },
                }
            );
        }

        /**
         * Serve exported Next.js assets.
         *
         * This Worker does not authenticate
         * visitors itself. Cloudflare Access
         * must protect the entire deployment.
         */
        const response = await env.ASSETS.fetch(request);

        const headers = new Headers(response.headers);

        headers.set(
            "X-Content-Type-Options",
            "nosniff"
        );

        headers.set(
            "Referrer-Policy",
            "strict-origin-when-cross-origin"
        );

        headers.set(
            "X-Frame-Options",
            "DENY"
        );

        return new Response(response.body, {
            status: response.status,
            statusText: response.statusText,
            headers,
        });
    },
};

export default dashboardWorker;
