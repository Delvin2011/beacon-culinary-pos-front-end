"use client";

import { useState } from "react";
import { CreditCard, Landmark, Smartphone } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Icons } from "@/components/icons";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export function Payment() {
  const [showDialog, setShowDialog] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState("card");

  const handleContinue = () => {
    setShowDialog(true);
  };

  return (
    <div className="min-h-[calc(100vh-7rem)] rounded-3xl border border-border bg-secondary/70 p-4 lg:p-6">
      <Card className="mx-auto w-full max-w-3xl overflow-hidden rounded-3xl border-border shadow-sm">
        <CardHeader className="bg-secondary px-6 py-5 md:px-8">
          <CardTitle className="text-2xl font-black uppercase tracking-wide text-foreground">
            Payment Method
          </CardTitle>
          <CardDescription>
            Complete the transaction using card, PayPal, Apple Pay, or EFT.
          </CardDescription>
        </CardHeader>

        <CardContent className="grid gap-6 px-6 py-6 md:px-8">
          <RadioGroup
            value={paymentMethod}
            onValueChange={setPaymentMethod}
            className="grid grid-cols-2 gap-3 md:grid-cols-4"
          >
            <div>
              <RadioGroupItem
                value="card"
                id="card"
                className="peer sr-only"
                aria-label="Card"
              />
              <Label
                htmlFor="card"
                className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border border-border bg-card p-4 text-foreground/80 transition hover:bg-muted [&:has([data-state=checked])]:border-primary [&:has([data-state=checked])]:bg-accent [&:has([data-state=checked])]:text-primary"
              >
                <CreditCard className="h-6 w-6" />
                Card
              </Label>
            </div>

            <div>
              <RadioGroupItem
                value="paypal"
                id="paypal"
                className="peer sr-only"
                aria-label="Paypal"
              />
              <Label
                htmlFor="paypal"
                className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border border-border bg-card p-4 text-foreground/80 transition hover:bg-muted [&:has([data-state=checked])]:border-primary [&:has([data-state=checked])]:bg-accent [&:has([data-state=checked])]:text-primary"
              >
                <Icons.paypal className="h-6 w-6" />
                Paypal
              </Label>
            </div>

            <div>
              <RadioGroupItem
                value="apple"
                id="apple"
                className="peer sr-only"
                aria-label="Apple"
              />
              <Label
                htmlFor="apple"
                className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border border-border bg-card p-4 text-foreground/80 transition hover:bg-muted [&:has([data-state=checked])]:border-primary [&:has([data-state=checked])]:bg-accent [&:has([data-state=checked])]:text-primary"
              >
                <Smartphone className="h-6 w-6" />
                Apple Pay
              </Label>
            </div>

            <div>
              <RadioGroupItem
                value="eft"
                id="eft"
                className="peer sr-only"
                aria-label="EFT"
              />
              <Label
                htmlFor="eft"
                className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border border-border bg-card p-4 text-foreground/80 transition hover:bg-muted [&:has([data-state=checked])]:border-primary [&:has([data-state=checked])]:bg-accent [&:has([data-state=checked])]:text-primary"
              >
                <Landmark className="h-6 w-6" />
                EFT
              </Label>
            </div>
          </RadioGroup>

          <div className="grid gap-2">
            <Label htmlFor="name">Name On Card</Label>
            <Input id="name" placeholder="First Last" className="h-11 bg-card" />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="city">City</Label>
            <Input id="city" placeholder="Johannesburg" className="h-11 bg-card" />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="number">Card number</Label>
            <Input id="number" placeholder="0000 0000 0000 0000" className="h-11 bg-card" />
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div className="grid gap-2">
              <Label htmlFor="month">Expires</Label>
              <Select>
                <SelectTrigger id="month" aria-label="Month">
                  <SelectValue placeholder="Month" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="1">January</SelectItem>
                  <SelectItem value="2">February</SelectItem>
                  <SelectItem value="3">March</SelectItem>
                  <SelectItem value="4">April</SelectItem>
                  <SelectItem value="5">May</SelectItem>
                  <SelectItem value="6">June</SelectItem>
                  <SelectItem value="7">July</SelectItem>
                  <SelectItem value="8">August</SelectItem>
                  <SelectItem value="9">September</SelectItem>
                  <SelectItem value="10">October</SelectItem>
                  <SelectItem value="11">November</SelectItem>
                  <SelectItem value="12">December</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="year">Year</Label>
              <Select>
                <SelectTrigger id="year" aria-label="Year">
                  <SelectValue placeholder="Year" />
                </SelectTrigger>
                <SelectContent>
                  {Array.from({ length: 10 }, (_, i) => (
                    <SelectItem key={i} value={`${new Date().getFullYear() + i}`}>
                      {new Date().getFullYear() + i}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="cvc">CVC</Label>
              <Input id="cvc" placeholder="CVC" className="h-11 bg-card" />
            </div>
          </div>
        </CardContent>

        <CardFooter className="bg-muted px-6 py-5 md:px-8">
          <Button
            className="h-12 w-full rounded-2xl bg-primary text-base font-black uppercase tracking-wide text-primary-foreground hover:bg-primary/90"
            onClick={handleContinue}
          >
            Pay Now
          </Button>
        </CardFooter>
      </Card>

      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent className="rounded-2xl">
          <DialogTitle className="text-2xl text-primary">
            Transaction Successful!
          </DialogTitle>
          <p className="text-sm text-muted-foreground">
            Your payment was received and the order has been finalized.
          </p>
        </DialogContent>
      </Dialog>
    </div>
  );
}
