# Artifact Kit API

Import from `@/components/kit` inside Artifact Site pages.

```tsx
import { Chart, ReceiptFooter, SplitBadge, StatTile, Table, ThemeProvider } from "@/components/kit"
```

## Components

- `ThemeProvider({ theme?: "light" | "dark", children })`: wraps a page or section with a theme override. Omit `theme` to use `prefers-color-scheme`.
- `Chart({ data, type?, height? })`: inline SVG bar or line chart. `data` entries are `{ label, value, split? }`.
- `Table({ columns, rows })`: simple server-rendered table. `rows` are records keyed by column.
- `StatTile({ label, value, detail? })`: compact metric tile.
- `SplitBadge({ split })`: small split label for metrics.
- `ReceiptFooter({ effort?, receipts?, sha256?, note? })`: required footer for publishable proof pages.

## Rules

- Keep components server-renderable; do not add browser APIs at module top level.
- Scores must carry split labels in the nearby text, table column, `SplitBadge`, or chart data.
- Use local data files only. Do not fetch remote APIs or load remote scripts/images from the page.
