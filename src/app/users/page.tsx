import { redirect } from "next/navigation"

// The old mock users screen is replaced by Staff management.
export default function UsersPage() {
  redirect("/staff")
}
