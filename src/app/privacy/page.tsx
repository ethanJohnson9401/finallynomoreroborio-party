
import type { Metadata } from "next";
import Link from "next/link";
import Footer from "@/components/Footer";

export const metadata: Metadata = {
    title: "Privacy & Content Policy | Finally No More roboRIO",
    description:
        "How the roboRIO Trauma Center handles anonymous reports, moderation, privacy, and removal requests.",
};

const email = "privacy@finallynomoreroborio.party";

export default function PrivacyPage() {
    return (
        <main className="min-h-screen bg-[#101318] px-6 py-10 text-white md:px-12 lg:px-20">
            <div className="mx-auto max-w-5xl">
                <header className="flex flex-wrap items-center justify-between gap-6 border-b border-white/20 pb-8">
                    <Link
                        href="/"
                        className="text-sm font-black tracking-[-0.03em] transition-colors hover:text-[#d8ff48]"
                    >
                        FINALLY NO MORE ROBORIO.
                    </Link>

                    <Link
                        href="/"
                        className="font-mono text-xs font-bold tracking-wider text-[#d8ff48] hover:underline"
                    >
                        ← RETURN TO THE PARTY
                    </Link>
                </header>

                <section className="border-b border-white/20 py-16 md:py-24">
                    <p className="font-mono text-xs font-bold tracking-[0.25em] text-[#d8ff48]">
                        DEPARTMENT OF DATA SURVIVAL / 001
                    </p>

                    <h1 className="mt-6 max-w-4xl text-5xl leading-[0.92] font-black tracking-[-0.06em] uppercase sm:text-7xl lg:text-8xl">
                        YOUR DATA.
                        <br />
                        <span className="text-[#d8ff48]">
                            YOUR RULES.
                        </span>
                    </h1>

                    <p className="mt-8 max-w-2xl text-base leading-8 text-gray-300">
                        The roboRIO might have lost your robot
                        code, but we still take privacy seriously.
                        Here is how incident reports are handled.
                    </p>
                </section>

                <div className="grid gap-12 py-14 md:grid-cols-[180px_1fr]">
                    <aside className="font-mono text-xs tracking-wider text-gray-400">
                        POLICY / PUBLIC
                        <div className="mt-4 h-1 w-14 bg-[#ff633a]" />
                    </aside>

                    <div className="space-y-14">
                        <PolicySection number="01" title="THE PROJECT">
                            Finally No More roboRIO is an unofficial
                            FRC parody website. Visitors can submit
                            anonymous hardware incident stories when
                            submissions are enabled. Every report
                            requires moderator approval before
                            publication.
                        </PolicySection>

                        <PolicySection number="02" title="WHAT WE STORE">
                            We store the submitted story, a random
                            incident identifier, a duplicate-prevention
                            submission key, timestamps, and moderation
                            status. Private moderation records also
                            record the authenticated moderator&apos;s
                            email address.
                            <br />
                            <br />
                            We do not ask submitters for names or
                            email addresses. However, stories may
                            contain identifying details provided by
                            their authors.
                        </PolicySection>

                        <PolicySection number="03" title="SECURITY">
                            Submissions use Cloudflare Turnstile and
                            rate limiting to reduce abuse. Cloudflare
                            may process network information for
                            hosting, security, and abuse prevention.
                        </PolicySection>

                        <PolicySection number="04" title="PUBLICATION">
                            All new reports start as pending.
                            Only approved reports appear on the
                            public Incident Memorial. Pending and
                            rejected reports remain unpublished.
                            Moderators may reject inappropriate
                            or identifying content.
                        </PolicySection>

                        <PolicySection number="05" title="RETENTION">
                            Data retention periods are still being
                            finalized. We are not currently promising
                            an automatic deletion schedule. Private
                            database backups may contain incident
                            and moderation records.
                        </PolicySection>

                        <section
                            id="removal"
                            className="scroll-mt-12 border-l-4 border-[#d8ff48] bg-[#1e242c] p-6 md:p-8"
                        >
                            <p className="font-mono text-xs font-bold tracking-widest text-[#d8ff48]">
                                06 / REMOVAL REQUESTS
                            </p>

                            <h2 className="mt-4 text-2xl font-black uppercase md:text-3xl">
                                WANT A REPORT REMOVED?
                            </h2>

                            <p className="mt-4 text-sm leading-7 text-gray-300">
                                Email us with the incident receipt
                                ID or enough information to identify
                                the report. Please avoid sending
                                additional sensitive personal data.
                            </p>

                            <a
                                href={`mailto:${email}?subject=Incident%20Removal%20Request`}
                                className="mt-6 inline-flex max-w-full flex-wrap items-center gap-3 bg-[#d8ff48] px-5 py-4 font-mono text-xs font-bold break-all text-[#101318] transition-colors hover:bg-white focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#d8ff48]"
                            >
                                {email}
                                <span aria-hidden="true">↗</span>
                            </a>

                            <p className="mt-5 text-xs leading-6 text-gray-400">
                                Withdrawal removes a report from
                                public view. It does not automatically
                                erase private records or backups.
                            </p>
                        </section>

                        <PolicySection number="07" title="POLICY CHANGES">
                            We may update this policy as the project
                            evolves. The policy is also maintained
                            in our public GitHub repository.
                        </PolicySection>
                    </div>
                </div>

                <Footer />
            </div>
        </main>
    );
}

function PolicySection({
                           number,
                           title,
                           children,
                       }: {
    number: string;
    title: string;
    children: React.ReactNode;
}) {
    return (
        <section className="border-t border-white/20 pt-6">
            <p className="font-mono text-xs font-bold tracking-widest text-[#ff633a]">
                {number} / POLICY
            </p>

            <h2 className="mt-4 text-2xl font-black tracking-tight uppercase md:text-3xl">
                {title}
            </h2>

            <p className="mt-5 max-w-2xl text-sm leading-7 text-gray-300">
                {children}
            </p>
        </section>
    );
}
