/* ============================================================
   iHuman — offline humanization engine
   Pure, dependency-free text transformation.
   Exposed as window.IHumanizer
   ============================================================ */
(function () {
  "use strict";

  /* ---------- seeded PRNG ---------- */

  let seed = (Date.now() ^ 0x9e3779b9) >>> 0;

  function reseed() {
    seed = (Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0;
  }

  function rand() {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  }

  function pick(arr) {
    return arr[Math.floor(rand() * arr.length)];
  }

  /* Capitalize replacement if the matched word was capitalized */
  function matchCase(matched, repl) {
    if (!repl) return repl;
    if (/^[A-Z]/.test(matched) && /^[a-z]/.test(repl)) {
      return repl[0].toUpperCase() + repl.slice(1);
    }
    return repl;
  }

  /* Replace with support for $1 placeholders + case preservation */
  function smartReplace(text, re, rep) {
    return text.replace(re, function () {
      const args = Array.prototype.slice.call(arguments);
      const m = args[0];
      let r = rep;
      for (let i = 1; i <= 4; i++) {
        if (r.indexOf("$" + i) !== -1) {
          r = r.split("$" + i).join(args[i] !== undefined ? args[i] : "");
        }
      }
      return matchCase(m, r);
    });
  }

  function lowerFirstWord(s) {
    const words = s.split(" ");
    if (words[0] !== "I" && /^[A-Z][a-z]/.test(words[0])) {
      words[0] = words[0][0].toLowerCase() + words[0].slice(1);
    }
    return words.join(" ");
  }

  /* ---------- word banks ---------- */

  const CONTRACTIONS = [
    [/\bit is\b/gi, "it's"],
    [/\bthat is\b/gi, "that's"],
    [/\bthere is\b/gi, "there's"],
    [/\bwhat is\b/gi, "what's"],
    [/\bwho is\b/gi, "who's"],
    [/\bhe is\b/gi, "he's"],
    [/\bshe is\b/gi, "she's"],
    [/\bdo not\b/gi, "don't"],
    [/\bdoes not\b/gi, "doesn't"],
    [/\bdid not\b/gi, "didn't"],
    [/\bis not\b/gi, "isn't"],
    [/\bare not\b/gi, "aren't"],
    [/\bwas not\b/gi, "wasn't"],
    [/\bwere not\b/gi, "weren't"],
    [/\bhave not\b/gi, "haven't"],
    [/\bhas not\b/gi, "hasn't"],
    [/\bhad not\b/gi, "hadn't"],
    [/\bwill not\b/gi, "won't"],
    [/\bwould not\b/gi, "wouldn't"],
    [/\bcannot\b/gi, "can't"],
    [/\bcan not\b/gi, "can't"],
    [/\bcould not\b/gi, "couldn't"],
    [/\bshould not\b/gi, "shouldn't"],
    [/\byou are\b/gi, "you're"],
    [/\bwe are\b/gi, "we're"],
    [/\bthey are\b/gi, "they're"],
    [/\bI am\b/g, "I'm"],
    [/\byou will\b/gi, "you'll"],
    [/\bwe will\b/gi, "we'll"],
    [/\bthat will\b/gi, "that'll"],
    [/\byou have\b/gi, "you've"],
    [/\bwe have\b/gi, "we've"],
    [/\bthey have\b/gi, "they've"],
    [/\bI have\b/g, "I've"],
    [/\blet us\b/gi, "let's"]
  ];

  /* AI-cliché phrases → plain-human equivalents ($1 = capture group) */
  const CLICHES = [
    [/\bit is important to note that\s*/gi, ""],
    [/\bit is worth noting that\s*/gi, ""],
    [/\bit should be noted that\s*/gi, ""],
    [/\bit goes without saying that\s*/gi, ""],
    [/\bit is crucial to\b/gi, "you need to"],
    [/\bit is essential to\b/gi, "you need to"],
    [/\bit is vital to\b/gi, "you have to"],
    [/\bdelve into\b/gi, "dig into"],
    [/\bdelves into\b/gi, "digs into"],
    [/\bdelving into\b/gi, "digging into"],
    [/\bdelve\b/gi, "dig"],
    [/\bembark on a journey\b/gi, "get started"],
    [/\bin today's fast-paced digital landscape\b/gi, "these days online"],
    [/\bin today's fast-paced world\b/gi, "these days"],
    [/\bin today's world\b/gi, "these days"],
    [/\bin the modern era\b/gi, "these days"],
    [/\bin the digital age\b/gi, "online"],
    [/\bthe ever-evolving landscape of\b/gi, "the ever-shifting world of"],
    [/\bthe landscape of\b/gi, "the world of"],
    [/\bnavigate the complexities of\b/gi, "handle"],
    [/\bnavigating the complexities of\b/gi, "handling"],
    [/\bnavigate\b/gi, "handle"],
    [/\bleveraging\b/gi, "using"],
    [/\bleverage\b/gi, "use"],
    [/\butilizing\b/gi, "using"],
    [/\butilize\b/gi, "use"],
    [/\bfurthermore\b/gi, "also"],
    [/\bmoreover\b/gi, "plus"],
    [/\badditionally\b/gi, "also"],
    [/\bin conclusion\b/gi, "so, in the end"],
    [/\bin summary\b/gi, "long story short"],
    [/\bto summarize\b/gi, "long story short"],
    [/\bnevertheless\b/gi, "even so"],
    [/\bnonetheless\b/gi, "still"],
    [/\btherefore\b/gi, "so"],
    [/\bthus\b/gi, "so"],
    [/\bhence\b/gi, "so"],
    [/\ba testament to\b/gi, "proof of"],
    [/\btestament\b/gi, "proof"],
    [/\bplays a pivotal role in\b/gi, "is key to"],
    [/\bplays a crucial role in\b/gi, "is key to"],
    [/\bplays a vital role in\b/gi, "is key to"],
    [/\bpivotal\b/gi, "key"],
    [/\bcrucial\b/gi, "key"],
    [/\bmeticulous(ly)?\b/gi, "careful$1"],
    [/\ba myriad of\b/gi, "a lot of"],
    [/\ba plethora of\b/gi, "a lot of"],
    [/\bmyriad of\b/gi, "plenty of"],
    [/\bplethora of\b/gi, "plenty of"],
    [/\bfostering\b/gi, "building"],
    [/\bfosters\b/gi, "builds"],
    [/\bfoster\b/gi, "build"],
    [/\bcutting-edge\b/gi, "new"],
    [/\bstate-of-the-art\b/gi, "top"],
    [/\bseamlessly\b/gi, "smoothly"],
    [/\bseamless\b/gi, "smooth"],
    [/\brobust\b/gi, "solid"],
    [/\bin order to\b/gi, "to"],
    [/\bdue to the fact that\b/gi, "because"],
    [/\bdespite the fact that\b/gi, "even though"],
    [/\bwith regard to\b/gi, "about"],
    [/\bwhen it comes to\b/gi, "with"],
    [/\ba wide range of\b/gi, "all kinds of"],
    [/\bunlock the potential of\b/gi, "get the most out of"],
    [/\bparadigm shift\b/gi, "big change"],
    [/\bgame-changing\b/gi, "bold"],
    [/\brevolutionize\b/gi, "shake up"],
    [/\bholistic\b/gi, "complete"],
    [/\bsynerg(y|ies)\b/gi, "teamwork$1"],
    [/\bin the realm of\b/gi, "in"],
    [/\btapestry\b/gi, "mix"],
    [/\bunderscores\b/gi, "shows"],
    [/\bunderscore\b/gi, "show"],
    [/\bhighlights the importance of\b/gi, "shows the value of"],
    [/\bunderscoring the importance of\b/gi, "showing the value of"],
    [/\bhighlights\b/gi, "shows"],
    [/\bnot only\b/gi, ""],
    [/\bbut also\b/gi, "and"]
  ];

  /* Seeded synonym rotation */
  const SYNONYMS = {
    good: ["solid", "decent", "nice"],
    great: ["really good", "excellent"],
    bad: ["poor", "rough"],
    big: ["large", "major", "sizable"],
    small: ["minor", "little"],
    important: ["key", "serious", "major"],
    interesting: ["striking", "curious"],
    many: ["plenty of", "a lot of"],
    very: ["really", "pretty"],
    really: ["genuinely", "truly"],
    helps: ["makes it easier", "comes in handy"],
    help: ["make easier", "come in handy"],
    makes: ["lets", "gets"],
    make: ["let", "get"],
    shows: ["makes clear", "points to"],
    show: ["make clear", "point to"],
    creates: ["builds", "sparks"],
    create: ["build", "spark"],
    provides: ["gives", "offers"],
    provide: ["give", "offer"],
    ensures: ["makes sure", "guarantees"],
    ensure: ["make sure", "guarantee"],
    fast: ["quick", "rapid"],
    quick: ["fast", "snappy"],
    improve: ["sharpen", "boost"],
    improves: ["sharpens", "boosts"],
    get: ["grab", "land"],
    gets: ["grabs", "lands"],
    often: ["a lot", "frequently"],
    people: ["folks", "most of us"],
    because: ["since", "as"],
    think: ["figure", "reckon"],
    understands: ["gets", "follows"],
    understand: ["get", "follow"],
    difficult: ["tough", "tricky"],
    challenging: ["tough", "tricky"],
    significant: ["serious", "major"],
    substantial: ["serious", "sizable"],
    increase: ["bump up", "lift"],
    increases: ["bumps up", "lifts"],
    reduce: ["cut", "trim"],
    reduces: ["cuts", "trims"]
  };

  const OPENERS = ["Honestly,", "The thing is,", "Look —", "Here's the deal:", "Truth is,"];
  const SENT_STARTERS = ["And", "But", "Still,", "Even so,", "That said,"];
  const TAIL_TAGS = [", really.", ", honestly.", ", at least in my experience.", ". And that matters."];
  const CONNECTORS = [", and", ", but", " — ", "; ", ", so"];
  const EMOJI = [" 🙂", " ✨", " 👍", " 🔥"];

  /* ---------- pipeline passes ---------- */

  function applyCliches(text) {
    let out = text;
    for (const [re, rep] of CLICHES) {
      out = smartReplace(out, re, rep);
    }
    return out;
  }

  function applyContractions(text) {
    let out = text;
    for (const [re, rep] of CONTRACTIONS) {
      out = smartReplace(out, re, rep);
    }
    return out;
  }

  function applySynonyms(text, degree) {
    let out = text;
    const prob = [0, 0.35, 0.5, 0.65][degree];
    for (const word of Object.keys(SYNONYMS)) {
      const re = new RegExp("\\b" + word + "\\b", "gi");
      out = out.replace(re, function (m) {
        if (rand() > prob) return m;
        return matchCase(m, pick(SYNONYMS[word]));
      });
    }
    return out;
  }

  function splitSentences(text) {
    const out = [];
    const re = /[^.!?]+[.!?]+["')\]]*\s*|[^.!?]+\s*$/g;
    let m;
    while ((m = re.exec(text)) !== null) {
      const s = m[0].trim();
      if (s) out.push(s);
    }
    return out;
  }

  /* Burstiness: split overlong sentences, occasionally merge short ones */
  function varyRhythm(text, degree) {
    const CONJ = /^(?:and|but|which|that|so|because|while|although|however)$/i;
    let sentences = splitSentences(text);
    const maxWords = [30, 24, 18][degree - 1];
    const mergeProb = [0, 0.2, 0.35, 0.5][degree];

    /* split pass */
    const split = [];
    for (const s of sentences) {
      const words = s.split(/\s+/);
      if (words.length > maxWords) {
        let best = -1;
        for (let j = 3; j < words.length - 3; j++) {
          const w = words[j].replace(/[^A-Za-z]/g, "");
          if (CONJ.test(w) && (best < 0 || Math.abs(j - words.length / 2) < Math.abs(best - words.length / 2))) {
            best = j;
          }
        }
        if (best > 0) {
          const first = words.slice(0, best).join(" ").replace(/[,;:]$/, "") + ".";
          const rest = words.slice(best).join(" ");
          split.push(first, rest[0].toUpperCase() + rest.slice(1));
          continue;
        }
      }
      split.push(s);
    }

    /* merge pass */
    const merged = [];
    for (let i = 0; i < split.length; i++) {
      const cur = split[i];
      const next = split[i + 1];
      if (
        next &&
        rand() < mergeProb &&
        cur.split(/\s+/).length <= 12 &&
        next.split(/\s+/).length <= 20
      ) {
        const conn = pick(CONNECTORS);
        let rest = lowerFirstWord(next);
        const stripped = rest.replace(/^(?:also|plus|so|and|but|still|even so|that said),\s*/i, "");
        if (stripped && stripped !== rest) {
          rest = stripped;
        }
        merged.push(cur.replace(/[.!?]+$/, "") + conn + " " + rest);
        i++;
      } else {
        merged.push(cur);
      }
    }

    return merged.join(" ");
  }

  function addHumanTouches(text, degree) {
    let s = text;

    /* conversational opener */
    const openerProb = [0, 0, 0.5, 0.7][degree];
    if (degree >= 2 && rand() < openerProb) {
      s = pick(OPENERS) + " " + lowerFirstWord(s);
    }

    /* sentence starters sprinkled mid-paragraph (deep only) */
    var MARKER = /^(?:also|plus|and|but|so|still|even so|that said|however)\b/i;
    if (degree >= 3) {
      s = s.replace(/([.!?])\s+([A-Z])([a-z])/g, function (m, p, ch, rest) {
        if (rand() < 0.12 && !MARKER.test(ch + rest)) {
          return p + " " + pick(SENT_STARTERS) + " " + ch.toLowerCase() + rest;
        }
        return m;
      });
    }

    /* em-dash flavor */
    if (degree >= 2 && rand() < 0.3) {
      s = s.replace(/, and /, function (m) {
        return rand() < 0.6 ? " — and " : m;
      });
    }

    /* casual tail tag on the final sentence */
    if (degree >= 2 && rand() < 0.22) {
      s = s.replace(/[.!?]+\s*$/, pick(TAIL_TAGS));
    }

    /* emoji at the very end (deep only) */
    if (degree >= 3 && rand() < 0.3) {
      s = s.replace(/\s*$/, "") + pick(EMOJI);
    }

    return s;
  }

  function cleanup(text) {
    return text
      .replace(/\s{2,}/g, " ")
      .replace(/\s+([,.;:!?)])/g, "$1")
      .replace(/([(])\s+/g, "$1")
      .replace(/,\s*,/g, ",")
      .replace(/\(\s*\)/g, "")
      .replace(/\s+—\s+/g, " — ")
      .replace(/—\s*\./g, ".")
      .replace(/\.\s*\./g, ".")
      .replace(/([.!?]\s+)([a-z])/g, function (m, p, c) { return p + c.toUpperCase(); })
      .replace(/^\s+|\s+$/g, "");
  }

  /* ---------- main entry ---------- */

  function humanize(text, opts) {
    reseed();
    const o = opts || {};
    const degree = Math.max(1, Math.min(3, o.degree || 2));
    const paragraphs = String(text).replace(/\r\n/g, "\n").split(/\n{2,}/);

    const outParas = paragraphs.map(function (para) {
      if (!para.trim()) return para;

      let s = para;
      s = applyCliches(s);
      s = applyContractions(s);
      s = applySynonyms(s, degree);
      s = varyRhythm(s, degree);
      if (degree >= 2) s = addHumanTouches(s, degree);
      s = cleanup(s);

      /* ensure the paragraph still starts like a sentence */
      s = s.replace(/^([a-z])/, function (m, ch) { return ch.toUpperCase(); });
      return s;
    });

    const result = outParas.join("\n\n");
    return { text: result, score: scoreText(result) };
  }

  /* ---------- human-ness heuristic ---------- */

  function scoreText(text) {
    const t = String(text).trim();
    if (!t) return 0;
    const words = t.split(/\s+/).filter(Boolean);
    if (words.length < 4) return 55;

    const sentences = t.split(/[.!?]+["')\]]*\s+/).map(function (s) { return s.trim(); }).filter(Boolean);
    if (sentences.length < 2) return 62;

    const lens = sentences.map(function (s) { return s.split(/\s+/).length; });
    const mean = lens.reduce(function (a, b) { return a + b; }, 0) / lens.length;
    const variance = lens.reduce(function (a, b) { return a + Math.pow(b - mean, 2); }, 0) / lens.length;
    const burst = Math.min(1, Math.sqrt(variance) / Math.max(6, mean * 0.9));

    let clicheHits = 0;
    for (const [re] of CLICHES) {
      if (new RegExp(re.source, "gi").test(t)) clicheHits++;
    }

    const contractions = (t.match(/\b\w+'\w+\b/g) || []).length;
    const contr = Math.min(1, contractions / Math.max(3, words.length / 25));
    const dashes = (t.match(/—/g) || []).length;

    let score = 46
      + burst * 24
      + contr * 18
      - clicheHits * 3.5
      + Math.min(dashes, 4) * 1.6
      + Math.min(words.length, 120) / 40;

    if (/^(furthermore|moreover|additionally|in conclusion)\b/i.test(t)) score -= 6;

    return Math.max(5, Math.min(98, Math.round(score)));
  }

  /* ---------- exports ---------- */

  window.IHumanizer = {
    humanize: humanize,
    score: scoreText,
    reseed: reseed
  };
})();
