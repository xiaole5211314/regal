import type { LogItem, AIScene } from "./types";
import { uuid, fmtTime } from "./utils";

function keywordsForQuery(query: string): string[] {
  const q = (query || "").toLowerCase();
  if (/(restaurant|cafe|diner|food|lunch|dinner|breakfast)/i.test(q)) {
    return ["restaurant", "diner", "cafe", "coffee shop", "bistro", "bar", "lunch", "dinner", "breakfast", "reservation", "menu"];
  }
  const tokens = q
    .replace(/[^\w\s-]/g, " ")
    .split(/\s+/)
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(0, 10);
  return tokens.length ? tokens : [];
}

function buildScenesFromHits(hits: LogItem[]): AIScene[] {
  if (hits.length === 0) return [];
  const sorted = [...hits].sort((a, b) => a.at - b.at);

  const groups: LogItem[][] = [];
  for (const h of sorted) {
    const last = groups[groups.length - 1];
    if (!last) groups.push([h]);
    else {
      const gap = h.at - last[last.length - 1].at;
      if (gap <= 90_000) last.push(h);
      else groups.push([h]);
    }
  }

  return groups.map((g, idx) => {
    const speakers = Array.from(new Set(g.map((x) => x.speaker)));
    const snippet = g
      .slice(0, 3)
      .map((x) => `${x.speaker}: ${x.text}`)
      .join(" · ");
    return {
      id: uuid(),
      title: `Scene ${idx + 1}`,
      startAt: g[0].at,
      endAt: g[g.length - 1].at,
      speakers,
      lineIds: g.map((x) => x.id),
      snippet,
    };
  });
}

export function runAssistant(query: string, logs: LogItem[]): { answer: string; scenes: AIScene[] } {
  const q = (query || "").trim();
  if (!q) return { answer: "Please enter a question.", scenes: [] };

  const kw = keywordsForQuery(q);
  if (kw.length === 0) return { answer: "Please enter a more specific question.", scenes: [] };

  const hits = logs
    .filter((x) => x.kind === "speech")
    .filter((x) => kw.some((k) => x.text.toLowerCase().includes(k)));

  const scenes = buildScenesFromHits(hits);

  if (hits.length === 0) {
    return { answer: "No relevant segments found for that query.", scenes: [] };
  }

  const lines = hits
    .slice(-12)
    .map((x) => `- ${fmtTime(x.at)}  ${x.speaker}: ${x.text}`)
    .join("\n");

  const answer = [`Matches: ${hits.length} line(s) · Scenes: ${scenes.length}`, "", "Recent matches:", lines].join("\n");
  return { answer, scenes };
}
