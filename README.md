# Lateef Cobb – AI-Native Governance Site

A luxury editorial microsite for Lateef Cobb that serves static assets securely and relays private inquiries to Mailchimp (while optionally keeping a local JSON log if Mailchimp is not configured).

## Features

- Fully responsive static experience with cinematic motion cues.
- Secure Node.js server that serves the site with hardened headers.
- `/api/inquiry` endpoint validates submissions, relays them to Mailchimp, and stores a local JSON log.
- Configurable API base + CORS headers so the static site can talk to a remote backend domain in production.
- Front-end contact form with async submission, honeypot spam protection, and status messaging.

## Getting Started

1. **Install dependencies** (none are required beyond Node.js 16+).
2. Copy the example environment file and fill it with your Mailchimp credentials:
   ```bash
   cp .env.example .env
   ```
   - `MAILCHIMP_API_KEY`: A Mailchimp API key with access to your target audience.
   - `MAILCHIMP_SERVER_PREFIX`: The dc value from your API key (e.g., `us1`).
   - `MAILCHIMP_LIST_ID`: The audience/list ID that should receive inquiries.
   - `PORT` (optional): Port for the HTTP server (defaults to `3000`).
   - `ALLOWED_ORIGINS` (optional): Comma-delimited list of origins permitted to call `/api/inquiry` (set to `https://yourdomain.com` when front end and backend are split).
3. Start the server:
   ```bash
   npm run dev
   ```
   Visit `http://localhost:3000` to view the site.

> The server writes a copy of each inquiry to `data/inquiries.json` so there is always an offline record. Keep that file secure.

## Deployment Notes

- Deploy as a simple Node service (Render, Railway, Fly.io, etc.).
- Provide the Mailchimp environment variables in your hosting dashboard.
- Behind a reverse proxy/SSL terminator, ensure HTTPS is enforced so form data stays encrypted in transit.

## Mailchimp Integration

The backend upserts each inquiry into the configured audience using Mailchimp's API and appends the briefing details as a subscriber note. If Mailchimp credentials are omitted, submissions are still logged locally and the front-end will notify visitors that their brief was received.

### Front-end API Base

`public/index.html` sets `data-api-base="/api"` on `<body>`. Update that attribute to point at your deployed backend origin (for example `https://api.theaili.com/api`) if you host the static site separately. The JavaScript automatically posts to that base while maintaining the same UX.

## Project Structure

```
.
├── public
│   ├── index.html
│   ├── main.js
│   └── styles.css
├── server.js
├── package.json
├── README.md
└── .env.example
```
