# CantoCards v0.4 — Mobile Cold-Start Optimized

This build keeps the learning logic, progress schema and UI, but changes how data is loaded on mobile.

## What changed

- Cold start now loads only `cards.json` + compact `startup.json` (~1.55 MB total uncompressed), instead of parsing the full ~12.9 MB lexical/sentence database before showing the home screen.
- Example words and sentences are split into 32 ~100 KB shards and parsed only when a revealed card needs them.
- Word-search terms live in a compact lazy `search_index.json` and load only when search/filtering needs them.
- The Service Worker prepares all optimized shards in the background for full offline use, without blocking the home screen.
- Progress keys remain exactly:
  - `cantoCards.progress.v1`
  - `cantoCards.settings.v1`

## Expected behavior

- App shell/home should appear much faster after a cold launch.
- The first reveal of a card from an uncached/unparsed example shard may briefly show “正在載入例詞與語境…”.
- After Settings → 安裝與離線 shows “離線功能已啟用”, all example shards/search index have been cached for offline use.
- Closing the app still clears JavaScript memory, but the next cold start only reparses the compact core data; example shards are parsed in small pieces as needed.

## Repository deployment

Upload the optimized build to the repository root. Existing legacy files `data/words.json`, `data/card_words.json`, and `data/sentences.json` are no longer used by the runtime. They may remain temporarily during QA; after QA passes they can be deleted for repository cleanliness.

The one-time `migrate-v04.html` rescue page is also not required by this optimized final build.
