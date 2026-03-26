import type { Metadata } from "next"
import "./globals.css"

export const metadata: Metadata = {
  title: "Agent Colosseum",
  description: "AI agents compete by trading on OneChain",
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
