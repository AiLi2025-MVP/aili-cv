# Lateef Cobb – AI-Native Governance Site

A luxury editorial microsite for Lateef Cobb that serves static assets from `/public` and relays private inquiries through a Vercel-ready serverless API with Mailchimp + optional webhook delivery.

## Features

- Cinematic, responsive landing page tailored to high-profile clientele.
- Contact form with honeypot, async submission state, and graceful fallbacks.
- `api/inquiry.js` serverless handler (Node 20) that validates payloads, enforces CORS, relays to Mailchimp, and optionally pings a webhook (Zapier/Slack/etc.).
- `vercel.json` config so Vercel deploys the API on Node 20 while serving `/public` as static assets.
- Lightweight `server.js` for local-only development (static hosting + hot reload via `npm run dev`).

## Local Development

1. Ensure Node.js 18+ is installed.
2. Copy the environment template and add your secrets:
   ```bash
   cp .env.example .env
   ```
   Populate:
   - `MAILCHIMP_API_KEY`, `MAILCHIMP_SERVER_PREFIX`, `MAILCHIMP_LIST_ID`
   - `ALLOWED_ORIGINS` (comma-separated list of origins allowed to call the API)
   - `INQUIRY_WEBHOOK_URL` (optional secondary relay)
3. Start the static dev server:
   ```bash
   npm run dev
   ```
   Browse `http://localhost:3000`. The front-end posts to the `data-api-base` attribute on `<body>` (defaults to `/api`), so when running locally with Vercel CLI the same code works without changes.

## Deploying on Vercel

1. Push this repo to GitHub (e.g., `github.com/AiLi2025-MVP/aili-cv`).
2. Create a new Vercel project and link the repository.
3. Set these environment variables in Vercel:
   - `MAILCHIMP_API_KEY`
   - `MAILCHIMP_SERVER_PREFIX`
   - `MAILCHIMP_LIST_ID`
   - `ALLOWED_ORIGINS` (e.g., `https://lateefcobb.com,https://www.lateefcobb.com`)
   - `INQUIRY_WEBHOOK_URL` (optional)
4. Deploy. `vercel.json` instructs Vercel to run `api/inquiry.js` on Node 20 while serving `public/` as static files. No custom build command is required.

> Need a dedicated API domain? Update `<body data-api-base="https://api.theaili.com/api">` in `public/index.html` before deploying the static assets elsewhere (S3/CF, etc.).

## Mailchimp + Webhook Flow

- Every valid brief upserts (or creates) a Mailchimp audience member via the official API and appends the briefing as a subscriber note.
- If `INQUIRY_WEBHOOK_URL` is set, the same payload is POSTed to that URL so you can notify Slack, Make, Airtable, etc.

## Project Structure

```
.
├── api
│   └── inquiry.js        # Vercel serverless endpoint
├── public
│   ├── index.html        # Landing page
│   ├── main.js           # Scroll + form logic
│   └── styles.css        # Luxury theme
├── server.js             # Local static dev server only
├── vercel.json           # Vercel routing/runtime config
├── package.json
├── .env.example
└── README.md
```
