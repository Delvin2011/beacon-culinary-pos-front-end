"use client"

import { useState } from "react"
import { CreditCard, Fuel, ShoppingCart, Trash2, Wallet } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useAuth } from "@/hooks/use-auth"
import { useOrder } from "@/hooks/use-order"

interface CustomerOrderProps {
  onCheckout: () => void
}

export default function CustomerOrder({ onCheckout }: CustomerOrderProps) {
  const { authFetch } = useAuth()
  const {
    products,
    isProductsLoading,
    error,
    cartItems,
    subTotal,
    vat,
    totalAmount,
    addToCart,
    updateCartQuantity,
    removeFromCart,
    clearCart,
    reloadCatalog,
  } = useOrder()

  const isEmpty = cartItems.length === 0
  const [selectedVariantByProduct, setSelectedVariantByProduct] = useState<Record<number, number>>({})
  const [isCashDialogOpen, setIsCashDialogOpen] = useState(false)
  const [cashTendered, setCashTendered] = useState("")
  const [isPayingCash, setIsPayingCash] = useState(false)
  const [cashCheckoutError, setCashCheckoutError] = useState<string | null>(null)
  const [cashChange, setCashChange] = useState<number | null>(null)
  const [checkoutReference, setCheckoutReference] = useState<string | null>(null)

  const openCashDialog = () => {
    setCashCheckoutError(null)
    setCashChange(null)
    setCheckoutReference(null)
    setCashTendered(totalAmount.toFixed(2))
    setIsCashDialogOpen(true)
  }

  const handleCashCheckout = async () => {
    const tenderedAmount = Number.parseFloat(cashTendered)

    if (Number.isNaN(tenderedAmount) || tenderedAmount <= 0) {
      setCashCheckoutError("Enter a valid cash amount.")
      return
    }

    if (tenderedAmount < totalAmount) {
      setCashCheckoutError("Cash amount is less than the total due.")
      return
    }

    setIsPayingCash(true)
    setCashCheckoutError(null)

    try {
      const orderItems = cartItems
        .filter((item) => item.quantity > 0)
        .map((item) => ({
          variantId: item.variantId,
          quantity: item.quantity,
        }))

      if (orderItems.length === 0) {
        setCashCheckoutError("Add at least one item before creating an order.")
        return
      }

      const createOrderPayload: Record<string, unknown> = {
        orderType: "DINE_IN",
        items: orderItems,
      }

      const response = await authFetch("/orders", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(createOrderPayload),
      })

      const responseBody = (await response.json().catch(() => null)) as
        | Record<string, unknown>
        | null

      if (!response.ok) {
        const message =
          (typeof responseBody?.message === "string" && responseBody.message) ||
          "Order creation failed. Please try again."
        throw new Error(message)
      }

      const status =
        (typeof responseBody?.status === "string" && responseBody.status) ||
        "CONFIRMED"

      if (status.toUpperCase() !== "CONFIRMED") {
        throw new Error(`Order returned unexpected status: ${status}`)
      }

      const reference =
        (typeof responseBody?.id === "string" && responseBody.id) ||
        (typeof responseBody?.id === "number" && String(responseBody.id)) ||
        null

      setCashChange(tenderedAmount - totalAmount)
      setCheckoutReference(reference)
      clearCart()
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to complete cash checkout."
      setCashCheckoutError(message)
    } finally {
      setIsPayingCash(false)
    }
  }

  return (
    <div className="min-h-[calc(100vh-7rem)] rounded-3xl border border-border bg-secondary/70 p-4 lg:p-6">
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="space-y-6">
          <div className="grid gap-4 md:grid-cols-2">
            <Button
              type="button"
              variant="ghost"
              className="h-auto rounded-3xl bg-primary px-6 py-7 text-left text-primary-foreground shadow-lg shadow-primary/30 hover:bg-primary/95"
            >
              <div>
                <p className="text-xs uppercase tracking-[0.2em] text-primary-foreground/80">Quick Tap</p>
                <p className="mt-2 text-2xl font-bold">Instant Settlement</p>
              </div>
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="h-auto rounded-3xl border border-border bg-card px-6 py-7 text-left hover:bg-secondary"
            >
              <div>
                <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Open Bar Tab</p>
                <p className="mt-2 text-2xl font-bold text-foreground">Scan QR / Track Session</p>
              </div>
            </Button>
          </div>

          {error && (
            <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
              {error}
              <Button
                variant="ghost"
                type="button"
                className="ml-2 h-auto p-0 text-destructive underline hover:bg-transparent"
                onClick={() => {
                  void reloadCatalog()
                }}
              >
                Retry
              </Button>
            </div>
          )}

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {products.map((item) => {
              const selectedVariantId = selectedVariantByProduct[item.id] ?? item.variants[0]?.id
              const selectedVariant = item.variants.find((variant) => variant.id === selectedVariantId)

              return (
                <Card
                  key={item.id}
                  className="rounded-3xl border border-border bg-card p-5 shadow-sm"
                >
                  <CardContent className="p-0">
                    <div className="mb-5 flex items-center gap-3">
                      <div className="rounded-2xl bg-accent p-3 text-primary">
                        <Fuel className="h-6 w-6" />
                      </div>
                      <div>
                        <p className="text-lg font-bold text-foreground">{item.name}</p>
                        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                          Menu Item
                        </p>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-2 rounded-2xl border border-border bg-muted p-2">
                      {item.variants.map((variant) => {
                        const isSelected = selectedVariant?.id === variant.id

                        return (
                          <Button
                            key={variant.id}
                            type="button"
                            variant="ghost"
                            onClick={() => {
                              setSelectedVariantByProduct((prev) => ({
                                ...prev,
                                [item.id]: variant.id,
                              }))
                            }}
                            className={`h-auto rounded-xl p-3 text-left ${
                              isSelected
                                ? "bg-accent ring-2 ring-primary/20"
                                : "bg-card hover:bg-accent"
                            }`}
                          >
                            <div>
                              <p className="text-xs font-semibold uppercase text-muted-foreground">
                                {variant.variantName}
                              </p>
                              <p className="mt-1 text-2xl font-bold text-foreground">
                                R {variant.price.toFixed(2)}
                              </p>
                            </div>
                          </Button>
                        )
                      })}
                    </div>

                    <Button
                      className="mt-4 w-full rounded-xl bg-primary text-base font-bold uppercase tracking-wide text-primary-foreground hover:bg-primary/90"
                      onClick={() => {
                        if (!selectedVariant) return
                        addToCart(item, selectedVariant, 1)
                      }}
                      disabled={!selectedVariant}
                    >
                      <ShoppingCart className="mr-2 h-4 w-4" />
                      Add {selectedVariant?.variantName ?? "Variant"} To Order
                    </Button>

                    {item.description && (
                      <p className="mt-3 line-clamp-2 text-xs text-muted-foreground">{item.description}</p>
                    )}
                  </CardContent>
                </Card>
              )
            })}

            {isProductsLoading && (
              <p className="col-span-full text-sm text-muted-foreground">Loading products...</p>
            )}

            {!isProductsLoading && products.length === 0 && !error && (
              <p className="col-span-full text-sm text-muted-foreground">
                No menu items found.
              </p>
            )}
          </div>
        </div>

        <div className="lg:sticky lg:top-4">
          <Card className="overflow-hidden rounded-3xl border border-border bg-card shadow-sm">
            <div className="flex items-center justify-between bg-secondary px-6 py-5">
              <h3 className="text-2xl font-black uppercase tracking-wide text-foreground">Current Order</h3>
              {!isEmpty && (
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={clearCart}
                  aria-label="Clear order"
                >
                  <Trash2 className="h-5 w-5 text-muted-foreground" />
                </Button>
              )}
            </div>

            <div className="max-h-[300px] space-y-3 overflow-auto px-6 py-4">
              {isEmpty ? (
                <div className="rounded-2xl border border-dashed border-border bg-muted px-4 py-8 text-center text-muted-foreground">
                  <p className="text-sm uppercase tracking-[0.18em]">Order is empty</p>
                </div>
              ) : (
                cartItems.map((item) => (
                  <div key={item.cartItemId} className="rounded-2xl border border-border bg-muted p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-semibold text-foreground">{item.name}</p>
                        <p className="text-xs uppercase tracking-wide text-muted-foreground">{item.variantName}</p>
                      </div>
                      <Button variant="ghost" size="icon" onClick={() => removeFromCart(item.cartItemId)}>
                        <Trash2 className="h-4 w-4 text-muted-foreground" />
                      </Button>
                    </div>

                    <div className="mt-2 flex items-center gap-2">
                      <Input
                        type="number"
                        min={0}
                        value={item.quantity}
                        onChange={(e) => updateCartQuantity(item.cartItemId, parseInt(e.target.value, 10))}
                        className="h-9 w-20 bg-card"
                      />
                      <span className="text-sm text-muted-foreground">Qty</span>
                      <p className="ml-auto text-sm font-semibold text-foreground">
                        R {(item.price * item.quantity).toFixed(2)}
                      </p>
                    </div>
                  </div>
                ))
              )}
            </div>

            <div className="space-y-4 border-t border-border px-6 py-6">
              <div className="space-y-2 text-base">
                <div className="flex justify-between font-medium text-foreground/80">
                  <span>Subtotal</span>
                  <span>R {subTotal.toFixed(2)}</span>
                </div>
                <div className="flex justify-between font-medium text-foreground/80">
                  <span>VAT (15%)</span>
                  <span>R {vat.toFixed(2)}</span>
                </div>
              </div>

              <div className="flex items-end justify-between border-t border-border pt-4">
                <span className="text-lg font-bold uppercase tracking-[0.2em] text-primary">Total</span>
                <span className="text-5xl font-black text-foreground">R {totalAmount.toFixed(2)}</span>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <Button
                  type="button"
                  variant="ghost"
                  className="h-auto rounded-2xl bg-secondary px-4 py-5 font-bold uppercase tracking-wide text-foreground/80 hover:bg-secondary/90"
                  onClick={openCashDialog}
                  disabled={isEmpty}
                >
                  <Wallet className="h-5 w-5" />
                  Cash
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  className="h-auto rounded-2xl bg-secondary px-4 py-5 font-bold uppercase tracking-wide text-foreground/80 hover:bg-secondary/90"
                >
                  <CreditCard className="h-5 w-5" />
                  Card
                </Button>
              </div>

              <Button
                className="h-14 w-full rounded-2xl bg-primary text-2xl font-black uppercase tracking-wide text-primary-foreground hover:bg-primary/90"
                onClick={onCheckout}
                disabled={isEmpty}
              >
                Card Checkout
              </Button>
            </div>
          </Card>
        </div>
      </div>

      <Dialog open={isCashDialogOpen} onOpenChange={setIsCashDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Cash Payment</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div className="rounded-lg bg-muted p-4">
              <p className="text-sm text-muted-foreground">Amount due</p>
              <p className="text-3xl font-black text-foreground">R {totalAmount.toFixed(2)}</p>
            </div>

            {cashChange === null ? (
              <>
                <div className="grid gap-2">
                  <Label htmlFor="cash-tendered">Cash received</Label>
                  <Input
                    id="cash-tendered"
                    type="number"
                    min={0}
                    step="0.01"
                    value={cashTendered}
                    onChange={(event) => setCashTendered(event.target.value)}
                  />
                </div>

                {cashCheckoutError && (
                  <p className="text-sm text-destructive">{cashCheckoutError}</p>
                )}

                <Button
                  type="button"
                  className="w-full"
                  onClick={() => {
                    void handleCashCheckout()
                  }}
                  disabled={isPayingCash || isEmpty}
                >
                  {isPayingCash ? "Processing..." : "Pay Now"}
                </Button>
              </>
            ) : (
              <>
                <div className="rounded-lg border border-primary/30 bg-primary/10 p-4">
                  <p className="text-sm text-muted-foreground">Change to return</p>
                  <p className="text-3xl font-black text-primary">R {cashChange.toFixed(2)}</p>
                </div>

                {checkoutReference && (
                  <p className="text-sm text-muted-foreground">Order reference: {checkoutReference}</p>
                )}

                <Button type="button" className="w-full" onClick={() => setIsCashDialogOpen(false)}>
                  Done
                </Button>
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
