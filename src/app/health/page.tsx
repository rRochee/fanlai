"use client"

import { useState } from "react"

export default function HealthPage() {
  const [n, setN] = useState(0)
  return (
    <div style={{ padding: 40, fontFamily: "monospace" }}>
      <p id="health-marker">health ok</p>
      <button id="health-btn" onClick={() => setN((v) => v + 1)}>
        clicked {n}
      </button>
    </div>
  )
}
