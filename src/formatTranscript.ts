import type { LogItem, LawyerProfile } from "./types";
import { clampText, fmtDateISO, fmtTime, padLeft, padRight, wrapText } from "./utils";

export function formatLegalTranscript(params: {
  logs: LogItem[];
  profile?: LawyerProfile | null;
  caseTitle?: string;
  caseNo?: string;
  location?: string;
  proceeding?: string;
  date?: string;
  pageLineLimit?: number;
}) {
  const {
    logs,
    profile,
    caseTitle = "REGAL — LEGAL OPERATIONS PLATFORM",
    caseNo = "Case No. 24-CV-____",
    location = "San Francisco, CA",
    proceeding = "Proceedings Transcript (Unofficial)",
    date = fmtDateISO(Date.now()),
    pageLineLimit = 25,
  } = params;

  const items = [...logs].sort((a, b) => a.at - b.at);

  const pageWidth = 96;
  const lineNoCol = 3;
  const gap = 2;
  const speakerColWidth = 12;
  const textWidth = pageWidth - (lineNoCol + gap + speakerColWidth + 2);

  const headerLines = (pageNo: number) => {
    const left = caseTitle;
    const right = `Page ${pageNo}`;
    const top = padRight(left, pageWidth - right.length) + right;

    const l2 = proceeding;
    const l3 = `${caseNo}   Location: ${location}   Date: ${date}`;

    const verified = profile
      ? `Verified user: ${profile.fullName} · ${profile.firm} · Bar ${profile.barNumber} · Valid thru ${profile.validThrough} · ${profile.role}`
      : `Verified user: (not provided)`;

    return [
      top.slice(0, pageWidth),
      l2.length > pageWidth ? l2.slice(0, pageWidth) : l2,
      l3.length > pageWidth ? l3.slice(0, pageWidth) : l3,
      verified.length > pageWidth ? verified.slice(0, pageWidth) : verified,
      "-".repeat(pageWidth),
    ];
  };

  let out: string[] = [];
  let pageNo = 1;
  let lineNo = 1;

  out.push(...headerLines(pageNo));

  function newPage() {
    out.push("");
    pageNo += 1;
    lineNo = 1;
    out.push(...headerLines(pageNo));
  }

  function emitLine(no: number, speaker: string, text: string) {
    const ln = padLeft(no, 2) + " ";
    const sp = padRight(speaker, speakerColWidth);
    const body = `${sp}: ${text}`;
    out.push((ln + " ".repeat(gap) + body).slice(0, pageWidth));
  }

  for (const item of items) {
    if (item.kind === "mark") {
      const mark = `— ${clampText(item.text || "MARK")} —`;
      const centered =
        mark.length >= pageWidth ? mark.slice(0, pageWidth) : padLeft(mark, Math.floor((pageWidth + mark.length) / 2));
      if (lineNo > pageLineLimit) newPage();
      emitLine(lineNo, "CLERK", centered.trim());
      lineNo += 1;
      continue;
    }

    const speaker = item.speaker;
    const wrapped = wrapText(item.text, textWidth);

    for (let i = 0; i < wrapped.length; i++) {
      if (lineNo > pageLineLimit) newPage();
      emitLine(lineNo, i === 0 ? speaker : "", wrapped[i]);
      lineNo += 1;
    }

    if (lineNo > pageLineLimit) newPage();
    emitLine(lineNo, "", `[${fmtTime(item.at)}]`);
    lineNo += 1;
  }

  return out.join("\n");
}
