import Header from "@/components/Header"
import Hero from "@/components/Hero";
import Countdown from "@/components/Countdown";
import CelebrationControls from "@/components/CelebrationControls";
import TerminationNotice from "@/components/TerminationNotice";
import SystemcoreReveal from "@/components/SystemcoreReveal";
import Footer from "@/components/Footer";
import ScrollReveal from "@/components/ScrollReveal";

export default function Home(){
  return (

      <main className="min-h-screen px-8 py-12">

          <Header />
          <Hero />
          <Countdown />
          <CelebrationControls />
          <ScrollReveal><TerminationNotice/></ScrollReveal>
          <ScrollReveal><SystemcoreReveal /></ScrollReveal>
          <Footer />
      </main>

  )
}