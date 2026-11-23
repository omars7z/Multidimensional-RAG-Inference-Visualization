// Thin client for the Python server (ui.py). Same origin in production; proxied by Vite in dev.

async function json(res) {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Server error (${res.status})`);
  return data;
}

export const getInfo = () => fetch("/api/info").then(json);

/** Retrieval internals for one question (tokens, vector, rankings, 2D map); local only, no model calls. */
export const inspect = (q) => fetch(`/api/inspect?q=${encodeURIComponent(q)}`).then(json);

export const search = (q, k) => fetch(`/api/search?q=${encodeURIComponent(q)}&k=${k}`).then(json);

/** POST the question and call onEvent for every NDJSON event: step, token, result or error. */
export async function askStream(question, onEvent, signal) {
  const res = await fetch("/api/ask/stream", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question }),
    signal,
  });
  if (!res.ok) await json(res);
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value;
    let newline;
    while ((newline = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (line) onEvent(JSON.parse(line));
    }
  }
}
