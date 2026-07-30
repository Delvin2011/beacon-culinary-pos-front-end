"use client"

import * as React from "react"
import { Label, Pie, PieChart } from "recharts"

import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart"
import { Select, SelectTrigger, SelectValue, SelectContent, SelectGroup, SelectLabel, SelectItem } from "@/components/ui/select";

import { DatePickerWithRange } from "../date-picker-with-range"
import { DateRange } from "react-day-picker"
import { useState } from "react"


interface Order {
    orderNumber: string
    trackingNumber: string
    dateOrdered: string
    depot: string
    category: string
    status: string
  }

const orderUpdates = [{orderNumber: 'BZOA6K8R28UI15D',
    trackingNumber: '2I7DE1B57ZWCD68',
    dateOrdered: '2025-01-01',
    depot: 'Depot A',
    category: 'Corporate Client',
    status: 'Delivered'},
   {orderNumber: '7LYW2EH4O6WGRJ4',
    trackingNumber: 'F5MFDA70G5FN63L',
    dateOrdered: '2024-12-21',
    depot: 'Depot A',
    category: 'Bulk Buyer',
    status: 'Picked Up'},
   {orderNumber: 'NXMEV2GVZ9ACI9R',
    trackingNumber: '7AL78NTTD05RG6H',
    dateOrdered: '2024-12-26',
    depot: 'Depot A',
    category: 'Small Business',
    status: 'Picked Up'},
   {orderNumber: 'VD2PDAROEDB2D4M',
    trackingNumber: 'YZEY8K2L0YKE54Y',
    dateOrdered: '2024-12-18',
    depot: 'Depot A',
    category: 'Bulk Buyer',
    status: 'Confirmed'},
   {orderNumber: 'F62232JE1SBNS1G',
    trackingNumber: 'QSFY4JCRQH1Y2F1',
    dateOrdered: '2024-12-31',
    depot: 'Depot A',
    category: 'Corporate Client',
    status: 'Picked Up'},
   {orderNumber: 'PE8DNOBS0YDM7BQ',
    trackingNumber: 'ECTS3R2IQMDJVIT',
    dateOrdered: '2024-12-16',
    depot: 'Depot C',
    category: 'Bulk Buyer',
    status: 'Confirmed'},
   {orderNumber: 'P0DYCGS62QE5ACN',
    trackingNumber: 'A26T41IVPGLZD87',
    dateOrdered: '2024-12-15',
    depot: 'Depot E',
    category: 'Corporate Client',
    status: 'In Transit'},
   {orderNumber: '9M9CGFZE73KXJXV',
    trackingNumber: 'ABNMSVM2R0P2MH8',
    dateOrdered: '2025-01-03',
    depot: 'Depot C',
    category: 'Retailer',
    status: 'Delivered'},
   {orderNumber: '6YNLMM8FLJ5BGX7',
    trackingNumber: 'L1QBGRHNCR92SEV',
    dateOrdered: '2025-01-09',
    depot: 'Depot B',
    category: 'Bulk Buyer',
    status: 'In Transit'},
   {orderNumber: 'QBV3KEHRW0DZIHM',
    trackingNumber: 'KUWUYNCPDO6GHAW',
    dateOrdered: '2024-12-19',
    depot: 'Depot A',
    category: 'Small Business',
    status: 'Picked Up'},
   {orderNumber: 'KLPLMN4ZW1VIYYU',
    trackingNumber: 'GDQSKRLMDE4598U',
    dateOrdered: '2024-12-26',
    depot: 'Depot D',
    category: 'Corporate Client',
    status: 'In Transit'},
   {orderNumber: 'H1G3BZ8FRHKDVVL',
    trackingNumber: 'IU5WWEF0DXHC9VJ',
    dateOrdered: '2024-12-20',
    depot: 'Depot E',
    category: 'Retailer',
    status: 'Delivered'},
   {orderNumber: 'U7EL888NU1NUTSE',
    trackingNumber: '13J3DL0DD4DVV7B',
    dateOrdered: '2024-12-25',
    depot: 'Depot B',
    category: 'Bulk Buyer',
    status: 'Confirmed'},
   {orderNumber: 'DZFCM8YLP3DFV6D',
    trackingNumber: '1J83EDKI4OH1KQP',
    dateOrdered: '2024-12-31',
    depot: 'Depot E',
    category: 'Bulk Buyer',
    status: 'In Transit'},
   {orderNumber: 'X97UT4G8PLSAQD8',
    trackingNumber: '2G3HZ1V2NIQC36P',
    dateOrdered: '2024-12-30',
    depot: 'Depot C',
    category: 'Corporate Client',
    status: 'Delivered'},
   {orderNumber: 'MI1A8QPC70KSF7R',
    trackingNumber: 'ZLT9KLTUWYY3FJ3',
    dateOrdered: '2025-01-01',
    depot: 'Depot D',
    category: 'Retailer',
    status: 'Picked Up'},
   {orderNumber: 'QBU90Q7K2YZ962Z',
    trackingNumber: 'QHVLV7W51UJZ7CM',
    dateOrdered: '2024-12-17',
    depot: 'Depot A',
    category: 'Corporate Client',
    status: 'Picked Up'},
   {orderNumber: '5MQ8BRA78SLH3C4',
    trackingNumber: 'V64UGNKKWDH6XLT',
    dateOrdered: '2024-12-22',
    depot: 'Depot B',
    category: 'Retailer',
    status: 'In Transit'},
   {orderNumber: 'HOXO5RQUCK7YHCP',
    trackingNumber: '5IOBKOZ8XEBC0LC',
    dateOrdered: '2025-01-15',
    depot: 'Depot A',
    category: 'Small Business',
    status: 'In Transit'},
   {orderNumber: '2433F7O1V0RE1RB',
    trackingNumber: 'MT16E17XBHCN81H',
    dateOrdered: '2024-12-25',
    depot: 'Depot D',
    category: 'Small Business',
    status: 'Confirmed'},
   {orderNumber: 'Y4UC43972KZ77RB',
    trackingNumber: 'JCFDPO9CDCC4Z44',
    dateOrdered: '2025-01-08',
    depot: 'Depot D',
    category: 'Bulk Buyer',
    status: 'Delivered'},
   {orderNumber: 'IFRSLTK0I2ZAHDY',
    trackingNumber: '3MBMP3BGX7OEDBU',
    dateOrdered: '2025-01-13',
    depot: 'Depot A',
    category: 'Retailer',
    status: 'Delivered'},
   {orderNumber: 'SMBPILGPEQ8EZKR',
    trackingNumber: 'UIL6RIJ5CLJ004R',
    dateOrdered: '2024-12-15',
    depot: 'Depot C',
    category: 'Small Business',
    status: 'Delivered'},
   {orderNumber: 'BFLTZVIZFXKYOWF',
    trackingNumber: '3MYNFHWWGNJX7WD',
    dateOrdered: '2024-12-26',
    depot: 'Depot D',
    category: 'Bulk Buyer',
    status: 'Delivered'},
   {orderNumber: 'LRITTEJF5YBY4JC',
    trackingNumber: '7VSODEFVZYTRQRG',
    dateOrdered: '2025-01-11',
    depot: 'Depot C',
    category: 'Small Business',
    status: 'Picked Up'},
   {orderNumber: 'N8VS0TZ71C1JXAN',
    trackingNumber: '8BZ3M0KWERX2NUS',
    dateOrdered: '2025-01-03',
    depot: 'Depot B',
    category: 'Small Business',
    status: 'Delivered'},
   {orderNumber: 'Z8YFDLQLMWX5SX4',
    trackingNumber: 'OUBP8LHOTZDPKZM',
    dateOrdered: '2025-01-02',
    depot: 'Depot C',
    category: 'Corporate Client',
    status: 'Picked Up'},
   {orderNumber: 'B7WZ9MRRVO1E0OB',
    trackingNumber: 'UB6UW3PTHSY2A7P',
    dateOrdered: '2025-01-08',
    depot: 'Depot D',
    category: 'Retailer',
    status: 'Delivered'},
   {orderNumber: 'TT3G8KN46JGKNLM',
    trackingNumber: 'L3D23W3J3I521DV',
    dateOrdered: '2025-01-02',
    depot: 'Depot E',
    category: 'Retailer',
    status: 'Delivered'},
   {orderNumber: '9JIAER3YRSS5CVN',
    trackingNumber: 'M155NPFOPS87A82',
    dateOrdered: '2025-01-08',
    depot: 'Depot C',
    category: 'Small Business',
    status: 'In Transit'},
   {orderNumber: 'X8RXPBYUGGMO0CW',
    trackingNumber: 'LMB1L1I0Q2T55O0',
    dateOrdered: '2025-01-15',
    depot: 'Depot B',
    category: 'Small Business',
    status: 'Delivered'},
   {orderNumber: 'VCKD6K2JKE2M36X',
    trackingNumber: 'CN50LSKLPW1PB5I',
    dateOrdered: '2024-12-31',
    depot: 'Depot B',
    category: 'Retailer',
    status: 'Delivered'},
   {orderNumber: 'EXX92FVMRQUHZFC',
    trackingNumber: 'AA5C1BC59TMIIFZ',
    dateOrdered: '2024-12-30',
    depot: 'Depot B',
    category: 'Small Business',
    status: 'Picked Up'},
   {orderNumber: 'XBKBAOPL77J4ZCG',
    trackingNumber: 'CMRO5C7H2MSH7B0',
    dateOrdered: '2025-01-06',
    depot: 'Depot C',
    category: 'Small Business',
    status: 'Confirmed'},
   {orderNumber: 'SQGVVXT4XNZD4QZ',
    trackingNumber: '5Y28STSGNX104SW',
    dateOrdered: '2024-12-18',
    depot: 'Depot C',
    category: 'Retailer',
    status: 'In Transit'},
   {orderNumber: 'YI7GIJSZY9LP2OK',
    trackingNumber: 'ZKQHWQVF6JQ1R4I',
    dateOrdered: '2025-01-02',
    depot: 'Depot E',
    category: 'Bulk Buyer',
    status: 'Delivered'},
   {orderNumber: '8X0UPBO0OVZB3LH',
    trackingNumber: 'CKY3OQN0369A11V',
    dateOrdered: '2025-01-04',
    depot: 'Depot C',
    category: 'Small Business',
    status: 'Confirmed'},
   {orderNumber: '7EXQE2POFJRJUJV',
    trackingNumber: '3YTLMHXU0WT2FYW',
    dateOrdered: '2025-01-07',
    depot: 'Depot A',
    category: 'Retailer',
    status: 'In Transit'},
   {orderNumber: '0G85K64GIR0EQYS',
    trackingNumber: 'CPS88VKXGRNV0K0',
    dateOrdered: '2025-01-08',
    depot: 'Depot D',
    category: 'Bulk Buyer',
    status: 'Picked Up'},
   {orderNumber: 'IIA00VM9SPP0BQG',
    trackingNumber: '2WI6LXT8CLH8QLO',
    dateOrdered: '2024-12-31',
    depot: 'Depot D',
    category: 'Bulk Buyer',
    status: 'Delivered'},
   {orderNumber: 'VNKF200TTU4WJJ6',
    trackingNumber: 'BFW6IWCSC5ZHK1L',
    dateOrdered: '2024-12-27',
    depot: 'Depot A',
    category: 'Bulk Buyer',
    status: 'Picked Up'},
   {orderNumber: 'S0G30WYKAIU2NX4',
    trackingNumber: '81Q2XX8MINYTYQ6',
    dateOrdered: '2024-12-24',
    depot: 'Depot B',
    category: 'Small Business',
    status: 'In Transit'},
   {orderNumber: 'N2T4N4HC0E1KNR8',
    trackingNumber: 'NII857ELB1RYHG0',
    dateOrdered: '2025-01-14',
    depot: 'Depot B',
    category: 'Corporate Client',
    status: 'In Transit'},
   {orderNumber: 'VQJBHM5TJC7SG83',
    trackingNumber: 'JBZ7GIIIREUTZYF',
    dateOrdered: '2025-01-07',
    depot: 'Depot C',
    category: 'Small Business',
    status: 'Confirmed'},
   {orderNumber: '1NHSKXUJM1QFB3R',
    trackingNumber: 'S8EFFAJUFN6R8F8',
    dateOrdered: '2025-01-16',
    depot: 'Depot B',
    category: 'Corporate Client',
    status: 'Delivered'},
   {orderNumber: 'NXJNE3OMOMWS281',
    trackingNumber: 'E8SSC83I4D0I8SG',
    dateOrdered: '2024-12-23',
    depot: 'Depot C',
    category: 'Corporate Client',
    status: 'In Transit'},
   {orderNumber: '8Q8CV5OSJTV2Z1J',
    trackingNumber: 'UF5MVZA8NAIOQOF',
    dateOrdered: '2025-01-15',
    depot: 'Depot C',
    category: 'Retailer',
    status: 'In Transit'},
   {orderNumber: 'D74YYE2DC5LE0FT',
    trackingNumber: '790W1W7OB2EBSVN',
    dateOrdered: '2024-12-24',
    depot: 'Depot A',
    category: 'Corporate Client',
    status: 'Picked Up'},
   {orderNumber: '47JGF9FL9U22C1P',
    trackingNumber: 'SX1ZSLHI8A9GIHG',
    dateOrdered: '2025-01-02',
    depot: 'Depot A',
    category: 'Bulk Buyer',
    status: 'Picked Up'},
   {orderNumber: 'F19B2WBJULEI0OE',
    trackingNumber: 'XJ7L5JX6XV9D9F8',
    dateOrdered: '2024-12-16',
    depot: 'Depot E',
    category: 'Retailer',
    status: 'In Transit'},
   {orderNumber: 'NV3DXV12EDRCJ4E',
    trackingNumber: 'UKOKEYF6R8CARY9',
    dateOrdered: '2024-12-26',
    depot: 'Depot B',
    category: 'Corporate Client',
    status: 'Delivered'},
   {orderNumber: '1JUJ2PZJELUD42D',
    trackingNumber: '58J8CR02NHLSM3S',
    dateOrdered: '2025-01-13',
    depot: 'Depot E',
    category: 'Small Business',
    status: 'Confirmed'},
   {orderNumber: 'MIYHDVBDWSZKSVF',
    trackingNumber: 'T81YJAH56CBUAQ5',
    dateOrdered: '2025-01-06',
    depot: 'Depot D',
    category: 'Small Business',
    status: 'In Transit'},
   {orderNumber: 'EJUYCID797Q5V1C',
    trackingNumber: 'T5F9T1TTPWL8RP4',
    dateOrdered: '2024-12-24',
    depot: 'Depot B',
    category: 'Retailer',
    status: 'Picked Up'},
   {orderNumber: 'LTVIQHXY0D4BQ2V',
    trackingNumber: 'CDGJQ2WYLJSM5T9',
    dateOrdered: '2024-12-15',
    depot: 'Depot C',
    category: 'Bulk Buyer',
    status: 'Picked Up'},
   {orderNumber: 'F7HI4PRNRLWFHEJ',
    trackingNumber: '1F9HLC816EQI4L2',
    dateOrdered: '2024-12-29',
    depot: 'Depot B',
    category: 'Bulk Buyer',
    status: 'Confirmed'},
   {orderNumber: 'DZ8TGNPHZC7ED1W',
    trackingNumber: 'ZBDSAWPPSKK84J1',
    dateOrdered: '2025-01-05',
    depot: 'Depot E',
    category: 'Bulk Buyer',
    status: 'Delivered'},
   {orderNumber: 'O0ZGWT6Z8ZIXSA9',
    trackingNumber: 'HO8S4GF01XUEHWU',
    dateOrdered: '2024-12-16',
    depot: 'Depot E',
    category: 'Small Business',
    status: 'In Transit'},
   {orderNumber: '6VLOUQJZCC2NZJ4',
    trackingNumber: 'Y2S33E5DGEGIXTL',
    dateOrdered: '2025-01-08',
    depot: 'Depot A',
    category: 'Bulk Buyer',
    status: 'Confirmed'},
   {orderNumber: 'O1S263C8OZJW467',
    trackingNumber: 'TAVQ2VETG9AUU0D',
    dateOrdered: '2024-12-25',
    depot: 'Depot C',
    category: 'Small Business',
    status: 'Delivered'},
   {orderNumber: '4OZJYUNEGXO0GY5',
    trackingNumber: '9THJUFOQN6ITMB9',
    dateOrdered: '2025-01-12',
    depot: 'Depot D',
    category: 'Corporate Client',
    status: 'Picked Up'},
   {orderNumber: 'Y0N9H4RFTQZVQ34',
    trackingNumber: '8L5L1U6K683ME7R',
    dateOrdered: '2025-01-11',
    depot: 'Depot C',
    category: 'Retailer',
    status: 'Confirmed'},
   {orderNumber: 'GLYT4ZX50AFXBRN',
    trackingNumber: '4767QOVMMO5LEDN',
    dateOrdered: '2025-01-01',
    depot: 'Depot B',
    category: 'Small Business',
    status: 'Confirmed'},
   {orderNumber: 'MKJNLQYJBMUCRBR',
    trackingNumber: 'W9NY47R0FQQVOQA',
    dateOrdered: '2025-01-01',
    depot: 'Depot B',
    category: 'Small Business',
    status: 'Confirmed'},
   {orderNumber: 'EHBYFH9MF6GBGYS',
    trackingNumber: 'CS7PH9DLWGX6I7D',
    dateOrdered: '2025-01-11',
    depot: 'Depot A',
    category: 'Retailer',
    status: 'Confirmed'},
   {orderNumber: '6GG0TCIJ296F6XT',
    trackingNumber: 'XTIEDMQHKLL43QR',
    dateOrdered: '2024-12-31',
    depot: 'Depot E',
    category: 'Retailer',
    status: 'Delivered'},
   {orderNumber: 'F3O28S14FFY5X9Z',
    trackingNumber: '0AKJTV1GOHL3YTB',
    dateOrdered: '2024-12-28',
    depot: 'Depot A',
    category: 'Retailer',
    status: 'Picked Up'},
   {orderNumber: 'EBVTZZQNURAA4BE',
    trackingNumber: 'ELUVN0LBWGE8LV4',
    dateOrdered: '2025-01-15',
    depot: 'Depot D',
    category: 'Retailer',
    status: 'Picked Up'},
   {orderNumber: 'BAYGBT8SVW3OCIW',
    trackingNumber: '8TIL8AS43HCMRP1',
    dateOrdered: '2024-12-18',
    depot: 'Depot C',
    category: 'Bulk Buyer',
    status: 'Delivered'},
   {orderNumber: 'ENVCEHF5HOTFCIX',
    trackingNumber: '6YS8PGP5PCVNEDS',
    dateOrdered: '2025-01-06',
    depot: 'Depot C',
    category: 'Small Business',
    status: 'Confirmed'},
   {orderNumber: 'BB3WNWHOH5VJNSM',
    trackingNumber: '101OODA1G371IJQ',
    dateOrdered: '2024-12-20',
    depot: 'Depot C',
    category: 'Corporate Client',
    status: 'Picked Up'},
   {orderNumber: '5971MTCED523H8M',
    trackingNumber: '5A8BAIVQRRCV09F',
    dateOrdered: '2024-12-19',
    depot: 'Depot D',
    category: 'Bulk Buyer',
    status: 'Picked Up'},
   {orderNumber: '1HXHA8IKGPNR1ZB',
    trackingNumber: 'OPUXTKC5QVXO0E3',
    dateOrdered: '2024-12-20',
    depot: 'Depot C',
    category: 'Retailer',
    status: 'In Transit'},
   {orderNumber: 'HW19GG0ZY9W9LVB',
    trackingNumber: 'S464A2T7KHKM0WO',
    dateOrdered: '2025-01-03',
    depot: 'Depot D',
    category: 'Retailer',
    status: 'Picked Up'},
   {orderNumber: 'YROKDBZWXPR15C8',
    trackingNumber: 'PV1DNRWX1XVEOAX',
    dateOrdered: '2025-01-12',
    depot: 'Depot C',
    category: 'Small Business',
    status: 'Confirmed'},
   {orderNumber: 'U6K9SCU9BPKZW3Q',
    trackingNumber: 'EYXPFYIF9RHLJFS',
    dateOrdered: '2025-01-14',
    depot: 'Depot E',
    category: 'Retailer',
    status: 'Delivered'},
   {orderNumber: 'M9F59WLOPY3FRRC',
    trackingNumber: 'IHJ6SN3VF54E142',
    dateOrdered: '2025-01-14',
    depot: 'Depot A',
    category: 'Bulk Buyer',
    status: 'Picked Up'},
   {orderNumber: 'CI6AB5RGOO0MZED',
    trackingNumber: 'E0OTEOQVPOQS407',
    dateOrdered: '2024-12-20',
    depot: 'Depot E',
    category: 'Retailer',
    status: 'Picked Up'},
   {orderNumber: 'T56SKHSI2UA2RHZ',
    trackingNumber: 'V8NMOZ81A97T9Q3',
    dateOrdered: '2024-12-19',
    depot: 'Depot B',
    category: 'Bulk Buyer',
    status: 'Confirmed'},
   {orderNumber: 'MARWYJJM2YDV6WO',
    trackingNumber: 'HKU9BZ51SEX7PJ8',
    dateOrdered: '2025-01-07',
    depot: 'Depot A',
    category: 'Retailer',
    status: 'Picked Up'},
   {orderNumber: 'IKVPDLIE7LTGFOA',
    trackingNumber: 'IG8QC85UF4DRB4L',
    dateOrdered: '2024-12-25',
    depot: 'Depot D',
    category: 'Bulk Buyer',
    status: 'Delivered'},
   {orderNumber: 'WHVHGG0Y5XGJET7',
    trackingNumber: 'I3WM5T7K2C00I33',
    dateOrdered: '2025-01-02',
    depot: 'Depot B',
    category: 'Corporate Client',
    status: 'Confirmed'},
   {orderNumber: 'HAOST1LYGYCUJV0',
    trackingNumber: 'TNFZL57P4RQBYC0',
    dateOrdered: '2025-01-01',
    depot: 'Depot A',
    category: 'Corporate Client',
    status: 'In Transit'},
   {orderNumber: 'A2TF523PS5OA9JD',
    trackingNumber: 'QEERE1QHR45B9N1',
    dateOrdered: '2025-01-16',
    depot: 'Depot D',
    category: 'Bulk Buyer',
    status: 'Picked Up'},
   {orderNumber: 'KTCG9ZJMFXBU5F2',
    trackingNumber: '04XN7A4MUVNMGBN',
    dateOrdered: '2024-12-23',
    depot: 'Depot E',
    category: 'Bulk Buyer',
    status: 'Delivered'},
   {orderNumber: '2OFGDVS0JZ9U70X',
    trackingNumber: 'C1T89LA1SEADIF8',
    dateOrdered: '2024-12-30',
    depot: 'Depot D',
    category: 'Corporate Client',
    status: 'Confirmed'},
   {orderNumber: 'QRCA26BNER15ZYN',
    trackingNumber: 'NWCP8J5EE35QRNT',
    dateOrdered: '2024-12-22',
    depot: 'Depot E',
    category: 'Bulk Buyer',
    status: 'Confirmed'},
   {orderNumber: 'P5QGM3TGUHKFX3H',
    trackingNumber: '4IJRTLQF8LQQMXM',
    dateOrdered: '2024-12-27',
    depot: 'Depot A',
    category: 'Retailer',
    status: 'Picked Up'},
   {orderNumber: 'LDS1G7UOM8TB94S',
    trackingNumber: 'HJF3U27P8GN0QV3',
    dateOrdered: '2025-01-01',
    depot: 'Depot E',
    category: 'Bulk Buyer',
    status: 'Picked Up'},
   {orderNumber: '7F2FLA843LXNC0M',
    trackingNumber: 'GJ9KD33LXMV0XFI',
    dateOrdered: '2025-01-12',
    depot: 'Depot B',
    category: 'Bulk Buyer',
    status: 'In Transit'},
   {orderNumber: 'I0OUUQUZ4VUDVKZ',
    trackingNumber: 'BYG9PMX5IBNICH3',
    dateOrdered: '2024-12-20',
    depot: 'Depot C',
    category: 'Corporate Client',
    status: 'In Transit'},
   {orderNumber: 'FOM11QMLFX9RZ4G',
    trackingNumber: 'FNYTBW4PVBMGXG9',
    dateOrdered: '2024-12-30',
    depot: 'Depot B',
    category: 'Retailer',
    status: 'Delivered'},
   {orderNumber: 'X3BSU5GLIKDJCXM',
    trackingNumber: '0JI8NM5P3HZW1BX',
    dateOrdered: '2024-12-29',
    depot: 'Depot E',
    category: 'Corporate Client',
    status: 'Confirmed'},
   {orderNumber: '6H83BAELF8BM13H',
    trackingNumber: '54GUEZYZAOJ0VZV',
    dateOrdered: '2025-01-12',
    depot: 'Depot D',
    category: 'Corporate Client',
    status: 'In Transit'},
   {orderNumber: '0V62NTBHTZ1CZCG',
    trackingNumber: 'J5SZ2YTB9VY17PM',
    dateOrdered: '2025-01-15',
    depot: 'Depot C',
    category: 'Small Business',
    status: 'Picked Up'},
   {orderNumber: 'IBC5GVSOJLOXMD1',
    trackingNumber: 'DE4WA3ROC2D84B2',
    dateOrdered: '2024-12-31',
    depot: 'Depot B',
    category: 'Bulk Buyer',
    status: 'Delivered'},
   {orderNumber: 'J9KWY54FUJSVWZZ',
    trackingNumber: 'K8J3H0ZRO9WTS4V',
    dateOrdered: '2024-12-22',
    depot: 'Depot A',
    category: 'Retailer',
    status: 'Confirmed'},
   {orderNumber: '6IWQSNL3HWU365Z',
    trackingNumber: '1N6BKD9XRNMUA5N',
    dateOrdered: '2025-01-14',
    depot: 'Depot E',
    category: 'Bulk Buyer',
    status: 'In Transit'},
   {orderNumber: 'AHOPK9QF0XCZWNQ',
    trackingNumber: 'BI4AVDT6FTCOFOC',
    dateOrdered: '2024-12-18',
    depot: 'Depot A',
    category: 'Corporate Client',
    status: 'Delivered'},
   {orderNumber: 'N1HVI5CZCGPER14',
    trackingNumber: 'ICVBS6I946KVQLS',
    dateOrdered: '2024-12-15',
    depot: 'Depot C',
    category: 'Corporate Client',
    status: 'Picked Up'}]

const chartConfig = {
  visitors: {
    label: "Visitors",
  },
  chrome: {
    label: "Chrome",
    color: "hsl(var(--chart-1))",
  },
  safari: {
    label: "Safari",
    color: "hsl(var(--chart-2))",
  },
  firefox: {
    label: "Firefox",
    color: "hsl(var(--chart-3))",
  },
  edge: {
    label: "Edge",
    color: "hsl(var(--chart-4))",
  },
  other: {
    label: "Other",
    color: "hsl(var(--chart-5))",
  },
} satisfies ChartConfig

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

  const statusFillMapping: { [key: string]: string } = {
    Delivered: "var(--color-chrome)",
    "Picked Up": "var(--color-safari)",
    Confirmed: "var(--color-firefox)",
    "In Transit": "var(--color-edge)",
    other: "var(--color-other)",
  };

  function getStatusChartData(orders: Order[]): { status: string; count: number; fill: string }[] {
    // Create a map to count the occurrences of each status
    const statusCounts: { [key: string]: number } = {};
  
    // Count occurrences of each status
    orders.forEach((order) => {
      if (statusCounts[order.status]) {
        statusCounts[order.status]++;
      } else {
        statusCounts[order.status] = 1;
      }
    });
  
    // Create chart data with distinct statuses and their corresponding count and fill color
    const chartData = Object.keys(statusCounts).map((status) => ({
      status,
      count: statusCounts[status],
      fill: statusFillMapping[status] || "var(--color-other)", // Default to "other" if status is not mapped
    }));
  
    return chartData;
  }

  function getTotalCount(chartData: { status: string; count: number; fill: string }[]): number {
    let total = 0;
    for (const item of chartData) {
      total += item.count;
    }
    return total;
  }

export function OrderManagement() {
  const [selectedDateRange, setSelectedDateRange] = React.useState<DateRange | undefined>();
  const [selectedDepot, setSelectedDepot] = useState<string | undefined>(undefined);
  const [selectedCategory, setSelectedCategory] = useState<string | undefined>(undefined);

  const handleDateChange = (date: DateRange | undefined) => {
    setSelectedDateRange(date);
    console.log("Selected Date Range:", date); // You can use this data for further processing
  };
    // Handle depot selection
    const handleDepotChange = (value: string) => {
      setSelectedDepot(value);
    };
  
    // Handle category selection
    const handleCategoryChange = (value: string) => {
      setSelectedCategory(value);
    };

  const filteredOrders = filterOrdersByDate(orderUpdates, selectedDateRange?.from?.toLocaleDateString(), selectedDateRange?.to?.toLocaleDateString());
  const distinctDepots = getDistinctDepots(filteredOrders);
  const distinctCategories = getDistinctCategories(filteredOrders);

    // Apply depot filter only if selectedDepot is not undefined
  const filteredByDepot = selectedDepot
  ? filteredOrders.filter((order) => order.depot === selectedDepot)
  : filteredOrders;

  // Apply category filter only if selectedCategory is not undefined
  const filteredByCategory = selectedCategory
  ? filteredByDepot.filter((order) => order.category === selectedCategory)
  : filteredByDepot;

  const chartData = getStatusChartData(filteredByCategory);
  const totalCount = getTotalCount(chartData);
  
  return (
<Card className="flex flex-col">
  <CardHeader className="items-center pb-0">
    <CardTitle>Orders Summary</CardTitle>
  </CardHeader>
  <br/>
  <CardContent className="flex-1 pb-0">
    {/* Flex container for aligning the components in a row */}
    <div className="flex gap-4">
      {/* DatePickerWithRange component */}
      <DatePickerWithRange onDateChange={handleDateChange} />
      
      {/* Depot Select component */}
      <Select value={selectedDepot} onValueChange={handleDepotChange}>
        <SelectTrigger className="w-[180px]">
          <SelectValue placeholder="Select a depot" />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            <SelectLabel>Depots</SelectLabel>
            {distinctDepots.map((depot, index) => (
              <SelectItem key={index} value={depot}>
                {depot}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>

      {/* Category Select component */}
      <Select value={selectedCategory} onValueChange={handleCategoryChange}>
        <SelectTrigger className="w-[180px]">
          <SelectValue placeholder="Select a category" />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            <SelectLabel>Category</SelectLabel>
            {distinctCategories.map((category, index) => (
              <SelectItem key={index} value={category}>
                {category}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
    </div>

    <ChartContainer
          config={chartConfig}
          className="mx-auto aspect-square max-h-[250px]"
        >
          <PieChart>
            <ChartTooltip
              cursor={false}
              content={<ChartTooltipContent hideLabel />}
            />
            <Pie
              data={chartData.length == 0 ? orderUpdates : chartData}
              dataKey="count"
              nameKey="status"
              innerRadius={60}
              strokeWidth={5}
            >
              <Label
                content={({ viewBox }) => {
                  if (viewBox && "cx" in viewBox && "cy" in viewBox) {
                    return (
                      <text
                        x={viewBox.cx}
                        y={viewBox.cy}
                        textAnchor="middle"
                        dominantBaseline="middle"
                      >
                        <tspan
                          x={viewBox.cx}
                          y={viewBox.cy}
                          className="fill-foreground text-3xl font-bold"
                        >
                          {totalCount}
                        </tspan>
                        <tspan
                          x={viewBox.cx}
                          y={(viewBox.cy || 0) + 24}
                          className="fill-muted-foreground"
                        >
                          Orders
                        </tspan>
                      </text>
                    )
                  }
                }}
              />
            </Pie>
          </PieChart>
        </ChartContainer>
  </CardContent>
  <CardFooter className="flex-col gap-2 text-sm">
        <div className="flex items-center gap-2 font-medium leading-none">
        Showing Order by date, depot and category.
        </div>
      </CardFooter>
</Card>

  )
}

/*
        <ChartContainer
          config={chartConfig}
          className="mx-auto aspect-square max-h-[250px]"
        >
          <PieChart>
            <ChartTooltip
              cursor={false}
              content={<ChartTooltipContent hideLabel />}
            />
            <Pie
              data={chartData}
              dataKey="visitors"
              nameKey="browser"
              innerRadius={60}
              strokeWidth={5}
            >
              <Label
                content={({ viewBox }) => {
                  if (viewBox && "cx" in viewBox && "cy" in viewBox) {
                    return (
                      <text
                        x={viewBox.cx}
                        y={viewBox.cy}
                        textAnchor="middle"
                        dominantBaseline="middle"
                      >
                        <tspan
                          x={viewBox.cx}
                          y={viewBox.cy}
                          className="fill-foreground text-3xl font-bold"
                        >
                          {totalVisitors.toLocaleString()}
                        </tspan>
                        <tspan
                          x={viewBox.cx}
                          y={(viewBox.cy || 0) + 24}
                          className="fill-muted-foreground"
                        >
                          Litres
                        </tspan>
                      </text>
                    )
                  }
                }}
              />
            </Pie>
          </PieChart>
        </ChartContainer>


              <CardFooter className="flex-col gap-2 text-sm">
        <div className="flex items-center gap-2 font-medium leading-none">
          Trending up by 5.2% this month <TrendingUp className="h-4 w-4" />
        </div>
        <div className="leading-none text-muted-foreground">
          Showing demand for top products in the last month
        </div>
      </CardFooter>



      const chartData = [
  { browser: "chrome", visitors: 275, fill: "var(--color-chrome)" },
  { browser: "safari", visitors: 200, fill: "var(--color-safari)" },
  { browser: "firefox", visitors: 287, fill: "var(--color-firefox)" },
  { browser: "edge", visitors: 173, fill: "var(--color-edge)" },
  { browser: "other", visitors: 190, fill: "var(--color-other)" },
]

*/
