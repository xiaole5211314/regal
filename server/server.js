import express from "express";
import multer from "multer";

const app = express();
const upload = multer(); // memory storage

app.post("/api/transcribe", upload.single("audio"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No audio file uploaded (field name must be 'audio')" });

    const dgKey = process.env.DEEPGRAM_API_KEY;
    if (!dgKey) return res.status(500).json({ error: "Missing DEEPGRAM_API_KEY env var" });

    const contentType = req.file.mimetype || "audio/webm";

    const url =
      "https://api.deepgram.com/v1/listen" +
      "?model=nova-2" +
      "&smart_format=true" +
      "&punctuate=true" +
      "&diarize=true" +
      "&utterances=true";

    const r = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Token ${dgKey}`,
        "Content-Type": contentType
      },
      body: req.file.buffer
    });

    const data = await r.json();

    if (!r.ok) {
      return res.status(r.status).json({ error: "Deepgram request failed", deepgram: data });
    }

    res.json({ utterances: data?.results?.utterances ?? [] });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

app.listen(3001, () => console.log("Backend on http://localhost:3001"));
