import { Suspense } from "react"
import { LoginForm } from "@/components/login-form"

export default function LoginPage() {
  return (
    <div className="flex min-h-svh flex-col items-center justify-center bg-muted p-6 md:p-10">
      {/* One column since T1-8 (the picture showed one customer's brand). */}
      <div className="w-full max-w-sm">
        {/* LoginForm reads ?reauth and ?returnTo; Next needs a Suspense boundary around useSearchParams. */}
        <Suspense fallback={null}>
          <LoginForm />
        </Suspense>
      </div>
    </div>
  )
}
