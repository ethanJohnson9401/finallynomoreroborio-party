
/**
 * Browser request origin security for moderation actions.
 */

export const DASHBOARD_ORIGIN =
    "https://admin.finallynomoreroborio.party";

/**
 * Require the exact production dashboard origin.
 *
 * Origin is a CSRF defense, not an authentication mechanism.
 * Cloudflare Access and moderator authorization remain required.
 */
export function isTrustedWriteOrigin(
    request: Request
): boolean {
    return (
        request.headers.get("Origin") ===
        DASHBOARD_ORIGIN
    );
}

/**
 * CORS headers for authorized dashboard write requests.
 */
export function writeCorsHeaders(): Headers {
    return new Headers({
        "Access-Control-Allow-Origin":
        DASHBOARD_ORIGIN,
        "Access-Control-Allow-Credentials": "true",
        "Access-Control-Allow-Methods":
            "POST, OPTIONS",
        "Access-Control-Allow-Headers":
            "Content-Type",
        "Access-Control-Max-Age": "600",
        "Cache-Control": "no-store",
        "Vary": "Origin",
    });
}
