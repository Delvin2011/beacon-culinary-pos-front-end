// Reading the backend's error bodies. Device errors (and e.g. SELF_UNLOCK) use ErrorDto { error, code, details? };
// 400 validation errors are a field map { "<field>": "<message>" }. Branch on `code` only, never on the text:
// `error` is for display.

export interface ApiError {
  status: number
  code: string | null
  // Text safe to show (ErrorDto.error); null when the body has none.
  error: string | null
  details: Record<string, unknown> | null
  // 400 field map, without any `error` entry.
  fieldErrors: Record<string, string>
}

// Reads a copy of the response, so the caller can still read the body.
export async function readApiError(res: Response): Promise<ApiError> {
  let body: Record<string, unknown> | null = null
  try {
    const parsed = (await res.clone().json()) as unknown
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) body = parsed as Record<string, unknown>
  } catch {
    body = null
  }

  const code = typeof body?.code === "string" ? body.code : null
  const error = typeof body?.error === "string" && body.error.trim() ? body.error : null
  const details = body?.details && typeof body.details === "object" && !Array.isArray(body.details) ? (body.details as Record<string, unknown>) : null

  const fieldErrors: Record<string, string> = {}
  if (res.status === 400 && body && code === null) {
    for (const [field, message] of Object.entries(body)) {
      if (field !== "error" && typeof message === "string" && message.trim()) fieldErrors[field] = message
    }
  }

  return { status: res.status, code, error, details, fieldErrors }
}

// The `code` of an error response, or null.
export async function errorCode(res: Response): Promise<string | null> {
  return res.ok ? null : (await readApiError(res)).code
}

export function detailNumber(details: Record<string, unknown> | null, key: string): number | null {
  const value = details?.[key]
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

export function detailString(details: Record<string, unknown> | null, key: string): string | null {
  const value = details?.[key]
  return typeof value === "string" && value.trim() ? value : null
}
