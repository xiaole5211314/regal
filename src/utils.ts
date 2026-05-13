import type { Speaker } from "./types";

export const LS_KEY = "regal_transcript_ui_v9";
export const LS_PROFILE = "regal_profile_v3";

export function uuid() {
  return crypto.randomUUID();
}

export function clampText(s: string) {
  return (s || "").replace(/\s+/g, " ").trim();
}

export function fmtTime(t: number) {
  const d = new Date(t);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export function fmtDateISO(t: number) {
  const d = new Date(t);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export function addDaysISO(days: number) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return fmtDateISO(d.getTime());
}

export function speakerInitial(s: Speaker) {
  if (s === "LAWYER 1") return "L1";
  if (s === "LAWYER 2") return "L2";
  if (s === "JUDGE") return "J";
  if (s === "WITNESS") return "W";
  return "C";
}

export function padLeft(s: string | number, n: number) {
  return String(s).padStart(n, " ");
}

export function padRight(s: string, n: number) {
  return String(s).padEnd(n, " ");
}

export function wrapText(text: string, width: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let current = "";
  for (const w of words) {
    if (current.length + w.length + 1 > width) {
      lines.push(current.trimEnd());
      current = w + " ";
    } else {
      current += w + " ";
    }
  }
  if (current.trim()) lines.push(current.trimEnd());
  return lines;
}
