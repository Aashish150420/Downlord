# FluxDL

FluxDL is a web-based media downloader built with Node.js, Express, and a single-page frontend.
It supports direct downloads, playlists, queue tracking, history, Google sign-in, and Railway deployment.

## Features

- Download supported media URLs as `mp4` or `mp3`
- Queue management and download history
- Playlist loading and item filtering
- Subtitle controls for supported sources
- Google authentication with session-based login
- Live logs viewer
- Browser extension handoff support
- Railway-friendly production setup

## Tech Stack

- Node.js
- Express
- Passport + Google OAuth 2.0
- Express session
- Vanilla frontend with React via ESM CDN
- `yt-dlp` / `ffmpeg` workflow on the backend

## Project Structure

- [server/index.js](server/index.js) — Express app bootstrap
- [server/routes](server/routes) — API/auth/download routes
- [server/utils](server/utils) — downloader, queue, history helpers
- [public/index.html](public/index.html) — app shell
- [public/react-app.js](public/react-app.js) — main frontend app
- [browser-extension/fluxdl-send](browser-extension/fluxdl-send) — optional browser extension

## Local Development

### 1. Install dependencies

```bash
npm install
```

### 2. Create your `.env`

Example:

```env
PORT=3000
DOWNLOAD_DIR=./downloads
HISTORY_FILE=./history.json
RATE_LIMIT_MAX=30
MAX_CONCURRENT_DOWNLOADS=2
DOWNLOAD_RETRY_ATTEMPTS=2
DOWNLOAD_RETRY_DELAY_MS=3000

SPOTIFY_CLIENT_ID=your_spotify_client_id
SPOTIFY_CLIENT_SECRET=your_spotify_client_secret

GOOGLE_CLIENT_ID=your_google_client_id
GOOGLE_CLIENT_SECRET=your_google_client_secret
GOOGLE_CALLBACK_URL=http://localhost:3000/auth/google/callback
SESSION_SECRET=replace_with_a_long_random_secret
AUTH_SUCCESS_REDIRECT=/
NODE_ENV=development
```

### 3. Run locally

```bash
npm run dev
```

Or production-style start:

```bash
npm start
```

App URL:

- `http://localhost:3000`

## Google OAuth Setup

Create a Google OAuth client and configure:

### Local

- Authorized JavaScript origin: `http://localhost:3000`
- Authorized redirect URI: `http://localhost:3000/auth/google/callback`

### Railway Production

For this deployment:

- Authorized JavaScript origin: `https://downlord-production.up.railway.app`
- Authorized redirect URI: `https://downlord-production.up.railway.app/auth/google/callback`

Railway env var:

- `GOOGLE_CALLBACK_URL=https://downlord-production.up.railway.app/auth/google/callback`

## Railway Deployment

Set these Railway variables:

- `NODE_ENV=production`
- `SESSION_SECRET=<long random secret>`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_CALLBACK_URL=https://downlord-production.up.railway.app/auth/google/callback`
- `AUTH_SUCCESS_REDIRECT=/`
- `SPOTIFY_CLIENT_ID`
- `SPOTIFY_CLIENT_SECRET`
- Optional: `RATE_LIMIT_MAX`, `MAX_CONCURRENT_DOWNLOADS`, `DOWNLOAD_RETRY_ATTEMPTS`, `DOWNLOAD_RETRY_DELAY_MS`

Notes:

- [server/index.js](server/index.js) already includes `app.set("trust proxy", 1)` for Railway.
- In production, session cookies are marked `secure` when `NODE_ENV=production`.
- Keep `.env` out of git.

## Browser Extension

An unpacked Chrome/Edge extension is included in [browser-extension/fluxdl-send](browser-extension/fluxdl-send).

What it does:

- Adds **Send to FluxDL** to the context menu
- Sends the current/media URL into the app
- Supports configuring the app base URL

See [browser-extension/fluxdl-send/README.md](browser-extension/fluxdl-send/README.md).

## Scripts

From [package.json](package.json):

- `npm start` — start the server
- `npm run dev` — run with `nodemon`
- `npm test` — placeholder only

## Notes

- This project relies on backend downloader tooling being available for full media support.
- Some features depend on external credentials and platform support.
- Downloads and history are stored locally by default.

## Security

- Do not commit real OAuth or API secrets.
- Rotate any secrets that were exposed during development.
- Use a strong `SESSION_SECRET` in production.

## License

ISC
