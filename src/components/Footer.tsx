
import Link from "next/link";

export default function Footer() {
    return (
        <footer className="mt-24 border-t border-white/15 py-8">
            <div className="flex flex-col justify-between gap-6 md:flex-row md:items-start">
                <div>
                    <p className="text-xs font-black tracking-[0.2em]">
                        FINALLYNOMOREROBORIO.PARTY
                    </p>

                    <p className="mt-2 text-xs text-gray-400">
                        Built by FRC programmers. Fueled by emotional damage.
                    </p>
                </div>

                <div className="flex flex-col gap-3 text-xs">
                    <Link
                        href="/privacy"
                        className="font-bold text-[#d8ff48] hover:underline"
                    >
                        PRIVACY & CONTENT POLICY ↗
                    </Link>

                    <a
                        href="mailto:privacy@finallynomoreroborio.party"
                        className="text-gray-400 hover:text-white"
                    >
                        REQUEST INCIDENT REMOVAL
                    </a>
                </div>

                <p className="max-w-sm text-xs leading-relaxed text-gray-400">
                    Independent FRC parody project.
                    Not affiliated with or endorsed by FIRST,
                    NI, or the manufacturers of the hardware discussed.
                </p>
            </div>
        </footer>
    );
}
