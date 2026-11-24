// Presentation helpers for retrieved sources: site name, a readable page title, the site's favicon, and topics.

const SITES = {
  "aws.amazon.com": "AWS",
  "learn.microsoft.com": "Microsoft Learn",
  "oracle.com": "Oracle",
  "ibm.com": "IBM",
  "cloud.google.com": "Google Cloud",
  "developers.google.com": "Google Developers",
  "en.wikipedia.org": "Wikipedia",
  "ar.wikipedia.org": "ويكيبيديا",
};
const ACRONYMS = new Set(["ai", "ml", "nlp", "llm", "llms", "rag", "api", "gpt", "gan", "gans", "mlops", "aws", "iot"]);

function url(hit) {
  try { return hit.source_type === "url" ? new URL(hit.source) : null; } catch { return null; }
}

export function hostOf(hit) {
  return url(hit)?.hostname.replace(/^www\./, "") ?? null;
}

/** "AWS", "Microsoft Learn", …, else the bare host name, or "Local file". */
export function siteName(hit) {
  const host = hostOf(hit);
  return host ? SITES[host] ?? host : "Local file";
}

const humanize = (slug) => {
  const words = slug.replace(/\.[a-z0-9]+$/i, "").replace(/[_-]+/g, " ").trim().split(/\s+/)
    .map((w) => (ACRONYMS.has(w.toLowerCase()) ? w.toUpperCase() : w.toLowerCase()));
  const text = words.join(" ").replace(/^concept /, "");
  return text ? text[0].toUpperCase() + text.slice(1) : "";
};

/** A readable title from the URL path ("…/what-is/machine-learning/" → "Machine learning") or the file name. */
export function pageTitle(hit) {
  const u = url(hit);
  const last = u ? u.pathname.split("/").filter(Boolean).pop() ?? u.hostname : hit.source.split(/[\\/]/).pop();
  return humanize(decodeURIComponent(last ?? "")) || hit.source;
}

/** The site's own favicon (the browser fetches it from that site; the UI falls back to an icon if it fails). */
export function faviconUrl(hit) {
  const u = url(hit);
  return u ? `${u.origin}/favicon.ico` : null;
}

/** Distinct follow-up questions from the sources' topics, for "Related" (de-duplicated on the question itself). */
export function relatedQuestions(sources, question, max = 4) {
  const norm = (s) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  const asked = norm(question);
  const seen = new Set([asked]);
  const out = [];
  for (const s of sources) {
    const title = pageTitle(s);
    if (!title || asked.includes(norm(title))) continue;
    const q = asQuestion(title);
    if (seen.has(norm(q))) continue;
    seen.add(norm(q));
    out.push(q);
    if (out.length >= max) break;
  }
  return out;
}

/** An icon and a hue for a topic tile, picked from keywords so the grid looks intentional. */
const TOPIC_ICONS = [
  [/agent|agentic/, "bot"], [/health|medic/, "heart"], [/vision|image|recognition/, "eye"],
  [/chat|conversation/, "chat"], [/translation|language|nlp|gpt|llm|text/, "languages"], [/anomal|fraud/, "radar"],
  [/regression|forecast|predict/, "trend"], [/embedding|vector|feature/, "boxes"], [/rag|retrieval|langchain|search/, "link"],
  [/mlops|pipeline|ops/, "workflow"], [/data|mining|label/, "database"], [/generative|gan|foundation|diffusion/, "sparkles"],
  [/neural|deep|learning|intelligence|ai\b/, "brain"],
];
export function topicIcon(topic) {
  const t = topic.toLowerCase();
  return TOPIC_ICONS.find(([re]) => re.test(t))?.[1] ?? "book";
}
export function topicHue(topic) {
  let h = 0;
  for (const c of topic) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h % 6; // six tile colours in CSS: .hue-0 … .hue-5
}

/** "Generative AI" -> "What is generative AI?"; titles that are already questions keep their wording. */
export function asQuestion(topic) {
  if (/^(what|how|why|when|which|who)\b/i.test(topic)) return topic.replace(/\?*$/, "?");
  // Lower-case the first letter unless the first word is an acronym ("AI agents", "GANs", "NLP").
  const phrase = (t) => (/^[A-Z0-9]{2}/.test(t) ? t : t[0].toLowerCase() + t.slice(1));
  topic = topic.split(/\s+/).map((w) => (ACRONYMS.has(w.toLowerCase()) ? w.toUpperCase() : w)).join(" ");
  if (ACRONYMS.has(topic.toLowerCase())) return `What is ${topic}?`;
  const vs = topic.split(/\s+vs\.?\s+/i);
  if (vs.length === 2) return `What is the difference between ${phrase(vs[0])} and ${phrase(vs[1])}?`;
  const plural = /[^s'iu]s$/i.test(topic.split(/\s+/).pop()); // "AI agents" -> are; "analysis", "status" -> is
  return `What ${plural ? "are" : "is"} ${phrase(topic)}?`;
}
