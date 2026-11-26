"use client"

// T1-8: the customer's name (and logo, when it has one) wherever a screen names the business.
import { useCustomerBranding } from "@/hooks/use-customer-branding"

export function CustomerName({ className }: { className?: string }) {
  const { name } = useCustomerBranding()
  return (
    <p data-testid="customer-name" className={className}>
      {name}
    </p>
  )
}

// Nothing when the customer has no logo.
export function CustomerLogo({ className }: { className?: string }) {
  const { name, logoUrl } = useCustomerBranding()
  if (!logoUrl) return null
  // A plain img: the logo's address is the customer's, not a build-time asset.
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={logoUrl} alt={`${name} logo`} className={className} />
}
