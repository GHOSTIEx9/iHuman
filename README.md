# iHuman — AI Text Humanizer

A production-ready, single-page AI humanizer with a liquid-glass UI over a live ember-gradient background. Pure static files: no build step, no dependencies, no servers, no API keys.

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
| `styles.css` | Design system: glass UI, live gradient background, animations |
| `humanizer.js` | Offline rewriting engine v3 — 12-stage pipeline + document runtime (exposes `window.IHumanizer` and `window.IHumanDocs`) |
| `dev-test.js` | Fuzz/quality harness for the engine (dev only, not shipped) |
| `app.js` | UI wiring: tabs, counters, meter, copy/download/speech, document flow, toasts |

## Customizing

- **Word banks:** edit `CLICHES`, `SYNONYMS`, `CONTRACTIONS`, `OPENERS` arrays at the top of `humanizer.js`.
- **Colors/typography:** tweak the `:root` variables at the top of `styles.css`. The palette is warm ember (charcoal base, `--gold`/`--ember`/`--copper` accents, `--moss` for positive states) — deliberately not the blue/purple AI-default look. Swap those five custom properties to rebrand the whole site.
- **Intensity modes:** degrees 1–3 map to Subtle / Balanced / Deep in `app.js` (`DEGREE` map).
- **Voices (styles):** `casual`, `professional`, `academic`, `genz` — each swaps the openers, fillers, tail tags, hedges, connectors, synonym bank, contraction rate, and emoji behavior. Add a new one in the `STYLES` object in `humanizer.js` (it appears automatically via `IHumanizer.styles()`); style-specific phrase corrections go in `postCliches`.

## The engine (v3 — 12-stage pipeline)

The humanizer is a structure-aware rewriting pipeline that runs entirely in your browser. Every paragraph flows through twelve stages:

1. **Parser / Text extraction** — normalization and cleanup.
2. **Content & context analyzer** — domain guess (technical/academic/general), formality level, nominal density.
3. **Semantic representation** — per-paragraph significance map; dense, fact-heavy paragraphs get stricter preservation.
4. **Writing-style analyzer** — the input's own voice (contraction rate, dash cadence, marker density) calibrates the rewrite so human-sounding input is nudged, not bulldozed.
5. **Rewrite planner** — turns analysis + intensity + voice into per-pass probabilities.
6. **Rule rewriting engine** — the plan executor: guarded passive→active conversion, "there is/are" extraction, 190+ cliché rules, guarded synonym rotation, burstiness (sentence splitting/merging), repetition variety.
7. **Meaning-preservation gate** — content-word overlap against an alias vocabulary of the engine's own rewrite pairs; numbers and proper nouns are hard requirements. Failing candidates are rejected even when they score more "human."
8. **Grammar & coherence gate** — mechanical defect scan (dangling commas, double articles, lowercase sentence starts, unbalanced quotes/parens…).
9. **Naturalness refinement** — conversational openers, hedges, fillers, em-dashes, tail tags, punch sentences.
10. **Final quality gate** — quality = 0.85 · human-score + 0.15 · meaning-score; a fallback ladder rewrites progressively milder until a candidate clears all gates, and a rewrite that scores worse than the original is never shipped.
11. **AI-likeness detector + best-of-N selection** — 2–4 candidates per paragraph, scored on the statistical signals detectors use (sentence-length variance, windowed lexical diversity, stopword band, punctuation cadence, cliché density).
12. **Output** — honest post-gate scoring in the UI meter.

Safety: quoted text, code spans, URLs, emails, acronyms (NASA, IT), and proper nouns are stashed before transformation and restored after.

Run the engine's test harness: `node dev-test.js` (artifact zoo, preservation guards, meaning/grammar gate checks, 480-run cross-style fuzz).

## Document humanizer (Text ▸ Document tab)

The Document tab runs the same pipeline over whole files, entirely on-device:

**PDF Upload → PDF Parser → Text + Structure Extraction → Page/Paragraph/Heading Detection → Humanization Pipeline → Reconstruct Document → Download Humanized PDF/DOCX**

- **Parsing** — PDFs via Mozilla **pdf.js**, DOCX via **mammoth.js**; lines are grouped into paragraphs and headings are detected by title-case/ALL-CAPS shape. Headings are never rewritten.
- **Processing** — each paragraph runs the full 12-stage pipeline at your chosen intensity and voice, with per-block reseeding so texture varies across the document.
- **Reconstruction** — rebuilt with **jsPDF** (PDF) or the **docx** library (DOCX), preserving heading structure and page flow.
- **Libraries** are loaded from CDN lazily — only when you actually humanize a document. The Text tab remains 100% dependency-free.
- Limits: `.pdf`/`.docx` only, up to 15 MB; scanned/image-only PDFs have no text layer and can't be processed.

Exposed as `window.IHumanDocs` (`parseFile`, `humanizeBlocks`, `reconstructPDF`, `reconstructDOCX`, `saveBlob`).

## Notes

- Fonts load from Google Fonts with system fallbacks if offline. Document libraries (pdf.js, mammoth, jsPDF, docx) load from CDN on first use of the Document tab.
- The "human-ness" score is a heuristic — a strong signal, not a guarantee. No tool can promise zero detection.
- Respects `prefers-reduced-motion`.
