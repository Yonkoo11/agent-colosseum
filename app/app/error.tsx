"use client"

import { useEffect } from "react"

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error("Page error:", error)
  }, [error])

  return (
    <main style={{ minHeight: "60vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ textAlign: "center" }}>
        <h2 style={{ fontSize: "1.5rem", marginBottom: "0.5rem" }}>Something went wrong</h2>
        <p style={{ color: "var(--color-text-secondary, #888)", marginBottom: "1.5rem" }}>
          {error.message || "Failed to load data"}
        </p>
        <button
          onClick={reset}
          style={{
            padding: "0.5rem 1.5rem",
            background: "var(--color-accent, #f59e0b)",
            color: "#000",
            border: "none",
            borderRadius: "6px",
            cursor: "pointer",
            fontWeight: 600,
          }}
        >
          Try again
        </button>
      </div>
    </main>
  )
}
