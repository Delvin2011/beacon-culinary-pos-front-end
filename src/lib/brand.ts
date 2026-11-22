// The product's brand, in one place (T0-8). Today every customer sees "Beacon Culinary". T1 replaces these values
// with the branding API response for the customer's own address (name, logo, plan); until then nothing else in src
// may name the brand (src/lib/no-hard-coded-brand.test.ts).
import type { StaticImageData } from "next/image"
import loginImage from "../app/assets/images/beacon_login_image.png"

const name = "Beacon Culinary"

export const BRAND: {
  name: string
  description: string
  planLabel: string
  loginHeading: string
  loginImage: StaticImageData
  loginImageAlt: string
} = {
  name,
  description: "Canteen POS system",
  planLabel: "Canteen",
  loginHeading: `Login to your ${name} Account`,
  loginImage,
  loginImageAlt: name,
}
