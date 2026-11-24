import { AnimatePresence, motion } from "motion/react";
import { useId } from "react";
import { Icon } from "../icons.jsx";

const PAGES = [["ask", "home", "Assistant"], ["how", "workflow", "How it works"], ["inference", "layers", "Inside inference"]];
const fmt = (n) => Number(n || 0).toLocaleString("en-US");
const VERDICT_TONE = { in_scope: "ok", out_of_scope: "info", unsafe: "bad", too_long: "bad", search: "muted" };

export function Logo({ size = 30 }) {
  // One gradient per instance (a gradient inside a hidden, display:none copy would not paint); keep the id URL-safe.
  const id = "logo" + useId().replace(/[^a-zA-Z0-9_-]/g, "");
  return (
    <svg className="logo-mark" width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="var(--brand-1)" /><stop offset="1" stopColor="var(--brand-2)" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="9" fill={`url(#${id})`} />
      <path d="M9 10.2c2.4-1 4.8-1 7 .4 2.2-1.4 4.6-1.4 7-.4v11.4c-2.4-1-4.8-1-7 .4-2.2-1.4-4.6-1.4-7-.4z" fill="none" stroke="#fff" strokeWidth="1.7" strokeLinejoin="round" />
      <path d="M16 10.6v11.8" stroke="#fff" strokeWidth="1.7" />
      <circle cx="23.6" cy="8.6" r="2.4" fill="#fff" />
    </svg>
  );
}

function Health({ info, error }) {
  const [tone, label] = error ? ["bad", "Server offline"] : !info ? ["idle", "Connecting…"]
    : !info.documents ? ["warn", "Index is empty"] : !info.llm ? ["warn", "Search only"] : ["ok", "All systems ready"];
  const api = info?.embedding_provider === "openai";
  return (
    <div className="side-status">
      <div className={`side-health t-${tone}`}><i className="dot" />{label}</div>
      {info?.documents > 0 && (
        <dl>
          <div><dt><Icon name="database" size="xs" />Index</dt><dd>{fmt(info.documents)} docs · {fmt(info.chunks)}</dd></div>
          <div><dt><Icon name="cpu" size="xs" />Answers</dt><dd className={info.llm ? "" : "off"}>{info.llm ?? "off"}</dd></div>
          <div><dt><Icon name="layers" size="xs" />Embeddings</dt><dd title={info.model}>{info.model.split("/").pop()}{api ? " · API" : ""}</dd></div>
          <div><dt><Icon name="shield" size="xs" />Guard</dt><dd className={info.judge ? "" : "off"}>{info.judge ?? "off"}</dd></div>
          <div><dt><Icon name="activity" size="xs" />Tracing</dt><dd className={info.tracing ? "" : "off"}>{info.tracing ?? "off"}</dd></div>
        </dl>
      )}
      {error && <p>Start the server with <code>python ui.py</code>.</p>}
      {info && !info.documents && <p>Run <code>python rag.py ingest</code> to build it.</p>}
    </div>
  );
}

function Body({ page, onPage, onNew, recent, activeId, onRecent, info, error, dark, onToggleTheme, onClose }) {
  return (
    <>
      <div className="side-top">
        <button type="button" className="side-brand" onClick={() => onNew()}>
          <Logo />
          <span><b>Knowledge Assistant</b><small dir="rtl" lang="ar">المساعد المعرفي</small></span>
        </button>
        {onClose && <button type="button" className="icon-btn" onClick={onClose} aria-label="Close menu"><Icon name="x" /></button>}
      </div>

      <button type="button" className="new-btn" onClick={() => onNew()}>
        <Icon name="plus" /><span>New question</span><kbd>/</kbd>
      </button>

      <nav className="side-nav" aria-label="Pages">
        {PAGES.map(([id, icon, label]) => (
          <button key={id} type="button" aria-current={page === id ? "page" : undefined} onClick={() => onPage(id)}>
            <Icon name={icon} /><span>{label}</span>
          </button>
        ))}
        <button type="button" className="side-3d" onClick={() => onPage("space")}>
          <Icon name="orbit" /><span>Explore in 3D</span><em>3D</em>
        </button>
      </nav>

      <div className="side-section">
        <div className="side-label"><Icon name="history" size="xs" />Recent</div>
        {recent.length === 0
          ? <p className="side-empty">Your questions will appear here.</p>
          : (
            <ul className="recent">
              <AnimatePresence initial={false}>
                {recent.map((r) => (
                  <motion.li key={r.id} layout initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }}>
                    <button type="button" aria-current={activeId === r.id ? "true" : undefined} onClick={() => onRecent(r)} title={r.q}>
                      <i className={`dot t-${VERDICT_TONE[r.verdict] ?? "muted"}`} />
                      <span dir="auto">{r.q}</span>
                    </button>
                  </motion.li>
                ))}
              </AnimatePresence>
            </ul>
          )}
      </div>

      <div className="side-bottom">
        <Health info={info} error={error} />
        <div className="theme-switch" role="group" aria-label="Theme">
          <button type="button" aria-pressed={!dark} onClick={() => dark && onToggleTheme()}><Icon name="sun" size="xs" />Light</button>
          <button type="button" aria-pressed={dark} onClick={() => !dark && onToggleTheme()}><Icon name="moon" size="xs" />Dark</button>
        </div>
      </div>
    </>
  );
}

/** Fixed sidebar on wide screens; on narrow ones a top bar with a menu button opens it as a drawer. */
export function Sidebar(props) {
  const { open, onOpen, onClose } = props;
  return (
    <>
      <aside className="sidebar" aria-label="Sidebar"><Body {...props} onClose={null} /></aside>
      <header className="mobilebar">
        <button type="button" className="icon-btn" onClick={onOpen} aria-label="Open menu"><Icon name="menu" /></button>
        <span className="mobile-brand"><Logo size={24} /><b>Knowledge Assistant</b></span>
        <button type="button" className="icon-btn" onClick={() => props.onNew()} aria-label="New question"><Icon name="plus" /></button>
      </header>
      <AnimatePresence>
        {open && (
          <>
            <motion.div className="scrim" onClick={onClose} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} />
            <motion.aside className="sidebar drawer" aria-label="Menu" initial={{ x: -300 }} animate={{ x: 0 }} exit={{ x: -300 }}
              transition={{ type: "spring", bounce: 0, duration: 0.3 }}>
              <Body {...props} onClose={onClose} />
            </motion.aside>
          </>
        )}
      </AnimatePresence>
    </>
  );
}
