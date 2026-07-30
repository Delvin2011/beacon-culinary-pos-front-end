"use client"

import dynamic from "next/dynamic"
import type { ComponentType, ReactNode } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import 'leaflet/dist/leaflet.css'

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

const customerVisits = [
  { lat: -17.8249, lng: 31.0531, visits: 180 }, // Harare
  { lat: -20.1593, lng: 28.5812, visits: 160 }, // Bulawayo
  { lat: -18.2196, lng: 27.7461, visits: 140 }, // Victoria Falls
  { lat: -18.9707, lng: 32.6700, visits: 130 }, // Mutare
  { lat: -20.0751, lng: 30.8327, visits: 120 }, // Masvingo
  { lat: -19.4580, lng: 29.8175, visits: 110 }, // Gweru
  { lat: -18.9256, lng: 29.8122, visits: 105 }, // Kadoma
  { lat: -19.4462, lng: 29.8522, visits: 95 },  // Kwekwe
  { lat: -18.2165, lng: 30.9407, visits: 85 },  // Marondera
  { lat: -20.0443, lng: 31.5789, visits: 75 },  // Chivhu
  { lat: -17.7183, lng: 30.9586, visits: 65 },  // Bindura
  { lat: -17.3655, lng: 31.1201, visits: 60 },  // Chinhoyi
  { lat: -21.0086, lng: 31.5799, visits: 55 },  // Zvishavane
  { lat: -19.7483, lng: 32.6094, visits: 50 },  // Chimanimani
  { lat: -18.1246, lng: 30.1481, visits: 45 },  // Murehwa
  { lat: -18.5375, lng: 30.8700, visits: 40 },  // Goromonzi
  { lat: -20.2957, lng: 29.5018, visits: 38 },  // Shurugwi
  { lat: -18.3392, lng: 30.1390, visits: 36 },  // Rusape
  { lat: -18.4029, lng: 27.7351, visits: 34 },  // Hwange
  { lat: -20.0699, lng: 29.2457, visits: 32 },  // Redcliff
  { lat: -16.7114, lng: 28.7885, visits: 30 },  // Kariba
  { lat: -21.0058, lng: 30.4455, visits: 28 },  // Beitbridge
  { lat: -16.5125, lng: 28.8714, visits: 26 },  // Binga
  { lat: -17.3589, lng: 31.0414, visits: 24 },  // Chegutu
  { lat: -18.7979, lng: 32.8675, visits: 22 },  // Nyanga
  { lat: -18.5064, lng: 29.7454, visits: 20 },  // Norton
  { lat: -19.9904, lng: 29.2903, visits: 18 },  // Zvishavane (West)
  { lat: -19.1307, lng: 29.9982, visits: 15 },  // Sanyati
];


export function TopCustomersHeatMap() {
  const mapContainerProps: Record<string, unknown> = {
    center: [-17.8249, 31.0531] as [number, number],
    zoom: 6.25,
    style: { height: "100%", width: "100%" },
  }

  return (
    <Card className="col-span-2">
      <CardHeader>
        <CardTitle>Customer Visits Heat Map</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="h-[600px]">
          <MapContainer {...mapContainerProps}>
            <TileLayer
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            />
            {customerVisits.map((customer, index) => (
              <CircleMarker
                key={index}
                center={[customer.lat, customer.lng]}
                radius={Math.sqrt(customer.visits) * 0.5}
                fillColor="#ff7800"
                color="#000"
                weight={1}
                opacity={1}
                fillOpacity={0.8}
              >
                <Tooltip>
                  Visits: {customer.visits}
                </Tooltip>
              </CircleMarker>
            ))}
          </MapContainer>
        </div>
      </CardContent>
    </Card>
  )
}

