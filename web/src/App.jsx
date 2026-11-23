import { Suspense, lazy, useEffect, useRef, useState } from "react";
import { askStream, getInfo, search } from "./api.js";
import { Answer, LiveAnswer } from "./components/Answer.jsx";
import { EmptyState } from "./components/EmptyState.jsx";
import { Header } from "./components/Header.jsx";
import { HowItWorks } from "./components/HowItWorks.jsx";
import { Inference } from "./components/Inference.jsx";
import { Passage } from "./components/Passage.jsx";
import { Icon } from "./icons.jsx";

const Space = lazy(() => import("./space/Space.jsx")); // three.js only loads when you enter

const fmt = (n) => Number(n || 0).toLocaleString("en-US");
const ACRONYMS = /\b(ai|ml|nlp|llm|rag)\b/g;

function useTheme() {
  const read = () => { try { return localStorage.getItem("theme"); } catch { return null; } };
  const [theme, setTheme] = useState(read);
  const systemDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  const dark = theme ? theme === "dark" : systemDark;
  useEffect(() => {
    if (theme) document.documentElement.dataset.theme = theme;
    else delete document.documentElement.dataset.theme;
  }, [theme]);
  const toggle = () => {
    const next = dark ? "light" : "dark";
    try { localStorage.setItem("theme", next); } catch { /* private mode: theme just isn't remembered */ }
    setTheme(next);
  };
  return [dark, toggle];
}

export default function App() {
  const [dark, toggleTheme] = useTheme();
  const [info, setInfo] = useState(null);
  const [infoError, setInfoError] = useState(false);
  const [mode, setMode] = useState("ask");
  const [question, setQuestion] = useState("");
  const [k, setK] = useState(5);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState(null); // {kind: "info" | "error", icon, text}
  const [view, setView] = useState({ kind: "empty" });
  const [page, setPage] = useState("ask");
  // Kept for this tab only, so a reload doesn't blank the explainer pages.
  const [lastRun, setLastRunState] = useState(() => { try { return JSON.parse(sessionStorage.getItem("lastRun")); } catch { return null; } });
  const setLastRun = (run) => { setLastRunState(run); try { sessionStorage.setItem("lastRun", JSON.stringify(run)); } catch { /* storage full or blocked */ } };
  const input = useRef(null);
  const abort = useRef(null);

  useEffect(() => { getInfo().then(setInfo).catch(() => setInfoError(true)); }, []);
  useEffect(() => { window.scrollTo(0, 0); }, [page]); // each page opens at its top, including back on the assistant
  useEffect(() => {
    const focus = (e) => { if (e.key === "/" && document.activeElement !== input.current) { e.preventDefault(); input.current.focus(); } };
    document.addEventListener("keydown", focus);
    return () => document.removeEventListener("keydown", focus);
  }, []);

  async function ask(q) {
    let draft = "";
    const steps = {};
    setView({ kind: "live", draft, steps: {} });
    const started = performance.now();
    let ttft = null; // first visible token, as the browser saw it
    const at = {}; // when each step event arrived, ms after sending
    await askStream(q, (event) => {
      if (event.type === "token") { ttft ??= performance.now() - started; draft += event.text; setView({ kind: "live", draft, steps: { ...steps } }); }
      if (event.type === "step") { at[event.step] = performance.now() - started; steps[event.step] = event; setView({ kind: "live", draft, steps: { ...steps } }); }
      if (event.type === "error") throw new Error(event.error);
      if (event.type === "result") {
        const replaced = draft.trim() && draft.trim() !== event.result.answer.trim();
        setView({ kind: "answer", result: event.result, replacedDraft: !!replaced });
        setLastRun({ ...event.result, client: { ttft, at, total: performance.now() - started } });
        setStatus({ kind: "info", icon: "check", text: `Done in ${fmt(Math.round(performance.now() - started))} ms` });
      }
    }, abort.current.signal);
  }

  async function searchOnly(q) {
    const started = performance.now();
    const hits = await search(q, k);
    setView({ kind: "search", hits });
    setStatus(hits.length ? { kind: "info", icon: "search", text: `${hits.length} passages · ${fmt(Math.round(performance.now() - started))} ms · no model called` } : null);
  }

  async function submit(e) {
    e?.preventDefault();
    const q = question.trim();
    if (!q) { setStatus({ kind: "error", icon: "alert", text: "Enter a question first." }); input.current.focus(); return; }
    abort.current?.abort();
    abort.current = new AbortController();
    setBusy(true);
    setStatus({ kind: "info", icon: "clock", text: mode === "ask" ? "Checking the question, retrieving passages and writing a grounded answer…" : "Searching…" });
    try {
      await (mode === "ask" ? ask(q) : searchOnly(q));
    } catch (err) {
      if (err.name === "AbortError") return;
      setStatus({ kind: "error", icon: "alert", text: `${err.message}. Check that the index is built and the model settings in .env are correct.` });
      setView({ kind: "none" });
    } finally {
      setBusy(false);
    }
  }

  const pickTopic = (t) => { setQuestion(`Explain ${t.toLowerCase().replace(ACRONYMS, (m) => m.toUpperCase())}.`); input.current.focus(); };

  if (page === "space") {
    return (
      <Suspense fallback={<div className="space"><div className="sp-loading sp-glass">Loading the 3D world…</div></div>}>
        <Space lastRun={lastRun} llm={info?.llm ?? "GPT Sol 6"} onExit={() => setPage("ask")} />
      </Suspense>
    );
  }

  return (
    <div className={`wrap${page === "ask" ? "" : " wide"}`}>
      <Header info={info} error={infoError} dark={dark} onToggleTheme={toggleTheme} page={page} onPage={setPage} />
      {page === "how" && <HowItWorks lastRun={lastRun} llm={info?.llm ?? "GPT Sol 6"} onBack={() => setPage("ask")} />}
      {page === "inference" && <Inference lastRun={lastRun} llm={info?.llm ?? "GPT Sol 6"} onBack={() => setPage("ask")} />}
      {page === "ask" && <>
      <form onSubmit={submit}>
        <label className="sr-only" htmlFor="q">Question</label>
        <textarea id="q" ref={input} dir="auto" maxLength={1000} rows={2} autoFocus value={question}
          placeholder="Ask in Arabic or English… / اكتب سؤالك بالعربية أو الإنجليزية"
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) submit(e); }} />
        <div className="controls">
          <div className="seg" role="group" aria-label="Mode">
            <button type="button" aria-pressed={mode === "ask"} onClick={() => setMode("ask")}><Icon name="sparkles" />Answer</button>
            <button type="button" aria-pressed={mode === "search"} onClick={() => setMode("search")}><Icon name="search" />Search only</button>
          </div>
          {mode === "search" && (
            <select aria-label="Number of passages" value={k} onChange={(e) => setK(Number(e.target.value))}>
              {[3, 5, 10].map((n) => <option key={n} value={n}>Top {n}</option>)}
            </select>
          )}
          <span className="count">{question.length} / 1000</span>
          <button className="go" type="submit" disabled={busy}>
            <Icon name={mode === "ask" ? "send" : "search"} /><span>{mode === "ask" ? "Ask" : "Search"}</span>
          </button>
        </div>
      </form>

      <div className={`status${status?.kind === "error" ? " error" : ""}`} aria-live="polite">
        {status && <><Icon name={status.icon} />{status.text}</>}
      </div>

      {view.kind === "empty" && <EmptyState topics={info?.topics ?? []} onTopic={pickTopic} />}
      {view.kind === "live" && <LiveAnswer draft={view.draft} steps={view.steps} llm={info?.llm ?? "GPT Sol 6"} />}
      {view.kind === "answer" && <Answer key={view.result.trace_url ?? view.result.answer} result={view.result} replacedDraft={view.replacedDraft} />}
      {view.kind === "search" && (view.hits.length
        ? view.hits.map((h, i) => <Passage key={h.chunk_id} hit={h} rank={i + 1} topScore={view.hits[0].score} />)
        : <EmptyState topics={[]} message="No matching passages. Try other words, or the other language." />)}
      </>}

      <footer>Guard (Arbiter) → hybrid retrieval → generation → grounding checks · <kbd>Ctrl</kbd> + <kbd>Enter</kbd> to send · <kbd>/</kbd> to focus</footer>
    </div>
  );
}
