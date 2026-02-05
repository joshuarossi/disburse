export type LandingLink = {
  nameKey: string
  href: string
  external?: boolean
}

const getEnvLink = (key: string, fallback: string) => {
  const value = (import.meta as ImportMeta & { env?: Record<string, string> }).env?.[key]
  if (value && value.trim()) {
    return value.trim()
  }
  return fallback
}

export const LANDING_FOOTER_LINKS: {
  product: LandingLink[]
  company: LandingLink[]
  legal: LandingLink[]
} = {
  product: [
    { nameKey: 'landing.footer.features', href: getEnvLink('VITE_LANDING_LINK_FEATURES', '/#features') },
    { nameKey: 'landing.footer.pricing', href: getEnvLink('VITE_LANDING_LINK_PRICING', '/#pricing') },
    { nameKey: 'landing.footer.documentation', href: getEnvLink('VITE_LANDING_LINK_DOCS', '/docs') },
  ],
  company: [
    { nameKey: 'landing.footer.about', href: getEnvLink('VITE_LANDING_LINK_ABOUT', '/about') },
    { nameKey: 'landing.footer.blog', href: getEnvLink('VITE_LANDING_LINK_BLOG', '/blog') },
    { nameKey: 'landing.footer.contact', href: getEnvLink('VITE_LANDING_LINK_CONTACT', '/contact') },
  ],
  legal: [
    { nameKey: 'landing.footer.privacy', href: getEnvLink('VITE_LANDING_LINK_PRIVACY', '/privacy') },
    { nameKey: 'landing.footer.terms', href: getEnvLink('VITE_LANDING_LINK_TERMS', '/terms') },
  ],
}

export const LANDING_CONTACT = {
  salesEmail: 'sales@disburse.com',
  supportEmail: 'support@disburse.com',
}
