
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";

import {
    Turnstile,
    type TurnstileInstance,
} from "@marsidev/react-turnstile";

const MIN_LENGTH = 20;
const MAX_LENGTH = 1000;

const API_URL = process.env.NEXT_PUBLIC_API_URL;
const SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;

const PLACEHOLDERS = [
    "It was elimination match 3. The roboRIO worked perfectly in the pit. The moment we reached the field, it decided to pursue other opportunities.",
    "After 45 minutes of debugging, we discovered the robot wasn't broken. The roboRIO just needed to be power-cycled for the sixth time.",
    "Driver Station said communication was established. The robot respectfully disagreed.",
    "We deployed code at 11:58 PM. At 11:59 PM, the roboRIO began its villain origin story.",
    "Everything worked in simulation. Everything worked on the practice field. Then the FMS connected.",
    "The roboRIO's status light blinked in a pattern that can only be described as a cry for help.",
    "Our autonomous routine worked flawlessly until the roboRIO remembered it had free will.",
    "The robot passed inspection. The roboRIO apparently took that as its two-week notice.",
    "We changed one line of code. The roboRIO responded by forgetting how networking works.",
    "Three programmers, two laptops, and one roboRIO. Somehow, the roboRIO won.",
];

interface IncidentReceipt {
    status: "received";
    id: string;
    moderation: "pending";
    message: string;
}

interface ApiError {
    error?: string;
}

interface IntakeConfig {
    submissionsEnabled: boolean;
}

type IntakeStatus =
    | "checking"
    | "open"
    | "closed"
    | "unavailable";

function getSubmissionError(
    status: number,
    code?: string
): string {
    if (status === 429 || code === "RATE_LIMITED") {
        return "Too many incident reports from this connection. Give the paperwork department a minute before trying again.";
    }

    if (
        status === 403 &&
        code === "TURNSTILE_VERIFICATION_FAILED"
    ) {
        return "Human verification failed or expired. Please verify again and resubmit.";
    }

    if (code === "RATE_LIMIT_UNAVAILABLE") {
        return "The submission safety system is temporarily unavailable. Please try again later.";
    }

    if (code === "INVALID_STORY_LENGTH") {
        return "Your incident must contain between 20 and 1000 characters.";
    }

    if (status === 503) {
        return "The incident API is temporarily unavailable. Your report has not been saved.";
    }

    return `Incident transmission failed (HTTP ${status}). Your report has not been confirmed.`;
}

export default function IncidentForm() {
    const [story, setStory] = useState("");
    const placeholder = PLACEHOLDERS[0];

    const [intakeStatus, setIntakeStatus] =
        useState<IntakeStatus>("checking");

    const [turnstileToken, setTurnstileToken] =
        useState<string | null>(null);

    const turnstileRef =
        useRef<TurnstileInstance | null>(null);

    const [isSubmitting, setIsSubmitting] =
        useState(false);

    const [submissionError, setSubmissionError] =
        useState<string | null>(null);

    const [receiptId, setReceiptId] =
        useState<string | null>(null);

    const trimmedStory = story.trim();

    const charactersRemaining =
        MAX_LENGTH - story.length;

    const isValid =
        trimmedStory.length >= MIN_LENGTH &&
        trimmedStory.length <= MAX_LENGTH;

    const canSubmit =
        intakeStatus === "open" &&
        isValid &&
        Boolean(turnstileToken) &&
        !isSubmitting;

    /**
     * Read current intake availability.
     *
     * An unavailable status API fails closed.
     */
    const checkAvailability = useCallback(
        async (signal?: AbortSignal) => {
            if (!API_URL) {
                if (!signal?.aborted) {
                    setIntakeStatus("unavailable");
                }
                return;
            }

            try {
                const response = await fetch(
                    `${API_URL}/api/incidents/config`,
                    {
                        method: "GET",
                        cache: "no-store",
                        signal,
                    }
                );

                if (!response.ok) {
                    throw new Error("STATUS_UNAVAILABLE");
                }

                const result =
                    (await response.json()) as IntakeConfig;

                if (
                    typeof result.submissionsEnabled !==
                    "boolean"
                ) {
                    throw new Error("INVALID_STATUS_RESPONSE");
                }

                if (!signal?.aborted) {
                    setIntakeStatus(
                        result.submissionsEnabled
                            ? "open"
                            : "closed"
                    );
                }
            } catch {
                if (!signal?.aborted) {
                    setIntakeStatus("unavailable");
                }
            }
        },
        []
    );

    /**
     * Initial availability request.
     */
    useEffect(() => {
        const controller = new AbortController();

        const initialize = async () => {
            await checkAvailability(controller.signal);
        };

        void initialize();

        return () => {
            controller.abort();
        };
    }, [checkAvailability]);

    /**
     * Single-use Turnstile tokens must be reset
     * after every submission attempt.
     */
    function resetTurnstile() {
        setTurnstileToken(null);
        turnstileRef.current?.reset();
    }

    /**
     * Retry the availability request.
     */
    async function retryAvailability() {
        setIntakeStatus("checking");
        await checkAvailability();
    }

    /**
     * Submit an incident to the Cloudflare Worker.
     */
    async function handleSubmit(
        event: FormEvent<HTMLFormElement>
    ) {
        event.preventDefault();

        if (
            !canSubmit ||
            !turnstileToken ||
            !API_URL
        ) {
            return;
        }

        setIsSubmitting(true);
        setSubmissionError(null);
        setReceiptId(null);

        try {
            const response = await fetch(
                `${API_URL}/api/incidents`,
                {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify({
                        story: trimmedStory,
                        turnstileToken,
                    }),
                    signal: AbortSignal.timeout(15000),
                }
            );

            if (!response.ok) {
                const errorResult: ApiError | null =
                    await response
                        .json()
                        .catch(() => null);

                if (
                    response.status === 503 &&
                    errorResult?.error ===
                    "SUBMISSIONS_DISABLED"
                ) {
                    setIntakeStatus("closed");
                    return;
                }

                throw new Error(
                    getSubmissionError(
                        response.status,
                        errorResult?.error
                    )
                );
            }

            if (response.status !== 201) {
                throw new Error(
                    "Unexpected API response. Your report has not been confirmed."
                );
            }

            const result =
                (await response.json()) as IncidentReceipt;

            if (
                result.status !== "received" ||
                typeof result.id !== "string" ||
                !result.id ||
                result.moderation !== "pending"
            ) {
                throw new Error(
                    "The API returned an invalid submission receipt."
                );
            }

            setReceiptId(result.id);
            setStory("");
        } catch (error) {
            if (
                error instanceof Error &&
                (error.name === "TimeoutError" ||
                    error.name === "AbortError")
            ) {
                setSubmissionError(
                    "The incident server took too long to respond. " +
                    "Your report could not be confirmed. " +
                    "Check the moderation status before retrying."
                );
            } else if (
                error instanceof TypeError
            ) {
                setSubmissionError(
                    "Unable to reach the incident server. " +
                    "Please check your connection and try again. " +
                    "Your report has not been confirmed."
                );
            } else {
                setSubmissionError(
                    error instanceof Error
                        ? error.message
                        : "Unable to contact the incident API."
                );
            }
        } finally {
            resetTurnstile();
            setIsSubmitting(false);
        }
    }

    /**
     * Intake availability states.
     */
    if (intakeStatus !== "open") {
        return (
            <div
                className="mt-6 border-t border-white/20 pt-8"
                aria-live="polite"
            >
                <p className="font-technical text-xs font-bold tracking-[.12em] text-[#d8ff48]">
                    TRAUMA CENTER / INTAKE STATUS
                </p>

                {intakeStatus === "checking" && (
                    <div role="status" className="mt-5">
                        <h3 className="text-2xl font-black uppercase tracking-tight sm:text-3xl">
                            CHECKING THE PAPERWORK DEPARTMENT.
                        </h3>

                        <p className="mt-3 text-sm text-gray-400">
                            Establishing a connection to
                            the incident filing system.
                        </p>
                    </div>
                )}

                {intakeStatus === "closed" && (
                    <div role="status" className="mt-5">
                        <p className="font-technical text-xs font-bold text-[#ff633a]">
                            SYSTEM STATUS / INTAKE CLOSED
                        </p>

                        <h3 className="mt-4 max-w-2xl text-3xl leading-tight font-black tracking-tight uppercase sm:text-5xl">
                            THE PAPERWORK DEPARTMENT
                            HAS CLOCKED OUT.
                        </h3>

                        <p className="mt-5 max-w-xl leading-relaxed text-gray-400">
                            Incident filing is temporarily
                            closed. The roboRIO denies
                            responsibility for this outage,
                            which is suspiciously on brand.
                        </p>

                        <p className="mt-4 text-sm text-gray-400">
                            Previously approved reports remain
                            available in the Incident Memorial.
                        </p>
                    </div>
                )}

                {intakeStatus === "unavailable" && (
                    <div role="alert" className="mt-5">
                        <p className="font-technical text-xs font-bold text-[#ff633a]">
                            STATUS / CONNECTION UNAVAILABLE
                        </p>

                        <h3 className="mt-4 text-2xl font-black uppercase tracking-tight sm:text-3xl">
                            WE LOST COMMS WITH INTAKE.
                        </h3>

                        <p className="mt-4 max-w-xl text-sm leading-relaxed text-gray-400">
                            We couldn&apos;t verify whether
                            submissions are open. Incident
                            filing is paused until the
                            connection can be restored.
                        </p>
                    </div>
                )}

                {intakeStatus !== "checking" && (
                    <button
                        type="button"
                        onClick={() =>
                            void retryAvailability()
                        }
                        className="font-technical mt-8 border border-[#d8ff48] px-5 py-3 text-xs font-bold tracking-wider text-[#d8ff48] transition-colors hover:bg-[#d8ff48] hover:text-[#101318] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white"
                    >
                        ↻ CHECK INTAKE STATUS
                    </button>
                )}
            </div>
        );
    }

    /**
     * Open intake form.
     */
    return (
        <form
            onSubmit={handleSubmit}
            className="mt-6"
        >
            <p className="font-technical mb-6 text-sm font-bold text-lime-400">
                YOUR INCIDENT REPORT
            </p>

            <div className="font-technical mb-6 flex flex-wrap items-center gap-3 text-xs font-bold tracking-wider">
                <span className="text-[#d8ff48]">
                    ● INTAKE OPEN
                </span>

                <span className="text-gray-400">
                    AWAITING YOUR TESTIMONY
                </span>
            </div>

            <label
                htmlFor="incident-story"
                className="font-technical block text-xs font-bold text-[#d8ff48]"
            >
                DESCRIBE YOUR INCIDENT
            </label>

            <textarea
                id="incident-story"
                name="story"
                value={story}
                onChange={(event) => {
                    setStory(event.target.value);
                    setSubmissionError(null);
                    setReceiptId(null);
                }}
                minLength={MIN_LENGTH}
                maxLength={MAX_LENGTH}
                rows={6}
                required
                placeholder={placeholder}
                aria-describedby="incident-help"
                className="mt-3 w-full resize-y border border-white/20 bg-[#1e242c] p-4 text-sm text-white outline-none placeholder:text-gray-400 focus:border-[#d8ff48] focus-visible:ring-2 focus-visible:ring-[#d8ff48]/30"
            />

            <div
                id="incident-help"
                className="mt-2 flex flex-wrap justify-between gap-2 text-xs text-gray-400"
            >
                <p>
                    Minimum {MIN_LENGTH} characters
                </p>

                <p>
                    {charactersRemaining} remaining
                </p>
            </div>

            <div className="mt-6">
                {SITE_KEY ? (
                    <Turnstile
                        ref={turnstileRef}
                        siteKey={SITE_KEY}
                        onSuccess={(token) => {
                            setTurnstileToken(token);
                            setSubmissionError(null);
                        }}
                        onExpire={() => {
                            setTurnstileToken(null);
                        }}
                        onError={() => {
                            setTurnstileToken(null);
                        }}
                        options={{
                            theme: "dark",
                            size: "flexible",
                            action: "submit_incident",
                        }}
                    />
                ) : (
                    <p role="alert" className="text-sm text-[#ff633a]">
                        Human verification is unavailable.
                    </p>
                )}
            </div>

            <button
                type="submit"
                disabled={!canSubmit}
                className="mt-6 w-full bg-[#ff633a] px-6 py-4 font-black text-[#101318] transition-colors hover:bg-[#ff805e] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#d8ff48] disabled:cursor-not-allowed disabled:opacity-40"
            >
                {isSubmitting
                    ? "TRANSMITTING INCIDENT REPORT..."
                    : "FILE INCIDENT REPORT ↗"}
            </button>

            {receiptId && (
                <div
                    role="status"
                    aria-live="polite"
                    className="mt-4 border-l-4 border-[#d8ff48] bg-[#1e242c] p-4"
                >
                    <p className="font-technical text-xs font-bold text-[#d8ff48]">
                        INCIDENT REPORT RECEIVED
                    </p>

                    <p className="mt-2 text-sm text-gray-300">
                        Your report has been filed and is
                        awaiting review. The roboRIO has
                        declined to comment.
                    </p>

                    <p className="font-technical mt-4 text-xs font-bold text-[#d8ff48]">
                        STATUS: PENDING MODERATION
                    </p>

                    <p className="font-technical mt-2 break-all text-xs text-gray-400">
                        RECEIPT / {receiptId}
                    </p>
                </div>
            )}

            {submissionError && (
                <div
                    role="alert"
                    className="mt-4 border-l-4 border-[#ff633a] bg-[#1e242c] p-4"
                >
                    <p className="font-technical text-xs font-bold text-[#ff633a]">
                        TRANSMISSION FAILED
                    </p>

                    <p className="mt-2 text-sm text-gray-300">
                        {submissionError}
                    </p>
                </div>
            )}

            <p className="mt-4 text-xs leading-relaxed text-gray-400">
                Anonymous submissions will be reviewed
                before publication. Please avoid including
                personal or identifying information.
            </p>
        </form>
    );
}
