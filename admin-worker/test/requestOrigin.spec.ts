
import {
    describe,
    expect,
    it,
} from "vitest";

import {
    DASHBOARD_ORIGIN,
    isTrustedWriteOrigin,
} from "../src/security/requestOrigin";

function makeRequest(origin?: string): Request {
    return new Request(
        "https://admin-api.finallynomoreroborio.party/api/admin/incidents/test/approve",
        {
            method: "POST",
            headers: origin
                ? { Origin: origin }
                : {},
        }
    );
}

describe("Moderation request origin", () => {
    it("accepts the trusted dashboard origin", () => {
        expect(
            isTrustedWriteOrigin(
                makeRequest(DASHBOARD_ORIGIN)
            )
        ).toBe(true);
    });

    it("rejects unknown origins", () => {
        expect(
            isTrustedWriteOrigin(
                makeRequest("https://evil.example")
            )
        ).toBe(false);
    });

    it("rejects requests without an Origin", () => {
        expect(
            isTrustedWriteOrigin(makeRequest())
        ).toBe(false);
    });

    it("rejects similar-looking hostnames", () => {
        expect(
            isTrustedWriteOrigin(
                makeRequest(
                    "https://admin.finallynomoreroborio.party.evil.example"
                )
            )
        ).toBe(false);
    });
});
