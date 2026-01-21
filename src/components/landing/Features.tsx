import { motion } from 'framer-motion'
import { 
  Shield, 
  Lock, 
  FileText, 
  Coins, 
  Users, 
  CreditCard 
} from 'lucide-react'

const features = [
  {
    icon: Shield,
    title: 'Non-Custodial',
    description: 'Your keys, your funds. We never have access to your private keys or assets.',
  },
  {
    icon: Lock,
    title: 'Safe-Powered',
    description: 'Built on Gnosis Safe, the most trusted smart contract wallet in Web3.',
  },
  {
    icon: FileText,
    title: 'Audit Trail',
    description: 'Complete transaction history with immutable on-chain records for compliance.',
  },
  {
    icon: Coins,
    title: 'Stablecoin Native',
    description: 'First-class support for USDC and USDT with more tokens coming soon.',
  },
  {
    icon: Users,
    title: 'Role-Based Access',
    description: 'Granular permissions for your team. Admins, approvers, initiators, and more.',
  },
  {
    icon: CreditCard,
    title: 'Simple Billing',
    description: 'Pay for the platform in stablecoins. No credit cards or bank accounts needed.',
  },
]

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.1,
    },
  },
}

const itemVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.5 },
  },
}

export function Features() {
  return (
    <section id="features" className="relative py-24 sm:py-32">
      {/* Background accent */}
      <div className="absolute inset-0 -z-10">
        <div className="absolute left-0 top-1/2 h-[400px] w-[400px] -translate-y-1/2 rounded-full bg-accent-500/5 blur-[100px]" />
      </div>

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
            Features
          </h2>
          <p className="mt-2 text-3xl font-bold tracking-tight text-white sm:text-4xl">
            Everything you need to manage treasury operations
          </p>
          <p className="mt-4 text-lg text-slate-400">
            Built for Web3 teams who need security, transparency, and control over their funds.
          </p>
        </motion.div>

        {/* Features grid */}
        <motion.div
          variants={containerVariants}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true }}
          className="mx-auto mt-16 grid max-w-5xl grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3"
        >
          {features.map((feature) => (
            <motion.div
              key={feature.title}
              variants={itemVariants}
              className="group relative rounded-2xl border border-white/5 bg-navy-900/50 p-8 transition-all duration-300 hover:border-accent-500/30 hover:bg-navy-800/50"
            >
              <div className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-xl bg-accent-500/10 text-accent-400 transition-colors group-hover:bg-accent-500/20">
                <feature.icon className="h-6 w-6" />
              </div>
              <h3 className="text-lg font-semibold text-white">{feature.title}</h3>
              <p className="mt-2 text-slate-400">{feature.description}</p>
            </motion.div>
          ))}
        </motion.div>
      </div>
    </section>
  )
}
