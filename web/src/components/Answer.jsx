import * as HoverCard from "@radix-ui/react-hover-card";
import { motion } from "motion/react";
import { toast } from "sonner";
import { Icon } from "../icons.jsx";
import { pageTitle, relatedQuestions, siteName } from "../sources.js";
import { Favicon } from "./Favicon.jsx";

export const CITATION = /\s?\[([^[\]\s#]+#\d+)\]/g;
const fmt = (n) => Number(n || 0).toLocaleString("en-US");
const secs = (ms) => `${(ms / 1000).toFixed(1)} s`;

export function outcome(r) {
  if (r.verdict === "unsafe") return ["b-bad", "shield-x", "Refused: unsafe request"];
  if (r.verdict === "too_long") return ["b-bad", "shield-x", "Refused: question too long"];
  if (r.verdict === "out_of_scope") return ["b-info", "info", "Declined: outside the documents"];
  if (r.checks.idk) return ["b-info", "help", "Not in the documents"];
  if (!r.checks.citations_ok) return ["b-warn", "alert", "Replaced: answer was not grounded"];
  if (!r.checks.numbers_ok || !r.checks.lang_ok) return ["b-warn", "alert", "Answered with warnings"];
  return ["b-ok", "shield-check", "Grounded answer"];
}

/* ---------- Answer text: paragraphs, lists, headings, **bold** and numbered citations ---------- */

function blocks(text) {
  const out = [];
  let para = [];
  let list = null;
  const flushPara = () => { if (para.length) { out.push({ type: "p", text: para.join(" ") }); para = []; } };
  const flushList = () => { if (list) { out.push(list); list = null; } };
  for (const raw of text.replace(/\r/g, "").split("\n")) {
    const line = raw.trim();
    if (!line) { flushPara(); flushList(); continue; }
    const bullet = line.match(/^[-*•]\s+(.*)$/);
    const numbered = line.match(/^\d+[.)]\s+(.*)$/);
    if (bullet || numbered) {
      flushPara();
      const type = bullet ? "ul" : "ol";
      if (list?.type !== type) { flushList(); list = { type, items: [] }; }
      list.items.push((bullet ?? numbered)[1]);
      continue;
    }
    const heading = line.match(/^#{1,4}\s+(.*)$/);
    if (heading) { flushPara(); flushList(); out.push({ type: "h", text: heading[1] }); continue; }
    flushList();
    para.push(line);
  }
  flushPara();
  flushList();
  return out;
}

function Cite({ id, hit, n, onCite }) {
  if (!hit) return <sup className="cite bad" title={`[${id}] does not match a retrieved passage`}>?</sup>;
  const text = hit.content ?? hit.excerpt;
  return (
    <HoverCard.Root openDelay={120} closeDelay={80}>
      <HoverCard.Trigger asChild>
        <button className="cite" type="button" onClick={() => onCite(id)} aria-label={`Source ${n}: ${pageTitle(hit)}`}>{n}</button>
      </HoverCard.Trigger>
      <HoverCard.Portal>
        <HoverCard.Content className="popover cite-pop" side="top" sideOffset={6} collisionPadding={12}>
          <div className="cite-pop-head"><Favicon hit={hit} /><span className="site">{siteName(hit)}</span><span className="num-badge">{n}</span></div>
          <b className="cite-pop-title">{pageTitle(hit)}</b>
          <p dir="auto">{text.slice(0, 300)}{text.length > 300 ? "…" : ""}</p>
        </HoverCard.Content>
      </HoverCard.Portal>
    </HoverCard.Root>
  );
}

function inline(text, ctx, keyBase) {
  const parts = [];
  let last = 0;
  const pushText = (s, k) => {
    s.split(/(\*\*[^*]+\*\*)/g).forEach((piece, i) => {
      if (!piece) return;
      parts.push(piece.startsWith("**") && piece.endsWith("**") ? <strong key={`${k}-${i}`}>{piece.slice(2, -2)}</strong> : piece);
    });
  };
  for (const m of text.matchAll(CITATION)) {
    pushText(text.slice(last, m.index), `${keyBase}-t${m.index}`);
    const [hit, n] = ctx.rank.get(m[1]) ?? [];
    parts.push(<Cite key={`${keyBase}-c${m.index}`} id={m[1]} hit={hit} n={n} onCite={ctx.onCite} />);
    last = m.index + m[0].length;
  }
  pushText(text.slice(last), `${keyBase}-end`);
  return parts;
}

/** The streamed draft: citations (complete or half-written) and an unclosed ** are hidden until the text settles. */
export function cleanDraft(text) {
  let t = text.replace(CITATION, "").replace(/\s?\[[^\]]*$/, "");
  if ((t.match(/\*\*/g) || []).length % 2) t = t.replace(/\*\*(?!.*\*\*)/s, "");
  return t;
}

export function AnswerText({ text, sources, onCite, className = "" }) {
  const ctx = { rank: new Map(sources.map((s, i) => [s.chunk_id, [s, i + 1]])), onCite };
  return (
    <div className={`answer prose ${className}`} dir="auto">
      {blocks(text).map((b, i) => {
        if (b.type === "h") return <h3 key={i} dir="auto">{inline(b.text, ctx, i)}</h3>;
        if (b.type === "p") return <p key={i} dir="auto">{inline(b.text, ctx, i)}</p>;
        const List = b.type;
        return <List key={i} dir="auto">{b.items.map((it, j) => <li key={j}>{inline(it, ctx, `${i}-${j}`)}</li>)}</List>;
      })}
    </div>
  );
}

/* ---------- Sources strip (above the answer) ---------- */

export function SourceStrip({ sources, onMore, loading }) {
  if (loading) {
    return <div className="source-strip">{[0, 1, 2].map((i) => <div key={i} className="src-card skel"><i /><i /><i /></div>)}</div>;
  }
  if (!sources.length) return null;
  // One card per page: passages from the same page share a card that lists all their citation numbers.
  const pages = [];
  const byPage = new Map();
  sources.forEach((s, i) => {
    let page = byPage.get(s.source);
    if (!page) { page = { hit: s, nums: [], cited: false }; byPage.set(s.source, page); pages.push(page); }
    page.nums.push(i + 1);
    page.cited ||= !!s.cited;
  });
  const ordered = [...pages].sort((a, b) => Number(b.cited) - Number(a.cited));
  const shown = ordered.slice(0, pages.length > 4 ? 3 : 4);
  const rest = ordered.slice(shown.length);
  return (
    <div className="source-strip">
      {shown.map(({ hit: s, nums, cited }, i) => {
        const Tag = s.source_type === "url" ? "a" : "button";
        const link = s.source_type === "url" ? { href: s.source, target: "_blank", rel: "noopener noreferrer" } : { type: "button", onClick: onMore };
        return (
          <motion.div key={s.source} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}>
            <Tag className={`src-card${cited ? " cited" : ""}`} title={(s.content ?? s.excerpt).slice(0, 200)} {...link}>
              <span className="src-title" dir="auto">{pageTitle(s)}</span>
              <span className="src-foot"><Favicon hit={s} size={14} /><span className="src-site">{siteName(s)}</span><span className="src-n">{nums.join(" · ")}</span></span>
            </Tag>
          </motion.div>
        );
      })}
      {rest.length > 0 && (
        <button type="button" className="src-card more" onClick={onMore}>
          <span className="favicons">{rest.slice(0, 3).map((p) => <Favicon key={p.hit.source} hit={p.hit} size={14} />)}</span>
          <span className="src-site">View {rest.length} more {rest.length === 1 ? "page" : "pages"}</span>
        </button>
      )}
    </div>
  );
}

/* ---------- Live progress while the pipeline runs ---------- */

const STEPS = [
  ["guard", "Checking the question", "Question passed the guard", "Refused by the guard"],
  ["retrieve", "Searching the knowledge base", "Found relevant passages", "No passages found"],
  ["generate", "Writing the answer", "Answer written", "Skipped: nothing answers this"],
  ["check", "Verifying citations, numbers and language", "Citations verified", "Checked, with warnings"],
];

export function Progress({ steps, chunks }) {
  const refused = steps.guard?.status === "refused";
  const current = refused ? null : STEPS.find(([id]) => !steps[id])?.[0];
  return (
    <ol className="progress">
      {STEPS.map(([id, doing, done, bad]) => {
        const step = steps[id];
        if (refused && id !== "guard") return null;
        const state = step ? (["refused", "empty", "skipped", "warning"].includes(step.status) ? "bad" : "done") : id === current ? "active" : "pending";
        const label = step ? (state === "bad" ? bad : done) : id === "retrieve" && chunks ? `Searching ${fmt(chunks)} passages` : doing;
        return (
          <li key={id} className={state}>
            <span className="p-ico">{state === "active" ? <span className="spinner" /> : state === "done" ? <Icon name="check" size="xs" /> : state === "bad" ? <Icon name="alert" size="xs" /> : <i />}</span>
            <span>{label}</span>
            {step?.ms != null && <em>{step.ms >= 1000 ? secs(step.ms) : `${Math.round(step.ms)} ms`}</em>}
          </li>
        );
      })}
    </ol>
  );
}

/* ---------- Actions and related topics (below the answer) ---------- */

export function ActionBar({ result: r, onRetry, onSteps }) {
  const u = r.usage || {};
  const copy = () => { navigator.clipboard?.writeText(r.answer); toast.success("Answer copied"); };
  return (
    <div className="action-bar">
      <button type="button" className="act" onClick={copy}><Icon name="copy" /><span>Copy</span></button>
      <button type="button" className="act" onClick={onRetry}><Icon name="retry" /><span>Ask again</span></button>
      <button type="button" className="act" onClick={onSteps}><Icon name="workflow" /><span>Steps</span></button>
      {r.trace_url && <a className="act" href={r.trace_url} target="_blank" rel="noopener noreferrer"><Icon name="activity" /><span>Trace</span></a>}
      <span className="act-meta">
        <span><Icon name="clock" size="xs" />{secs(r.timings.total)}</span>
        {u.input_tokens ? <span><Icon name="hash" size="xs" />{fmt(u.input_tokens + (u.output_tokens || 0))} tokens</span> : null}
      </span>
    </div>
  );
}

export function Related({ result: r, onAsk }) {
  const questions = relatedQuestions(r.sources, r.question);
  // Suggestions are built from English page titles, so they are only offered under English answers.
  if (r.verdict !== "in_scope" || r.lang === "ar" || !questions.length) return null;
  return (
    <section className="related" aria-label="Related">
      <h4><Icon name="layers" />Related</h4>
      {questions.map((q) => (
        <button key={q} type="button" onClick={() => onAsk(q)}>
          <span dir="auto">{q}</span><Icon name="plus" />
        </button>
      ))}
    </section>
  );
}
