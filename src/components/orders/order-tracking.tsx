"use client"

import * as React from "react"

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Select, SelectTrigger, SelectValue, SelectContent, SelectGroup, SelectLabel, SelectItem } from "@/components/ui/select";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuTrigger,
  } from "@/components/ui/dropdown-menu"
import { DatePickerWithRange } from "../date-picker-with-range"
import { DateRange } from "react-day-picker"
import { useMemo, useState } from "react"
import { ArrowUpDown, MoreHorizontal } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
    ColumnDef,
    ColumnFiltersState,
    SortingState,
    VisibilityState,
    flexRender,
    getCoreRowModel,
    getFilteredRowModel,
    getPaginationRowModel,
    getSortedRowModel,
    useReactTable,
  } from "@tanstack/react-table"
import { Checkbox } from "@/components/ui/checkbox"
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
  } from "@/components/ui/table"
import { OrderTrackingMapview } from "./order-tracking-map-view";
import OrderProgress from "./order-progress";

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

  const orderUpdates: Order[] = [
    {
      orderNumber: "X5J2YQHKQZ3G84P",
      trackingNumber: "9AZ3M6QR0WTGX7J",
      dateOrdered: "2024-12-20",
      depot: "Depot A",
      category: "Retailer",
      status: "Picked Up",
      timestamps: {
        Confirmed: "2024-12-20 15:12:45",
        PickedUp: "2024-12-20 16:45:23",
        InTransit: null,
        Delivered: null
      },
      location: null
    },
    {
      orderNumber: "N2DKY3L8OZG57VQ",
      trackingNumber: "J9X0ZMB6QLKW8RY",
      dateOrdered: "2025-01-10",
      depot: "Depot B",
      category: "Bulk Buyer",
      status: "In Transit",
      timestamps: {
        Confirmed: "2025-01-10 14:32:00",
        PickedUp: "2025-01-11 08:15:30",
        InTransit: "2025-01-12 10:45:00",
        Delivered: null
      },
      location: {
        lat: -17.8249,
        lng: 31.0531
      }
    },
    {
      orderNumber: "B9X8GZ2MLK3WY0Q",
      trackingNumber: "D5P7YJ8XZR3KQLM",
      dateOrdered: "2025-01-12",
      depot: "Depot D",
      category: "Corporate Client",
      status: "Delivered",
      timestamps: {
        Confirmed: "2025-01-12 11:00:30",
        PickedUp: "2025-01-12 12:05:20",
        InTransit: "2025-01-12 12:30:00",
        Delivered: "2025-01-12 14:20:10"
      },
      location: null
    },
    {
      orderNumber: "M0QLW8RYD5P7ZX3",
      trackingNumber: "KY3GZ2MLW8X9BQJ",
      dateOrdered: "2025-01-01",
      depot: "Depot E",
      category: "Small Business",
      status: "Confirmed",
      timestamps: {
        Confirmed: "2025-01-01 20:15:11",
        PickedUp: null,
        InTransit: null,
        Delivered: null
      },
      location: null
    },
    {
      orderNumber: "H5Q3Y7JPX6R2ZM9",
      trackingNumber: "T3U5J8K1L9Z2Q3W",
      dateOrdered: "2024-12-17",
      depot: "Depot C",
      category: "Retailer",
      status: "Picked Up",
      timestamps: {
        Confirmed: "2024-12-17 13:40:20",
        PickedUp: "2024-12-17 14:55:12",
        InTransit: null,
        Delivered: null
      },
      location: null
    },
    {
      orderNumber: "T8R2M9X3K1J6ZYQ",
      trackingNumber: "V9W4P2D7L0B1F6K",
      dateOrdered: "2024-12-15",
      depot: "Depot A",
      category: "Small Business",
      status: "In Transit",
      timestamps: {
        Confirmed: "2024-12-15 10:05:00",
        PickedUp: "2024-12-15 14:20:30",
        InTransit: "2024-12-16 10:15:45",
        Delivered: null
      },
      location: {
        lat: -17.8249,
        lng: 31.0531
      }
    },
    {
      orderNumber: "L9M5D2P0R7Q3Z8J",
      trackingNumber: "J0F4P1X9B2Y7V4D",
      dateOrdered: "2024-12-22",
      depot: "Depot B",
      category: "Retailer",
      status: "Confirmed",
      timestamps: {
        Confirmed: "2024-12-22 09:30:11",
        PickedUp: null,
        InTransit: null,
        Delivered: null
      },
      location: null
    },
    {
      orderNumber: "Z9K3B7Y5P6M1O2L",
      trackingNumber: "J5K9Y3W7P8Q2T5R",
      dateOrdered: "2024-12-25",
      depot: "Depot C",
      category: "Bulk Buyer",
      status: "Picked Up",
      timestamps: {
        Confirmed: "2024-12-25 12:40:21",
        PickedUp: "2024-12-25 14:10:12",
        InTransit: null,
        Delivered: null
      },
      location: null
    },
    {
      orderNumber: "R4P8L3W7Z1J9X5B",
      trackingNumber: "K7Q5M2V9W8Y1A2D",
      dateOrdered: "2025-01-02",
      depot: "Depot D",
      category: "Corporate Client",
      status: "In Transit",
      timestamps: {
        Confirmed: "2025-01-02 13:12:10",
        PickedUp: "2025-01-03 09:20:30",
        InTransit: "2025-01-04 14:25:55",
        Delivered: null
      },
      location: {
        lat: -17.8249,
        lng: 31.0531
      }
    },
    {
      orderNumber: "S9Q0R5J4L6P8M2D",
      trackingNumber: "K1V2B5F9P7J6X8M",
      dateOrdered: "2024-12-28",
      depot: "Depot E",
      category: "Small Business",
      status: "Delivered",
      timestamps: {
        Confirmed: "2024-12-28 17:45:55",
        PickedUp: "2024-12-28 18:20:15",
        InTransit: "2024-12-29 12:10:30",
        Delivered: "2024-12-29 15:20:30"
      },
      location: null
    },
    {
      orderNumber: "A9F1V2Y5L6B7P4M",
      trackingNumber: "N0Q3Y8Z9J2X0W7G",
      dateOrdered: "2024-12-18",
      depot: "Depot A",
      category: "Retailer",
      status: "In Transit",
      timestamps: {
        Confirmed: "2024-12-18 16:30:11",
        PickedUp: "2024-12-18 17:12:23",
        InTransit: "2024-12-19 13:45:00",
        Delivered: null
      },
      location: {
        lat: -17.8249,
        lng: 31.0531
      }
    },
    {
      orderNumber: "M0F8K7L1P2R9G0J",
      trackingNumber: "X5P9Y3V7K1J3T2B",
      dateOrdered: "2025-01-05",
      depot: "Depot B",
      category: "Bulk Buyer",
      status: "Confirmed",
      timestamps: {
        Confirmed: "2025-01-05 11:15:01",
        PickedUp: null,
        InTransit: null,
        Delivered: null
      },
      location: null
    },
    {
      orderNumber: "H7V2Y9F3Q4P2K0J",
      trackingNumber: "X9M8Y2P6V7J5W3L",
      dateOrdered: "2025-01-06",
      depot: "Depot D",
      category: "Corporate Client",
      status: "In Transit",
      timestamps: {
        Confirmed: "2025-01-06 14:25:33",
        PickedUp: "2025-01-07 11:12:20",
        InTransit: "2025-01-08 13:55:12",
        Delivered: null
      },
      location: {
        lat: -17.8249,
        lng: 31.0531
      }
    },
    {
      orderNumber: "G4Q1P9M6W7Z3J5Y",
      trackingNumber: "V2B8F1X7M5J6T9R",
      dateOrdered: "2025-01-03",
      depot: "Depot A",
      category: "Retailer",
      status: "Delivered",
      timestamps: {
        Confirmed: "2025-01-03 13:10:30",
        PickedUp: "2025-01-03 14:35:50",
        InTransit: "2025-01-03 15:00:10",
        Delivered: "2025-01-03 18:30:55"
      },
      location: null
    },
    {
      orderNumber: "A9Q7Y5F2J8W1K4Z",
      trackingNumber: "N2F9P8Y6M7J1K3B",
      dateOrdered: "2024-12-23",
      depot: "Depot E",
      category: "Small Business",
      status: "Confirmed",
      timestamps: {
        Confirmed: "2024-12-23 11:35:12",
        PickedUp: null,
        InTransit: null,
        Delivered: null
      },
      location: null
    },
    {
      orderNumber: "L2K8Y5M0P7R9J6F",
      trackingNumber: "B9Z7W4V3Y1J6K0F",
      dateOrdered: "2024-12-14",
      depot: "Depot C",
      category: "Bulk Buyer",
      status: "Picked Up",
      timestamps: {
        Confirmed: "2024-12-14 08:00:45",
        PickedUp: "2024-12-14 10:30:22",
        InTransit: null,
        Delivered: null
      },
      location: null
    },
    {
      orderNumber: "X3V6J9F7Q5P0Y2M",
      trackingNumber: "W1Y7P8B9F0V3M6T",
      dateOrdered: "2025-01-07",
      depot: "Depot B",
      category: "Retailer",
      status: "In Transit",
      timestamps: {
        Confirmed: "2025-01-07 12:05:35",
        PickedUp: "2025-01-07 13:12:50",
        InTransit: "2025-01-08 09:25:12",
        Delivered: null
      },
      location: {
        lat: -17.8249,
        lng: 31.0531
      }
    },
    {
      orderNumber: "F8Y9M5B1R0X2Q4L",
      trackingNumber: "P0Z3N5J9X7V4T6B",
      dateOrdered: "2025-01-09",
      depot: "Depot A",
      category: "Small Business",
      status: "Delivered",
      timestamps: {
        Confirmed: "2025-01-09 09:30:20",
        PickedUp: "2025-01-09 11:45:10",
        InTransit: "2025-01-09 14:00:12",
        Delivered: "2025-01-09 16:20:33"
      },
      location: null
    },
    {
      orderNumber: "D9X8Y3F2W5Q6L7M",
      trackingNumber: "J2K5P9T3F1V0M8W",
      dateOrdered: "2025-01-03",
      depot: "Depot C",
      category: "Corporate Client",
      status: "Confirmed",
      timestamps: {
        Confirmed: "2025-01-03 14:30:11",
        PickedUp: null,
        InTransit: null,
        Delivered: null
      },
      location: null
    },
    {
      orderNumber: "Y7F2T9M8R6P3W5Q",
      trackingNumber: "L1P9X3B0J7V5W2K",
      dateOrdered: "2025-01-04",
      depot: "Depot D",
      category: "Bulk Buyer",
      status: "Picked Up",
      timestamps: {
        Confirmed: "2025-01-04 16:25:00",
        PickedUp: "2025-01-04 17:45:35",
        InTransit: null,
        Delivered: null
      },
      location: null
    },
    {
      orderNumber: "W3V5M8Q9P7F2K0X",
      trackingNumber: "D7R1B9T5J6L8Z2P",
      dateOrdered: "2024-12-29",
      depot: "Depot A",
      category: "Small Business",
      status: "Confirmed",
      timestamps: {
        Confirmed: "2024-12-29 10:15:50",
        PickedUp: null,
        InTransit: null,
        Delivered: null
      },
      location: null
    },
    {
      orderNumber: "Z8F7B0R5T9K1M6L",
      trackingNumber: "Q3P7X9V4F2J5M0W",
      dateOrdered: "2025-01-02",
      depot: "Depot E",
      category: "Corporate Client",
      status: "In Transit",
      timestamps: {
        Confirmed: "2025-01-02 13:45:20",
        PickedUp: "2025-01-02 14:30:00",
        InTransit: "2025-01-03 10:05:35",
        Delivered: null
      },
      location: {
        lat: -17.8249,
        lng: 31.0531
      }
    },
    {
      orderNumber: "R5P6M9Y1Q0L3T8W",
      trackingNumber: "L3F9J7V4B0P1W6X",
      dateOrdered: "2024-12-30",
      depot: "Depot B",
      category: "Retailer",
      status: "Confirmed",
      timestamps: {
        Confirmed: "2024-12-30 08:40:11",
        PickedUp: null,
        InTransit: null,
        Delivered: null
      },
      location: null
    },
    {
      orderNumber: "F9Q7Y8P6L5R1T2J",
      trackingNumber: "V0M3B9Y8P5K2R6W",
      dateOrdered: "2025-01-08",
      depot: "Depot C",
      category: "Bulk Buyer",
      status: "In Transit",
      timestamps: {
        Confirmed: "2025-01-08 10:12:15",
        PickedUp: "2025-01-08 11:20:25",
        InTransit: "2025-01-09 09:15:50",
        Delivered: null
      },
      location: {
        lat: -17.8249,
        lng: 31.0531
      }
    },
    {
      orderNumber: "F3R1G6D9Q8M0J5W",
      trackingNumber: "B2K7N5X4L1R3P9F",
      dateOrdered: "2025-01-12",
      depot: "Depot D",
      category: "Corporate Client",
      status: "Confirmed",
      timestamps: {
        Confirmed: "2025-01-12 11:30:05",
        PickedUp: null,
        InTransit: null,
        Delivered: null
      },
      location: null
    },
    {
      orderNumber: "K8M1Y4Q3T0R2B7L",
      trackingNumber: "J9L4F7V1P6K2X0R",
      dateOrdered: "2025-01-10",
      depot: "Depot B",
      category: "Retailer",
      status: "In Transit",
      timestamps: {
        Confirmed: "2025-01-10 13:45:10",
        PickedUp: "2025-01-10 15:30:20",
        InTransit: "2025-01-11 09:20:45",
        Delivered: null
      },
      location: {
        lat: -17.8249,
        lng: 31.0531
      }
    },
    {
      orderNumber: "N2Q6F1R8X4P3T0J",
      trackingNumber: "P8K9B7V2L6D3W1R",
      dateOrdered: "2025-01-05",
      depot: "Depot C",
      category: "Bulk Buyer",
      status: "Picked Up",
      timestamps: {
        Confirmed: "2025-01-05 08:30:10",
        PickedUp: "2025-01-05 10:00:15",
        InTransit: null,
        Delivered: null
      },
      location: null
    },
    {
      orderNumber: "X9B5V3P2J1R6T7W",
      trackingNumber: "Z1M0L4N8K9Y2F5P",
      dateOrdered: "2025-01-04",
      depot: "Depot E",
      category: "Small Business",
      status: "In Transit",
      timestamps: {
        Confirmed: "2025-01-04 12:45:30",
        PickedUp: "2025-01-04 14:20:40",
        InTransit: "2025-01-05 10:00:00",
        Delivered: null
      },
      location: {
        lat: -17.8249,
        lng: 31.0531
      }
    },
    {
      orderNumber: "Y6L4R7G9B2T8M1W",
      trackingNumber: "F0J3K9N5P8R2B7L",
      dateOrdered: "2025-01-13",
      depot: "Depot D",
      category: "Retailer",
      status: "Confirmed",
      timestamps: {
        Confirmed: "2025-01-13 09:05:45",
        PickedUp: null,
        InTransit: null,
        Delivered: null
      },
      location: null
    },
    {
      orderNumber: "S5M7T9X2K1R8V6P",
      trackingNumber: "L2P8W7Q3V5J0B1X",
      dateOrdered: "2025-01-11",
      depot: "Depot C",
      category: "Bulk Buyer",
      status: "Picked Up",
      timestamps: {
        Confirmed: "2025-01-11 10:15:00",
        PickedUp: "2025-01-11 12:30:25",
        InTransit: null,
        Delivered: null
      },
      location: null
    },
    {
      orderNumber: "P1Y8V2J9K4T3L0M",
      trackingNumber: "B3R7M9L0Q8X2T6K",
      dateOrdered: "2025-01-14",
      depot: "Depot A",
      category: "Corporate Client",
      status: "In Transit",
      timestamps: {
        Confirmed: "2025-01-14 13:05:55",
        PickedUp: "2025-01-14 14:45:10",
        InTransit: "2025-01-15 08:40:30",
        Delivered: null
      },
      location: {
        lat: -17.8249,
        lng: 31.0531
      }
    },
    {
      orderNumber: "T6M1F3J4V2K9B8X",
      trackingNumber: "Y7Q5T8P9K0F2J3W",
      dateOrdered: "2025-01-07",
      depot: "Depot B",
      category: "Retailer",
      status: "Delivered",
      timestamps: {
        Confirmed: "2025-01-07 14:50:00",
        PickedUp: "2025-01-07 16:15:00",
        InTransit: "2025-01-08 10:00:35",
        Delivered: "2025-01-08 12:20:45"
      },
      location: null
    },
    {
      orderNumber: "Q9P6T7M2R1X4B0L",
      trackingNumber: "S1F9P7L0Q2R3B8M",
      dateOrdered: "2025-01-01",
      depot: "Depot E",
      category: "Bulk Buyer",
      status: "Confirmed",
      timestamps: {
        Confirmed: "2025-01-01 16:30:25",
        PickedUp: null,
        InTransit: null,
        Delivered: null
      },
      location: null
    },
    {
      orderNumber: "L3B6T8F0Q9W4M2P",
      trackingNumber: "K2X5Z7R1L9F8J0V",
      dateOrdered: "2025-01-03",
      depot: "Depot D",
      category: "Retailer",
      status: "In Transit",
      timestamps: {
        Confirmed: "2025-01-03 09:10:25",
        PickedUp: "2025-01-03 11:30:45",
        InTransit: "2025-01-04 07:00:55",
        Delivered: null
      },
      location: {
        lat: -17.8249,
        lng: 31.0531
      }
    },
    {
      orderNumber: "N1P8Y5M6K3R0J2T",
      trackingNumber: "W2L5P3T8V0F7Q1B",
      dateOrdered: "2025-01-08",
      depot: "Depot C",
      category: "Small Business",
      status: "Confirmed",
      timestamps: {
        Confirmed: "2025-01-08 14:30:50",
        PickedUp: null,
        InTransit: null,
        Delivered: null
      },
      location: null
    },
    {
      orderNumber: "Z3X1L4T7M2F9J0Y",
      trackingNumber: "T8B9N5M4P7K0V2R",
      dateOrdered: "2025-01-09",
      depot: "Depot B",
      category: "Corporate Client",
      status: "Picked Up",
      timestamps: {
        Confirmed: "2025-01-09 08:50:00",
        PickedUp: "2025-01-09 10:30:15",
        InTransit: null,
        Delivered: null
      },
      location: null
    },
    {
      orderNumber: "M9T0F6Q8P7R1X2V",
      trackingNumber: "L1K5N9J7V2B0F3T",
      dateOrdered: "2025-01-02",
      depot: "Depot A",
      category: "Bulk Buyer",
      status: "In Transit",
      timestamps: {
        Confirmed: "2025-01-02 16:10:35",
        PickedUp: "2025-01-02 17:45:20",
        InTransit: "2025-01-03 09:40:10",
        Delivered: null
      },
      location: {
        lat: -17.8249,
        lng: 31.0531
      }
    },
    {
      orderNumber: "V8P1J9M3K2F0B5T",
      trackingNumber: "D7W9X5T3R1P2L8F",
      dateOrdered: "2025-01-12",
      depot: "Depot D",
      category: "Retailer",
      status: "Confirmed",
      timestamps: {
        Confirmed: "2025-01-12 08:00:10",
        PickedUp: null,
        InTransit: null,
        Delivered: null
      },
      location: null
    },
    {
      orderNumber: "F4Y2K9M1X8V5L7J",
      trackingNumber: "P9R6B2T4N7K3V1F",
      dateOrdered: "2025-01-06",
      depot: "Depot E",
      category: "Small Business",
      status: "Delivered",
      timestamps: {
        Confirmed: "2025-01-06 11:20:40",
        PickedUp: "2025-01-06 14:00:30",
        InTransit: "2025-01-07 08:00:20",
        Delivered: "2025-01-07 10:30:25"
      },
      location: null
    },
    {
      orderNumber: "T1V6R3F9M2P0K7X",
      trackingNumber: "L8Q5B3N9J4T2V0Y",
      dateOrdered: "2025-01-04",
      depot: "Depot A",
      category: "Retailer",
      status: "Picked Up",
      timestamps: {
        Confirmed: "2025-01-04 10:30:15",
        PickedUp: "2025-01-04 12:40:30",
        InTransit: null,
        Delivered: null
      },
      location: null
    },
    {
      orderNumber: "Y4M9J3P8B2X1R0K",
      trackingNumber: "D7F3P9T6K0V2N1X",
      dateOrdered: "2025-01-11",
      depot: "Depot B",
      category: "Corporate Client",
      status: "In Transit",
      timestamps: {
        Confirmed: "2025-01-11 13:25:45",
        PickedUp: "2025-01-11 15:50:20",
        InTransit: "2025-01-12 09:30:00",
        Delivered: null
      },
      location: {
        lat: -17.8249,
        lng: 31.0531
      }
    },
    {
      orderNumber: "R5X0F1M3T9Y2K7V",
      trackingNumber: "J4B6P3T0L7F2V8X",
      dateOrdered: "2025-01-13",
      depot: "Depot E",
      category: "Retailer",
      status: "In Transit",
      timestamps: {
        Confirmed: "2025-01-13 16:50:20",
        PickedUp: "2025-01-13 18:20:35",
        InTransit: "2025-01-14 10:40:55",
        Delivered: null
      },
      location: {
        lat: -17.8249,
        lng: 31.0531
      }
    },
    {
      orderNumber: "B9Q7Y6T3V0F5N2J",
      trackingNumber: "R2X4T9P6L3F1W7V",
      dateOrdered: "2025-01-10",
      depot: "Depot D",
      category: "Small Business",
      status: "Confirmed",
      timestamps: {
        Confirmed: "2025-01-10 12:00:10",
        PickedUp: null,
        InTransit: null,
        Delivered: null
      },
      location: null
    },
    {
      orderNumber: "P3X6T9K0L7R8B2V",
      trackingNumber: "N4W8M5Y1V6L0T9F",
      dateOrdered: "2025-01-08",
      depot: "Depot B",
      category: "Retailer",
      status: "In Transit",
      timestamps: {
        Confirmed: "2025-01-08 10:15:40",
        PickedUp: "2025-01-08 13:40:20",
        InTransit: "2025-01-09 07:00:30",
        Delivered: null
      },
      location: {
        lat: -17.8249,
        lng: 31.0531
      }
    },
    {
      orderNumber: "F7J3V5K9Q0R1L2X",
      trackingNumber: "T9M4N1P6L0R2K8F",
      dateOrdered: "2025-01-12",
      depot: "Depot E",
      category: "Bulk Buyer",
      status: "Delivered",
      timestamps: {
        Confirmed: "2025-01-12 14:30:25",
        PickedUp: "2025-01-12 16:50:10",
        InTransit: "2025-01-13 09:20:50",
        Delivered: "2025-01-13 11:30:40"
      },
      location: null
    },
    {
      orderNumber: "S1X0M7V8K9Q3R5L",
      trackingNumber: "B6T5L9R2N4K0V7P",
      dateOrdered: "2025-01-07",
      depot: "Depot A",
      category: "Retailer",
      status: "Picked Up",
      timestamps: {
        Confirmed: "2025-01-07 12:00:30",
        PickedUp: "2025-01-07 14:20:45",
        InTransit: null,
        Delivered: null
      },
      location: null
    },
    {
      orderNumber: "G7L1K9T8P0R2M6J",
      trackingNumber: "R9V0M2F5L3P8X6K",
      dateOrdered: "2025-01-14",
      depot: "Depot C",
      category: "Corporate Client",
      status: "In Transit",
      timestamps: {
        Confirmed: "2025-01-14 16:15:05",
        PickedUp: "2025-01-14 18:30:10",
        InTransit: "2025-01-15 07:40:30",
        Delivered: null
      },
      location: {
        lat: -17.8249,
        lng: 31.0531
      }
    },
    {
      orderNumber: "P5Q1J8R9L0V3F6X",
      trackingNumber: "M7K0N2B9R6T1F4L",
      dateOrdered: "2025-01-04",
      depot: "Depot E",
      category: "Small Business",
      status: "Confirmed",
      timestamps: {
        Confirmed: "2025-01-04 10:50:25",
        PickedUp: null,
        InTransit: null,
        Delivered: null
      },
      location: null
    },
    {
      orderNumber: "F3K8Y6B9Q2R0P7V",
      trackingNumber: "N1V5M4R2L8F0T7X",
      dateOrdered: "2025-01-13",
      depot: "Depot D",
      category: "Bulk Buyer",
      status: "In Transit",
      timestamps: {
        Confirmed: "2025-01-13 11:30:00",
        PickedUp: "2025-01-13 13:50:30",
        InTransit: "2025-01-14 08:00:40",
        Delivered: null
      },
      location: {
        lat: -17.8249,
        lng: 31.0531
      }
    },
    {
      orderNumber: "V4P7Q3R1F2K0L9M",
      trackingNumber: "B0R2X5V1L6P9T3N",
      dateOrdered: "2025-01-05",
      depot: "Depot B",
      category: "Corporate Client",
      status: "Delivered",
      timestamps: {
        Confirmed: "2025-01-05 09:00:15",
        PickedUp: "2025-01-05 11:30:35",
        InTransit: "2025-01-06 07:15:20",
        Delivered: "2025-01-06 08:50:10"
      },
      location: null
    },
    {
      orderNumber: "L0Q2T5R3V9B8F7M",
      trackingNumber: "J4K3V9R1L5M2T7P",
      dateOrdered: "2025-01-09",
      depot: "Depot A",
      category: "Retailer",
      status: "In Transit",
      timestamps: {
        Confirmed: "2025-01-09 13:20:50",
        PickedUp: "2025-01-09 15:00:00",
        InTransit: "2025-01-10 10:30:10",
        Delivered: null
      },
      location: {
        lat: -17.8249,
        lng: 31.0531
      }
    },
    {
      orderNumber: "B5T9K6F3P2R1L0J",
      trackingNumber: "X8N3V0L6M2P1T7Q",
      dateOrdered: "2025-01-10",
      depot: "Depot C",
      category: "Retailer",
      status: "Confirmed",
      timestamps: {
        Confirmed: "2025-01-10 08:30:45",
        PickedUp: null,
        InTransit: null,
        Delivered: null
      },
      location: null
    },
    {
      orderNumber: "K2R7X1L9M5B3Q0J",
      trackingNumber: "T9P2F6L7R1N4M3B",
      dateOrdered: "2025-01-11",
      depot: "Depot D",
      category: "Corporate Client",
      status: "In Transit",
      timestamps: {
        Confirmed: "2025-01-11 11:15:20",
        PickedUp: "2025-01-11 14:20:30",
        InTransit: "2025-01-12 07:50:15",
        Delivered: null
      },
      location: {
        lat: -17.8249,
        lng: 31.0531
      }
    },
    {
      orderNumber: "P9R2X0L3K7F8M5V",
      trackingNumber: "B3T2R1L6M5K9V0Q",
      dateOrdered: "2025-01-09",
      depot: "Depot A",
      category: "Small Business",
      status: "Picked Up",
      timestamps: {
        Confirmed: "2025-01-09 12:40:05",
        PickedUp: "2025-01-09 15:00:10",
        InTransit: null,
        Delivered: null
      },
      location: null
    },
    {
      orderNumber: "J5X3K0V9P2R7L6T",
      trackingNumber: "B6F9V2L8P1N3K0M",
      dateOrdered: "2025-01-12",
      depot: "Depot B",
      category: "Retailer",
      status: "Delivered",
      timestamps: {
        Confirmed: "2025-01-12 10:00:35",
        PickedUp: "2025-01-12 12:30:00",
        InTransit: "2025-01-13 09:10:25",
        Delivered: "2025-01-13 11:15:40"
      },
      location: null
    },
    {
      orderNumber: "P0R6V2K9M1J3T7Q",
      trackingNumber: "F9L3K1M5B7V8T0N",
      dateOrdered: "2025-01-06",
      depot: "Depot E",
      category: "Small Business",
      status: "In Transit",
      timestamps: {
        Confirmed: "2025-01-06 13:00:25",
        PickedUp: "2025-01-06 15:20:10",
        InTransit: "2025-01-07 08:30:00",
        Delivered: null
      },
      location: {
        lat: -17.8249,
        lng: 31.0531
      }
    },
    {
      orderNumber: "B2T9V7K1R3L5F0X",
      trackingNumber: "N4P8V3L6M2R1T5F",
      dateOrdered: "2025-01-13",
      depot: "Depot C",
      category: "Bulk Buyer",
      status: "Confirmed",
      timestamps: {
        Confirmed: "2025-01-13 09:45:15",
        PickedUp: null,
        InTransit: null,
        Delivered: null
      },
      location: null
    },
    {
      orderNumber: "S3R5X2V9P1K7M4J",
      trackingNumber: "T9L3B2M5N1V0P7Q",
      dateOrdered: "2025-01-04",
      depot: "Depot D",
      category: "Retailer",
      status: "In Transit",
      timestamps: {
        Confirmed: "2025-01-04 12:15:30",
        PickedUp: "2025-01-04 14:45:25",
        InTransit: "2025-01-05 08:30:00",
        Delivered: null
      },
      location: {
        lat: -17.8249,
        lng: 31.0531
      }
    },
    {
      orderNumber: "T9F2R3X8K7L1P5V",
      trackingNumber: "Q0B9L3N6T1R7F2M",
      dateOrdered: "2025-01-15",
      depot: "Depot A",
      category: "Corporate Client",
      status: "Delivered",
      timestamps: {
        Confirmed: "2025-01-15 10:00:05",
        PickedUp: "2025-01-15 12:30:10",
        InTransit: "2025-01-16 08:15:00",
        Delivered: "2025-01-16 09:45:40"
      },
      location: null
    },
    {
      orderNumber: "L1R2T5K9P0M3X7F",
      trackingNumber: "V3B8R2L6T1P5M9K",
      dateOrdered: "2025-01-07",
      depot: "Depot B",
      category: "Small Business",
      status: "In Transit",
      timestamps: {
        Confirmed: "2025-01-07 11:50:20",
        PickedUp: "2025-01-07 14:10:30",
        InTransit: "2025-01-08 09:40:10",
        Delivered: null
      },
      location: {
        lat: -17.8249,
        lng: 31.0531
      }
    },
     {
      orderNumber: "L8P9R3T1K6M4F0V",
      trackingNumber: "X2B9V7L6P1R5K0T",
      dateOrdered: "2025-01-16",
      depot: "Depot A",
      category: "Retailer",
      status: "Confirmed",
      timestamps: {
        Confirmed: "2025-01-16 10:05:30",
        PickedUp: null,
        InTransit: null,
        Delivered: null
      },
      location: null
    },
    {
      orderNumber: "K3V1X7P8T5R2L9M",
      trackingNumber: "P2B1L7N4T0R3F5V",
      dateOrdered: "2025-01-17",
      depot: "Depot C",
      category: "Bulk Buyer",
      status: "Picked Up",
      timestamps: {
        Confirmed: "2025-01-17 09:15:25",
        PickedUp: "2025-01-17 11:50:40",
        InTransit: null,
        Delivered: null
      },
      location: null
    },
    {
      orderNumber: "R0T6P9X5F3V7L2M",
      trackingNumber: "B1K2L4P3N0R9M5T",
      dateOrdered: "2025-01-18",
      depot: "Depot D",
      category: "Small Business",
      status: "In Transit",
      timestamps: {
        Confirmed: "2025-01-18 12:00:20",
        PickedUp: "2025-01-18 14:30:05",
        InTransit: "2025-01-19 07:25:50",
        Delivered: null
      },
      location: {
        lat: -17.8249,
        lng: 31.0531
      }
    },
    {
      orderNumber: "M7R8X2V5K9L3T1P",
      trackingNumber: "Q4B1V2L9P0R7M6T",
      dateOrdered: "2025-01-19",
      depot: "Depot E",
      category: "Corporate Client",
      status: "Delivered",
      timestamps: {
        Confirmed: "2025-01-19 11:45:30",
        PickedUp: "2025-01-19 14:15:00",
        InTransit: "2025-01-20 09:05:15",
        Delivered: "2025-01-20 12:10:40"
      },
      location: null
    },
    {
      orderNumber: "S4T7R3X2P9L5M8V",
      trackingNumber: "F1K3L7B2T9P0R4M",
      dateOrdered: "2025-01-20",
      depot: "Depot A",
      category: "Small Business",
      status: "Confirmed",
      timestamps: {
        Confirmed: "2025-01-20 13:30:25",
        PickedUp: null,
        InTransit: null,
        Delivered: null
      },
      location: null
    },
    {
      orderNumber: "T6K8V3P1L9X2R5M",
      trackingNumber: "V4B1P9L6T3R0F7M",
      dateOrdered: "2025-01-21",
      depot: "Depot C",
      category: "Retailer",
      status: "In Transit",
      timestamps: {
        Confirmed: "2025-01-21 14:05:15",
        PickedUp: "2025-01-21 16:30:20",
        InTransit: "2025-01-22 09:45:30",
        Delivered: null
      },
      location: {
        lat: -17.8249,
        lng: 31.0531
      }
    },
    {
      orderNumber: "R3T9L2X8K7P1M6F",
      trackingNumber: "N0P2B1L3T4R9M5V",
      dateOrdered: "2025-01-22",
      depot: "Depot D",
      category: "Bulk Buyer",
      status: "Delivered",
      timestamps: {
        Confirmed: "2025-01-22 08:00:10",
        PickedUp: "2025-01-22 10:20:30",
        InTransit: "2025-01-23 07:15:25",
        Delivered: "2025-01-23 08:45:50"
      },
      location: null
    },
    {
      orderNumber: "M5P9R0L3X2V8T1F",
      trackingNumber: "L7B9N6R2P5T1K4M",
      dateOrdered: "2025-01-23",
      depot: "Depot B",
      category: "Corporate Client",
      status: "In Transit",
      timestamps: {
        Confirmed: "2025-01-23 12:30:45",
        PickedUp: "2025-01-23 14:05:50",
        InTransit: "2025-01-24 08:20:00",
        Delivered: null
      },
      location: {
        lat: -17.8249,
        lng: 31.0531
      }
    },
    {
      orderNumber: "T9V1R7K6X3P8L2F",
      trackingNumber: "R4B9L3T0M2P7F5K",
      dateOrdered: "2025-01-24",
      depot: "Depot E",
      category: "Retailer",
      status: "Picked Up",
      timestamps: {
        Confirmed: "2025-01-24 13:00:30",
        PickedUp: "2025-01-24 15:15:45",
        InTransit: null,
        Delivered: null
      },
      location: null
    }
  ];

// Function to get distinct depots
const getDistinctDepots = (orderUpdates: Order[]): string[] => {
    return orderUpdates.reduce((uniqueDepots, order) => {
      if (!uniqueDepots.includes(order.depot)) {
        uniqueDepots.push(order.depot);
      }
      return uniqueDepots;
    }, [] as string[]);
  };

  const getDistinctCategories= (orderUpdates: Order[]): string[] => {
    return orderUpdates.reduce((uniqueCategories, order) => {
      if (!uniqueCategories.includes(order.category)) {
        uniqueCategories.push(order.category);
      }
      return uniqueCategories;
    }, [] as string[]);
  };

  const filterOrdersByDate = (orders: Order[], fromDate: string | undefined, toDate: string| undefined) => {
    if(fromDate != undefined && toDate != undefined ){
      const from = new Date(fromDate);
      const to = new Date(toDate);
    
      return orders.filter(order => {
        const orderDate = new Date(order.dateOrdered);
        return orderDate >= from && orderDate <= to;
      });
    }
    else
    return []
  };

  // ActionCell Component to manage the state and rendering of dropdown and chat modal
const ActionCell = ({ orderUpdate }: { orderUpdate: Order }) => {
    const [isDialogOpen, setDialogOpen] = useState(false); // State to manage the modal visibility
    const [isDialogOpenOrderProgress, setDialogOpenOrderProgress] = useState(false); // State to manage the modal visibility
 
    const handleOpenChatWithPayment = () => {
      console.log("Opening chat for payment:", orderUpdate);
      setDialogOpen(true); // Open the chat dialog
    };

    const handleOpenOrderProgress= () => {
        setDialogOpenOrderProgress(true); // Open the chat dialog
      };
  
    const handleCloseChat = () => {
      setDialogOpen(false); // Close the chat dialog
    };

    const handleCloseOrderProgress = () => {
        setDialogOpenOrderProgress(false); // Close the chat dialog
      };

    return (
      <div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" className="h-8 w-8 p-0">
              <span className="sr-only">Open menu</span>
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>Actions</DropdownMenuLabel>
            <DropdownMenuItem onClick={handleOpenOrderProgress}>
              Track Order
            </DropdownMenuItem>
            {orderUpdate.status == "In Transit" ?
                <DropdownMenuItem onClick={handleOpenChatWithPayment}>
                    Map View
                </DropdownMenuItem>
                : null
            }
          </DropdownMenuContent>
        </DropdownMenu>
  
        {/* Conditionally render the chat modal */}
        {isDialogOpen && <OrderTrackingMapview  onClose={handleCloseChat} customerOrder={orderUpdate}/>}
        {isDialogOpenOrderProgress && <OrderProgress  onClose={handleCloseOrderProgress} order={orderUpdate}/>}
      </div>
    );
  };

  export const columns: ColumnDef<Order>[] = [
    {
      id: "select",
      header: ({ table }) => (
        <Checkbox
          checked={
            table.getIsAllPageRowsSelected() ||
            (table.getIsSomePageRowsSelected() && "indeterminate")
          }
          onCheckedChange={(value) => table.toggleAllPageRowsSelected(!!value)}
          aria-label="Select all"
        />
      ),
      cell: ({ row }) => (
        <Checkbox
          checked={row.getIsSelected()}
          onCheckedChange={(value) => row.toggleSelected(!!value)}
          aria-label="Select row"
        />
      ),
      enableSorting: false,
      enableHiding: false,
    },
    {
      accessorKey: "orderNumber",
      header: "Order Number",
      cell: ({ row }) => (
        <div className="capitalize">{row.getValue("orderNumber")}</div>
      ),
    },
    {
        accessorKey: "dateOrdered",
        header: ({ column }) => {
          return (
            <Button
              variant="ghost"
              onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
            >
              Date Ordered
              <ArrowUpDown />
            </Button>
          )
        },
        cell: ({ row }) => <div className="lowercase">{row.getValue("dateOrdered")}</div>,
    },
    {
      accessorKey: "status",
      header: "Status",
      cell: ({ row }) => (
        <div className="capitalize">{row.getValue("status")}</div>
      ),
    },
    {
      id: "actions",
      enableHiding: false,
      cell: ({ row }) => {
          const orderUpdate = row.original;
          return <ActionCell orderUpdate={orderUpdate} />;
        },
    },
  ]
  
  export function OrderTracking() {
    const [selectedDateRange, setSelectedDateRange] = useState<DateRange | undefined>();
    const [selectedDepot, setSelectedDepot] = useState<string | undefined>(undefined);
    const [selectedCategory, setSelectedCategory] = useState<string | undefined>(undefined);
  
    // UseMemo to memoize filtered orders based on selectedDateRange
    const filteredOrders = useMemo(() => {
      if (!selectedDateRange?.from || !selectedDateRange?.to) {
        return orderUpdates; // Return all orders if no date range is selected
      }
      return filterOrdersByDate(
        orderUpdates,
        selectedDateRange.from.toLocaleDateString(),
        selectedDateRange.to.toLocaleDateString()
      );
    }, [selectedDateRange]);
  
    // Memoize distinct depots and categories
    const distinctDepots = useMemo(() => getDistinctDepots(filteredOrders), [filteredOrders]);
    const distinctCategories = useMemo(() => getDistinctCategories(filteredOrders), [filteredOrders]);
  
    // Filter by depot
    const filteredByDepot = useMemo(() => {
      return selectedDepot
        ? filteredOrders.filter((order) => order.depot === selectedDepot)
        : filteredOrders;
    }, [selectedDepot, filteredOrders]);
  
    // Filter by category
    const filteredByCategory = useMemo(() => {
      return selectedCategory
        ? filteredByDepot.filter((order) => order.category === selectedCategory)
        : filteredByDepot;
    }, [selectedCategory, filteredByDepot]);
  
    // Table data
    const data = filteredByCategory;
  
    const [sorting, setSorting] = React.useState<SortingState>([]);
    const [columnFilters, setColumnFilters] = React.useState<ColumnFiltersState>([]);
    const [columnVisibility, setColumnVisibility] = React.useState<VisibilityState>({});
    const [rowSelection, setRowSelection] = React.useState({});
  
    const table = useReactTable({
      data,
      columns,
      onSortingChange: setSorting,
      onColumnFiltersChange: setColumnFilters,
      getCoreRowModel: getCoreRowModel(),
      getPaginationRowModel: getPaginationRowModel(),
      getSortedRowModel: getSortedRowModel(),
      getFilteredRowModel: getFilteredRowModel(),
      onColumnVisibilityChange: setColumnVisibility,
      onRowSelectionChange: setRowSelection,
      state: {
        sorting,
        columnFilters,
        columnVisibility,
        rowSelection,
      },
    });
  
    const handleDateChange = (date: DateRange | undefined) => {
      setSelectedDateRange(date);
      console.log("Selected Date Range:", date);
    };
  
    const handleDepotChange = (value: string) => setSelectedDepot(value);
    const handleCategoryChange = (value: string) => setSelectedCategory(value);
  
    return (
      <Card className="flex flex-col">
        <CardHeader className="items-center pb-0">
          <CardTitle>Orders Tracking</CardTitle>
          <br/>
        </CardHeader>
        <CardContent className="flex-1 pb-0">
          <div className="flex gap-4">
            <DatePickerWithRange onDateChange={handleDateChange} />
            <Select value={selectedDepot} onValueChange={handleDepotChange}>
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="Select a depot" />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectLabel>Depots</SelectLabel>
                  {distinctDepots.map((depot: string) => (
                    <SelectItem key={depot} value={depot}>
                      {depot}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
            <Select value={selectedCategory} onValueChange={handleCategoryChange}>
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="Select a category" />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectLabel>Category</SelectLabel>
                  {distinctCategories.map((category: string) => (
                    <SelectItem key={category} value={category}>
                      {category}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>
          {/* Table Content */}
        <div className="rounded-md border mt-4">
        <Table>
            {/* Table Header */}
            <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
                <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                    <TableHead key={header.id}>
                    {header.isPlaceholder
                        ? null
                        : flexRender(header.column.columnDef.header, header.getContext())}
                    </TableHead>
                ))}
                </TableRow>
            ))}
            </TableHeader>
            {/* Table Body */}
            <TableBody>
            {table.getRowModel().rows.length ? (
                table.getRowModel().rows.map((row) => (
                <TableRow key={row.id}>
                    {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id}>
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                    ))}
                </TableRow>
                ))
            ) : (
                <TableRow>
                <TableCell colSpan={columns.length} className="text-center">
                    No results found.
                </TableCell>
                </TableRow>
            )}
            </TableBody>
        </Table>
        </div>
        <div className="flex items-center justify-end space-x-2 pt-4">
        <div className="flex-1 text-sm text-muted-foreground">
        {table.getFilteredSelectedRowModel().rows.length} of{" "}
        {table.getFilteredRowModel().rows.length} row(s) selected.
        </div>
        <div className="space-x-2">
        <Button
        variant="outline"
        size="sm"
        onClick={() => table.previousPage()}
        disabled={!table.getCanPreviousPage()}
        >
        Previous
        </Button>
        <Button
        variant="outline"
        size="sm"
        onClick={() => table.nextPage()}
        disabled={!table.getCanNextPage()}
        >
        Next
        </Button>
        </div>
        </div>
        </CardContent>
      </Card>
    );
  }
  