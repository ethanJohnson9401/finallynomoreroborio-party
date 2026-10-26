
"use client";

import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { Turnstile } from "@marsidev/react-turnstile";

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

export default function IncidentForm() {
    const [story, setStory] = useState("");
    const [placeholder, setPlaceholder] = useState(PLACEHOLDERS[0]);

    const [turnstileToken, setTurnstileToken] = useState<string | null>(null);

    const [isSubmitting, setIsSubmitting] = useState(false);
    const [submissionError, setSubmissionError] = useState<string | null>(null);
    const [showNotice, setShowNotice] = useState(false);

    /**
     * Choose one random placeholder when the component mounts.
     * It won't change while the visitor is writing.
     */
    useEffect(() => {
        const randomIndex = Math.floor(
            Math.random() * PLACEHOLDERS.length
        );

        setPlaceholder(PLACEHOLDERS[randomIndex]);
    }, []);

    /**
     * Validate the incident report.
     */
    const trimmedStory = story.trim();
    const charactersRemaining = MAX_LENGTH - story.length;

    const isValid =
        trimmedStory.length >= MIN_LENGTH &&
        trimmedStory.length <= MAX_LENGTH;

    /**
     * Submit the incident to our Cloudflare Worker.
     *
     * The Worker currently returns HTTP 501 for valid
     * submissions because database storage is disabled.
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
             * Expected while our backend is under development.
             */
            if (response.status === 501) {
                setShowNotice(true);
                return;
            }

            if (!response.ok) {
                throw new Error(
                    `Submission failed (HTTP ${response.status})`
                );
            }

            /**
             * Future: Show a submission confirmation when
             * the backend stores reports successfully.
             *
             * Until that feature is implemented, we don't
             * claim that anything was saved.
             */
            setShowNotice(true);
        } catch (error) {
            setSubmissionError(
                error instanceof Error
                    ? error.message
                    : "Unable to contact the incident API."
            );
        } finally {
            setIsSubmitting(false);
        }
    }

    return (
        <form onSubmit={handleSubmit} className="mt-6">
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
                    setShowNotice(false);
                    setSubmissionError(null);
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
                <p>Minimum {MIN_LENGTH} characters</p>
                <p>{charactersRemaining} remaining</p>
            </div>

            {/* Cloudflare Turnstile verification */}
            <div className="mt-6">
                <Turnstile
                    siteKey={process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY!}
                    onSuccess={(token) => {
                        setTurnstileToken(token);
                        setSubmissionError(null);
                    }}
                    onExpire={() => setTurnstileToken(null)}
                    onError={() => setTurnstileToken(null)}
                    options={{
                        theme: "dark",
                        size: "flexible",
                    }}
                />
            </div>

            {/* Submit button */}
            <button
                type="submit"
                disabled={!isValid || !turnstileToken || isSubmitting}
                className="mt-6 w-full bg-[#ff633a] px-6 py-4 font-black text-[#101318] transition-colors hover:bg-[#ff805e] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#d8ff48] disabled:cursor-not-allowed disabled:opacity-40"
            >
                {isSubmitting
                    ? "TRANSMITTING INCIDENT REPORT..."
                    : "FILE INCIDENT REPORT ↗"}
            </button>

            {/* API/network errors */}
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

            {/* API is online but submissions aren't enabled */}
            {showNotice && (
                <div
                    role="status"
                    className="mt-4 border-l-4 border-[#ff633a] bg-[#1e242c] p-4"
                >
                    <p className="font-technical text-xs font-bold text-[#ff633a]">
                        SUBMISSION SYSTEM OFFLINE
                    </p>

                    <p className="mt-2 text-sm text-gray-300">
                        The incident report system is still under construction.
                        Your story has not been submitted or saved.
                    </p>
                </div>
            )}

            <p className="mt-4 text-xs leading-relaxed text-gray-400">
                Anonymous submissions will be reviewed before publication.
                Please avoid including personal or identifying information.
            </p>
        </form>
    );
}
