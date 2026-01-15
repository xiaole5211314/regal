/* Deepgram WebSocket proxy
   - Browser connects: ws://localhost:8080/ws?model=nova-3&language=en-US&diarize=true
   - Browser sends: raw PCM 16-bit little-endian @ 16kHz mono (binary frames)
   - Server forwards to: wss://api.deepgram.com/v1/listen?... with Authorization header
*/
const http = require("http");
const dotenv = require("dotenv");
const WebSocket = require("ws");
const { URL } = require("url");

dotenv.config();

const PORT = process.env.PORT ? Number(process.env.PORT) : 8080;
const API_KEY = process.env.DEEPGRAM_API_KEY;

if (!API_KEY) {
  console.error("Missing DEEPGRAM_API_KEY. Create server/.env and set DEEPGRAM_API_KEY=...");
  process.exit(1);
}

const server = http.createServer((req, res) => {
  res.writeHead(200, { "content-type": "text/plain" });
  res.end("Deepgram proxy running.\n");
});

const wss = new WebSocket.Server({ server });

function buildDeepgramUrl(reqUrl) {
  const u = new URL(reqUrl, `http://localhost:${PORT}`);
  const model = u.searchParams.get("model") || "nova-3";
  const language = u.searchParams.get("language") || "en-US";
  const diarize = u.searchParams.get("diarize") || "false";

  // Deepgram live listen endpoint
  // wss://api.deepgram.com/v1/listen :contentReference[oaicite:5]{index=5}
  const dg = new URL("wss://api.deepgram.com/v1/listen");

  // IMPORTANT: we are streaming raw PCM int16, 16kHz, mono
  dg.searchParams.set("encoding", "linear16");
  dg.searchParams.set("sample_rate", "16000");
  dg.searchParams.set("channels", "1");

  dg.searchParams.set("model", model);
  dg.searchParams.set("language", language);
  dg.searchParams.set("punctuate", "true");
  dg.searchParams.set("smart_format", "true");
  dg.searchParams.set("interim_results", "true");

  // Speaker diarization (optional)
  // diarize=true assigns a speaker number per word :contentReference[oaicite:6]{index=6}
  dg.searchParams.set("diarize", diarize);

  // You can tune endpointing (pause-to-finalize). Leave default for now.
  // dg.searchParams.set("endpointing", "500");

  return dg.toString();
}

wss.on("connection", (clientWs, req) => {
  const dgUrl = buildDeepgramUrl(req.url || "/ws");
  const dgWs = new WebSocket(dgUrl, {
    headers: { Authorization: `Token ${API_KEY}` }
  });

  let sawAudio = false;

  // KeepAlive every 3s (docs say 3–5s) :contentReference[oaicite:7]{index=7}
  const ka = setInterval(() => {
    if (dgWs.readyState === WebSocket.OPEN) {
      dgWs.send(JSON.stringify({ type: "KeepAlive" }));
    }
  }, 3000);

  dgWs.on("open", () => {
    clientWs.send(JSON.stringify({ type: "proxy_open" }));
  });

  dgWs.on("message", (data) => {
    // Deepgram sends JSON text frames (Results/Metadata/etc.)
    clientWs.send(data.toString());
  });

  dgWs.on("close", (code, reason) => {
    clearInterval(ka);
    try {
      clientWs.send(JSON.stringify({ type: "proxy_close", code, reason: reason?.toString?.() || "" }));
    } catch {}
    try { clientWs.close(); } catch {}
  });

  dgWs.on("error", (err) => {
    clearInterval(ka);
    try {
      clientWs.send(JSON.stringify({ type: "proxy_error", message: err?.message || String(err) }));
    } catch {}
    try { clientWs.close(); } catch {}
  });

  clientWs.on("message", (msg, isBinary) => {
    if (dgWs.readyState !== WebSocket.OPEN) return;

    // Binary = audio chunk (must not be empty) :contentReference[oaicite:8]{index=8}
    if (isBinary) {
      if (msg.length === 0) return;
      sawAudio = true;
      dgWs.send(msg);
      return;
    }

    // Text = control message from browser (optional)
    const s = msg.toString();
    try {
      const j = JSON.parse(s);
      // Forward supported control messages as text frame
      dgWs.send(JSON.stringify(j));
    } catch {
      // ignore
    }
  });

  clientWs.on("close", () => {
    clearInterval(ka);

    // If you opened a stream, close it properly (CloseStream) :contentReference[oaicite:9]{index=9}
    try {
      if (dgWs.readyState === WebSocket.OPEN) {
        // Note: KeepAlive alone does not prevent closure; you must send at least one audio frame. :contentReference[oaicite:10]{index=10}
        if (sawAudio) dgWs.send(JSON.stringify({ type: "CloseStream" }));
        dgWs.close();
      }
    } catch {}
  });
});

server.listen(PORT, () => {
  console.log(`Deepgram proxy WS listening on http://localhost:${PORT}`);
  console.log(`WS endpoint: ws://localhost:${PORT}/ws?model=nova-3&language=en-US&diarize=true`);
});
