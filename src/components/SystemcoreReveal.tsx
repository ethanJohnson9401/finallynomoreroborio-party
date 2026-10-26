
export default function SystemcoreReveal() {
    return (
        <section
            aria-labelledby="systemcore-heading"
            className="mt-32 bg-[#d8ff48] px-6 py-16 text-[#101318] md:px-12 md:py-24"
        >
            <p className="text-sm font-bold tracking-widest">
                03 / THE SUCCESSOR
            </p>

            <h2
                id="systemcore-heading"
                className="mt-8 text-[clamp(1.75rem,8vw,3rem)] font-black leading-[0.95] tracking-tight md:text-8xl"
            >
                LONG LIVE
                <br />
                <span className="text-[#101318]">
                    SYSTEMCORE.
                </span>
            </h2>

            <p className="mt-8 max-w-2xl text-lg">
                A new era in FRC control. A suspiciously loud farewell to the old one.
            </p>

            {/* Product launch announcement */}
            <div className="mt-12 bg-[#101318] px-5 py-4 text-[#d8ff48]">
                <p className="font-technical text-xs font-bold tracking-widest">
                    SYSTEMCORE // THE NEXT GENERATION HAS ENTERED THE CHAT
                </p>
            </div>

            {/* Technical status information */}
            <div className="mt-8 border-t-2 border-[#101318] pt-6">
                <p className="font-technical text-sm font-bold">
                    SYSTEM STATUS / NEXT GENERATION
                </p>

                <p className="mt-6 text-xl font-bold">
                    01 — NEW CONTROLLER ARRIVES
                </p>

                <p className="mt-4 text-xl font-bold">
                    02 — LEGACY DRAMA DEPARTS
                </p>

                <p className="mt-4 text-xl font-bold">
                    03 — PROGRAMMERS REJOICE
                </p>
            </div>
        </section>
    );
}
