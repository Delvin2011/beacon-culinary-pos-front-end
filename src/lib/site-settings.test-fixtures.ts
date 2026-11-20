// Test data: a GET /admin/settings body with every setting of contract section 2, at the shipped defaults.
import type { SettingValue, SiteSetting, SiteSettings } from "@/lib/site-settings"

type Seed = Omit<SiteSetting, "value" | "isDefault" | "active" | "lastChange" | "description"> & { description?: string }

const SEEDS: Seed[] = [
  { key: "vat.standard-rate", defaultValue: 0.15, type: "DECIMAL", limits: { min: 0, max: 0.9999, scale: 4, nullable: false }, group: "VAT", sensitive: true },
  { key: "reports.close-day.first-trading-day", defaultValue: "2026-10-12", type: "DATE", limits: { nullable: true }, group: "END_OF_DAY", sensitive: true },
  { key: "dashboard.variance.threshold", defaultValue: 50, type: "DECIMAL", limits: { min: 0, max: 99999999.99, scale: 2, nullable: false }, group: "DASHBOARD", sensitive: false },
  { key: "dashboard.voidRefund.watchPercent", defaultValue: 3, type: "DECIMAL", limits: { min: 0, max: 100, scale: 2, nullable: false }, group: "DASHBOARD", sensitive: false },
  { key: "dashboard.slowMeal.thresholdPercent", defaultValue: 25, type: "DECIMAL", limits: { min: 0, max: 100, scale: 2, nullable: false }, group: "DASHBOARD", sensitive: false },
  { key: "dashboard.slowMeal.afterTime", defaultValue: "12:30", type: "TIME", limits: { nullable: false }, group: "DASHBOARD", sensitive: false },
  { key: "dashboard.openingHours", defaultValue: "06:00-15:00", type: "TIME_RANGE", limits: { nullable: false }, group: "DASHBOARD", sensitive: false },
  { key: "board.done-display-minutes", defaultValue: 10, type: "INTEGER", limits: { min: 0, max: 1440, scale: 0, nullable: false }, group: "BOARD", sensitive: false },
  { key: "pos.tills.require-registered", defaultValue: false, type: "BOOLEAN", limits: { nullable: false }, group: "TILLS", sensitive: true },
  { key: "pos.session.idle-lock-minutes", defaultValue: 5, type: "INTEGER", limits: { min: 1, max: 1440, scale: 0, nullable: false }, group: "SESSIONS", sensitive: false },
  { key: "pos.session.idle-expiry-minutes", defaultValue: 30, type: "INTEGER", limits: { min: 1, max: 1440, scale: 0, nullable: false }, group: "SESSIONS", sensitive: false },
  { key: "pos.offline.max-offline-hours", defaultValue: 6, type: "INTEGER", limits: { min: 1, max: 18, scale: 0, nullable: false }, group: "OFFLINE", sensitive: false },
  { key: "pos.offline.warn-offline-hours", defaultValue: 5, type: "INTEGER", limits: { min: 1, max: 18, scale: 0, nullable: false }, group: "OFFLINE", sensitive: false },
  { key: "pos.offline.accounts-enabled", defaultValue: true, type: "BOOLEAN", limits: { nullable: false }, group: "OFFLINE", sensitive: true },
  { key: "pos.offline.account-cap", defaultValue: 150, type: "DECIMAL", limits: { min: 0, max: 99999999.99, scale: 2, nullable: false }, group: "OFFLINE", sensitive: true },
]

export interface Override {
  value?: SettingValue
  isDefault?: boolean
  lastChange?: SiteSetting["lastChange"]
}

// overrides: per key, a saved value (isDefault false unless given) and its last change.
export function settingsBody(overrides: Record<string, Override> = {}, offlineEntitled = true): SiteSettings {
  return {
    offlineEntitled,
    settings: SEEDS.map((seed) => {
      const override = overrides[seed.key]
      const saved = override && "value" in override
      const active = seed.group !== "OFFLINE" || offlineEntitled
      return {
        ...seed,
        description: seed.description ?? `Server description of ${seed.key}.`,
        value: saved ? (override.value as SettingValue) : seed.defaultValue,
        isDefault: override?.isDefault ?? !saved,
        active,
        ...(active ? {} : { inactiveReason: "OFFLINE_NOT_ENTITLED" }),
        lastChange: override?.lastChange ?? null,
      }
    }),
  }
}

export function settingOf(body: SiteSettings, key: string): SiteSetting {
  const setting = body.settings.find((s) => s.key === key)
  if (!setting) throw new Error(`No setting ${key}`)
  return setting
}
