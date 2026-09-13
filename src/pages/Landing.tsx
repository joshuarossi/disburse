import { Comparison, Faq, FinalCta, Footer, Header, Hero, HowItWorks, Idea, Pricing, Principles, ProductSection, Spotlights, Stats } from '@/components/landing'

export default function Landing() {
  return (
    <div className="mk">
      <Header />
      <main>
        <Hero />
        <ProductSection />
        <Principles />
        <Spotlights />
        <HowItWorks />
        <Comparison />
        <Stats />
        <Idea />
        <Pricing />
        <Faq />
        <FinalCta />
      </main>
      <Footer />
    </div>
  )
}
