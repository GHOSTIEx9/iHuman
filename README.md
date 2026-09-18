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
| `humanizer.js` | Offline rewriting engine (exposes `window.IHumanizer`) |
| `app.js` | UI wiring: counters, meter, copy/download/speech, toasts |

## Customizing

- **Word banks:** edit `CLICHES`, `SYNONYMS`, `CONTRACTIONS`, `OPENERS` arrays at the top of `humanizer.js`.
- **Colors/typography:** tweak the `:root` variables at the top of `styles.css`.
- **Intensity modes:** degrees 1–3 map to Subtle / Balanced / Deep in `app.js` (`DEGREE` map).

## Notes

- Fonts load from Google Fonts with system fallbacks if offline.
- The "human-ness" score is a heuristic (sentence-length variance, contraction density, remaining clichés) — a signal, not a guarantee.
- Respects `prefers-reduced-motion`.
