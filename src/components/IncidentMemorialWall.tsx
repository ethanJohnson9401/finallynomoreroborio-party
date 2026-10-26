
"use client";

import {
    useCallback,
    useEffect,
    useState,
} from "react";

interface PublicIncident {
    id: string;
    story: string;
    published_at: string;
}

interface PublicResponse {
    incidents: PublicIncident[];
    nextCursor: string | null;
}

const API_URL = process.env.NEXT_PUBLIC_API_URL;

const PAGE_SIZE = 8;

/**
 * Format a D1 UTC timestamp.
 */
function formatDate(value: string): string {
    const date = new Date(
        value.replace(" ", "T") + "Z"
    );

    if (Number.isNaN(date.getTime())) {
        return "DATE REDACTED";
    }

    return new Intl.DateTimeFormat("en-US", {
        month: "short",
        day: "2-digit",
        year: "numeric",
        timeZone: "UTC",
    })
        .format(date)
        .toUpperCase();
}

export default function IncidentMemorialWall() {
    const [incidents, setIncidents] =
        useState<PublicIncident[]>([]);

    const [cursor, setCursor] =
        useState<string | null>(null);

    const [loading, setLoading] = useState(false);
    const [loaded, setLoaded] = useState(false);

    const [error, setError] =
        useState<string | null>(null);

    /**
     * Retrieve a page of approved incidents.
     */
    const load = useCallback(
        async (
            nextCursor: string | null,
            signal?: AbortSignal
        ) => {
            if (!API_URL) {
                setError(
                    "Public archive configuration is unavailable."
                );
                setLoaded(true);
                return;
            }

            setLoading(true);
            setError(null);

            try {
                const url = new URL(
                    "/api/incidents/approved",
                    API_URL
                );

                url.searchParams.set(
                    "limit",
                    String(PAGE_SIZE)
                );

                if (nextCursor) {
                    url.searchParams.set(
                        "cursor",
                        nextCursor
                    );
                }

                const response = await fetch(
                    url.toString(),
                    { signal }
                );

                if (!response.ok) {
                    throw new Error(
                        `Archive unavailable (HTTP ${response.status})`
                    );
                }

                const data =
                    (await response.json()) as PublicResponse;

                if (
                    !Array.isArray(data.incidents) ||
                    !(
                        data.nextCursor === null ||
                        typeof data.nextCursor === "string"
                    )
                ) {
                    throw new Error(
                        "Invalid archive response"
                    );
                }

                setIncidents((previous) =>
                    nextCursor
                        ? [...previous, ...data.incidents]
                        : data.incidents
                );

                setCursor(data.nextCursor);
                setLoaded(true);
            } catch (reason) {
                if (signal?.aborted) {
                    return;
                }

                setError(
                    reason instanceof Error
                        ? reason.message
                        : "Archive unavailable"
                );

                setLoaded(true);
            } finally {
                if (!signal?.aborted) {
                    setLoading(false);
                }
            }
        },
        []
    );

    /**
     * Load the initial page after mounting.
     */
    useEffect(() => {
        const controller = new AbortController();

        const fetchInitialPage = async () => {
            await load(null, controller.signal);
        };

        void fetchInitialPage();

        return () => {
            controller.abort();
        };
    }, [load]);

    return (
        <section
            id="memorial"
            aria-labelledby="memorial-title"
            className="mt-20 border-t border-white/20 pt-10 md:mt-32 md:pt-12"
        >
            {/* Archive identifier */}
            <div className="font-technical flex flex-wrap items-baseline justify-between gap-3 text-xs tracking-[.2em] text-[#d8ff48]">
                <span>
                    05 / THE EVIDENCE LOCKER
                </span>

                <span className="text-white/50">
                    ARCHIVE STATUS: DECLASSIFIED
                </span>
            </div>

            {/* Section headline */}
            <div className="mt-8 grid gap-6 lg:grid-cols-[1.35fr_1fr] lg:items-end">
                <h2
                    id="memorial-title"
                    className="text-5xl leading-[.89] font-black tracking-[-.06em] uppercase sm:text-7xl lg:text-8xl"
                >
                    THE INCIDENT
                    <br />

                    <span className="text-[#ff633a]">
                        MEMORIAL.
                    </span>
                </h2>

                <p className="max-w-md text-base leading-relaxed text-white/65 lg:pb-2">
                    A permanent record of the moments
                    our robots chose chaos. Every case
                    below was reviewed before release.
                    Names withheld. Emotional damage
                    retained.
                </p>
            </div>

            {/* Declassification banner */}
            <div className="font-technical mt-10 flex flex-col gap-2 border-y-2 border-[#d8ff48] bg-[#d8ff48] px-4 py-3 text-[10px] leading-relaxed font-bold tracking-[.08em] text-[#101318] uppercase sm:flex-row sm:justify-between sm:gap-6 sm:text-xs">
                <span>
                    DECLASSIFIED INCIDENT ARCHIVE
                </span>

                <span>
                    FORM RIO-404 / PUBLIC RELEASE
                </span>
            </div>

            {/* Empty archive */}
            {loaded &&
                incidents.length === 0 &&
                !error && (
                    <div className="border-b border-white/20 py-16 sm:py-24">
                        <p className="font-technical text-xs tracking-widest text-[#d8ff48]">
                            ARCHIVE EMPTY / 000
                        </p>

                        <p className="mt-4 max-w-xl text-[1.65rem] leading-[1.08] font-black tracking-[-.035em] uppercase sm:text-5xl">
                            No incidents released.
                            The roboRIO denies everything.
                        </p>

                        <p className="mt-5 text-white/55">
                            Approved community reports
                            will appear here once
                            declassified.
                        </p>
                    </div>
                )}

            {/* Public incident records */}
            <ol className="list-none p-0">
                {incidents.map((incident, index) => (
                    <li
                        key={incident.id}
                        className="grid gap-5 border-b border-white/20 py-8 sm:grid-cols-[8rem_1fr] sm:gap-10 sm:py-12"
                    >
                        {/* Case metadata */}
                        <div className="font-technical text-xs tracking-[.12em] text-white/50 uppercase">
                            <span className="block text-4xl font-black tracking-tighter text-[#d8ff48]">
                                {String(index + 1).padStart(
                                    3,
                                    "0"
                                )}
                            </span>

                            <span className="mt-2 block">
                                CASE FILE
                            </span>

                            <span className="mt-1 block">
                                {formatDate(
                                    incident.published_at
                                )}
                            </span>
                        </div>

                        {/* Incident contents */}
                        <div>
                            <div className="font-technical mb-4 flex flex-wrap items-center gap-3 text-[10px] tracking-widest uppercase">
                                <span className="border border-[#ff633a] px-2 py-1 text-[#ff633a]">
                                    Verified by moderation
                                </span>

                                <span className="text-white/40">
                                    RIO-
                                    {incident.id
                                        .slice(0, 8)
                                        .toUpperCase()}
                                </span>
                            </div>

                            <blockquote className="m-0 max-w-4xl whitespace-pre-wrap break-words text-xl leading-snug font-semibold tracking-tight sm:text-3xl">
                                “{incident.story}”
                            </blockquote>
                        </div>
                    </li>
                ))}
            </ol>

            {/* Error display */}
            {error && (
                <p
                    role="alert"
                    className="mt-6 border-l-4 border-[#ff633a] pl-4 text-sm text-[#ff9c83]"
                >
                    {error}{" "}

                    <button
                        type="button"
                        className="underline underline-offset-4"
                        onClick={() =>
                            void load(
                                incidents.length > 0
                                    ? cursor
                                    : null
                            )
                        }
                    >
                        Retry
                    </button>
                </p>
            )}

            {/* Archive controls */}
            <div className="mt-8 flex items-center justify-between gap-4">
                <span
                    aria-live="polite"
                    className="font-technical text-xs text-white/50"
                >
                    {loading
                        ? "RETRIEVING ARCHIVE…"
                        : `${incidents.length} RELEASED RECORDS LOADED`}
                </span>

                {cursor && (
                    <button
                        type="button"
                        disabled={loading}
                        onClick={() => void load(cursor)}
                        className="font-technical border border-[#d8ff48] px-5 py-3 text-xs font-bold tracking-wider text-[#d8ff48] transition hover:bg-[#d8ff48] hover:text-[#101318] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white disabled:opacity-50"
                    >
                        LOAD MORE CASE FILES ↗
                    </button>
                )}
            </div>
        </section>
    );
}
