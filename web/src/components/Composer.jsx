import { motion } from "motion/react";
import { useEffect } from "react";
import { Icon } from "../icons.jsx";

/** Grow the question box with its text, up to a cap (then it scrolls). */
const grow = (el) => { el.style.height = "auto"; el.style.height = `${Math.min(el.scrollHeight, 240)}px`; };

/** The question box. `hero` is the large first-screen version; `dock` is pinned under the thread. */
export function Composer({ inputRef, value, onChange, onSubmit, onStop, mode, onMode, k, onK, busy, variant, info }) {
  useEffect(() => { if (inputRef.current) grow(inputRef.current); }, [value, variant, inputRef]);
  const hero = variant === "hero";
  return (
    <form className={`composer composer--${variant}`} onSubmit={(e) => { e.preventDefault(); onSubmit(); }}>
      <label className="sr-only" htmlFor="q">Question</label>
      <textarea id="q" ref={inputRef} dir="auto" maxLength={1000} rows={hero ? 3 : 1} autoFocus value={value}
        placeholder={hero ? "Ask anything about the documents… / اسأل أي سؤال عن المستندات" : "Ask another question…  /  سؤال آخر"}
        onChange={(e) => { onChange(e.target.value); grow(e.target); }}
        onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); onSubmit(); } }} />
      <div className="controls">
        <div className="seg" role="group" aria-label="Mode">
          {[["ask", "sparkles", "Answer"], ["search", "search", "Search only"]].map(([id, icon, label]) => (
            <button key={id} type="button" aria-pressed={mode === id} onClick={() => onMode(id)}
              title={id === "ask" ? "Guarded, cited answer from the documents" : "Show matching passages; no model is called"}>
              {mode === id && <motion.span layoutId={`mode-pill-${variant}`} className="seg-pill" transition={{ type: "spring", bounce: 0.15, duration: 0.4 }} />}
              <Icon name={icon} /><span>{label}</span>
            </button>
          ))}
        </div>
        {mode === "search" && (
          <select aria-label="Number of passages" value={k} onChange={(e) => onK(Number(e.target.value))}>
            {[3, 5, 10].map((n) => <option key={n} value={n}>Top {n}</option>)}
          </select>
        )}
        {mode === "ask" && info?.llm && <span className="model-chip" title="Answer model"><Icon name="cpu" size="xs" />{info.llm}</span>}
        <span className="count">{value.length > 800 ? `${value.length} / 1000` : hero ? <><kbd>Enter</kbd> to send · <kbd>Shift</kbd>+<kbd>Enter</kbd> new line</> : null}</span>
        {busy && onStop
          ? <button className="send stop" type="button" onClick={onStop} aria-label="Stop" title="Stop"><span className="stop-sq" /></button>
          : <button className="send" type="submit" disabled={busy || !value.trim()} aria-label={mode === "ask" ? "Ask" : "Search"} title={mode === "ask" ? "Ask (Enter)" : "Search (Enter)"}>
              <Icon name={mode === "ask" ? "send" : "search"} size="" />
            </button>}
      </div>
    </form>
  );
}
