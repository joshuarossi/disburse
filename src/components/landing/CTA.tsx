import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Button } from '@/components/ui/button'
import { ArrowRight, Sparkles } from 'lucide-react'

export function CTA() {
  return (
    <section className="relative py-24 sm:py-32">
      <div className="mx-auto max-w-7xl px-6 lg:px-8">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
          className="relative overflow-hidden rounded-3xl"
        >
          {/* Background gradient */}
          <div className="absolute inset-0 bg-gradient-to-br from-accent-600 via-accent-500 to-accent-400" />
          
          {/* Pattern overlay */}
          <div 
            className="absolute inset-0 opacity-10"
            style={{
              backgroundImage: `radial-gradient(circle at 2px 2px, white 1px, transparent 0)`,
              backgroundSize: '32px 32px'
            }}
          />

          {/* Content */}
          <div className="relative px-8 py-16 sm:px-16 sm:py-24 text-center">
            <div className="mx-auto max-w-2xl">
              <div className="mb-6 inline-flex items-center gap-2 rounded-full bg-white/20 px-4 py-2 text-sm font-medium text-white">
                <Sparkles className="h-4 w-4" />
                <span>30-day free trial</span>
              </div>

              <h2 className="text-3xl font-bold tracking-tight text-white sm:text-4xl lg:text-5xl">
                Ready to streamline your treasury?
              </h2>
              
              <p className="mt-4 text-lg text-white/80">
                Join teams already using Disburse to manage their stablecoin operations 
                with confidence and control.
              </p>

              <div className="mt-10 flex flex-col items-center justify-center gap-4 sm:flex-row">
                <Link to="/login">
                  <Button 
                    size="lg" 
                    className="group bg-white text-accent-600 hover:bg-white/90 shadow-xl"
                  >
                    Try For Free
                    <ArrowRight className="transition-transform group-hover:translate-x-1" />
                  </Button>
                </Link>
              </div>

              <p className="mt-6 text-sm text-white/60">
                No credit card required • Cancel anytime
              </p>
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  )
}
