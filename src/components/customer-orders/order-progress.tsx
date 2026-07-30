"use client";

import React from "react";
import { Check, Package, Truck, ClipboardCheck, MapPin, ShoppingBag  } from "lucide-react";
import { cn } from "@/lib/utils";
import { Dialog, DialogContent } from "../ui/dialog";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";

export type Order = {
  orderNumber: string;
  trackingNumber: string;
  dateOrdered: string;
  depot: string;
  category: string;
  status: string;
  timestamps: TimeStamps;
  location: Location | null;
};

export type TimeStamps = {
  Confirmed: string | null;
  PickedUp: string | null;
  InTransit: string | null;
  Delivered: string | null;
};

export type Location = {
  lat: number;
  lng: number;
};

const stepDefinitions = [
  { title: "Booked", icon: Package },
  { title: "Confirmed", icon: ClipboardCheck },
  { title: "Picked Up", icon: ShoppingBag  },
  { title: "In Transit", icon: Truck },
  { title: "Complete", icon: MapPin },
];

type StepTitle = typeof stepDefinitions[number]["title"];

function getSteps(order: Order) {
  const { status, timestamps, dateOrdered } = order;

  // Map order statuses to the corresponding step titles
  const statusMapping: Record<StepTitle, StepTitle> = {
    Booked: "Booked",
    Confirmed: "Confirmed",
    "Picked Up": "Picked Up",
    "In Transit": "In Transit",
    Complete: "Complete",
  };

  const currentStatus: StepTitle =
    status in statusMapping ? (status as StepTitle) : "Booked";

  const currentStatusIndex = Object.keys(statusMapping).indexOf(currentStatus);

  const stepStatus = stepDefinitions.map((step) => {
    const stepTitle = step.title;
    const isCompleted =
      Object.keys(statusMapping)
        .slice(0, currentStatusIndex + 1)
        .includes(stepTitle);

    return {
      title: stepTitle,
      date:
        stepTitle === "Booked"
          ? dateOrdered
          : timestamps[stepTitle.replace(" ", "") as keyof TimeStamps] || "",
      status: isCompleted
        ? "completed"
        : stepTitle === statusMapping[currentStatus]
        ? "current"
        : "pending",
      icon: step.icon,
    };
  });

  return stepStatus;
}

export default function OrderProgress({
  onClose,
  order,
}: {
  onClose: () => void;
  order: Order;
}) {
  const steps = getSteps(order);

  return (
    <Dialog open={true} onOpenChange={onClose}>
      <DialogContent>
        <Card className="col-span-2">
          <CardHeader>
            <CardTitle>Order Tracking</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="relative space-y-4 before:absolute before:inset-0 before:ml-5 before:h-full before:w-0.5 before:-translate-x-px before:bg-gray-200">
              {steps.map((step, index) => (
                <div key={index} className="relative flex gap-x-4">
                  <div
                    className={cn(
                      "relative z-10 flex h-10 w-10 items-center justify-center rounded-full",
                      step.status === "completed" && "bg-green-50 text-green-600",
                      step.status === "current" && "bg-orange-50 text-orange-600",
                      step.status === "pending" && "bg-gray-50 text-gray-600"
                    )}
                  >
                    {step.status === "completed" ? (
                      <Check className="h-5 w-5" />
                    ) : (
                      <step.icon className="h-5 w-5" />
                    )}
                  </div>
                  <div className="flex flex-col">
                    <div className="flex items-center gap-x-2">
                      <div
                        className={cn(
                          "text-sm font-medium",
                          step.status === "completed" && "text-green-600",
                          step.status === "current" && "text-orange-600",
                          step.status === "pending" && "text-gray-600"
                        )}
                      >
                        {step.title}
                      </div>
                      <div className="text-sm text-gray-500">{step.date}</div>
                    </div>
                    {order.location && step.title === "In Transit" && (
                      <div className="mt-0.5 text-sm text-gray-500">
                        Location: {order.location.lat}, {order.location.lng}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </DialogContent>
    </Dialog>
  );
}
