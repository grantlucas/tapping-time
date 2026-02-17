# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with
code in this repository.

## What This Project Is

Tapping Time is a maple sap tapping advisor. It uses browser geolocation and
the Pirate Weather API to analyze 7-day freeze-thaw cycles and recommend when
to tap sugar maple trees. It runs as a Cloudflare Worker with no build step.

## Commands

```bash
npm run dev          # Local dev server via wrangler
npm run deploy       # Deploy to Cloudflare Workers
npm test             # Run all tests (vitest run)
npm run test:watch   # Run tests in watch mode
npx vitest run src/scoring.test.js  # Run a single test file
```

## Setup

Requires a `.dev.vars` file (copy from `.dev.vars.example`) with a Pirate
Weather API key. KV namespace IDs in `wrangler.toml` must be set for caching.

## Architecture

The app is two source files with no build step:

- **`src/index.js`** — Cloudflare Worker entry point. Handles the `/api/forecast`
  endpoint (fetches weather, scores days, caches in KV with 3h TTL) and serves
  the inline HTML/CSS/JS frontend for all other routes. The frontend uses
  browser geolocation and vanilla JS (no framework).

- **`src/scoring.js`** — Pure scoring logic, fully unit-tested. Exports
  `scoreDay` (rates a day as excellent/good/fair/poor based on temperature
  thresholds), `findBestWindow` (finds longest consecutive run of good+ days),
  and `generateRecommendation` (produces a typed recommendation message).

All temperatures are in Celsius. The scoring thresholds are exported constants
at the top of `scoring.js`.

## Testing

Tests live alongside source (`src/scoring.test.js`). Only the pure scoring
logic is tested; the Worker handler is not. Tests use Vitest with ESM imports.
