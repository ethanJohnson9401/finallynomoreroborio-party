
"use client";

import { useRef, useState } from "react";
import type { FormEvent } from "react";
import {
    Turnstile,
    type TurnstileInstance,
} from "@marsidev/react-turnstile";

const MIN_LENGTH = 20;
const MAX_LENGTH = 1000;

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

export default function IncidentForm() {
    const [story, setStory] = useState("");

    // Keep the initial render deterministic to avoid
    // React hydration mismatches and effect-based state updates.
    const placeholder = PLACEHOLDERS[0];

    const [turnstileToken, setTurnstileToken] =
        useState<string | null>(null);

    const turnstileRef = useRef<TurnstileInstance | null>(null);

    const [isSubmitting, setIsSubmitting] = useState(false);

    const [submissionError, setSubmissionError] =
        useState<string | null>(null);

    const [showNotice, setShowNotice] = useState(false);

    const [receiptId, setReceiptId] =
        useState<string | null>(null);

    /**
     * Validate the incident report.
     */
    const trimmedStory = story.trim();

    const charactersRemaining = MAX_LENGTH - story.length;

    const isValid =
        trimmedStory.length >= MIN_LENGTH &&
        trimmedStory.length <= MAX_LENGTH;

    /**
     * Reset Turnstile after a submission attempt.
     *
     * Turnstile verification tokens are single-use.
     */
    function resetTurnstile() {
        setTurnstileToken(null);
        turnstileRef.current?.reset();
    }

    /**
     * Submit the incident to the Cloudflare Worker API.
     */
    async function handleSubmit(
        event: FormEvent<HTMLFormElement>
    ) {
        event.preventDefault();

        if (!isValid || !turnstileToken || isSubmitting) {
            return;
        }

        setIsSubmitting(true);
        setSubmissionError(null);
        setShowNotice(false);
        setReceiptId(null);

        try {
            const response = await fetch(
                `${process.env.NEXT_PUBLIC_API_URL}/api/incidents`,
                {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify({
                        story: trimmedStory,
                        turnstileToken,
                    }),
                }
            );

            /**
             * Production submissions are intentionally disabled.
             *
             * The API returns:
             * HTTP 503
             * { "error": "SUBMISSIONS_DISABLED" }
             *
             * Other HTTP 503 errors must remain failures.
             */
            if (response.status === 503) {
                const result: ApiError | null =
                    await response.json().catch(() => null);

                if (
                    result?.error === "SUBMISSIONS_DISABLED"
                ) {
                    setShowNotice(true);
                    return;
                }
            }

            /**
             * Reject unsuccessful HTTP responses.
             */
            if (!response.ok) {
                throw new Error(
                    `Submission failed (HTTP ${response.status})`
                );
            }

            /**
             * A successful submission must return HTTP 201.
             */
            if (response.status !== 201) {
                throw new Error(
                    `Unexpected API response (HTTP ${response.status})`
                );
            }

            const result =
                (await response.json()) as IncidentReceipt;

            /**
             * Validate the incident receipt.
             */
            if (
                result.status !== "received" ||
                typeof result.id !== "string" ||
                !result.id ||
                result.moderation !== "pending"
            ) {
                throw new Error(
                    "Unexpected incident receipt from API."
                );
            }

            /**
             * Store the receipt and clear the report.
             */
            setReceiptId(result.id);
            setStory("");
        } catch (error) {
            setSubmissionError(
                error instanceof Error
                    ? error.message
                    : "Unable to contact the incident API."
            );
        } finally {
            resetTurnstile();
            setIsSubmitting(false);
        }
    }

    return (
        <form onSubmit={handleSubmit} className="mt-6">
            {/* Incident story label */}
            <label
                htmlFor="incident-story"
                className="font-technical block text-xs font-bold text-[#d8ff48]"
            >
                DESCRIBE YOUR INCIDENT
            </label>

            {/* Story input */}
            <textarea
                id="incident-story"
                name="story"
                value={story}
                onChange={(event) => {
                    setStory(event.target.value);
                    setShowNotice(false);
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

            {/* Character counter */}
            <div
                id="incident-help"
                className="mt-2 flex flex-wrap justify-between gap-2 text-xs text-gray-400"
            >
                <p>Minimum {MIN_LENGTH} characters</p>
                <p>{charactersRemaining} remaining</p>
            </div>

            {/* Cloudflare Turnstile verification */}
            <div className="mt-6">
                <Turnstile
                    ref={turnstileRef}
                    siteKey={
                        process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY!
                    }
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
            </div>

            {/* Submit button */}
            <button
                type="submit"
                disabled={
                    !isValid ||
                    !turnstileToken ||
                    isSubmitting
                }
                className="mt-6 w-full bg-[#ff633a] px-6 py-4 font-black text-[#101318] transition-colors hover:bg-[#ff805e] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#d8ff48] disabled:cursor-not-allowed disabled:opacity-40"
            >
                {isSubmitting
                    ? "TRANSMITTING INCIDENT REPORT..."
                    : "FILE INCIDENT REPORT ↗"}
            </button>

            {/* Successful submission receipt */}
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
                        Your report has been filed and is awaiting
                        review. The roboRIO has declined to comment.
                    </p>

                    <p className="font-technical mt-4 text-xs font-bold text-[#d8ff48]">
                        STATUS: PENDING MODERATION
                    </p>

                    <p className="font-technical mt-2 break-all text-xs text-gray-400">
                        RECEIPT / {receiptId}
                    </p>
                </div>
            )}

            {/* API or network errors */}
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

            {/* Submissions temporarily disabled */}
            {showNotice && (
                <div
                    role="status"
                    className="mt-4 border-l-4 border-[#ff633a] bg-[#1e242c] p-4"
                >
                    <p className="font-technical text-xs font-bold text-[#ff633a]">
                        SUBMISSION SYSTEM OFFLINE
                    </p>

                    <p className="mt-2 text-sm text-gray-300">
                        The roboRIO Trauma Center is currently
                        accepting visitors, but incident filing
                        is temporarily closed. Your report has
                        not been saved. Check back when the
                        paperwork department reopens.
                    </p>
                </div>
            )}

            {/* Privacy notice */}
            <p className="mt-4 text-xs leading-relaxed text-gray-400">
                Anonymous submissions will be reviewed before
                publication. Please avoid including personal or
                identifying information.
            </p>
        </form>
    );
}
