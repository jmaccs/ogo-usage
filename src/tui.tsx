// src/tui.tsx
import { Plugin, usePlugin } from "@opencode/plugin/tui";
import { createSignal, Show } from "solid-js";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const URL = "https://opencode.ai/zen/go/v1/usage";
const POLL_MS = 120_000;

type Meter = { status?: string; percent?: number; resetsAt?: string };
type Usage = { rolling?: Meter; weekly?: Meter; monthly?: Meter };

async function readKey(): Promise<string | undefined> {
  // 1. env var (set it in your shell profile)
  const env = process.env.OPENCODE_API_KEY?.trim();
  if (env) return env;

  // 2. optional file in the config dir: ~/.config/opencode/go-usage.key
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
  return m >= 1440
    ? `${Math.floor(m / 1440)}d`
    : m >= 60
      ? `${Math.floor(m / 60)}h`
      : `${m}m`;
}

export default Plugin.define({
  id: "me.go-usage",
  setup(context) {
    const [usage, setUsage] = createSignal<Usage | undefined>();
    const [err, setErr] = createSignal<string | undefined>();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;

    const tick = async () => {
      try {
        const key = await readKey();
        if (!key) throw new Error("no key");
        setUsage(await fetchUsage(key));
        setErr(undefined);
      } catch (e) {
        setErr((e as Error).message); // keep last good value; don't blank the bar
      }
      if (!stopped) timer = setTimeout(tick, POLL_MS);
    };
    tick(); // not awaited, so it can't block setup or the first frame

    const Bar = () => {
      const ctx = usePlugin();
      const seg = (label: string, m?: Meter) =>
        m
          ? `${label} ${m.percent ?? "?"}%${m.resetsAt ? ` ↻${until(m.resetsAt)}` : ""}`
          : null;
      const text = () => {
        const u = usage();
        if (!u) return err() ? ` Go: ${err()} ` : "";
        return (
          " " +
          [seg("5h", u.rolling), seg("wk", u.weekly), seg("mo", u.monthly)]
            .filter(Boolean)
            .join("  ") +
          (err() ? " ⚠" : "") +
          " "
        );
      };
      return (
        <Show when={text()}>
          <text fg={ctx.theme.text.base}>{text()}</text>
        </Show>
      );
    };

    // append only: never replace, so omo-slim's arrangement is left alone
    context.ui.slot({ append: "home.footer.status", render: () => <Bar /> });
    context.ui.slot({ append: "prompt.footer.status", render: () => <Bar /> });

    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  },
});
