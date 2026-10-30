// Reads a text/event-stream response and calls onData with each event's data. Stops when the stream ends or signal aborts.
export async function consumeSseResponse(response: Response, onData: (raw: string) => void, signal: AbortSignal): Promise<void> {
  if (!response.body) throw new Error("SSE stream body is not available.")

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ""

  while (!signal.aborted) {
    const { value, done } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n")

    let splitAt = buffer.indexOf("\n\n")
    while (splitAt >= 0) {
      const block = buffer.slice(0, splitAt)
      buffer = buffer.slice(splitAt + 2)

      const dataLines = block
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trimStart())
      if (dataLines.length > 0) onData(dataLines.join("\n"))

      splitAt = buffer.indexOf("\n\n")
    }
  }
}
