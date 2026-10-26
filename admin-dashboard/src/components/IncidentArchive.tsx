
"use client";

import { useState } from "react";
import styles from "./IncidentArchive.module.css";

const API_URL =
    "https://admin-api.finallynomoreroborio.party";

const WRITES_ENABLED =
    process.env.NEXT_PUBLIC_MODERATION_WRITES_ENABLED ===
    "true";

const UUID_PATTERN =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Incident = {
    id: string;
    story: string;
    status: "pending" | "approved" | "rejected";
    created_at: string;
    reviewed_at: string | null;
    published_at: string | null;
    withdrawn_at: string | null;
};

function isIncident(value: unknown): value is Incident {
    if (!value || typeof value !== "object") {
        return false;
    }

    const item = value as Partial<Incident>;

    return (
        typeof item.id === "string" &&
        typeof item.story === "string" &&
        ["pending", "approved", "rejected"].includes(
            item.status ?? ""
        ) &&
        typeof item.created_at === "string" &&
        (item.published_at === null ||
            typeof item.published_at === "string") &&
        (item.withdrawn_at === null ||
            typeof item.withdrawn_at === "string")
    );
}

function displayStatus(incident: Incident): string {
    if (incident.withdrawn_at) return "WITHDRAWN";

    return incident.status.toUpperCase();
}

export default function IncidentArchive() {
    const [receiptId, setReceiptId] = useState("");
    const [incident, setIncident] =
        useState<Incident | null>(null);

    const [reason, setReason] = useState("");
    const [confirming, setConfirming] = useState(false);

    const [loading, setLoading] = useState(false);
    const [submitting, setSubmitting] = useState(false);

    const [error, setError] = useState("");
    const [message, setMessage] = useState("");

    const canWithdraw =
        WRITES_ENABLED &&
        incident?.status === "approved" &&
        incident.published_at !== null &&
        incident.withdrawn_at === null;

    function resetLookup() {
        setIncident(null);
        setReason("");
        setConfirming(false);
        setMessage("");
        setError("");
    }

    async function lookupIncident() {
        const id = receiptId.trim();

        resetLookup();

        if (!UUID_PATTERN.test(id)) {
            setError("ENTER A VALID INCIDENT RECEIPT UUID.");
            return;
        }

        setLoading(true);

        try {
            const response = await fetch(
                `${API_URL}/api/admin/incidents/${encodeURIComponent(id)}`,
                {
                    method: "GET",
                    credentials: "include",
                    cache: "no-store",
                }
            );

            if (!response.ok) {
                if (response.status === 404) {
                    throw new Error("INCIDENT NOT FOUND.");
                }

                if (
                    response.status === 401 ||
                    response.status === 403
                ) {
                    throw new Error(
                        "MODERATOR ACCESS DENIED OR SESSION EXPIRED."
                    );
                }

                throw new Error(
                    `LOOKUP FAILED (HTTP ${response.status}).`
                );
            }

            const result: unknown = await response.json();

            if (
                typeof result !== "object" ||
                result === null ||
                !("incident" in result) ||
                !isIncident(result.incident)
            ) {
                throw new Error("INVALID API RESPONSE.");
            }

            setIncident(result.incident);
        } catch (err) {
            setError(
                err instanceof Error
                    ? err.message
                    : "LOOKUP FAILED."
            );
        } finally {
            setLoading(false);
        }
    }

    async function withdrawIncident() {
        if (!incident || !canWithdraw || submitting) {
            return;
        }

        const cleanReason = reason.trim();

        if (
            cleanReason.length < 10 ||
            cleanReason.length > 500
        ) {
            setError(
                "WITHDRAWAL REASON MUST BE 10–500 CHARACTERS."
            );
            return;
        }

        setSubmitting(true);
        setError("");

        try {
            const response = await fetch(
                `${API_URL}/api/admin/incidents/${encodeURIComponent(
                    incident.id
                )}/withdraw`,
                {
                    method: "POST",
                    credentials: "include",
                    cache: "no-store",
                    headers: {
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify({
                        reason: cleanReason,
                    }),
                }
            );

            if (!response.ok) {
                if (response.status === 409) {
                    throw new Error(
                        "THIS INCIDENT IS NO LONGER ELIGIBLE. LOOK IT UP AGAIN."
                    );
                }

                if (
                    response.status === 401 ||
                    response.status === 403
                ) {
                    throw new Error(
                        "MODERATOR AUTHORIZATION FAILED."
                    );
                }

                if (response.status === 503) {
                    throw new Error(
                        "WITHDRAWAL SERVICE UNAVAILABLE. VERIFY STATUS BEFORE RETRYING."
                    );
                }

                throw new Error(
                    `WITHDRAWAL FAILED (HTTP ${response.status}).`
                );
            }

            const result: unknown = await response.json();

            if (
                typeof result !== "object" ||
                result === null ||
                !("incident" in result) ||
                typeof result.incident !== "object" ||
                result.incident === null ||
                !("id" in result.incident) ||
                result.incident.id !== incident.id
            ) {
                throw new Error(
                    "UNEXPECTED WITHDRAWAL RESPONSE. RECHECK INCIDENT STATUS."
                );
            }

            setConfirming(false);
            setReason("");
            setMessage(
                "INCIDENT WITHDRAWN. VERIFYING CURRENT STATUS..."
            );

            // Re-fetch authoritative state before marking
            // the record withdrawn in the interface.
            const verify = await fetch(
                `${API_URL}/api/admin/incidents/${encodeURIComponent(
                    incident.id
                )}`,
                {
                    credentials: "include",
                    cache: "no-store",
                }
            );

            if (!verify.ok) {
                throw new Error(
                    "WITHDRAWAL ACCEPTED, BUT STATUS VERIFICATION FAILED. LOOK UP THE INCIDENT AGAIN."
                );
            }

            const verified: unknown = await verify.json();

            if (
                typeof verified !== "object" ||
                verified === null ||
                !("incident" in verified) ||
                !isIncident(verified.incident)
            ) {
                throw new Error(
                    "COULD NOT VERIFY THE WITHDRAWAL RESPONSE."
                );
            }

            setIncident(verified.incident);
            setMessage(
                verified.incident.withdrawn_at !== null &&
                verified.incident.published_at === null
                    ? "INCIDENT SUCCESSFULLY WITHDRAWN FROM PUBLICATION."
                    : "STATUS REQUIRES MANUAL REVIEW."
            );
        } catch (err) {
            setError(
                err instanceof Error
                    ? err.message
                    : "WITHDRAWAL FAILED. RECHECK THE INCIDENT."
            );
        } finally {
            setSubmitting(false);
        }
    }

    return (
        <section
            id="incident-archive"
            className={styles.archive}
            aria-labelledby="archive-title"
        >
            <div className={styles.header}>
                <span className={styles.eyebrow}>
                    02 / RECORDS DEPARTMENT
                </span>

                <h2 id="archive-title">
                    THE INCIDENT ARCHIVE
                    <sup>®</sup>
                </h2>

                <p>
                    DECLASSIFY THE RECEIPT. REVIEW THE
                    EVIDENCE. REVOKE PUBLICATION IF
                    NECESSARY.
                </p>
            </div>

            <form
                className={styles.search}
                onSubmit={(event) => {
                    event.preventDefault();
                    void lookupIncident();
                }}
            >
                <label htmlFor="archive-receipt">
                    INCIDENT RECEIPT ID
                </label>

                <div className={styles.searchRow}>
                    <input
                        id="archive-receipt"
                        type="text"
                        value={receiptId}
                        placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                        onChange={(event) => {
                            setReceiptId(event.target.value);
                            resetLookup();
                        }}
                        spellCheck={false}
                        autoComplete="off"
                        disabled={loading || submitting}
                    />

                    <button
                        type="submit"
                        disabled={loading || submitting}
                    >
                        {loading
                            ? "SEARCHING..."
                            : "LOCATE FILE ↗"}
                    </button>
                </div>
            </form>

            {error && (
                <p className={styles.error} role="alert">
                    {error}
                </p>
            )}

            {message && (
                <p className={styles.success} role="status">
                    {message}
                </p>
            )}

            {incident && (
                <article className={styles.record}>
                    <div className={styles.recordTop}>
                        <span>CASE FILE / {incident.id}</span>
                        <strong>
                            {displayStatus(incident)}
                        </strong>
                    </div>

                    <p className={styles.story}>
                        {incident.story}
                    </p>

                    <div className={styles.metadata}>
                        <span>
                            SUBMITTED / {incident.created_at}
                        </span>
                        <span>
                            MODERATION / {incident.status}
                        </span>
                    </div>

                    {canWithdraw ? (
                        <div className={styles.actionArea}>
                            <h3>WITHDRAW PUBLICATION</h3>

                            <p>
                                Removes the report from
                                public view. The report and
                                audit record remain stored
                                privately.
                            </p>

                            <label htmlFor="withdrawal-reason">
                                REASON FOR WITHDRAWAL
                            </label>

                            <textarea
                                id="withdrawal-reason"
                                value={reason}
                                onChange={(event) => {
                                    setReason(event.target.value);
                                    setConfirming(false);
                                }}
                                maxLength={500}
                                rows={4}
                                placeholder="Explain why this report must be removed..."
                                disabled={submitting}
                            />

                            <span className={styles.counter}>
                                {reason.trim().length} / 500
                            </span>

                            {!confirming ? (
                                <button
                                    type="button"
                                    className={styles.dangerButton}
                                    disabled={
                                        reason.trim().length < 10 ||
                                        submitting
                                    }
                                    onClick={() =>
                                        setConfirming(true)
                                    }
                                >
                                    REQUEST WITHDRAWAL
                                </button>
                            ) : (
                                <div
                                    className={styles.confirm}
                                    role="group"
                                    aria-label="Confirm incident withdrawal"
                                >
                                    <strong>
                                        CONFIRM PUBLICATION REMOVAL?
                                    </strong>

                                    <p>
                                        This action is logged
                                        and cannot be undone
                                        through this interface.
                                    </p>

                                    <div className={styles.confirmActions}>
                                        <button
                                            type="button"
                                            onClick={() =>
                                                setConfirming(false)
                                            }
                                            disabled={submitting}
                                        >
                                            CANCEL
                                        </button>

                                        <button
                                            type="button"
                                            className={styles.dangerButton}
                                            disabled={submitting}
                                            onClick={() =>
                                                void withdrawIncident()
                                            }
                                        >
                                            {submitting
                                                ? "WITHDRAWING..."
                                                : "CONFIRM WITHDRAWAL"}
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>
                    ) : (
                        <p className={styles.notEligible}>
                            {incident.withdrawn_at
                                ? "PUBLICATION PREVIOUSLY WITHDRAWN."
                                : incident.status !== "approved"
                                    ? "ONLY APPROVED REPORTS CAN BE WITHDRAWN."
                                    : !WRITES_ENABLED
                                        ? "MODERATION WRITES ARE DISABLED."
                                        : "THIS REPORT IS NOT CURRENTLY PUBLISHED."}
                        </p>
                    )}
                </article>
            )}
        </section>
    );
}
