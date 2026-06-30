import { Box, StyledText, Text } from "@opentui/core"

/** Bottom-anchor transcript text so short turns sit above the input, not below a flex gap. */
export function anchorTranscriptBox(content: StyledText, flexGrow = 1): ReturnType<typeof Box> {
  return Box(
    {
      flexDirection: "column",
      flexGrow,
      flexShrink: 1,
      minHeight: 0,
      justifyContent: "flex-end",
      overflow: "hidden",
    },
    Text({
      content,
      flexShrink: 0,
    }),
  )
}
