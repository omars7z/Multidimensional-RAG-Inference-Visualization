import { Suspense, lazy, useEffect, useRef, useState } from "react";
import { Toaster } from "sonner";
import { askStream, getInfo, search } from "./api.js";
import { Composer } from "./components/Composer.jsx";
import { Welcome } from "./components/EmptyState.jsx";
import { HowItWorks } from "./components/HowItWorks.jsx";
import { Inference } from "./components/Inference.jsx";
import { Sidebar } from "./components/Sidebar.jsx";
import { Turn } from "./components/Turn.jsx";

const Space = lazy(() => import("./space/Space.jsx")); // three.js only loads when you enter

const ACRONYMS = /\b(ai|ml|nlp|llm|rag)\b/g;
const RECENT_KEY = "recentQuestions";
const RECENT_MAX = 12;
const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

/** Browser storage that never throws (private mode, blocked or full storage just means nothing is remembered). */
const store = {
  get(area, key) { try { return JSON.parse(window[area].getItem(key)); } catch { return null; } },
  set(area, key, value) { try { window[area].setItem(key, JSON.stringify(value)); } catch { /* not remembered */ } },
};

function useTheme() {
  const [theme, setTheme] = useState(() => { try { return localStorage.getItem("theme"); } catch { return null; } });
  const systemDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  const dark = theme ? theme === "dark" : systemDark;
  useEffect(() => {
    if (theme) document.documentElement.dataset.theme = theme;
    else delete document.documentElement.dataset.theme;
  }, [theme]);
  const toggle = () => {
    const next = dark ? "light" : "dark";
    try { localStorage.setItem("theme", next); } catch { /* not remembered */ }
    setTheme(next);
  };
  return [dark, toggle];
}

/** Soft colour fields, a fading grid and grain behind everything, so the page has depth instead of a flat fill. */
function Backdrop() {
  return <div className="backdrop" aria-hidden="true"><i className="b1" /><i className="b2" /><i className="b3" /><i className="grid" /><i className="grain" /></div>;
}

export default function App() {
  const [dark, toggleTheme] = useTheme();
  const [info, setInfo] = useState(null);
  const [infoError, setInfoError] = useState(false);
  const [page, setPage] = useState("ask");
  const [drawer, setDrawer] = useState(false);
  const [mode, setMode] = useState("ask");
  const [k, setK] = useState(5);
  const [question, setQuestion] = useState("");
  const [thread, setThread] = useState([]);
  const [busy, setBusy] = useState(false);
  const [announce, setAnnounce] = useState("");
  const [recent, setRecent] = useState(() => store.get("localStorage", RECENT_KEY) ?? []);
  const [activeId, setActiveId] = useState(null);
  // The last answer feeds the explainer pages; kept for this tab so a reload doesn't blank them.
  const [lastRun, setLastRunState] = useState(() => store.get("sessionStorage", "lastRun"));
  const setLastRun = (run) => { setLastRunState(run); store.set("sessionStorage", "lastRun", run); };
  const input = useRef(null);
  const abort = useRef(null);
  const liveId = useRef(null);

  useEffect(() => { getInfo().then(setInfo).catch(() => setInfoError(true)); }, []);
  useEffect(() => { window.scrollTo(0, 0); setDrawer(false); }, [page]);
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") setDrawer(false);
      if (e.key === "/" && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName)) { e.preventDefault(); input.current?.focus(); }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const update = (id, patch) => setThread((all) => all.map((t) => (t.id === id ? { ...t, ...(typeof patch === "function" ? patch(t) : patch) } : t)));

  function remember(turn) {
    const entry = { id: turn.id, q: turn.q, mode: turn.mode, verdict: turn.mode === "search" ? "search" : turn.result?.verdict,
      turn: { id: turn.id, q: turn.q, mode: turn.mode, state: "done", result: turn.result, hits: turn.hits, ms: turn.ms,
        replacedDraft: turn.replacedDraft, draft: "", steps: {} } };
    setRecent((list) => {
      const next = [entry, ...list.filter((r) => r.q !== turn.q || r.mode !== turn.mode)].slice(0, RECENT_MAX);
      store.set("localStorage", RECENT_KEY, next);
      return next;
    });
  }

  async function run(q, runMode = mode) {
    q = q.trim();
    if (!q || q.length > 1000) return;
    abort.current?.abort();
    if (liveId.current) update(liveId.current, (t) => (t.state === "live" ? { state: "stopped" } : {}));
    const controller = new AbortController();
    abort.current = controller;
    const id = newId();
    liveId.current = id;
    const turn = { id, q, mode: runMode, state: "live", draft: "", steps: {}, result: null, hits: [], error: null, ms: 0 };
    setThread((all) => [...all, turn]);
    setActiveId(id);
    setQuestion("");
    setPage("ask");
    setBusy(true);
    setAnnounce(runMode === "ask" ? "Working on the answer" : "Searching");
    requestAnimationFrame(() => document.getElementById(`turn-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" }));
    const started = performance.now();
    try {
      if (runMode === "search") {
        const hits = await search(q, k);
        const done = { ...turn, state: "done", hits, ms: performance.now() - started };
        update(id, done);
        remember(done);
        setAnnounce(`${hits.length} passages found`);
        return;
      }
      let draft = "";
      const steps = {};
      let ttft = null; // first visible token, as the browser saw it
      const at = {}; // when each step event arrived, ms after sending
      await askStream(q, (event) => {
        if (event.type === "token") { ttft ??= performance.now() - started; draft += event.text; update(id, { draft }); }
        if (event.type === "step") { at[event.step] = performance.now() - started; steps[event.step] = event; update(id, { steps: { ...steps } }); }
        if (event.type === "error") throw new Error(event.error);
        if (event.type === "result") {
          const replacedDraft = !!draft.trim() && draft.trim() !== event.result.answer.trim();
          const done = { ...turn, state: "done", draft, steps: { ...steps }, result: event.result, replacedDraft, ms: performance.now() - started };
          update(id, done);
          remember(done);
          setLastRun({ ...event.result, client: { ttft, at, total: performance.now() - started } });
          setAnnounce("Answer ready");
        }
      }, controller.signal);
    } catch (err) {
      if (err.name === "AbortError") return;
      update(id, { state: "error", error: err.message });
      setAnnounce("Something went wrong");
    } finally {
      if (liveId.current === id) { setBusy(false); liveId.current = null; }
    }
  }

  const stop = () => {
    abort.current?.abort();
    if (liveId.current) update(liveId.current, { state: "stopped" });
    liveId.current = null;
    setBusy(false);
  };
  const newQuestion = () => {
    stop();
    setThread([]);
    setActiveId(null);
    setQuestion("");
    setPage("ask");
    setDrawer(false);
    requestAnimationFrame(() => input.current?.focus());
  };
  const openRecent = (r) => {
    stop();
    setThread([{ ...r.turn, id: r.id }]);
    setActiveId(r.id);
    setPage("ask");
    setDrawer(false);
    if (r.turn.result) setLastRun(r.turn.result);
    requestAnimationFrame(() => window.scrollTo(0, 0));
  };
  const pickTopic = (t) => {
    setQuestion(`Explain ${t.toLowerCase().replace(ACRONYMS, (m) => m.toUpperCase())}.`);
    input.current?.focus();
  };

  if (page === "space") {
    return (
      <Suspense fallback={<div className="space"><div className="sp-loading sp-glass">Loading the 3D world…</div></div>}>
        <Space lastRun={lastRun} llm={info?.llm ?? "GPT 6"} onExit={() => setPage("ask")} />
      </Suspense>
    );
  }

  const composer = (variant) => (
    <Composer inputRef={input} variant={variant} value={question} onChange={setQuestion} onSubmit={() => run(question)}
      onStop={mode === "ask" ? stop : null} mode={mode} onMode={setMode} k={k} onK={setK} busy={busy} info={info} />
  );

  return (
    <div className="app">
      <Backdrop />
      <Toaster theme={dark ? "dark" : "light"} position="bottom-center" toastOptions={{ className: "toast" }} />
      <Sidebar page={page} onPage={setPage} onNew={newQuestion} recent={recent} activeId={activeId} onRecent={openRecent}
        info={info} error={infoError} dark={dark} onToggleTheme={toggleTheme}
        open={drawer} onOpen={() => setDrawer(true)} onClose={() => setDrawer(false)} />
      <div className="sr-only" aria-live="polite">{announce}</div>

      <main className="main">
        {page === "how" && <div className="wrap wide"><HowItWorks lastRun={lastRun} llm={info?.llm ?? "GPT 6"} onBack={() => setPage("ask")} /></div>}
        {page === "inference" && <div className="wrap wide"><Inference lastRun={lastRun} llm={info?.llm ?? "GPT 6"} onBack={() => setPage("ask")} /></div>}
        {page === "ask" && (thread.length === 0
          ? <div className="wrap"><Welcome info={info} composer={composer("hero")} onAsk={(q) => run(q, "ask")} onTopic={pickTopic} /></div>
          : <>
              <div className="wrap thread">
                {thread.map((t) => <Turn key={t.id} turn={t} info={info} onAsk={(q) => run(q, "ask")} onRetry={(turn) => run(turn.q, turn.mode)} />)}
              </div>
              <div className="dock">
                <div className="dock-in">
                  {composer("dock")}
                  <p className="dock-note">Each question is answered on its own, only from the indexed documents. Check important facts in the sources.</p>
                </div>
              </div>
            </>)}
      </main>
    </div>
  );
}
