
import IncidentForm from "@/components/IncidentForm";

export default function TraumaCenter() {
    return (
        <section
            aria-labelledby="trauma-heading"
            className="mt-32"
        >
            {/* Section identification */}
            <div className="flex items-center justify-between gap-4">
                <p className="font-technical text-sm font-bold text-orange-500">
                    04 / COMMUNITY INCIDENT REPORTS
                </p>

                <p className="font-technical hidden text-xs text-gray-400 sm:block">
                    FORM RIO-500
                </p>
            </div>

            {/* Main section heading */}
            <h2
                id="trauma-heading"
                className="mt-8 text-4xl font-black leading-tight tracking-tight md:text-7xl"
            >
                THE ROBORIO
                <br />
                <span className="text-lime-400">
                    TRAUMA CENTER.
                </span>
            </h2>

            {/* Section description */}
            <p className="mt-6 max-w-2xl text-lg text-gray-400">
                Tell us what the roboRIO did to you.
                This is a safe space. Probably.
            </p>

            {/* Incident intake container */}
            <div className="mt-12 border border-white/20 p-6 md:p-10">
                {/*
                  IncidentForm handles intake availability.

                  - Open: shows the submission form
                  - Closed: shows the closed-intake message
                  - Checking: shows connection status
                  - Unavailable: shows connection failure

                  The heading is managed inside IncidentForm
                  so it reflects the actual intake state.
                */}
                <IncidentForm />
            </div>
        </section>
    );
}
