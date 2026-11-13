import { act, renderHook } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { useLoginBlocks } from "@/hooks/use-login-blocks"

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe("useLoginBlocks", () => {
  it("counts down once a second and clears itself at zero", () => {
    const { result } = renderHook(() => useLoginBlocks<number>())
    act(() => result.current.block(7, { code: "RATE_LIMITED", retryAfterSeconds: 3 }))

    expect(result.current.get(7)).toEqual({
      code: "RATE_LIMITED",
      remainingSeconds: 3,
      active: true,
      message: "Too many attempts. Try again in 0:03.",
    })

    act(() => vi.advanceTimersByTime(1000))
    expect(result.current.get(7)?.remainingSeconds).toBe(2)

    act(() => vi.advanceTimersByTime(2000))
    expect(result.current.get(7)).toBeNull()
  })

  it("keeps blocks for different keys apart", () => {
    const { result } = renderHook(() => useLoginBlocks<number>())
    act(() => result.current.block(1, { code: "ACCOUNT_LOCKED", retryAfterSeconds: 900 }))

    expect(result.current.get(1)?.active).toBe(true)
    expect(result.current.get(2)).toBeNull()

    act(() => result.current.block(2, { code: "RATE_LIMITED", retryAfterSeconds: 10 }))
    act(() => vi.advanceTimersByTime(10_000))
    expect(result.current.get(2)).toBeNull()
    expect(result.current.get(1)?.remainingSeconds).toBe(890)
  })

  it("shows a block without a time but disables nothing", () => {
    const { result } = renderHook(() => useLoginBlocks<string>())
    act(() => result.current.block("self", { code: "ACCOUNT_LOCKED", retryAfterSeconds: null }))

    expect(result.current.get("self")).toEqual({
      code: "ACCOUNT_LOCKED",
      remainingSeconds: null,
      active: false,
      message: "This account is locked. Ask a manager to unlock it.",
    })
    act(() => vi.advanceTimersByTime(60_000))
    expect(result.current.get("self")?.active).toBe(false)
  })

  it("runs no timer when there is no countdown", () => {
    const { result } = renderHook(() => useLoginBlocks<string>())
    act(() => result.current.block("self", { code: "RATE_LIMITED", retryAfterSeconds: null }))
    expect(vi.getTimerCount()).toBe(0)
  })

  it("stops its timer once every countdown has ended", () => {
    const { result } = renderHook(() => useLoginBlocks<number>())
    act(() => result.current.block(1, { code: "RATE_LIMITED", retryAfterSeconds: 2 }))
    expect(vi.getTimerCount()).toBe(1)
    act(() => vi.advanceTimersByTime(2000))
    expect(vi.getTimerCount()).toBe(0)
  })

  it("clears one key, or all of them", () => {
    const { result } = renderHook(() => useLoginBlocks<number>())
    act(() => {
      result.current.block(1, { code: "RATE_LIMITED", retryAfterSeconds: 30 })
      result.current.block(2, { code: "RATE_LIMITED", retryAfterSeconds: 30 })
    })
    act(() => result.current.clear(1))
    expect(result.current.get(1)).toBeNull()
    expect(result.current.get(2)).not.toBeNull()
    act(() => result.current.clearAll())
    expect(result.current.get(2)).toBeNull()
  })

  it("restarts the countdown when the same key is blocked again", () => {
    const { result } = renderHook(() => useLoginBlocks<number>())
    act(() => result.current.block(1, { code: "RATE_LIMITED", retryAfterSeconds: 5 }))
    act(() => vi.advanceTimersByTime(4000))
    act(() => result.current.block(1, { code: "ACCOUNT_LOCKED", retryAfterSeconds: 60 }))
    expect(result.current.get(1)).toMatchObject({ code: "ACCOUNT_LOCKED", remainingSeconds: 60 })
  })
})
