// The site's locale, in one place (T0-8). Today every customer is in South Africa. T1 replaces these values with the
// site locale from the API (time zone, currency, locale), and reports should then format with their own
// meta.currency and meta.timezone. Until then nothing else in src may name the zone, the currency code or the
// "R" prefix (src/lib/no-hard-coded-locale.test.ts).
export const TIME_ZONE = "Africa/Johannesburg"
// Both tags as used today: en-ZA (space grouping, comma decimals) and en-GB (day-month dates, 24-hour times).
// Formats are not unified here.
export const LOCALE_ZA = "en-ZA"
export const LOCALE_GB = "en-GB"
export const CURRENCY = "ZAR"
export const CURRENCY_SYMBOL = "R"
