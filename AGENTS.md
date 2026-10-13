# japanesehelper — agent notes

React + Vite PWA (local-only, IndexedDB). Main app: `src/App.tsx` (decks/cards, SM-2 in `src/lib/srs.ts`, state in `src/lib/storage.ts`, DB `japanese_srs_db`).

## WK Path (local WaniKani clone)

- `src/lib/wk/api.ts`: personal-token API client (pagination, 429/RateLimit-Reset backoff). `syncContent` downloads all subjects + SRS systems (incremental via `updated_after`, image-only radical SVGs cached); `importProgress` snapshots assignments, review stats, study materials, level progressions.
- `src/lib/wk/engine.ts`: WaniKani rules — stage intervals rounded down to the hour, `ceil(wrong/2) × (2 if ≥ Guru)` penalty, unlock when components pass, level up at 90 % of level kanji passed, `max_level_granted` cap, lesson/review queues, forecast.
- `src/lib/wk/grading.ts`: meaning (whitelist/blacklist/user synonyms, typo tolerance) and reading (kana/romaji, kanji wrong-reading-type → retry).
- `src/lib/wk/db.ts`: separate IndexedDB `japanese_srs_wk` (keys `content`, `progress`); content is large, never store it in `AppState`.
- `src/wk/WkApp.tsx`: dashboard, lessons, quiz/review session, browse/search, subject pages; `src/wk/markup.tsx` renders mnemonic tags.
- WaniKani content must never be committed (public repo); it only lives in the user's browser.

## Commands

- `npm install`, `npm run dev` (port 3000, strict), `npx vitest run`, `npm run build` (tsc + vite).
