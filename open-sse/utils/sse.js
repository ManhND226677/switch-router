export function sseChunk(data) {
  return `data: ${JSON.stringify(data)}\n\n`;
}
