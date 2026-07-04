import type { CSSProperties, ReactNode } from "react"

export type ChartPoint = {
  label: string
  value: number
  split?: string
}

export function ThemeProvider({
  children,
  theme,
}: {
  children: ReactNode
  theme?: "light" | "dark"
}) {
  return (
    <div className="artifact-theme" data-theme={theme}>
      {children}
    </div>
  )
}

export function SplitBadge({ split }: { split: string }) {
  return <span style={badgeStyle}>{split}</span>
}

export function StatTile({
  label,
  value,
  detail,
}: {
  label: string
  value: string | number
  detail?: string
}) {
  return (
    <section className="kit-panel" style={statStyle}>
      <span style={mutedStyle}>{label}</span>
      <strong style={statValueStyle}>{value}</strong>
      {detail ? <span style={mutedStyle}>{detail}</span> : null}
    </section>
  )
}

export function Table({
  columns,
  rows,
}: {
  columns: string[]
  rows: Array<Record<string, ReactNode>>
}) {
  return (
    <div className="kit-panel" style={{ overflowX: "auto" }}>
      <table style={tableStyle}>
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column} style={thStyle}>{column}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index}>
              {columns.map((column) => (
                <td key={column} style={tdStyle}>{row[column]}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function Chart({
  data,
  type = "bar",
  height = 220,
}: {
  data: ChartPoint[]
  type?: "bar" | "line"
  height?: number
}) {
  const width = 640
  const padding = 28
  const values = data.map((point) => point.value)
  const max = Math.max(1, ...values)
  const innerWidth = width - padding * 2
  const innerHeight = height - padding * 2
  const points = data.map((point, index) => {
    const x = padding + (data.length <= 1 ? innerWidth / 2 : (index / (data.length - 1)) * innerWidth)
    const y = padding + innerHeight - (point.value / max) * innerHeight
    return { ...point, x, y }
  })
  return (
    <figure className="kit-panel" style={chartFrameStyle}>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" style={{ width: "100%", height }}>
        <line x1={padding} x2={width - padding} y1={height - padding} y2={height - padding} stroke="var(--artifact-border)" />
        {type === "line" ? (
          <polyline
            fill="none"
            points={points.map((point) => `${point.x},${point.y}`).join(" ")}
            stroke="var(--artifact-accent)"
            strokeWidth="3"
          />
        ) : null}
        {points.map((point, index) => {
          const barWidth = Math.max(10, innerWidth / Math.max(1, data.length) - 12)
          return type === "bar" ? (
            <rect
              key={point.label}
              fill="var(--artifact-accent)"
              height={height - padding - point.y}
              rx="3"
              width={barWidth}
              x={padding + index * (innerWidth / Math.max(1, data.length)) + 6}
              y={point.y}
            />
          ) : (
            <circle key={point.label} cx={point.x} cy={point.y} fill="var(--artifact-accent)" r="4" />
          )
        })}
      </svg>
      <figcaption style={chartLegendStyle}>
        {data.map((point) => (
          <span key={point.label}>
            {point.label}: <strong>{point.value}</strong>
            {point.split ? <> <SplitBadge split={point.split} /></> : null}
          </span>
        ))}
      </figcaption>
    </figure>
  )
}

export function ReceiptFooter({
  effort,
  receipts,
  sha256,
  note,
}: {
  effort?: string
  receipts?: string[]
  sha256?: string
  note?: string
}) {
  return (
    <footer className="kit-panel" style={receiptStyle}>
      {effort ? <span>effort: <code>{effort}</code></span> : null}
      {sha256 ? <span>sha256: <code>{sha256}</code></span> : null}
      {receipts?.length ? (
        <span>receipts: {receipts.map((receipt) => <code key={receipt}>{receipt}</code>)}</span>
      ) : null}
      {note ? <span>{note}</span> : null}
    </footer>
  )
}

const mutedStyle: CSSProperties = {
  color: "var(--artifact-muted)",
}

const badgeStyle: CSSProperties = {
  border: "1px solid var(--artifact-border)",
  borderRadius: "999px",
  color: "var(--artifact-muted)",
  display: "inline-flex",
  fontSize: 12,
  marginLeft: 6,
  padding: "1px 6px",
}

const statStyle: CSSProperties = {
  display: "grid",
  gap: 6,
  padding: 16,
}

const statValueStyle: CSSProperties = {
  fontSize: 28,
}

const tableStyle: CSSProperties = {
  borderCollapse: "collapse",
  width: "100%",
}

const thStyle: CSSProperties = {
  borderBottom: "1px solid var(--artifact-border)",
  color: "var(--artifact-muted)",
  padding: 10,
  textAlign: "left",
}

const tdStyle: CSSProperties = {
  borderBottom: "1px solid var(--artifact-border)",
  padding: 10,
}

const chartFrameStyle: CSSProperties = {
  margin: 0,
  padding: 16,
}

const chartLegendStyle: CSSProperties = {
  color: "var(--artifact-muted)",
  display: "flex",
  flexWrap: "wrap",
  gap: 12,
}

const receiptStyle: CSSProperties = {
  color: "var(--artifact-muted)",
  display: "grid",
  gap: 6,
  marginTop: 24,
  padding: 12,
}
