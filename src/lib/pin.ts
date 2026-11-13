// Staff PINs: exactly 6 digits, for PIN sign-in, manager-PIN approval and the staff dialogs.
export const PIN_LENGTH = 6
export const PIN_PATTERN = /^\d{6}$/
export const PIN_FORMAT_MESSAGE = "PIN must be 6 digits."

// The backend's 400 for a malformed PIN: {"pin":"PIN must be 6 digits"}.
export function isPinFormatError(body: unknown): boolean {
  return !!body && typeof body === "object" && typeof (body as Record<string, unknown>).pin === "string"
}
