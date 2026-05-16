# Regal

[![Live Demo](https://img.shields.io/badge/Live%20Demo-Visit-2563EB?style=flat-square&logo=github)](https://qiankangwang.github.io/regal/)

An AI-powered legal operations platform that streamlines depositions through real-time transcription, intelligent assistance, and faster case navigation.

## Live Demo

**[qiankangwang.github.io/regal](https://qiankangwang.github.io/regal/)**

## Demo

<p align="center">
  <img src="./Regal.gif" alt="Regal demo" width="900">
</p>

## Features

- Real-time deposition transcription
- AI-powered legal assistance and Q&A
- Intuitive case navigation and document management
- Modern, responsive UI for legal professionals

## Tech Stack

- **Frontend**: React, TypeScript, Vite
- **Backend**: Node.js, Express
- **Styling**: CSS

## Getting Started

```bash
# Install dependencies
npm install

# Start the development server
npm run dev
```

## Project Structure

```
├── src/                    # React frontend
│   ├── App.tsx             # Main UI — transcript, controls, modals
│   ├── assistant.ts        # Keyword search over the transcript
│   ├── formatTranscript.ts # Court-style .txt export formatting
│   ├── types.ts            # Shared types
│   ├── utils.ts            # Helpers (ids, time/date formatting, text wrap)
│   ├── hooks/              # useMediaQuery, useLocalStorage
│   ├── main.tsx
│   ├── index.css
│   └── App.css
├── server/                 # Deepgram transcription backend (Express)
│   ├── server.js           # POST /api/transcribe — proxies audio to Deepgram
│   ├── .env.example        # Copy to .env, then set DEEPGRAM_API_KEY
│   └── package.json
├── public/
├── index.html
├── package.json
├── vite.config.ts
└── tsconfig.json
```

## About

Regal was built to modernize the deposition workflow, reducing manual overhead and enabling legal teams to focus on case strategy.
