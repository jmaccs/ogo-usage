// src/tui.ts
import { Plugin } from "@opencode/plugin/tui";
import { createElement, insert, setProp } from "@opentui/solid";
import { createSignal } from "solid-js";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const URL = "https://opencode.ai/zen/go/v1/usage";
const POLL_MS = 120_000; // API poll
const TICK_MS = 30_000; // countdown refresh between polls
const WARN = 80; // percent -> warning colour
const CRIT = 95; // percent -> error colour
const OK_USES_BASE = true; // true: normal state uses plain text colour; false: green

type Meter = { status?: string; percent?: number; resetsAt?: string };
type Usage = { rolling?: Meter; weekly?: Meter; monthly?: Meter };

// ---- key + fetch -----------------------------------------------------------

async function readKey(): Promise<string | undefined> {
  // 1. env var
  const env = process.env.OPENCODE_API_KEY?.trim();
  if (env) return env;

  // 2. optional file: ~/.config/opencode/go-usage.key (chmod 600)
  const cfg = process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config");
  try {
    const k = (
      await readFile(join(cfg, "opencode", "go-usage.key"), "utf8")
    ).trim();
    if (k) return k;
  } catch {}

  // 3. opencode's own auth.json (what /connect stores)
  const data = process.env.XDG_DATA_HOME ?? join(homedir(), ".local", "share");
  try {
    const auth = JSON.parse(
      await readFile(join(data, "opencode", "auth.json"), "utf8"),
    );
    return auth?.["opencode-go"]?.key || undefined;
  } catch {}
}

async function fetchUsage(key: string): Promise<Usage> {
  const res = await fetch(URL, {
    headers: {
      Authorization: `Bearer ${key}`,
      "User-Agent": "opencode-go-usage-tui/0.1",
    },
    signal: AbortSignal.timeout(8_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()).usage;
}

function until(iso?: string) {
  if (!iso) return "";
  const m = Math.max(0, Math.round((Date.parse(iso) - Date.now()) / 60_000));
  if (m >= 1440)
    return `${Math.floor(m / 1440)}d${Math.floor((m % 1440) / 60)}h`;
  if (m >= 60) return `${Math.floor(m / 60)}h${m % 60}m`;
  return `${m}m`;
}

// ---- plugin ----------------------------------------------------------------

export default Plugin.define({
  id: "me.go-usage",
  setup(context) {
    const [usage, setUsage] = createSignal<Usage | undefined>();
    const [err, setErr] = createSignal<string | undefined>();
    const [now, setNow] = createSignal(Date.now());

    let pollTimer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;

    const poll = async () => {
      try {
        const key = await readKey();
        if (!key) throw new Error("no key");
        setUsage(await fetchUsage(key));
        setErr(undefined);
      } catch (e) {
        setErr((e as Error).message); // keep last good value
      }
      if (!stopped) pollTimer = setTimeout(poll, POLL_MS);
    };
    poll(); // not awaited: never blocks setup or the first frame

    const clock = setInterval(() => setNow(Date.now()), TICK_MS);

    // Fallbacks guarantee a visible colour even if a theme token is missing.
    const FALLBACK = { ok: "#9ece6a", warn: "#e0af68", crit: "#f7768e" };

    // Tokens might be a string/RGBA or an object with .base; normalise.
    const asColor = (v: any, fallback: string) =>
      v == null ? fallback : typeof v === "object" && "base" in v ? v.base : v;

    const color = (tone: "ok" | "warn" | "crit") => {
      const t = context.theme.text;
      if (tone === "crit") return asColor(t.feedback?.error, FALLBACK.crit);
      if (tone === "warn") return asColor(t.feedback?.warning, FALLBACK.warn);
      return OK_USES_BASE ? t.base : asColor(t.feedback?.success, FALLBACK.ok);
    };

    const toneOf = (m: Meter): "ok" | "warn" | "crit" => {
      const p = m.percent ?? 0;
      if ((m.status && m.status !== "ok") || p >= CRIT) return "crit";
      return p >= WARN ? "warn" : "ok";
    };

    // One <text> per coloured piece. fg on a text node is the documented form.
    const piece = (content: string, fg: unknown) => {
      const n = createElement("text");
      setProp(n, "fg", fg);
      insert(n, () => content);
      return n;
    };

    const buildPieces = () => {
      now(); // subscribe so countdowns tick
      const t = context.theme.text;
      const u = usage();
      const stale = !!err();

      if (!u) return err() ? [piece(` Go: ${err()} `, t.faint)] : [];

      const meters: [string, Meter | undefined][] = [
        ["5h", u.rolling],
        ["wk", u.weekly],
        ["mo", u.monthly],
      ];

      const out: unknown[] = [];
      for (const [label, m] of meters) {
        if (!m) continue;
        const reset = until(m.resetsAt);
        out.push(piece(` ${label} `, t.info));
        out.push(
          piece(`${m.percent ?? "?"}%`, stale ? t.faint : color(toneOf(m))),
        );
        out.push(piece(reset ? ` ↻${reset} ` : " ", t.muted));
      }
      if (stale) out.push(piece("⚠", color("warn")));
      return out;
    };

    const Bar = () => {
      const row = createElement("box");
      setProp(row, "flexDirection", "row"); // keeps everything on one line
      setProp(row, "flexShrink", 0);
      insert(row, buildPieces);
      return row;
    };

    const [claimed, setClaimed] = createSignal<string[]>([])
    const TARGETS = [
      { slot: "home.footer.status" as const },
      { slot: "prompt.footer.status" as const },
    ]
    const winner = () => TARGETS.find((t) => claimed().includes(t.slot))?.slot

    const disposers = TARGETS.map((target) =>
      context.ui.slot({
        append: target.slot,
        render: () => {
          setClaimed([target.slot])
          return winner() === target.slot ? Bar() : undefined
        },
      }),
    )

    return () => {
      disposers.forEach((dispose) => dispose())
      stopped = true;
      if (pollTimer) clearTimeout(pollTimer);
      clearInterval(clock);
    };
  },
});
