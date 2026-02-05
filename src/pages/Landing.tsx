import { Header, Hero, Features, Pricing, HowItWorks, CTA, Footer } from '@/components/landing'

export default function Landing() {
  return (
    <div className="min-h-screen" style={{ backgroundColor: 'var(--color-bg-primary)' }}>
      <Header />
      <main>
        <Hero />
        <Features />
        <Pricing />
        <HowItWorks />
        <CTA />
      </main>
      <Footer />
    </div>
  )
}
