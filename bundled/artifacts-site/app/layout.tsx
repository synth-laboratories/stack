import type { ReactNode } from "react"
import "./globals.css"

export const metadata = {
  title: "Artifact Site",
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
