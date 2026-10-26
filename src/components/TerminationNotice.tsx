export default function TerminationNotice() {
    return (
        <section
            aria-labelledby="termination-heading"
            className="mt-16 md:mt-24"
        >
            <p className="text-sm font-bold tracking-widest text-orange-500">
                02 / PERSONNEL ACTION
            </p>

            <h2
                id="termination-heading"
                className="mt-8 text-4xl font-black tracking-tight md:text-7xl"
            >
                NOTICE OF INVOLUNTARY
                <br />
                <span className="text-lime-400">RETIREMENT.</span>
            </h2>

            <div className="relative mt-10 overflow-hidden bg-[#f7f3ea] p-6 text-[#101318] md:p-12">
                <div
                    aria-hidden="true"
                    className="pointer-events-none relative mb-8 ml-auto w-fit rotate-[-8deg] border-4 border-orange-600 px-3 py-2 text-sm font-black tracking-widest text-orange-600 opacity-70 md:absolute md:right-12 md:top-10 md:mb-0 md:text-4xl"
                >
                    TERMINATED
                </div>
                <p className="text-sm font-bold">FORM RIO-404</p>

                <p className="mt-10 text-xs font-bold uppercase text-gray-500">
                    Reason for separation
                </p>

                <h3 className="mt-4 text-2xl font-black md:text-5xl">
                    REPEATED EMOTIONAL DAMAGE TO SOFTWARE.
                </h3>

                <div className="mt-12 border-t border-black/20 pt-6">
                    <p className="text-sm font-bold">
                        EFFECTIVE: JANUARY 9, 2027
                    </p>

                    <p className="mt-2 text-sm font-bold text-orange-600">
                        NO APPEAL PROCESS AVAILABLE.
                    </p>
                </div>
            </div>
        </section>
    );
}