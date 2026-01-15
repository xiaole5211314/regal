import { useEffect, useMemo, useRef, useState } from "react";

type Speaker = "JUDGE" | "WITNESS" | "LAWYER 1" | "LAWYER 2" | "CLERK";
type LogItem = {
    id: string;
    at: number;
    speaker: Speaker;
    text: string;
    kind: "speech" | "mark";
};

type AIScene = {
    id: string;
    title: string;
    startAt: number;
    endAt: number;
    speakers: Speaker[];
    lineIds: string[];
    snippet: string;
};

type LawyerProfile = {
    fullName: string;
    barNumber: string;
    firm: string;
    role: "LAWYER 1" | "LAWYER 2";
    validThrough: string; // YYYY-MM-DD
    verifiedAt: number;
};

const LS_KEY = "regal_transcript_ui_v9";
const LS_PROFILE = "regal_profile_v3";

function uuid() {
    return crypto.randomUUID();
}
function clampText(s: string) {
    return (s || "").replace(/\s+/g, " ").trim();
}
function fmtTime(t: number) {
    const d = new Date(t);
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}
function fmtDateISO(t: number) {
    const d = new Date(t);
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
}
function addDaysISO(days: number) {
    const d = new Date();
    d.setDate(d.getDate() + days);
    return fmtDateISO(d.getTime());
}
function speakerInitial(s: Speaker) {
    if (s === "LAWYER 1") return "L1";
    if (s === "LAWYER 2") return "L2";
    if (s === "JUDGE") return "J";
    if (s === "WITNESS") return "W";
    return "C";
}

/** Demo lines — runs once and stops automatically */
const STREAM_LINES: Array<{ speaker: Speaker; text: string }> = [
    { speaker: "LAWYER 1", text: "Your Honor, for the record, we object to the characterization of the timeline." },
    { speaker: "JUDGE", text: "Noted. Counsel, keep your questions focused." },
    { speaker: "LAWYER 2", text: "Understood, Your Honor. Witness, did you review the contract prior to signing?" },
    { speaker: "WITNESS", text: "Yes. I reviewed it the night before and again the morning of." },
    { speaker: "LAWYER 2", text: "And did anyone pressure you to sign without changes?" },
    { speaker: "WITNESS", text: "No. I had time to ask questions." },
    { speaker: "LAWYER 1", text: "Move to strike as nonresponsive." },
    { speaker: "JUDGE", text: "Denied. Proceed." },
    { speaker: "LAWYER 2", text: "Let’s turn to Exhibit 12. Do you recognize this email chain?" },
    { speaker: "WITNESS", text: "I do. That’s my email address and my reply." },
    { speaker: "LAWYER 1", text: "Before we proceed—did you discuss meeting at a restaurant near the courthouse?" },
    { speaker: "WITNESS", text: "We mentioned a cafe on Market Street, but we didn’t meet there." },
    { speaker: "LAWYER 2", text: "For the record, was it a diner or a coffee shop? Any name you recall?" },
    { speaker: "WITNESS", text: "A small diner—no, I don’t remember the name." },
    { speaker: "JUDGE", text: "The record will reflect the witness’s answer." },
];

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

function runAssistant(query: string, logs: LogItem[]): { answer: string; scenes: AIScene[] } {
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

/* -------------------- Transcript export formatting -------------------- */

function padLeft(s: string, n: number) {
    return String(s).padStart(n, " ");
}
function padRight(s: string, n: number) {
    return String(s).padEnd(n, " ");
}
function wrapText(text: string, width: number): string[] {
    const t = clampText(text);
    if (!t) return [""];
    const words = t.split(" ");
    const lines: string[] = [];
    let cur = "";
    for (const w of words) {
        if (!cur) cur = w;
        else if ((cur + " " + w).length <= width) cur += " " + w;
        else {
            lines.push(cur);
            cur = w;
        }
    }
    if (cur) lines.push(cur);
    return lines;
}

function formatLegalTranscript(params: {
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

/* -------------------- App -------------------- */

export default function App() {
    // Responsive
    const [isWide, setIsWide] = useState<boolean>(() => window.matchMedia?.("(min-width: 980px)")?.matches ?? true);
    useEffect(() => {
        const mq = window.matchMedia?.("(min-width: 980px)");
        if (!mq) return;
        const handler = () => setIsWide(mq.matches);
        handler();
        if (mq.addEventListener) mq.addEventListener("change", handler);
        else mq.addListener(handler);
        return () => {
            if (mq.removeEventListener) mq.removeEventListener("change", handler);
            else mq.removeListener(handler);
        };
    }, []);

    // Profile
    const [profile, setProfile] = useState<LawyerProfile | null>(() => {
        try {
            const raw = localStorage.getItem(LS_PROFILE);
            if (raw) return JSON.parse(raw);
        } catch { }
        return null;
    });
    const [verifyOpen, setVerifyOpen] = useState<boolean>(() => !profile);

    // Verification defaults (prefilled for demo)
    const [vRole, setVRole] = useState<LawyerProfile["role"]>("LAWYER 1");
    const [vName, setVName] = useState("Alex Chen");
    const [vBar, setVBar] = useState("CA-1234567");
    const [vFirm, setVFirm] = useState("Regal LLP");
    const [vValid, setVValid] = useState(addDaysISO(30));
    const [vErr, setVErr] = useState<string | null>(null);

    function submitVerification() {
        setVErr(null);
        const fullName = clampText(vName);
        const barNumber = clampText(vBar);
        const firm = clampText(vFirm);
        const validThrough = clampText(vValid);

        if (!fullName || fullName.length < 2) return setVErr("Please enter your full name.");
        if (!barNumber || barNumber.length < 4) return setVErr("Please enter a valid bar number.");
        if (!firm || firm.length < 2) return setVErr("Please enter your firm/organization.");
        if (!/^\d{4}-\d{2}-\d{2}$/.test(validThrough)) return setVErr("Valid-through date must be YYYY-MM-DD.");

        const p: LawyerProfile = { fullName, barNumber, firm, role: vRole, validThrough, verifiedAt: Date.now() };
        setProfile(p);
        try {
            localStorage.setItem(LS_PROFILE, JSON.stringify(p));
        } catch { }
        setVerifyOpen(false);
        setInputSpeaker(p.role);
    }

    function resetVerification() {
        try {
            localStorage.removeItem(LS_PROFILE);
        } catch { }
        setProfile(null);
        setVerifyOpen(true);
    }

    // Logs
    const [logs, setLogs] = useState<LogItem[]>(() => {
        try {
            const raw = localStorage.getItem(LS_KEY);
            if (raw) return JSON.parse(raw);
        } catch { }
        const now = Date.now();
        return [
            { id: uuid(), at: now - 1000 * 60 * 3, speaker: "CLERK", kind: "mark", text: "SESSION OPENED" },
            { id: uuid(), at: now - 1000 * 60 * 2, speaker: "JUDGE", kind: "speech", text: "We are on the record." },
            { id: uuid(), at: now - 1000 * 55, speaker: "LAWYER 2", kind: "speech", text: "Good morning, Your Honor." },
            { id: uuid(), at: now - 1000 * 40, speaker: "LAWYER 1", kind: "speech", text: "Good morning." },
        ];
    });

    useEffect(() => {
        try {
            localStorage.setItem(LS_KEY, JSON.stringify(logs));
        } catch { }
    }, [logs]);

    function pushLog(item: LogItem) {
        setLogs((prev) => [...prev, item].slice(-2000));
    }
    function addMark(text = "MARK") {
        pushLog({ id: uuid(), at: Date.now(), speaker: "CLERK", kind: "mark", text });
    }
    function clearAll() {
        setIsRunning(false);
        setTyping(false);
        setDemoDone(false);
        setLogs([]);
        setAiAnswer("");
        setAiScenes([]);
        setHighlightIds(new Set());
        try {
            localStorage.removeItem(LS_KEY);
        } catch { }
    }

    // Demo run once
    const [isRunning, setIsRunning] = useState(false);
    const [typing, setTyping] = useState(false);
    const [demoDone, setDemoDone] = useState(false);

    const tickRef = useRef(0);
    const timerRef = useRef<number | null>(null);

    useEffect(() => {
        if (!isRunning) {
            if (timerRef.current) {
                window.clearInterval(timerRef.current);
                timerRef.current = null;
            }
            return;
        }

        setDemoDone(false);
        tickRef.current = 0;

        if (timerRef.current) window.clearInterval(timerRef.current);

        timerRef.current = window.setInterval(() => {
            setTyping(true);
            window.setTimeout(() => setTyping(false), 420);

            const i = tickRef.current;
            if (i >= STREAM_LINES.length) {
                setIsRunning(false);
                setTyping(false);
                setDemoDone(true);
                if (timerRef.current) {
                    window.clearInterval(timerRef.current);
                    timerRef.current = null;
                }
                return;
            }

            const line = STREAM_LINES[i];
            tickRef.current += 1;
            pushLog({ id: uuid(), at: Date.now(), speaker: line.speaker, kind: "speech", text: line.text });
        }, 900);

        return () => {
            if (timerRef.current) {
                window.clearInterval(timerRef.current);
                timerRef.current = null;
            }
        };
    }, [isRunning]);

    // Filter
    const [filter, setFilter] = useState<Speaker | "ALL">("ALL");
    const visible = useMemo(() => (filter === "ALL" ? logs : logs.filter((x) => x.speaker === filter)), [logs, filter]);

    // Composer
    const [inputSpeaker, setInputSpeaker] = useState<Speaker>("LAWYER 1");
    const [manual, setManual] = useState("");
    useEffect(() => {
        if (profile) setInputSpeaker(profile.role);
    }, [profile]);

    function addManual() {
        const t = clampText(manual);
        if (!t) return;
        pushLog({ id: uuid(), at: Date.now(), speaker: inputSpeaker, kind: "speech", text: t });
        setManual("");
    }

    // AI
    const [aiQuery, setAiQuery] = useState("Find scenes where the lawyers discussed restaurants.");
    const [aiAnswer, setAiAnswer] = useState<string>("");
    const [aiScenes, setAiScenes] = useState<AIScene[]>([]);
    const [aiBusy, setAiBusy] = useState(false);

    const [highlightIds, setHighlightIds] = useState<Set<string>>(() => new Set());

    function runAi() {
        setAiBusy(true);
        window.setTimeout(() => {
            const r = runAssistant(aiQuery, logs);
            setAiAnswer(r.answer);
            setAiScenes(r.scenes);
            setAiBusy(false);
        }, 320);
    }

    // Jump / highlight
    const msgElMap = useRef(new Map<string, HTMLDivElement>());
    const setMsgRef = (id: string) => (el: HTMLDivElement | null) => {
        if (!el) msgElMap.current.delete(id);
        else msgElMap.current.set(id, el);
    };
    function jumpToLine(lineId: string) {
        const el = msgElMap.current.get(lineId);
        if (!el) return;
        el.scrollIntoView({ behavior: "smooth", block: "center" });
    }
    function applyHighlight(ids: string[]) {
        setHighlightIds(new Set(ids));
        if (ids[0]) jumpToLine(ids[0]);
        window.setTimeout(() => setHighlightIds(new Set()), 6500);
    }

    // Auto scroll page to bottom while demo is running
    const bottomRef = useRef<HTMLDivElement | null>(null);
    useEffect(() => {
        if (!isRunning) return;
        bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    }, [visible.length, typing, isRunning]);

    // Export modal
    const [exportOpen, setExportOpen] = useState(false);
    const [exportPreview, setExportPreview] = useState("");

    function buildExportText() {
        return formatLegalTranscript({
            logs,
            profile,
            caseTitle: "REGAL — LEGAL OPERATIONS PLATFORM",
            caseNo: "Case No. 24-CV-____",
            location: "San Francisco, CA",
            proceeding: "Proceedings Transcript (Unofficial)",
            date: fmtDateISO(Date.now()),
            pageLineLimit: 25,
        });
    }
    function openExport() {
        const txt = buildExportText();
        setExportPreview(txt);
        setExportOpen(true);
    }
    function downloadExport() {
        const txt = exportPreview || buildExportText();
        const blob = new Blob([txt], { type: "text/plain;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `Regal_Transcript_${fmtDateISO(Date.now())}.txt`;
        a.click();
        URL.revokeObjectURL(url);
    }

    // Keyboard shortcuts
    useEffect(() => {
        function onKeyDown(e: KeyboardEvent) {
            const meta = e.metaKey || e.ctrlKey;
            if (meta && e.key === "Enter") {
                e.preventDefault();
                setIsRunning((v) => !v);
            }
            if (meta && e.key.toLowerCase() === "k") {
                e.preventDefault();
                addMark();
            }
            if (e.key === "Escape") {
                setIsRunning(false);
                setTyping(false);
            }
        }
        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    }, []);

    // Styles
    const c = {
        ink: "#0B1220",
        sub: "#334155",
        muted: "#64748B",
        line: "#E5E7EB",
        bg: "#FFFFFF",
        soft: "#F8FAFC",
        chip: "#F1F5F9",
        blue: "#1D4ED8",
        red: "#DC2626",
        hi: "rgba(29,78,216,.10)",
        hiLine: "rgba(29,78,216,.30)",
    };

    const styles: Record<string, React.CSSProperties> = {
        page: { minHeight: "100vh", background: c.bg, color: c.ink, fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial" },
        container: { maxWidth: 1240, margin: "0 auto", padding: 16 },

        topbar: {
            position: "sticky",
            top: 0,
            zIndex: 10,
            background: c.bg,
            border: `1px solid ${c.line}`,
            borderRadius: 12,
            padding: "10px 12px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
        },

        brand: { display: "flex", alignItems: "center", gap: 10 },
        logo: { width: 28, height: 28, borderRadius: 8, border: `1px solid ${c.line}`, display: "grid", placeItems: "center", fontWeight: 900, fontSize: 12 },
        brandText: { display: "flex", flexDirection: "column", lineHeight: 1.15 },
        brandName: { fontWeight: 900, fontSize: 14 },
        brandTag: { fontSize: 12, color: c.muted },

        rightTop: { display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", justifyContent: "flex-end" },
        status: { fontSize: 12, color: c.muted, whiteSpace: "nowrap" },

        badge: { display: "inline-flex", alignItems: "center", gap: 8, padding: "6px 10px", borderRadius: 999, border: `1px solid ${c.line}`, background: c.soft, fontSize: 12, fontWeight: 700, cursor: "pointer" },
        badgeDot: (ok: boolean): React.CSSProperties => ({ width: 8, height: 8, borderRadius: 999, background: ok ? "#16A34A" : "#CBD5E1" }),

        grid: {
            display: "grid",
            gridTemplateColumns: isWide ? "360px 1fr" : "1fr",
            gap: 14,
            marginTop: 14,
            paddingBottom: isWide ? 0 : 72,
            alignItems: "start",
        },

        card: { border: `1px solid ${c.line}`, borderRadius: 12, background: c.bg },
        cardPad: { padding: 12 },

        // Left panel: STICKY so it never disappears while transcript scrolls
        leftSticky: {
            position: isWide ? "sticky" : "relative",
            top: isWide ? 76 : undefined, // sits under the topbar
            alignSelf: "start",
            maxHeight: isWide ? "calc(100vh - 96px)" : undefined,
            overflow: isWide ? "auto" : "visible",
        },

        h: { fontWeight: 800, fontSize: 12, letterSpacing: 0.8, textTransform: "uppercase", color: c.sub },
        row: { display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", marginTop: 10 },

        btn: { border: `1px solid ${c.line}`, background: c.bg, color: c.ink, padding: "9px 12px", borderRadius: 10, fontWeight: 800, cursor: "pointer" },
        btnPrimary: { borderColor: "rgba(29,78,216,.25)", color: c.blue, background: "#FFFFFF" },
        btnDanger: { borderColor: "rgba(220,38,38,.25)", color: c.red, background: "#FFFFFF" },
        btnDisabled: { opacity: 0.5, cursor: "not-allowed" },

        input: { border: `1px solid ${c.line}`, borderRadius: 10, padding: "9px 10px", outline: "none", width: "100%", fontWeight: 600, background: c.bg },
        select: { border: `1px solid ${c.line}`, borderRadius: 10, padding: "9px 10px", outline: "none", fontWeight: 700, background: c.bg },

        // Right transcript: NO inner scroll — page scrolls
        chatShell: { border: `1px solid ${c.line}`, borderRadius: 12, overflow: "hidden", background: c.bg },
        chatHeader: { padding: "10px 12px", borderBottom: `1px solid ${c.line}`, display: "flex", justifyContent: "space-between", gap: 12, alignItems: "baseline" },
        chatTitle: { fontWeight: 900 },
        chatMeta: { fontSize: 12, color: c.muted },

        chatBody: { padding: 12, background: c.soft },

        msgRow: (side: "left" | "right") =>
            ({ display: "flex", justifyContent: side === "right" ? "flex-end" : "flex-start", marginBottom: 10 }) as React.CSSProperties,

        bubble: (speaker: Speaker, kind: "speech" | "mark", highlighted: boolean) =>
            ({
                width: "min(780px, 100%)",
                borderRadius: 12,
                border: highlighted ? `1px solid ${c.hiLine}` : `1px solid ${c.line}`,
                background: kind === "mark" ? c.bg : highlighted ? c.hi : speaker === "JUDGE" ? c.chip : c.bg,
                padding: "10px 10px 8px 10px",
                transition: "border-color 140ms ease, background 140ms ease",
            }) as React.CSSProperties,

        bubbleTop: { display: "flex", justifyContent: "space-between", gap: 10, alignItems: "baseline", marginBottom: 6 },
        chip: { display: "inline-flex", alignItems: "center", gap: 8, padding: "5px 9px", borderRadius: 999, border: `1px solid ${c.line}`, background: c.bg, fontSize: 12, fontWeight: 800 },
        avatar: { width: 22, height: 22, borderRadius: 8, border: `1px solid ${c.line}`, background: c.soft, display: "grid", placeItems: "center", fontSize: 11, fontWeight: 900 },
        time: { fontSize: 12, color: c.muted, fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono','Courier New', monospace" },
        text: { lineHeight: 1.55, color: c.ink },

        markLine: { textAlign: "center", fontSize: 12, letterSpacing: 0.8, color: c.muted, padding: "8px 10px", border: `1px dashed ${c.line}`, borderRadius: 12, background: c.bg } as React.CSSProperties,

        typing: { display: "inline-flex", alignItems: "center", gap: 8, fontSize: 12, color: c.muted, margin: "6px 0 10px 0" } as React.CSSProperties,
        dots: { display: "inline-flex", gap: 4, alignItems: "center" },
        dotTiny: (delay: number): React.CSSProperties => ({ width: 6, height: 6, borderRadius: 999, background: "#94A3B8", animation: `bounce 1s ${delay}ms infinite` }),

        composer: { padding: 12, borderTop: `1px solid ${c.line}`, background: c.bg, display: "grid", gridTemplateColumns: isWide ? "170px 1fr 120px" : "1fr", gap: 10 },

        floatingStop: {
            position: "fixed",
            right: 18,
            bottom: 18,
            zIndex: 1000,
            border: "1px solid rgba(220,38,38,.25)",
            background: c.bg,
            borderRadius: 999,
            padding: "11px 14px",
            fontWeight: 900,
            cursor: "pointer",
            display: isRunning ? "inline-flex" : "none",
            alignItems: "center",
            gap: 10,
        } as React.CSSProperties,

        mobileBar: { position: "fixed", left: 0, right: 0, bottom: 0, zIndex: 999, padding: 12, background: "rgba(255,255,255,.96)", borderTop: `1px solid ${c.line}`, display: isWide ? "none" : "block" } as React.CSSProperties,
        mobileBarInner: { maxWidth: 1240, margin: "0 auto", display: "flex", gap: 10, alignItems: "center", justifyContent: "space-between" } as React.CSSProperties,

        aiBox: { marginTop: 10, border: `1px solid ${c.line}`, borderRadius: 12, background: c.bg, padding: 10 } as React.CSSProperties,
        aiAnswer: { marginTop: 10, border: `1px solid ${c.line}`, borderRadius: 12, background: c.soft, padding: 10, fontSize: 12, whiteSpace: "pre-wrap", lineHeight: 1.5, maxHeight: 200, overflow: "auto", fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono','Courier New', monospace" } as React.CSSProperties,

        sceneGrid: { display: "grid", gap: 10, marginTop: 10 },
        sceneCard: { border: `1px solid ${c.line}`, borderRadius: 12, background: c.bg, padding: 10 } as React.CSSProperties,
        sceneTitleRow: { display: "flex", justifyContent: "space-between", gap: 10, alignItems: "baseline" } as React.CSSProperties,
        sceneTitle: { fontWeight: 900, fontSize: 13 } as React.CSSProperties,
        sceneMeta: { fontSize: 12, color: c.muted } as React.CSSProperties,
        sceneSnippet: { marginTop: 8, fontSize: 12, color: c.sub, lineHeight: 1.45 } as React.CSSProperties,
        sceneActions: { display: "flex", gap: 10, flexWrap: "wrap", marginTop: 10 } as React.CSSProperties,

        modalOverlay: { position: "fixed", inset: 0, background: "rgba(15,23,42,.32)", zIndex: 2000, display: "grid", placeItems: "center", padding: 14 } as React.CSSProperties,
        modal: { width: "min(980px, 100%)", maxHeight: "min(86vh, 820px)", overflow: "hidden", background: c.bg, borderRadius: 12, border: `1px solid ${c.line}`, display: "flex", flexDirection: "column" } as React.CSSProperties,
        modalTop: { padding: 12, borderBottom: `1px solid ${c.line}`, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 } as React.CSSProperties,
        modalTitle: { fontWeight: 900 } as React.CSSProperties,
        modalBody: { padding: 12, background: c.soft, overflow: "auto", flex: 1 } as React.CSSProperties,
        modalPre: { margin: 0, padding: 12, borderRadius: 12, border: `1px solid ${c.line}`, background: c.bg, fontSize: 12, lineHeight: 1.45, whiteSpace: "pre", overflow: "auto", fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono','Courier New', monospace" } as React.CSSProperties,

        verifyModal: { width: "min(760px, 100%)", background: c.bg, borderRadius: 12, border: `1px solid ${c.line}`, overflow: "hidden", display: "flex", flexDirection: "column" } as React.CSSProperties,
        verifyTop: { padding: 12, borderBottom: `1px solid ${c.line}`, display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10 } as React.CSSProperties,
        verifyBody: { padding: 12, background: c.soft } as React.CSSProperties,
        verifyGrid: { display: "grid", gridTemplateColumns: isWide ? "1fr 1fr" : "1fr", gap: 10 } as React.CSSProperties,
        verifyErr: { marginTop: 10, border: "1px solid rgba(220,38,38,.25)", background: "rgba(220,38,38,.08)", borderRadius: 12, padding: "10px 12px", fontSize: 13 } as React.CSSProperties,
        hint: { marginTop: 10, fontSize: 12, color: c.muted, lineHeight: 1.5 },
    };

    return (
        <div style={styles.page}>
            <style>{`
        @keyframes bounce { 0%,80%,100% { transform: translateY(0); opacity:.6 } 40% { transform: translateY(-3px); opacity:1 } }
      `}</style>

            {/* Verification Modal */}
            {verifyOpen && (
                <div style={styles.modalOverlay}>
                    <div style={styles.verifyModal}>
                        <div style={styles.verifyTop}>
                            <div>
                                <div style={{ fontWeight: 900, fontSize: 15 }}>Attorney Verification</div>
                                <div style={{ fontSize: 12, color: c.muted, marginTop: 6 }}>Demo mode — prefilled for fast presentation.</div>
                            </div>
                            {profile && <button style={styles.btn} onClick={() => setVerifyOpen(false)}>Continue</button>}
                        </div>

                        <div style={styles.verifyBody}>
                            <div style={styles.verifyGrid}>
                                <div>
                                    <div style={styles.h}>Role</div>
                                    <div style={{ marginTop: 6 }}>
                                        <select style={styles.select} value={vRole} onChange={(e) => setVRole(e.target.value as any)}>
                                            <option value="LAWYER 1">LAWYER 1</option>
                                            <option value="LAWYER 2">LAWYER 2</option>
                                        </select>
                                    </div>
                                </div>

                                <div>
                                    <div style={styles.h}>Bar Number</div>
                                    <div style={{ marginTop: 6 }}>
                                        <input style={styles.input} value={vBar} onChange={(e) => setVBar(e.target.value)} placeholder="e.g., CA-1234567" />
                                    </div>
                                </div>

                                <div>
                                    <div style={styles.h}>Full Name</div>
                                    <div style={{ marginTop: 6 }}>
                                        <input style={styles.input} value={vName} onChange={(e) => setVName(e.target.value)} placeholder="e.g., Alex Chen" />
                                    </div>
                                </div>

                                <div>
                                    <div style={styles.h}>Firm / Organization</div>
                                    <div style={{ marginTop: 6 }}>
                                        <input style={styles.input} value={vFirm} onChange={(e) => setVFirm(e.target.value)} placeholder="e.g., Regal LLP" />
                                    </div>
                                </div>

                                <div>
                                    <div style={styles.h}>Valid Through</div>
                                    <div style={{ marginTop: 6 }}>
                                        <input style={styles.input} value={vValid} onChange={(e) => setVValid(e.target.value)} placeholder="YYYY-MM-DD" />
                                    </div>
                                </div>
                            </div>

                            {vErr && <div style={styles.verifyErr}><b>Verification failed:</b> {vErr}</div>}

                            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 12, alignItems: "center" }}>
                                <button style={{ ...styles.btn, ...styles.btnPrimary }} onClick={submitVerification}>Verify & Enter</button>
                                {profile && <button style={styles.btn} onClick={() => setVerifyOpen(false)}>Skip</button>}
                                {profile && <button style={{ ...styles.btn, ...styles.btnDanger }} onClick={resetVerification}>Reset</button>}
                            </div>

                            <div style={styles.hint}>Tip: For the demo, just click <b>Verify & Enter</b>.</div>
                        </div>
                    </div>
                </div>
            )}

            {/* Export Modal */}
            {exportOpen && (
                <div style={styles.modalOverlay} onMouseDown={() => setExportOpen(false)}>
                    <div style={styles.modal} onMouseDown={(e) => e.stopPropagation()}>
                        <div style={styles.modalTop}>
                            <div>
                                <div style={styles.modalTitle}>Export Transcript</div>
                                <div style={{ fontSize: 12, color: c.muted, marginTop: 4 }}>Court-style formatting · Page/line numbered</div>
                            </div>
                            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                                <button style={{ ...styles.btn, ...styles.btnPrimary }} onClick={downloadExport}>Download .txt</button>
                                <button style={styles.btn} onClick={() => setExportOpen(false)}>Close</button>
                            </div>
                        </div>
                        <div style={styles.modalBody}>
                            <pre style={styles.modalPre}>{exportPreview}</pre>
                        </div>
                    </div>
                </div>
            )}

            {/* Floating STOP (always accessible) */}
            <button
                style={styles.floatingStop}
                onClick={() => {
                    setIsRunning(false);
                    setTyping(false);
                }}
                title="Stop (Esc)"
            >
                <span style={{ width: 9, height: 9, borderRadius: 999, background: c.red }} />
                STOP
            </button>

            {/* Mobile bottom bar */}
            <div style={styles.mobileBar}>
                <div style={styles.mobileBarInner}>
                    <button style={{ ...styles.btn, ...styles.btnPrimary }} onClick={() => setIsRunning((v) => !v)}>
                        {isRunning ? "Stop" : demoDone ? "Run Demo Again" : "Start Demo"}
                    </button>
                    <button style={styles.btn} onClick={() => addMark("MARK")}>MARK</button>
                    <button style={{ ...styles.btn, ...(logs.length ? {} : styles.btnDisabled) }} disabled={!logs.length} onClick={openExport}>Export</button>
                </div>
            </div>

            <div style={styles.container}>
                {/* Topbar */}
                <div style={styles.topbar}>
                    <div style={styles.brand}>
                        <div style={styles.logo}>R</div>
                        <div style={styles.brandText}>
                            <div style={styles.brandName}>Regal</div>
                            <div style={styles.brandTag}>Legal Operations Platform</div>
                        </div>
                    </div>

                    <div style={styles.rightTop}>
                        <div style={styles.status}>
                            {isRunning ? "Demo transcription running" : demoDone ? "Demo complete" : "Demo ready"} · Ctrl/⌘+Enter toggle · Ctrl/⌘+K mark
                        </div>

                        <div style={styles.badge} onClick={() => setVerifyOpen(true)} title="Open verification" role="button">
                            <span style={styles.badgeDot(!!profile)} />
                            {profile ? (
                                <>
                                    <span style={{ fontWeight: 900 }}>Verified</span>
                                    <span style={{ color: c.muted }}>
                                        {profile.fullName} · Bar {profile.barNumber} · Valid thru {profile.validThrough}
                                    </span>
                                </>
                            ) : (
                                <>
                                    <span style={{ fontWeight: 900 }}>Not verified</span>
                                    <span style={{ color: c.muted }}>Open verification</span>
                                </>
                            )}
                        </div>
                    </div>
                </div>

                {/* Main */}
                <div style={styles.grid}>
                    {/* Left — sticky so you can always pause/stop */}
                    <div style={styles.leftSticky}>
                        <div style={{ ...styles.card, ...styles.cardPad }}>
                            <div style={styles.h}>Controls</div>

                            <div style={styles.row}>
                                <button style={{ ...styles.btn, ...styles.btnPrimary }} onClick={() => setIsRunning((v) => !v)}>
                                    {isRunning ? "Stop" : demoDone ? "Run Demo Again" : "Start Demo"}
                                </button>
                                <button style={styles.btn} onClick={() => addMark("MARK")}>Add MARK</button>
                                <button style={{ ...styles.btn, ...(logs.length ? {} : styles.btnDisabled) }} disabled={!logs.length} onClick={openExport}>
                                    Export Transcript
                                </button>
                                <button style={{ ...styles.btn, ...styles.btnDanger }} onClick={clearAll}>Clear</button>
                            </div>

                            <div style={{ marginTop: 14, ...styles.h }}>Filter</div>
                            <div style={styles.row}>
                                <select style={styles.select} value={filter} onChange={(e) => setFilter(e.target.value as any)}>
                                    <option value="ALL">All speakers</option>
                                    <option value="JUDGE">Judge</option>
                                    <option value="WITNESS">Witness</option>
                                    <option value="LAWYER 1">Lawyer 1</option>
                                    <option value="LAWYER 2">Lawyer 2</option>
                                    <option value="CLERK">Clerk</option>
                                </select>
                            </div>

                            <div style={{ marginTop: 14, ...styles.h }}>AI Assistant</div>
                            <div style={styles.aiBox}>
                                <textarea
                                    value={aiQuery}
                                    onChange={(e) => setAiQuery(e.target.value)}
                                    style={{ ...styles.input, minHeight: 84, resize: "vertical", fontWeight: 600 }}
                                    placeholder='Example: "Find scenes where the lawyers discussed restaurants."'
                                />
                                <div style={styles.row}>
                                    <button style={{ ...styles.btn, ...styles.btnPrimary }} onClick={runAi} disabled={aiBusy}>
                                        {aiBusy ? "Analyzing…" : "Analyze"}
                                    </button>
                                    <button style={styles.btn} onClick={() => setHighlightIds(new Set())}>Clear highlights</button>
                                </div>

                                {aiAnswer ? (
                                    <div style={styles.aiAnswer}>{aiAnswer}</div>
                                ) : (
                                    <div style={styles.hint}>Ask questions about the transcript. Results appear as scene cards.</div>
                                )}

                                {aiScenes.length > 0 && (
                                    <div style={styles.sceneGrid}>
                                        {aiScenes.map((s) => (
                                            <div key={s.id} style={styles.sceneCard}>
                                                <div style={styles.sceneTitleRow}>
                                                    <div style={styles.sceneTitle}>{s.title}</div>
                                                    <div style={styles.sceneMeta}>
                                                        {fmtTime(s.startAt)} – {fmtTime(s.endAt)}
                                                    </div>
                                                </div>
                                                <div style={{ marginTop: 6, fontSize: 12, color: c.muted }}>Speakers: {s.speakers.join(", ")}</div>
                                                <div style={styles.sceneSnippet}>{s.snippet}</div>
                                                <div style={styles.sceneActions}>
                                                    <button style={styles.btn} onClick={() => jumpToLine(s.lineIds[0])}>Jump</button>
                                                    <button style={{ ...styles.btn, ...styles.btnPrimary }} onClick={() => applyHighlight(s.lineIds)}>Highlight</button>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}

                                <div style={styles.hint}>
                                    Demo stops after one pass. Use “Run Demo Again” to replay. Press <b>Esc</b> to stop instantly.
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Right — transcript (page scrolls) */}
                    <div style={styles.chatShell}>
                        <div style={styles.chatHeader}>
                            <div style={styles.chatTitle}>Proceedings Transcript</div>
                            <div style={styles.chatMeta}>{visible.length} items · view: {filter === "ALL" ? "All speakers" : filter}</div>
                        </div>

                        <div style={styles.chatBody}>
                            {visible.map((m) => {
                                const side: "left" | "right" = m.speaker === "LAWYER 1" || m.speaker === "LAWYER 2" ? "right" : "left";
                                const highlighted = highlightIds.has(m.id);

                                if (m.kind === "mark") {
                                    return (
                                        <div key={m.id} style={{ margin: "10px 0" }} ref={setMsgRef(m.id)}>
                                            <div style={styles.markLine}>
                                                — {m.text} — <span style={{ opacity: 0.75, marginLeft: 10 }}>{fmtTime(m.at)}</span>
                                            </div>
                                        </div>
                                    );
                                }

                                return (
                                    <div key={m.id} style={styles.msgRow(side)} ref={setMsgRef(m.id)}>
                                        <div style={styles.bubble(m.speaker, m.kind, highlighted)}>
                                            <div style={styles.bubbleTop}>
                                                <div style={styles.chip}>
                                                    <span style={styles.avatar}>{speakerInitial(m.speaker)}</span>
                                                    {m.speaker}
                                                </div>
                                                <div style={styles.time}>{fmtTime(m.at)}</div>
                                            </div>
                                            <div style={styles.text}>{m.text}</div>
                                        </div>
                                    </div>
                                );
                            })}

                            {typing && (
                                <div style={styles.typing}>
                                    <span style={{ fontWeight: 700 }}>Transcribing</span>
                                    <span style={styles.dots}>
                                        <span style={styles.dotTiny(0)} />
                                        <span style={styles.dotTiny(140)} />
                                        <span style={styles.dotTiny(280)} />
                                    </span>
                                </div>
                            )}

                            <div ref={bottomRef} />
                        </div>

                        {/* Composer */}
                        <div style={styles.composer}>
                            <select style={styles.select} value={inputSpeaker} onChange={(e) => setInputSpeaker(e.target.value as Speaker)}>
                                <option value="LAWYER 1">LAWYER 1</option>
                                <option value="LAWYER 2">LAWYER 2</option>
                                <option value="JUDGE">JUDGE</option>
                                <option value="WITNESS">WITNESS</option>
                                <option value="CLERK">CLERK</option>
                            </select>

                            <input
                                style={styles.input}
                                value={manual}
                                onChange={(e) => setManual(e.target.value)}
                                placeholder="Type to add to the record…"
                                onKeyDown={(e) => {
                                    if (e.key === "Enter") addManual();
                                }}
                            />

                            <button
                                style={{ ...styles.btn, ...styles.btnPrimary, ...(clampText(manual) ? {} : styles.btnDisabled) }}
                                onClick={addManual}
                                disabled={!clampText(manual)}
                            >
                                Send
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
