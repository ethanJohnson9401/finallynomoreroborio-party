import RetirementArtwork from "@/components/RetirementArtwork";

export default function Hero() {

    return (

        <section className="mt-12 grid grid-cols-1 items-center gap-2 lg:mt-12 lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)] lg:gap-8">

            <div>
                  <p className = "text-orange-500">
                      MISSION 001 / OPERATION GOOD RIDDANCE
                  </p>

                  <h1 className = "mt-8 text-5xl font-black leading-[0.95] tracking-tight sm:text-7xl lg:text-[clamp(4rem,6vw,6.5rem)]">
                      <span className = "whitespace-nowrap">THE ROBORIO</span>
                      <br/>
                      IS GETTING
                      <br/>
                      <span className = "text-lime-400">THE BOOT</span>
                  </h1>
            </div>

            <RetirementArtwork />
        </section>

    );

}