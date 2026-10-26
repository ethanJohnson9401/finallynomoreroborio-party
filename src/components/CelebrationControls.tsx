
"use client";

import { useEffect, useRef, useState } from "react";
import { launchCelebration } from "@/lib/celebration";

// January 9, 2027, at 12:00 PM Eastern Standard Time
const KICKOFF_TIME = new Date("2027-01-09T12:00:00-05:00").getTime();

export default function CelebrationControls() {
    const [disrespects, setDisrespects] = useState(0);
    const [celebrating, setCelebrating] = useState(false);
    const [kickoffStarted, setKickoffStarted] = useState(false);

    // null means we haven't checked the kickoff time yet.
    const previousKickoffState = useRef<boolean | null>(null);

    // Detect kickoff and automatically celebrate when it begins.
    useEffect(() => {
        const checkKickoff = () => {
            const hasStarted = Date.now() >= KICKOFF_TIME;

            // Only celebrate if kickoff happens while the page is open.
            if (
                previousKickoffState.current === false &&
                hasStarted
            ) {
                setCelebrating(true);
                launchCelebration();
            }

            previousKickoffState.current = hasStarted;
            setKickoffStarted(hasStarted);
        };

        checkKickoff();

        const interval = window.setInterval(checkKickoff, 1000);

        return () => window.clearInterval(interval);
    }, []);

    // Listen for the F key to pay disrespects.
    useEffect(() => {
        function handleKeyDown(event: KeyboardEvent) {
            if (
                event.key.toLowerCase() !== "f" ||
                event.repeat ||
                event.ctrlKey ||
                event.altKey ||
                event.metaKey
            ) {
                return;
            }

            const target = event.target;

            // Don't trigger when typing into forms or editable content.
            if (
                target instanceof HTMLElement &&
                (target.isContentEditable ||
                    ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))
            ) {
                return;
            }

            setDisrespects((previous) => previous + 1);
        }

        window.addEventListener("keydown", handleKeyDown);

        return () => window.removeEventListener("keydown", handleKeyDown);
    }, []);

    // Manual celebrations are locked until kickoff.
    function handleCelebrate() {
        if (!kickoffStarted) return;

        setCelebrating(true);
        launchCelebration();
    }

    // Clicking the button works before and after kickoff.
    function handleDisrespect() {
        setDisrespects((previous) => previous + 1);
    }

    return (
        <>
            {/* Production celebration controls */}
            <section
                aria-label="Retirement party controls"
                className="mt-4 flex flex-col gap-3 md:flex-row md:items-center"
            >
                <button
                    type="button"
                    onClick={handleCelebrate}
                    disabled={!kickoffStarted}
                    className={`px-6 py-5 font-black transition-colors ${
                        kickoffStarted
                            ? "cursor-pointer bg-lime-400 text-black hover:bg-lime-300"
                            : "cursor-not-allowed bg-[#30383b] text-gray-400"
                    }`}
                >
                    {kickoffStarted
                        ? "INITIATE CELEBRATION ↗"
                        : "CELEBRATION LOCKED — T-MINUS TO KICKOFF"}
                </button>

                <button
                    type="button"
                    onClick={handleDisrespect}
                    className="cursor-pointer bg-orange-500 px-6 py-5 font-black text-black transition-colors hover:bg-orange-400"
                >
                    PRESS F TO PAY DISRESPECTS
                </button>

                <p
                    className="text-center text-xs text-gray-400 md:text-left"
                    aria-live="polite"
                >
                    F = {disrespects} DISRESPECTS
                </p>

                {celebrating && (
                    <p
                        className="text-center text-sm font-bold text-lime-400"
                        role="status"
                    >
                        RETIREMENT PARTY INITIATED.
                    </p>
                )}
            </section>

            {/* This panel is only included in development builds. */}
            {process.env.NODE_ENV === "development" && (
                <aside className="mt-4 border border-dashed border-purple-500/40 p-3">
                    <p className="mb-2 text-xs font-bold text-purple-400">
                        DEVELOPMENT TOOLS
                    </p>

                    <button
                        type="button"
                        onClick={launchCelebration}
                        className="cursor-pointer bg-purple-600 px-4 py-2 text-xs font-bold text-white transition-colors hover:bg-purple-500"
                    >
                        TEST CONFETTI
                    </button>
                </aside>
            )}
        </>
    );
}
