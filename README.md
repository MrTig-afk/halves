# Halves

Scan a receipt, crop it to the items and choose what's shared by tap or by voice. Halves keeps a running tab between two roommates, and one Settle all clears it.

Live URL: https://halves-nine.vercel.app

## Stack

- Next.js 16 (App Router, TypeScript) on Vercel
- Neon Postgres (one database, bills and receipt photos)
- Google Gemini (free tier) reads receipts and voice commands

## Run it locally

```bash
git clone <repo-url> halves && cd halves
npm install
cp .env.example .env      # then fill in each value (comments say where from)
npm run dev               # http://localhost:3000
```

## Checks

```bash
npm run lint
npm test
npm run build
```
