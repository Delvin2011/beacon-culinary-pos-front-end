"use client"

import dynamic from "next/dynamic"
import type { ComponentType, ReactNode } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import 'leaflet/dist/leaflet.css'
import { Dialog, DialogContent } from "../ui/dialog";

const MapContainer = dynamic(
  () => import("react-leaflet").then((m) => m.MapContainer as unknown as ComponentType<Record<string, unknown>>),
  { ssr: false },
)
const TileLayer = dynamic(
  () => import("react-leaflet").then((m) => m.TileLayer as unknown as ComponentType<Record<string, unknown>>),
  { ssr: false },
)
const CircleMarker = dynamic(
  () => import("react-leaflet").then((m) => m.CircleMarker as unknown as ComponentType<Record<string, unknown>>),
  { ssr: false },
)
const Tooltip = dynamic(
  () => import("react-leaflet").then((m) => m.Tooltip as unknown as ComponentType<{ children: ReactNode }>),
  { ssr: false },
)

export type Order = {
  orderNumber: string
  trackingNumber: string
  dateOrdered: string
  depot: string
  category: string
  status: string
  timestamps: TimeStamps
  location: Location | null
}

export type TimeStamps = {
  Confirmed: string | null,
  PickedUp: string | null,
  InTransit: string | null,
  Delivered: string | null
}

export type Location = {
  lat: number,
  lng: number
}

export function OrderTrackingMapview({ onClose, customerOrder }: { onClose: () => void, customerOrder:Order  }) {
  const mapContainerProps: Record<string, unknown> = {
    center: [-17.8249, 31.0531] as [number, number],
    zoom: 6.25,
    style: { height: "100%", width: "100%" },
  }

  return (
    <Dialog open={true} onOpenChange={onClose}>
      <DialogContent>
        <Card className="col-span-2">
        <CardHeader>
          <CardTitle>Order Tracking - Map View</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-[400px]">
            <MapContainer {...mapContainerProps}>
              <TileLayer
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
              />
              {customerOrder.location != null ?
                <CircleMarker
                key={customerOrder.orderNumber}
                center={[customerOrder.location.lat, customerOrder.location.lng]}
                radius={10}
                fillColor="#ff7800"
                color="#000"
                weight={1}
                opacity={1}
                fillOpacity={0.8}
              >
                <Tooltip>
                  Order Status: {customerOrder.status + ":  " + customerOrder.timestamps.InTransit}
                </Tooltip>
              </CircleMarker>
              : null
              }

            </MapContainer>
          </div>
        </CardContent>
      </Card>
      </DialogContent>
    </Dialog>
  )
}

