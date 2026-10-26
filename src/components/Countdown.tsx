
"use client";

import { useEffect, useState } from "react";

// January 9, 2027, at 12:00 PM Eastern Standard Time
const KICKOFF_DATE = new Date("2027-01-09T12:00:00-05:00");

// Calculate the remaining seconds until kickoff
function getSecondsRemaining(): number {
    const difference = KICKOFF_DATE.getTime() - Date.now();

    return Math.max(0, Math.floor(difference / 1000));
}

// Convert seconds into days, hours, minutes, and seconds
function formatTime(totalSeconds: number) {
    return {
        days: Math.floor(totalSeconds / 86400),
        hours: Math.floor((totalSeconds % 86400) / 3600),
        minutes: Math.floor((totalSeconds % 3600) / 60),
        seconds: totalSeconds % 60,
    };
}

export default function Countdown() {
    const [secondsRemaining, setSecondsRemaining] = useState<number | null>(null);

    useEffect(() => {
        const updateCountdown = () => {
            setSecondsRemaining(getSecondsRemaining());
        };

        // Calculate immediately when the component mounts
        updateCountdown();

        // Update once per second
        const interval = window.setInterval(updateCountdown, 1000);

        // Clean up the interval when the component unmounts
        return () => window.clearInterval(interval);
    }, []);

    const time = formatTime(secondsRemaining ?? 0);

    return (
        <section
            aria-label="Countdown to the 2027 FRC kickoff"
            className="mt-16 border-l-4 border-orange-500 bg-[#1e242c] p-6 md:p-8"
        >
            {/* Mission-control heading */}
            <p className="font-technical text-sm font-bold tracking-wide text-lime-400">
                FLIGHT CONTROL / T-MINUS
            </p>

            {/* Kickoff date */}
            <p className="font-technical mt-2 text-xs tracking-wide text-gray-400">
                2027 FRC KICKOFF / JAN 09 / 12:00 ET
            </p>

            {/* Countdown units */}
            <div className="mt-8 grid grid-cols-2 gap-6 md:grid-cols-4">
                {Object.entries(time).map(([label, value]) => (
                    <div
                        key={label}
                        className="min-w-0 border-l border-white/15 pl-4 first:border-l-0 first:pl-0 md:pl-6"
                    >
                        {/* Countdown number */}
                        <p className="font-technical text-5xl font-black tabular-nums md:text-7xl">
                            {secondsRemaining === null
                                ? "--"
                                : String(value).padStart(2, "0")}
                        </p>

                        {/* Unit label */}
                        <p className="font-technical mt-2 text-xs font-bold uppercase tracking-wider text-gray-400">
                            {label}
                        </p>
                    </div>
                ))}
            </div>

            {/* Countdown status */}
            <p
                className="font-technical mt-8 text-xs font-bold tracking-wide text-orange-500"
                role="status"
            >
                {secondsRemaining === null
                    ? "INITIALIZING COUNTDOWN SYSTEM..."
                    : secondsRemaining > 0
                        ? "COUNTDOWN ACTIVE // T-MINUS TO KICKOFF"
                        : "KICKOFF REACHED // RETIREMENT AUTHORIZED"}
            </p>
        </section>
    );
}
