import { motion } from 'framer-motion'
import { useTranslation } from 'react-i18next'
import { Wallet, UserPlus, Send } from 'lucide-react'

export function HowItWorks() {
  const { t } = useTranslation();
  
  const steps = [
    {
      icon: Wallet,
      step: t('landing.howItWorks.step1.number'),
      title: t('landing.howItWorks.step1.title'),
      description: t('landing.howItWorks.step1.description'),
    },
    {
      icon: UserPlus,
      step: t('landing.howItWorks.step2.number'),
      title: t('landing.howItWorks.step2.title'),
      description: t('landing.howItWorks.step2.description'),
    },
    {
      icon: Send,
      step: t('landing.howItWorks.step3.number'),
      title: t('landing.howItWorks.step3.title'),
      description: t('landing.howItWorks.step3.description'),
    },
  ]
  return (
    <section className="relative py-24 sm:py-32">
      {/* Background */}
      <div className="absolute inset-0 -z-10 bg-gradient-to-b from-navy-950 via-navy-900/50 to-navy-950" />
      
      <div className="mx-auto max-w-7xl px-6 lg:px-8">
        {/* Section header */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
          className="mx-auto max-w-2xl text-center"
        >
          <h2 className="text-base font-semibold uppercase tracking-wider text-accent-400">
            {t('landing.howItWorks.title')}
          </h2>
          <p className="mt-2 text-3xl font-bold tracking-tight text-white sm:text-4xl">
            {t('landing.howItWorks.subtitle')}
          </p>
          <p className="mt-4 text-lg text-slate-400">
            {t('landing.howItWorks.description')}
          </p>
        </motion.div>

        {/* Steps */}
        <div className="mx-auto mt-16 max-w-5xl">
          <div className="relative">
            {/* Connecting line */}
            <div className="absolute left-1/2 top-0 hidden h-full w-px -translate-x-1/2 bg-gradient-to-b from-accent-500/50 via-accent-500/20 to-transparent lg:block" />
            
            <div className="grid grid-cols-1 gap-12 lg:grid-cols-3 lg:gap-8">
              {steps.map((step, index) => (
                <motion.div
                  key={step.title}
                  initial={{ opacity: 0, y: 30 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.5, delay: index * 0.15 }}
                  className="relative flex flex-col items-center text-center"
                >
                  {/* Step number badge */}
                  <div className="relative mb-6">
                    <div className="flex h-20 w-20 items-center justify-center rounded-2xl border border-accent-500/30 bg-navy-900">
                      <step.icon className="h-8 w-8 text-accent-400" />
                    </div>
                    <div className="absolute -right-2 -top-2 flex h-8 w-8 items-center justify-center rounded-full bg-accent-500 text-sm font-bold text-navy-950">
                      {step.step}
                    </div>
                  </div>

                  <h3 className="text-xl font-semibold text-white">{step.title}</h3>
                  <p className="mt-3 max-w-xs text-slate-400">{step.description}</p>
                </motion.div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
