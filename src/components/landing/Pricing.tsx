import { motion } from 'framer-motion'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { getPlanFeatureKey, PLANS, type PlanKey } from '@/lib/billingPlans'

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.15 },
  },
}

const itemVariants = {
  hidden: { opacity: 0, y: 30 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.6, ease: [0.22, 1, 0.36, 1] },
  },
}

export function Pricing() {
  const { t } = useTranslation()

  return (
    <section
      id="pricing"
      className="relative py-24 sm:py-32 overflow-hidden"
      style={{ scrollMarginTop: '96px' }}
    >
      <div className="absolute inset-0 -z-10">
        <div className="absolute left-1/4 top-1/4 h-[500px] w-[500px] rounded-full bg-accent-500/10 blur-[120px]" />
        <div className="absolute right-1/4 bottom-1/4 h-[450px] w-[450px] rounded-full bg-accent-400/8 blur-[110px]" />
      </div>

      <div className="mx-auto max-w-7xl px-6 lg:px-8">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-100px' }}
          transition={{ duration: 0.6 }}
          className="mx-auto max-w-3xl text-center mb-16"
        >
          <div className="inline-flex items-center gap-2 rounded-full border border-accent-500/30 bg-accent-500/10 px-4 py-2 text-sm text-accent-400 mb-6">
            <span>{t('landing.pricing.badge')}</span>
          </div>
          <h2 className="text-4xl font-bold tracking-tight text-white sm:text-5xl">
            {t('landing.pricing.title')}
          </h2>
          <p className="mt-4 text-lg text-slate-400">
            {t('landing.pricing.subtitle')}
          </p>
        </motion.div>

        <motion.div
          variants={containerVariants}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: '-100px' }}
          className="grid grid-cols-1 gap-8 lg:grid-cols-3"
        >
          {(Object.entries(PLANS) as [PlanKey, typeof PLANS[PlanKey]][]).map(([key, plan]) => {
            const Icon = plan.icon

            return (
              <motion.div
                key={key}
                variants={itemVariants}
                className={`relative rounded-3xl border p-8 backdrop-blur-sm transition-all duration-500 ${
                  plan.popular
                    ? 'border-accent-500/50 bg-gradient-to-br from-accent-500/10 to-navy-950/60 shadow-xl shadow-accent-500/10'
                    : 'border-white/10 bg-navy-900/50'
                }`}
              >
                {plan.popular ? (
                  <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-accent-500 px-3 py-1 text-xs font-semibold text-navy-950">
                    {t('landing.pricing.popular')}
                  </span>
                ) : null}

                <div className="flex items-center gap-3">
                  <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${
                    plan.popular ? 'bg-accent-500/20 text-accent-400' : 'bg-navy-800 text-slate-400'
                  }`}>
                    <Icon className="h-5 w-5" />
                  </div>
                  <div>
                    <h3 className="text-xl font-semibold text-white">
                      {t(`settings.billing.plans.${key}.name`)}
                    </h3>
                    <p className="text-sm text-slate-400">
                      {t(`settings.billing.plans.${key}.description`)}
                    </p>
                  </div>
                </div>

                <div className="mt-6 flex items-baseline gap-2">
                  <span className="text-3xl font-bold text-white">
                    {t(`settings.billing.plans.${key}.price`, { price: plan.price })}
                  </span>
                </div>

                <ul className="mt-6 space-y-3 text-sm text-slate-300">
                  {plan.features.map((feature, idx) => {
                    const featureKey = getPlanFeatureKey(idx)
                    return (
                      <li key={`${key}-${idx}`} className="flex items-start gap-2">
                        <Check className={`mt-0.5 h-4 w-4 ${plan.popular ? 'text-accent-400' : 'text-green-400'}`} />
                        {t(`settings.billing.plans.${key}.features.${featureKey}`, { defaultValue: feature })}
                      </li>
                    )
                  })}
                </ul>

                <div className="mt-8">
                  <Link to="/login">
                    <Button className="w-full" variant={plan.popular ? 'default' : 'secondary'}>
                      {t('landing.pricing.cta')}
                    </Button>
                  </Link>
                </div>
              </motion.div>
            )
          })}
        </motion.div>

        <div className="mt-10 text-center text-sm text-slate-400">
          {t('landing.pricing.note')}
        </div>
      </div>
    </section>
  )
}
