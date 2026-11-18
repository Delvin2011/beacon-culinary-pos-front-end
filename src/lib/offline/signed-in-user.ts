// O3: the signed-in person as a cashier id, for comparing with a shift's owner and a grant's cashierId.
// PIN sign-ins carry cashierId; otherwise the numeric user id.
export function signedInUserId(user: { id?: string; cashierId?: number } | null | undefined): number | null {
  if (!user) return null
  if (typeof user.cashierId === "number") return user.cashierId
  const id = Number(user.id)
  return Number.isInteger(id) && id > 0 ? id : null
}
