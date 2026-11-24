// One icon API for the whole UI, backed by Lucide (tree-shaken, bundled: no icon CDN, works offline).
import {
  Activity, ArrowRight, ArrowUp, ArrowUpRight, BookOpen, Bot, Boxes, Brain, Check, ChevronDown, ChevronLeft, ChevronRight,
  CircleCheck, CircleHelp, CircleMinus, CircleX, Clock, Copy, Cpu, Database, ExternalLink, Eye, FileText, Gauge, Globe, Hash,
  HeartPulse, History, House, Info, Languages, Layers, LayoutGrid, Link2, ListChecks, Lock, Menu, MessagesSquare, Monitor, Moon,
  Network, Orbit, Pause, Play, Plus, Quote, Radar, RotateCcw, Route, Scale, Search, Shield, ShieldCheck, ShieldX, Sparkles, Sun,
  Tag, TrendingUp, TriangleAlert, Workflow, X,
} from "lucide-react";

const ICONS = {
  book: BookOpen, sparkles: Sparkles, search: Search, send: ArrowUp, shield: Shield, "shield-check": ShieldCheck,
  "shield-x": ShieldX, help: CircleHelp, alert: TriangleAlert, check: Check, "check-circle": CircleCheck, "x-circle": CircleX,
  "minus-circle": CircleMinus, home: House, chevron: ChevronRight, "chevron-down": ChevronDown, "chevron-left": ChevronLeft,
  play: Play, pause: Pause, grid: LayoutGrid, globe: Globe, file: FileText, external: ExternalLink, copy: Copy, sun: Sun,
  moon: Moon, monitor: Monitor, database: Database, cpu: Cpu, activity: Activity, layers: Layers, clock: Clock, hash: Hash,
  info: Info, lock: Lock, scale: Scale, tag: Tag, route: Route, orbit: Orbit, workflow: Workflow, quote: Quote,
  "arrow-up-right": ArrowUpRight, "arrow-right": ArrowRight, plus: Plus, menu: Menu, x: X, history: History, retry: RotateCcw,
  list: ListChecks, gauge: Gauge, network: Network,
  // topic tiles
  bot: Bot, heart: HeartPulse, eye: Eye, chat: MessagesSquare, brain: Brain, languages: Languages, radar: Radar,
  trend: TrendingUp, boxes: Boxes, link: Link2,
};

const SIZES = { xs: 13, sm: 15, "": 18, lg: 22 };

export function Icon({ name, size = "sm" }) {
  const Glyph = ICONS[name];
  if (!Glyph) return null;
  return <Glyph className={`ico ${size}`} size={SIZES[size] ?? 18} strokeWidth={1.75} aria-hidden="true" />;
}

export const STEP_ICONS = { guard: "shield", retrieve: "search", generate: "sparkles", check: "check-circle" };
