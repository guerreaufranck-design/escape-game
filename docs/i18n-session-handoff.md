# i18n session hand-off — 2026-04-30

Snapshot of the day's translation work, written so a fresh Claude session
(or future-you) can resume cold without re-reading 4 hours of conversation.

---

## TL;DR

Klook Asia push triggered a discovery that ~70 UI strings were either
hardcoded in JSX or only available in 5 static locales (fr/en/de/es/it),
causing buttons + tutorial + errors to fall back to English for the 27
dynamic locales (zh/ja/ko/th/vi/id/etc.). Plus a UX bug: 5-30s wait after
a step skip with no progress feedback ("app crashed" perception).

Both shipped in **commit `c0ae54f`** (deployed via Vercel). DB cache for
27 dynamic locales was pre-warmed via Gemini batch translation, with
human-pass overrides applied to the 6 Klook-priority languages.

---

## What was shipped (commit `c0ae54f`)

Files changed:

```
src/lib/translations.ts           (+~70 keys, dynamic pack store, tt() patched)
src/components/player/Tutorial.tsx                  (refactored to use tt())
src/components/player/StepTransitionOverlay.tsx     (NEW — fullscreen loader)
src/components/player/UITranslationsProvider.tsx    (NEW — useUITranslations hook)
src/app/(player)/play/[sessionId]/page.tsx         (hardcoded strings extracted)
src/app/(player)/leaderboard/page.tsx              (hook mounted)
src/app/(player)/results/[sessionId]/page.tsx      (hook mounted)
```

Behaviour added:

- `tt(key, locale)` now consults a module-level dynamic pack store before
  the static `ui` object. Static fallback chain unchanged.
- `useUITranslations(locale)` hook hydrates from localStorage, refetches
  `/api/translations?lang=<locale>`, writes into the dynamic store via
  `setDynamicUIPack()`, triggers re-render via `useSyncExternalStore`.
- Mounted on `/play/[sessionId]`, `/leaderboard`, `/results/[sessionId]`.
  Home page already uses its own `useTranslatedUI()` hook (unchanged).
- New `StepTransitionOverlay` shows a fullscreen reassurance modal during
  `skipping` or `isLoading` step transitions. Rotates copy at 4s/12s/22s.
  Includes the message "the app hasn't crashed — translation in progress".

---

## Translation cache state (as of session end)

Source of truth: Supabase table `ui_translations_cache` (one row per
`(translation_key, language)` pair). Total UI keys = 169 (after the
~70 additions on this branch).

| Locale | Coverage | Human-pass | Notes |
|---|---|---|---|
| ja | 169/169 | yes (10 keys) | full |
| ko | 169/169 | yes (~9 keys) | full |
| th | 169/169 | yes (~3 keys) | full |
| vi | 169/169 | yes (~2 keys) | full |
| id | 169/169 | yes (~22 keys) | filled by hand after Gemini truncation |
| zh | 141/169 | yes (~7 keys) | 22 tutorial paragraphs still EN — Gemini truncates Chinese output reliably; live with it or hand-translate |
| 21 others | ? | no | being pre-warmed by `scripts/prewarm-all-languages.ts` (in flight at session end) |

User runs Vercel Pro/Enterprise (60s function timeout — Hobby would have
died on Indonesian's 43s call).

---

## Known fragilities (to fix later, NOT urgent)

### `translateUIStrings()` in `src/lib/translate-service.ts`

Three real bugs we hit today:

1. **Fire-and-forget upserts** (line ~357):
   ```ts
   supabase.from("ui_translations_cache").upsert(...).then(() => {});
   ```
   Vercel can kill the function before these resolve. Symptom: API
   returns 200 with translated strings, but DB has 0 rows. Hit us on
   `id` first call.

2. **Single oversized Gemini call**: The function sends all uncached
   keys in one request. Gemini 2.5 Flash output cap is ~8K tokens; long
   tutorial paragraphs in verbose languages (zh especially) truncate
   the JSON, parse fails, fallback returns English with no DB write.
   Hit us on `zh` consistently — 22 tutorial paragraphs never make it.

3. **Silent fallback on Gemini errors** (line ~376): On 503 / parse
   error / timeout, returns English without logging which keys failed
   or notifying the caller. Player sees English strings in their
   non-English UI without anyone knowing.

**Fix recipe** (next time we touch this):
- Replace the `.then(() => {})` with `await` (or a Promise.all batch
  upsert).
- Chunk the prompt into batches of ~30 keys before Gemini call.
- Add explicit retry-on-503 + return error info to caller.
- Log failed keys with `[ui-translate]` prefix so they show up in
  Vercel runtime logs.

The robust pattern is in `scripts/prewarm-all-languages.ts` — copy that
chunking + retry logic into the API route when refactoring.

### Mysterious row deletion on `ui_translations_cache`

At some point during today's session, the JA cache went from ~161 rows
to 10 (only the manual human-pass overrides remained). No deletion
script touched this table; the only writers are `translateUIStrings()`
(insert-only) and our manual SQL upserts (which preserve other rows).

**Hypothesis (unverified)**: Could be a Supabase quirk under upsert
contention, a TTL we missed, or a manual operation we didn't track.

**Mitigation**: Re-run pre-warm restored JA. But if a customer's UI
goes English mid-session next time, this is the first place to look.
Consider a weekly cron that checks every locale's row count and alerts
if any drops below 90% of `Object.keys(ui).length`.

### CDN cache poisoning on apex domain

User reported `https://oddballtrip.com/api/translations?lang=zh`
returning HTTP 500 cached for ~6 minutes (`age: 372`). The `www.`
domain CDN cached an earlier failure. Direct Vercel domain
(`escape-game-indol.vercel.app`) was fine throughout.

**If this recurs**: Vercel dashboard → Settings → Caching → Purge.
The `/api/translations` route emits no `Cache-Control` header (the
file I almost added did, but I removed that file). CDN default
behaviour for 5xx may cache for ~10 min.

---

## How the dynamic translation system works (architecture)

```
┌─────────────────────────────────────────────────────────────────┐
│ Server side                                                     │
│                                                                 │
│   /api/translations?lang=ja  (existing endpoint)                │
│      → translateUIStrings(englishStrings, "ja")                 │
│         → check ui_translations_cache for cached keys           │
│         → call Gemini for missing keys (FRAGILE — see above)    │
│         → return { locale, strings: { ... 169 keys ... } }      │
└─────────────────────────────────────────────────────────────────┘
                              │ HTTP
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ Client side                                                     │
│                                                                 │
│  PlayPage / LeaderboardPage / ResultsPage                       │
│     useUITranslations(locale)                                   │
│        ├─ on mount: load from localStorage if present           │
│        ├─ always refetch /api/translations?lang=...             │
│        ├─ setDynamicUIPack(locale, pack)                        │
│        │     → updates module-level dynamicPacks[locale]        │
│        │     → bumps version, notifies subscribers              │
│        └─ writes to localStorage (warm-boot speed)              │
│                                                                 │
│  Anywhere in the page:                                          │
│     tt(key, locale)                                             │
│        ├─ check dynamicPacks[locale][key]   ← dynamic           │
│        ├─ check ui[key][locale]             ← static (5 langs)  │
│        ├─ check ui[key].en                  ← English fallback  │
│        ├─ check ui[key].fr                  ← French fallback   │
│        └─ return key                        ← debug visible     │
└─────────────────────────────────────────────────────────────────┘
```

The two systems are independent:
- `useTranslatedUI(locale)` (older, in `LocaleSelector.tsx`) — used by
  the home page only. Returns a per-component `tt()` function.
- `useUITranslations(locale)` (new, in `UITranslationsProvider.tsx`)  —
  populates a module-level store consulted by the global `tt()`.

Both hit the same `/api/translations` endpoint, both write to
localStorage with different keys (`escape-game-ui-XX` vs `ui_pack_XX`).
Some duplication, harmless.

---

## SQL snippets for ops

### View what's cached for a language

```sql
SELECT translation_key, translated_text
FROM ui_translations_cache
WHERE language = 'ja'
ORDER BY translation_key;
```

### Force re-translation of one key

```sql
DELETE FROM ui_translations_cache
WHERE language = 'ja' AND translation_key = 'tutorial.s5.text';
-- next /api/translations?lang=ja call regenerates it
```

### Override a single value (idempotent)

```sql
INSERT INTO ui_translations_cache (translation_key, language, translated_text)
VALUES ('ar.skipButton', 'ja', 'スキップ')
ON CONFLICT (translation_key, language)
DO UPDATE SET translated_text = EXCLUDED.translated_text;
```

### Coverage check across all dynamic locales

Run from project root:

```bash
npx tsx scripts/check-cache-counts.ts
```

### Find missing keys for a locale

```bash
npx tsx scripts/check-cache-gaps.ts
```

(Edit the locale list at the top of the script.)

### Pre-warm a locale (or all dynamic locales)

```bash
npx tsx scripts/prewarm-all-languages.ts
```

Built today. Robust: chunked Gemini calls (30 keys/batch), 3 retries,
synchronous DB writes. Skips already-complete locales.

---

## Reference: the 32 supported locales

Defined in `src/lib/i18n.ts`:

- **Static** (bundled in `translations.ts`): fr, en, de, es, it
- **Dynamic** (Gemini-translated, 27 langs):
  pt, nl, pl, ru, zh, ja, ko, ar, hi, tr, sv, da, no, fi, el, cs, ro,
  hu, th, he, uk, id, vi, ms, hr, bg, ca

Klook-priority subset: zh, ja, ko, th, vi, id

---

## Next high-leverage tasks if you resume this thread

1. **Verify the prewarm script result** — output at
   `/tmp/claude-501/-Users-franckguerreau-Documents-ESCAPE-GAME/.../bzqy5w3jq.output`
   (or rerun the script if not finished). Check that all 27 locales
   reach 169/169.

2. **Hand-translate the 22 zh tutorial paragraphs** if quality matters
   for the Chinese Klook market. Gemini truncates them every time;
   they need to be inserted via SQL by a fluent speaker (or a different
   model with a bigger output window — Claude 3.5 Sonnet or Gemini 1.5
   Pro both have 8K+ output and would not truncate).

3. **Refactor `translateUIStrings()`** (see fragilities above).
   Replace fire-and-forget with awaited batch upserts. Add chunking.
   This unblocks the API endpoint as a reliable on-demand translator
   for any new locale a player picks for the first time.

4. **Add a coverage-monitoring cron** — daily script that counts rows
   per locale in `ui_translations_cache`, alerts if any drops by >5%
   from the previous run. Catches the mystery row-deletion bug if it
   recurs.

5. **(Live test before Klook)** — generate a test code in `ja`, walk
   through tutorial + 1 step + 1 skip on a real device. Confirm the
   `StepTransitionOverlay` actually appears during the 5-30s wait.
   Code is correct on inspection but never tested end-to-end with a
   real Gemini-translation call in production.

---

## Files added today (not yet committed)

```
scripts/check-cache-counts.ts          (count rows per locale)
scripts/check-cache-gaps.ts            (list missing keys per locale)
scripts/check-tours-game.ts            (debug script — Tournus session check)
scripts/debug-id-translation.ts        (one-off Gemini test, can delete)
scripts/debug-id-full.ts               (one-off Gemini test, can delete)
scripts/prewarm-all-languages.ts       (robust pre-warm — keep)
docs/i18n-session-handoff.md           (this file)
```

Recommend committing `prewarm-all-languages.ts` + `check-cache-counts.ts`
+ `check-cache-gaps.ts` + this doc. The `debug-id-*` scripts are
disposable.
