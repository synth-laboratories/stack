import { readFileSync } from "node:fs"
import { join } from "node:path"
import { Chart, ReceiptFooter, SplitBadge, StatTile, Table, ThemeProvider } from "@/components/kit"

type ArtifactData = {
  effort?: string
  sha256?: string
  receipts?: string[]
  rows: Array<{
    candidate: string
    split: string
    score: number
    note?: string
  }>
}

export default function ArtifactPage() {
  const data = JSON.parse(
    readFileSync(join(process.cwd(), "..", "data", "REPLACE_SLUG", "data.json"), "utf8"),
  ) as ArtifactData
  const chartData = data.rows.map((row) => ({
    label: row.candidate,
    value: row.score,
    split: row.split,
  }))

  return (
    <ThemeProvider>
      <main style={{ display: "grid", gap: 24, margin: "0 auto", maxWidth: 1040, padding: 32 }}>
        <header>
          <h1>Replace with artifact title</h1>
          <p>Replace with the concrete claim this page proves.</p>
        </header>
        <section style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>
          {data.rows.map((row) => (
            <StatTile
              key={`${row.candidate}-${row.split}`}
              label={row.candidate}
              value={row.score}
              detail={`split ${row.split}`}
            />
          ))}
        </section>
        <Chart data={chartData} type="bar" />
        <Table
          columns={["candidate", "split", "score", "note"]}
          rows={data.rows.map((row) => ({
            candidate: row.candidate,
            split: <SplitBadge split={row.split} />,
            score: row.score,
            note: row.note ?? "",
          }))}
        />
        <ReceiptFooter effort={data.effort} receipts={data.receipts} sha256={data.sha256} />
      </main>
    </ThemeProvider>
  )
}
