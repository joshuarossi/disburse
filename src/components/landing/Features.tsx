import { motion } from 'framer-motion'
import { useTranslation } from 'react-i18next'
import { 
  Shield, 
  Lock, 
  FileText, 
  Coins, 
  Users, 
  CreditCard,
  ShieldCheck,
  Layers,
  CheckCircle2
} from 'lucide-react'

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.15,
    },
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

const slideInLeft = {
  hidden: { opacity: 0, x: -50 },
  visible: {
    opacity: 1,
    x: 0,
    transition: { duration: 0.7, ease: [0.22, 1, 0.36, 1] },
  },
}

const slideInRight = {
  hidden: { opacity: 0, x: 50 },
  visible: {
    opacity: 1,
    x: 0,
    transition: { duration: 0.7, ease: [0.22, 1, 0.36, 1] },
  },
}

export function Features() {
  const { t } = useTranslation();
  
  return (
    <>
      {/* Section 1: Security & Compliance Hero Section */}
      <section className="relative py-24 sm:py-32 overflow-hidden">
        {/* Background effects */}
        <div className="absolute inset-0 -z-10">
          <div className="absolute left-1/4 top-1/4 h-[600px] w-[600px] rounded-full bg-accent-500/10 blur-[120px]" />
          <div className="absolute right-1/4 bottom-1/4 h-[500px] w-[500px] rounded-full bg-accent-400/8 blur-[100px]" />
        </div>

        <div className="mx-auto max-w-7xl px-6 lg:px-8">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-100px" }}
            transition={{ duration: 0.6 }}
            className="mx-auto max-w-3xl text-center mb-16"
          >
            <div className="inline-flex items-center gap-2 rounded-full border border-accent-500/30 bg-accent-500/10 px-4 py-2 text-sm text-accent-400 mb-6">
              <ShieldCheck className="h-4 w-4" />
              <span>{t('landing.features.section1.badge')}</span>
            </div>
            <h2 className="text-4xl font-bold tracking-tight text-white sm:text-5xl lg:text-6xl">
              {t('landing.features.section1.title')}{' '}
              <span className="bg-gradient-to-r from-accent-400 to-accent-500 bg-clip-text text-transparent">
                {t('landing.features.section1.titleHighlight')}
              </span>
            </h2>
            <p className="mt-6 text-lg text-slate-400 max-w-2xl mx-auto">
              {t('landing.features.description')}
            </p>
          </motion.div>

          <motion.div
            variants={containerVariants}
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, margin: "-100px" }}
            className="grid grid-cols-1 gap-8 lg:grid-cols-3 lg:gap-6"
          >
            {/* Non-Custodial - Large Card */}
            <motion.div
              variants={itemVariants}
              className="lg:col-span-2 group relative rounded-3xl border border-white/10 bg-gradient-to-br from-navy-900/80 to-navy-950/80 p-10 backdrop-blur-sm transition-all duration-500 hover:border-accent-500/40 hover:shadow-2xl hover:shadow-accent-500/10"
            >
              <div className="absolute inset-0 rounded-3xl bg-gradient-to-br from-accent-500/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
              <div className="relative">
                <div className="mb-6 inline-flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-accent-500/20 to-accent-600/10 text-accent-400 border border-accent-500/20">
                  <Shield className="h-8 w-8" />
                </div>
                <h3 className="text-2xl font-bold text-white mb-4">{t('landing.features.nonCustodial.title')}</h3>
                <p className="text-lg text-slate-300 leading-relaxed">{t('landing.features.nonCustodial.description')}</p>
              </div>
            </motion.div>

            {/* Safe-Powered */}
            <motion.div
              variants={itemVariants}
              className="group relative rounded-3xl border border-white/10 bg-navy-900/50 p-8 backdrop-blur-sm transition-all duration-500 hover:border-accent-500/40 hover:bg-navy-800/60"
            >
              <div className="mb-6 inline-flex h-14 w-14 items-center justify-center rounded-xl bg-accent-500/10 text-accent-400 transition-colors group-hover:bg-accent-500/20">
                <Lock className="h-7 w-7" />
              </div>
              <h3 className="text-xl font-semibold text-white mb-3">{t('landing.features.safePowered.title')}</h3>
              <p className="text-slate-400">{t('landing.features.safePowered.description')}</p>
            </motion.div>

            {/* Sanctions Screening - Full Width Below */}
            <motion.div
              variants={itemVariants}
              className="lg:col-span-3 group relative rounded-3xl border border-white/10 bg-gradient-to-r from-navy-900/60 via-navy-950/60 to-navy-900/60 p-10 backdrop-blur-sm transition-all duration-500 hover:border-accent-500/40"
            >
              <div className="flex flex-col lg:flex-row items-start lg:items-center gap-6">
                <div className="flex-shrink-0">
                  <div className="inline-flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-green-500/20 to-emerald-600/10 text-green-400 border border-green-500/20">
                    <ShieldCheck className="h-8 w-8" />
                  </div>
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-3">
                    <h3 className="text-2xl font-bold text-white">{t('landing.features.sanctionsScreening.title')}</h3>
                    <span className="inline-flex items-center gap-1 rounded-full bg-green-500/10 px-3 py-1 text-xs font-medium text-green-400 border border-green-500/20">
                      <CheckCircle2 className="h-3 w-3" />
                      {t('landing.features.badges.compliance')}
                    </span>
                  </div>
                  <p className="text-lg text-slate-300 leading-relaxed">{t('landing.features.sanctionsScreening.description')}</p>
                </div>
              </div>
            </motion.div>
          </motion.div>
        </div>
      </section>

      {/* Section 2: Operations - Split Layout */}
      <section className="relative py-24 sm:py-32 overflow-hidden">
        <div className="absolute inset-0 -z-10 bg-gradient-to-b from-navy-950 via-navy-900/30 to-navy-950" />
        
        <div className="mx-auto max-w-7xl px-6 lg:px-8">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-100px" }}
            transition={{ duration: 0.6 }}
            className="mx-auto max-w-3xl text-center mb-16"
          >
            <h2 className="text-4xl font-bold tracking-tight text-white sm:text-5xl">
              {t('landing.features.section2.title')}{' '}
              <span className="bg-gradient-to-r from-accent-400 to-accent-500 bg-clip-text text-transparent">
                {t('landing.features.section2.titleHighlight')}
              </span>
            </h2>
          </motion.div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 max-w-6xl mx-auto">
            {/* Audit Trail */}
            <motion.div
              initial="hidden"
              whileInView="visible"
              viewport={{ once: true, margin: "-100px" }}
              variants={slideInLeft}
              className="group relative rounded-3xl border border-white/10 bg-navy-900/50 p-10 backdrop-blur-sm transition-all duration-500 hover:border-accent-500/40 hover:bg-navy-800/60 hover:shadow-xl hover:shadow-accent-500/5"
            >
              <div className="mb-6 inline-flex h-16 w-16 items-center justify-center rounded-2xl bg-accent-500/10 text-accent-400 transition-colors group-hover:bg-accent-500/20 group-hover:scale-110">
                <FileText className="h-8 w-8" />
              </div>
              <h3 className="text-2xl font-bold text-white mb-4">{t('landing.features.auditTrail.title')}</h3>
              <p className="text-lg text-slate-300 leading-relaxed">{t('landing.features.auditTrail.description')}</p>
            </motion.div>

            {/* Batch Transactions */}
            <motion.div
              initial="hidden"
              whileInView="visible"
              viewport={{ once: true, margin: "-100px" }}
              variants={slideInRight}
              className="group relative rounded-3xl border border-white/10 bg-gradient-to-br from-navy-900/60 to-navy-950/60 p-10 backdrop-blur-sm transition-all duration-500 hover:border-accent-500/40 hover:shadow-xl hover:shadow-accent-500/5"
            >
              <div className="mb-6 inline-flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-accent-500/20 to-accent-600/10 text-accent-400 border border-accent-500/20 transition-transform group-hover:scale-110">
                <Layers className="h-8 w-8" />
              </div>
              <div className="flex items-center gap-3 mb-4">
                <h3 className="text-2xl font-bold text-white">{t('landing.features.batchTransactions.title')}</h3>
                <span className="inline-flex items-center gap-1 rounded-full bg-accent-500/10 px-3 py-1 text-xs font-medium text-accent-400 border border-accent-500/20">
                  <CheckCircle2 className="h-3 w-3" />
                  {t('landing.features.badges.efficient')}
                </span>
              </div>
              <p className="text-lg text-slate-300 leading-relaxed">{t('landing.features.batchTransactions.description')}</p>
            </motion.div>
          </div>
        </div>
      </section>

      {/* Section 3: Platform Features - Grid */}
      <section id="features" className="relative py-24 sm:py-32 overflow-hidden">
        <div className="absolute inset-0 -z-10">
          <div className="absolute right-0 top-1/2 h-[500px] w-[500px] -translate-y-1/2 rounded-full bg-accent-500/5 blur-[120px]" />
        </div>

        <div className="mx-auto max-w-7xl px-6 lg:px-8">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-100px" }}
            transition={{ duration: 0.6 }}
            className="mx-auto max-w-3xl text-center mb-16"
          >
            <h2 className="text-4xl font-bold tracking-tight text-white sm:text-5xl">
              {t('landing.features.section3.title')}
            </h2>
            <p className="mt-4 text-lg text-slate-400">
              {t('landing.features.section3.description')}
            </p>
          </motion.div>

          <motion.div
            variants={containerVariants}
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, margin: "-100px" }}
            className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 max-w-6xl mx-auto"
          >
            {/* Stablecoin Native */}
            <motion.div
              variants={itemVariants}
              className="group relative rounded-2xl border border-white/5 bg-navy-900/50 p-8 transition-all duration-300 hover:border-accent-500/30 hover:bg-navy-800/50 hover:shadow-lg hover:shadow-accent-500/5"
            >
              <div className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-xl bg-accent-500/10 text-accent-400 transition-colors group-hover:bg-accent-500/20 group-hover:scale-110">
                <Coins className="h-6 w-6" />
              </div>
              <h3 className="text-lg font-semibold text-white mb-2">{t('landing.features.stablecoinNative.title')}</h3>
              <p className="text-slate-400">{t('landing.features.stablecoinNative.description')}</p>
            </motion.div>

            {/* Role-Based Access */}
            <motion.div
              variants={itemVariants}
              className="group relative rounded-2xl border border-white/5 bg-navy-900/50 p-8 transition-all duration-300 hover:border-accent-500/30 hover:bg-navy-800/50 hover:shadow-lg hover:shadow-accent-500/5"
            >
              <div className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-xl bg-accent-500/10 text-accent-400 transition-colors group-hover:bg-accent-500/20 group-hover:scale-110">
                <Users className="h-6 w-6" />
              </div>
              <h3 className="text-lg font-semibold text-white mb-2">{t('landing.features.roleBasedAccess.title')}</h3>
              <p className="text-slate-400">{t('landing.features.roleBasedAccess.description')}</p>
            </motion.div>

            {/* Simple Billing */}
            <motion.div
              variants={itemVariants}
              className="group relative rounded-2xl border border-white/5 bg-navy-900/50 p-8 transition-all duration-300 hover:border-accent-500/30 hover:bg-navy-800/50 hover:shadow-lg hover:shadow-accent-500/5"
            >
              <div className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-xl bg-accent-500/10 text-accent-400 transition-colors group-hover:bg-accent-500/20 group-hover:scale-110">
                <CreditCard className="h-6 w-6" />
              </div>
              <h3 className="text-lg font-semibold text-white mb-2">{t('landing.features.simpleBilling.title')}</h3>
              <p className="text-slate-400">{t('landing.features.simpleBilling.description')}</p>
            </motion.div>
          </motion.div>
        </div>
      </section>
    </>
  )
}
