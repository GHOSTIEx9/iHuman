# iHuman — AI Text Humanizer

A production-ready, single-page AI humanizer with a liquid-glass UI over a live aurora gradient background. Pure static files: no build step, no dependencies, no servers, no API keys.

**Your text never leaves the browser** — the humanizer engine is plain JavaScript running locally.

## Run locally

Open `index.html` directly, or serve the folder:

```bash
python3 -m http.server 8080
# then visit http://localhost:8080
```

## Deploy

It's a fully static site, so any static host works — copy the four files (index.html, styles.css, humanizer.js, app.js) to:

- **Netlify** — drag-and-drop the folder at app.netlify.com/drop
- **Vercel** — `npx vercel` in this folder
- **GitHub Pages** — push the files, enable Pages on the branch
- **Cloudflare Pages** — connect the repo, no build command needed

## Files

| File | Purpose |
|---|---|
| `index.html` | Markup, SVG logo/favicon, SEO + OG meta |
| `styles.css` | Design system: glass UI, aurora background, animations |
| `humanizer.js` | Offline rewriting engine v2 (exposes `window.IHumanizer`) |
| `dev-test.js` | Fuzz/quality harness for the engine (dev only, not shipped) |
| `app.js` | UI wiring: counters, meter, copy/download/speech, toasts |

## Customizing

- **Word banks:** edit `CLICHES`, `SYNONYMS`, `CONTRACTIONS`, `OPENERS` arrays at the top of `humanizer.js`.
- **Colors/typography:** tweak the `:root` variables at the top of `styles.css`.
- **Intensity modes:** degrees 1–3 map to Subtle / Balanced / Deep in `app.js` (`DEGREE` map).
- **Voices (styles):** `casual`, `professional`, `academic`, `genz` — each swaps the openers, fillers, tail tags, hedges, connectors, synonym bank, contraction rate, and emoji behavior. Add a new one in the `STYLES` object in `humanizer.js` (it appears automatically via `IHumanizer.styles()`); style-specific phrase corrections go in `postCliches`.

## The engine (v2)

The humanizer is a structure-aware rewriting pipeline that runs entirely in your browser:

1. **Structural passes** — passive→active voice conversion (guarded, bail-out safe), "there is/are" expletive extraction, discourse-marker demotion.
2. **190+ cliché rewrite rules** — inflated verbs (delve/leverage/utilize/foster), meta-commentary deletion ("it is important to note that"), heavy noun phrases → verbs ("plays a pivotal role in" → "is key to"), AI landscape filler, discourse markers → conversational equivalents.
3. **Guarded synonym rotation** — seeded and context-aware; proper nouns, possessives, acronyms, and sentence-start words that can't be de-capitalized are protected.
4. **Burstiness engine** — clause-level sentence splitting at balanced conjunction points, short-sentence merging, repetition-variety enforcement.
5. **Human texture** — conversational openers, hedges, fillers, em-dashes, tail tags, punch sentences (probability scales with intensity).
6. **Style banks** — four voices (casual / professional / academic / Gen-Z) that swap the texture material and synonym bank per request.
7. **AI-likeness detector + best-of-N selection** — every request generates 2–4 candidate rewrites; an internal detector scores each on the statistical signals AI detectors look at (sentence-length variance, windowed lexical diversity, stopword band, punctuation cadence, cliché density) and the most human candidate wins. A rewrite that scores worse than the original is never shipped.

Safety: quoted text, code spans, URLs, emails, acronyms (NASA, IT), and proper nouns are stashed before transformation and restored after.

Run the engine's test harness: `node dev-test.js`

## Notes

- Fonts load from Google Fonts with system fallbacks if offline.
- The "human-ness" score is a heuristic — a strong signal, not a guarantee. No tool can promise zero detection.
- Respects `prefers-reduced-motion`.
