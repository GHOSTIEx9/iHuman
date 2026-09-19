/* ============================================================
   iHuman — offline humanization engine v3 (12-stage pipeline)
   ============================================================
   1. Structure-aware rewrites: passive->active (past tense),
      "there are" extraction, discourse-marker demotion,
      clause splitting/merging for burstiness.
   2. Detection-aware output: an internal AI-likeness detector
      scores every candidate rewrite on the statistical signals
      detectors look at (burstiness, lexical diversity, stopword
      band, punctuation cadence, cliché density). Several
      candidates are generated; the most human one wins.
   3. Safety guards: quoted text, URLs, emails, acronyms and
      proper nouns are protected from transformation.

   Zero dependencies. Exposes window.IHumanizer
   ============================================================ */
(function () {
  "use strict";

  /* ============================================================
     SECTION 1 — Seeded PRNG (mulberry32)
     ============================================================ */

  let _seed = (Date.now() ^ 0x9e3779b9) >>> 0;

  function reseed() {
    _seed = (Date.now() ^ Math.floor(Math.random() * 0xffffffff) ^ Math.floor(performance.now() * 1000)) >>> 0;
  }
  reseed();

  function rand() {
    _seed |= 0; _seed = (_seed + 0x6D2B79F5) | 0;
    let t = Math.imul(_seed ^ (_seed >>> 15), 1 | _seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  function pick(arr) { return arr[Math.floor(rand() * arr.length)]; }

  function pickWeighted(pairs) {
    let total = 0;
    for (const p of pairs) total += p[1];
    let r = rand() * total;
    for (const p of pairs) {
      r -= p[1];
      if (r <= 0) return p[0];
    }
    return pairs[pairs.length - 1][0];
  }

  /* ============================================================
     SECTION 2 — String utilities
     ============================================================ */

  function matchCase(matched, repl) {
    if (!repl) return repl;
    if (/^[A-Z]/.test(matched) && /^[a-z]/.test(repl)) {
      return repl[0].toUpperCase() + repl.slice(1);
    }
    return repl;
  }

  function smartReplace(text, re, rep) {
    return text.replace(re, function () {
      const args = Array.prototype.slice.call(arguments);
      const m = args[0];
      let r = rep;
      for (let i = 1; i <= 5; i++) {
        if (r.indexOf("$" + i) !== -1) {
          r = r.split("$" + i).join(args[i] !== undefined ? args[i] : "");
        }
      }
      return matchCase(m, r);
    });
  }

  /* Words that are safe to de-capitalize when they start a sentence.
     Anything else (names, titles, unknown words) keeps its case. */
  var SAFE_LOWER = {};
  "the these there that this it its in on at for with by from as is are was were be been being a an and or but so if when while because however furthermore moreover additionally nevertheless therefore thus hence many most some both each all any few more other such only same than too very just now then also plus still even people businesses organizations experts studies researchers you we they she he writers companies users customers teams folks".split(" ").forEach(function (w) { SAFE_LOWER[w] = 1; });

  function lowerFirstWord(s) {
    const m = s.match(/^\s*([A-Za-z][A-Za-z']*)/);
    if (!m) return s;
    const w = m[1];
    if (w === "I" || /^[A-Z]{2,}$/.test(w)) return s;
    if (!SAFE_LOWER[w.toLowerCase()]) return s;   /* proper noun / title */
    const after = s.slice(m.index + m[0].length, m.index + m[0].length + 2);
    if (/^\.\s*[A-Za-z]/.test(after)) return s;   /* "Dr. Smith" / "J. Doe" */
    if (/^[A-Z]/.test(w)) {
      const idx = m.index + m[0].length - w.length;
      return s.slice(0, idx) + w[0].toLowerCase() + s.slice(idx + 1);
    }
    return s;
  }

  function capFirst(s) {
    const m = s.match(/^\s*([a-z])/);
    if (m) return s.slice(0, m.index) + m[1].toUpperCase() + s.slice(m.index + 1);
    return s;
  }

  function tokenize(text) {
    return text.match(/\s+|[^\s]+/g) || [];
  }

  function isWordTok(tok) { return /^[\w'’]/.test(tok); }

  /* Sentence splitting that survives abbreviations */
  const ABBREV = /(?:(?:\b(?:Mr|Mrs|Ms|Dr|Prof|Sr|Jr|vs|etc|e\.g|i\.e|Inc|Ltd|Co|St)\.)|(?:^[A-Za-z]\.))\s*$/i;

  function splitSentences(text) {
    const out = [];
    let buf = "";
    const parts = String(text).split(/(?<=[.!?])\s+/);
    for (const p of parts) {
      buf = buf ? buf + " " + p : p;
      if (ABBREV.test(buf.trim())) continue;
      if (p.trim()) { out.push(buf.trim()); buf = ""; }
    }
    if (buf.trim()) out.push(buf.trim());
    return out;
  }

  /* ============================================================
     SECTION 3 — Word banks
     ============================================================ */

  /* --- 3a. AI-cliché rewrite bank (order = precedence) --- */

  const CLICHES = [
    /* meta-commentary -> delete outright */
    [/\bit is important to note that\s*/gi, ""],
    [/\bit is worth noting that\s*/gi, ""],
    [/\bit should be noted that\s*/gi, ""],
    [/\bit'?s worth (?:noting|mentioning) that\s*/gi, ""],
    [/\bit is worth mentioning that\s*/gi, ""],
    [/\bit goes without saying that\s*/gi, ""],
    [/\bit'?s no secret that\s*/gi, ""],
    [/\bneedless to say,?\s*/gi, ""],
    [/\bas (?:we|you) (?:all )?know,?\s*/gi, ""],
    [/\bin other words,?\s*/gi, ""],
    [/\bthat (?:being )?said,?\s*/gi, "still, "],
    [/\bwith that (?:being )?said,?\s*/gi, "still, "],
    [/\bit'?s been shown that\s*/gi, ""],
    [/\bstudies show that\s*/gi, "truth is, "],
    [/\bat its core,?\s*/gi, ""],
    [/\bthe process of\b/gi, ""],
    [/\bthe concept of\b/gi, ""],
    [/\bthe notion of\b/gi, "the idea of"],
    [/\bthere (?:is|are) no doubt that\b/gi, ""],
    [/\bit is impossible to ignore\b/gi, "you can't ignore it —"],

    /* expletive + evaluative frames */
    [/\bit is crucial to\b/gi, "you need to"],
    [/\bit is essential to\b/gi, "you need to"],
    [/\bit is vital to\b/gi, "you have to"],
    [/\bit is important to understand that\s*/gi, ""],
    [/\bit is important to\b/gi, "you should"],
    [/\bthe key to (?:success|achieving [a-z]+) is\b/gi, "what actually works is"],

    /* inflated verbs -> plain verbs */
    [/\bdelve (?:deep(?:er|ly)? )?into\b/gi, "dig into"],
    [/\bdelves? (?:deep(?:er|ly)? )?into\b/gi, "digs into"],
    [/\bdelving (?:deep(?:er|ly)? )?into\b/gi, "digging into"],
    [/\bdelve\b/gi, "dig"],
    [/\bleverag(?:e|ing|ed)\b/gi, function (m) { return matchCase(m, /ing$/.test(m) ? "using" : /ed$/.test(m) ? "used" : "use"); }],
    [/\butiliz(?:e|ing|ed)\b/gi, function (m) { return matchCase(m, /ing$/.test(m) ? "using" : /ed$/.test(m) ? "used" : "use"); }],
    [/\bfacilitat(?:e|ing|ed)\b/gi, function (m) { return matchCase(m, /ing$/.test(m) ? "help" : /ed$/.test(m) ? "helped" : "helps"); }],
    [/\bendeavor to\b/gi, "try to"],
    [/\bendeavor\b/gi, "try"],
    [/\bcommence\b/gi, "start"],
    [/\bterminate\b/gi, "end"],
    [/\binquire\b/gi, "ask"],
    [/\bascertain\b/gi, "find out"],
    [/\bdemonstrat(?:e|es|ing)\b/gi, function (m) { return matchCase(m, /ing$/.test(m) ? "showing" : /es$/.test(m) ? "shows" : "show"); }],
    [/\bpossess(?:es|ed)?\b/gi, function (m) { return matchCase(m, /es$/.test(m) ? "has" : /ed$/.test(m) ? "had" : "have"); }],
    [/\bnavigat(?:e|ing)\b/gi, function (m) { return matchCase(m, /ing$/.test(m) ? "handling" : "handle"); }],
    [/\bfoster(?:ing|s)?\b/gi, function (m) { return matchCase(m, /ing$/.test(m) ? "building" : /s$/.test(m) ? "builds" : "build"); }],
    [/\bgarner(?:s|ed)?\b/gi, function (m) { return matchCase(m, /ed$/.test(m) ? "earned" : /s$/.test(m) ? "earns" : "earn"); }],
    [/\bemploy(?:s)?\b/gi, function (m) { return matchCase(m, /s$/.test(m) ? "uses" : "use"); }],
    [/\brevolutioniz(?:e|ing|ed)\b/gi, function (m) { return matchCase(m, /ing$/.test(m) ? "shaking up" : /ed$/.test(m) ? "shook up" : "shake up"); }],
    [/\bunparalle(?:l|le)led\b/gi, "outstanding"],
    [/\bunprecedented\b/gi, "record"],
    [/\bunequivocally\b/gi, "clearly"],
    [/\barguably\b/gi, "maybe"],

    /* discourse markers -> conversational equivalents */
    [/\bfurthermore,?\s*/gi, "also, "],
    [/\bmoreover,?\s*/gi, "plus, "],
    [/\badditionally,?\s*/gi, "also, "],
    [/\bin conclusion,?\s*/gi, "so, in the end, "],
    [/\bin summary,?\s*/gi, "long story short, "],
    [/\bto summarize,?\s*/gi, "long story short, "],
    [/\bin summation,?\s*/gi, "long story short, "],
    [/\bnevertheless,?\s*/gi, "even so, "],
    [/\bnonetheless,?\s*/gi, "still, "],
    [/\btherefore,?\s*/gi, "so "],
    [/\bconsequently,?\s*/gi, "so "],
    [/\bas a result,?\s*/gi, "so "],
    [/\bthus\b/gi, "so"],
    [/\bhence\b/gi, "so"],
    [/\bhowever,?\s*/gi, "but "],
    [/\bconversely,?\s*/gi, "on the flip side, "],
    [/\bin contrast,?\s*/gi, "but "],
    [/\bon the other hand,?\s*/gi, "then again, "],
    [/\bin addition,?\s*/gi, "also, "],
    [/\bfirst and foremost,?\s*/gi, "first off, "],
    [/\bfirstly\b/gi, "first"],
    [/\bsecondly\b/gi, "second"],
    [/\bthirdly\b/gi, "third"],
    [/\blastly,?\s*/gi, "finally, "],
    [/\bin closing,?\s*/gi, "so, wrapping up, "],
    [/\bto conclude,?\s*/gi, "so, wrapping up, "],
    [/\bsubsequently,?\s*/gi, "after that, "],
    [/\bpreviously\b/gi, "before"],
    [/\bcurrently\b/gi, "right now"],
    [/\bultimately\b/gi, "in the end"],

    /* AI landscape filler */
    [/\bin today's fast-paced digital landscape\b/gi, "these days online"],
    [/\bin today's fast-paced world\b/gi, "these days"],
    [/\bin today's (?:modern )?world\b/gi, "these days"],
    [/\bin the modern era\b/gi, "these days"],
    [/\bin the digital age\b/gi, "online"],
    [/\bin the realm of\b/gi, "in"],
    [/\bin the world of\b/gi, "in"],
    [/\bthe ever-evolving landscape of\b/gi, "the ever-shifting world of"],
    [/\bthe ever-changing landscape of\b/gi, "the shifting world of"],
    [/\bthe landscape of\b/gi, "the world of"],
    [/\bin the (?:current )?climate of\b/gi, "in"],
    [/\bagainst the backdrop of\b/gi, "in"],
    [/\bwithin the sphere of\b/gi, "in"],
    [/\bwhen it comes to\b/gi, "with"],
    [/\bin terms of\b/gi, "for"],
    [/\bwith regard to\b/gi, "about"],
    [/\bwith respect to\b/gi, "about"],
    [/\bin regards to\b/gi, "about"],
    [/\bpertaining to\b/gi, "about"],
    [/\bconcerning\b/gi, "about"],

    /* heavy noun phrases -> verbs */
    [/\bplays a (?:pivotal|crucial|vital|significant|key) role in\b/gi, "is key to"],
    [/\bplays a role in\b/gi, "affects"],
    [/\bserv(?:e|es|ed) as\b/gi, function (m) { return matchCase(m, /ed$/.test(m) ? "was" : "is"); }],
    [/\bprovides? (?:the )?opportunity to\b/gi, "lets you"],
    [/\boffers? (?:the )?ability to\b/gi, "lets you"],
    [/\ballow(?:s|ing)? (?:for|you to)\b/gi, "lets you"],
    [/\benabl(?:e|es|ing) (?:you |users |them )?to\b/gi, "helps"],
    [/\bmake use of\b/gi, "use"],
    [/\bmake (?:a )?decision\b/gi, "decide"],
    [/\bgive (?:consideration|thought) to\b/gi, "think about"],
    [/\btake into consideration\b/gi, "consider"],
    [/\btake(?:s|n'?t)? advantage of\b/gi, "use"],
    [/\bhas the ability to\b/gi, "can"],
    [/\bhave the ability to\b/gi, "can"],
    [/\bis able to\b/gi, "can"],
    [/\bare able to\b/gi, "can"],
    [/\bthe ability to\b/gi, "being able to"],
    [/\ba (?:wide )?(?:range|array|variety|spectrum) of\b/gi, "all kinds of"],
    [/\bmust be considered\b/gi, "matters"],
    [/\bshould be considered\b/gi, "is worth a look"],
    [/\bcannot be overstated\b/gi, "is a big deal"],
    [/\bremains? to be seen\b/gi, "we'?ll see"],

    /* inflation adjectives / adverbs */
    [/\bmeticulous(ly)?\b/gi, "careful$1"],
    [/\bexhaustive(ly)?\b/gi, "thorough$1"],
    [/\ba myriad of\b/gi, "a lot of"],
    [/\bmyriad of\b/gi, "plenty of"],
    [/\ba plethora of\b/gi, "a lot of"],
    [/\bplethora of\b/gi, "plenty of"],
    [/\bcutting-edge\b/gi, "new"],
    [/\bstate-of-the-art\b/gi, "top"],
    [/\bworld-class\b/gi, "great"],
    [/\bbest-in-class\b/gi, "great"],
    [/\bnext-generation\b/gi, "new"],
    [/\bseamless(ly)?\b/gi, "smooth$1"],
    [/\bholistic\b/gi, "complete"],
    [/\bcomprehensive\b/gi, "full"],
    [/\btransformative\b/gi, "big"],
    [/\bgame-changing\b/gi, "bold"],
    [/\bparadigm shift\b/gi, "big change"],
    [/\bsynerg(?:y|ies|istic)\b/gi, "teamwork"],
    [/\bcornerstone\b/gi, "backbone"],
    [/\ba testament to\b/gi, "proof of"],
    [/\btestament\b/gi, "proof"],
    [/\btapestry\b/gi, "mix"],
    [/\bcrucial\b/gi, "key"],
    [/\bpivotal\b/gi, "key"],
    [/\bvital\b/gi, "key"],
    [/\bparamount\b/gi, "key"],
    [/\bmonumental\b/gi, "huge"],
    [/\bsignificantly\b/gi, "a lot"],
    [/\bsubstantially\b/gi, "a lot"],
    [/\bmarkedly\b/gi, "clearly"],
    [/\bfundamentally\b/gi, "at heart"],
    [/\bessentially\b/gi, "basically"],
    [/\bnotably\b/gi, "especially"],
    [/\bparticularly\b/gi, "especially"],

    /* connective tissue */
    [/\bin order to\b/gi, "to"],
    [/\bdue to the fact that\b/gi, "because"],
    [/\bowing to the fact that\b/gi, "because"],
    [/\bin spite of the fact that\b/gi, "even though"],
    [/\bdespite the fact that\b/gi, "even though"],
    [/\bfor the purpose of\b/gi, "to"],
    [/\bwith the exception of\b/gi, "except"],
    [/\bprior to\b/gi, "before"],
    [/\bsubsequent to\b/gi, "after"],
    [/\bin the event that\b/gi, "if"],
    [/\bat this point in time\b/gi, "right now"],
    [/\bat the end of the day\b/gi, "in the end"],
    [/\bwhen all is said and done\b/gi, "in the end"],
    [/\ba large number of\b/gi, "a lot of"],
    [/\ba significant number of\b/gi, "a lot of"],
    [/\bthe vast majority of\b/gi, "most"],
    [/\bthe majority of\b/gi, "most"],
    [/\ba number of\b/gi, "a few"],
    [/\bso as to\b/gi, "to"],
    [/\bsuch as\b/gi, "like"],

    /* the "not only ... but also" tell */
    [/\bnot only\b/gi, ""],
    [/\bbut also\b/gi, "and"],
    [/\ban interplay of\b/gi, "a mix of"],
    [/\ba confluence of\b/gi, "a mix of"],
    [/\ba convergence of\b/gi, "a mix of"],
    [/\bmultifaceted\b/gi, "layered"],
    [/\bnuanced\b/gi, "layered"],
    [/\bunderscor(?:e|es|ing)\b/gi, function (m) { return matchCase(m, /ing$/.test(m) ? "showing" : /es$/.test(m) ? "shows" : "show"); }],
    [/\bhighlight(?:s|ing)?\b/gi, function (m) { return matchCase(m, /ing$/.test(m) ? "showing" : /s$/.test(m) ? "shows" : "show"); }],
    [/\bemphasiz(?:e|es|ing)\b/gi, function (m) { return matchCase(m, /ing$/.test(m) ? "stress" : /es$/.test(m) ? "stresses" : "stress"); }],
    [/\bpav(?:e|es|ing) the way for\b/gi, "opening the door for"],
    [/\bstands? as a testament to\b/gi, "proves"],
    [/\bembark on\b/gi, "start"],
    [/\bjourney\b/gi, "path"],
    [/\bunlock the (?:full )?potential of\b/gi, "get the most out of"],
    [/\bunlock\b/gi, "open up"],
    [/\btap into\b/gi, "use"],
    [/\bharness\b/gi, "use"],
    [/\bthe importance of .{3,40}? cannot be overstated/gi, "you really can't skip this"],
    [/\ba double-edged sword\b/gi, "risky business"]
  ];

  /* --- 3b. Contractions --- */

  const CONTRACTIONS = [
    [/\bit is\b/gi, "it's"], [/\bthat is\b/gi, "that's"],
    [/\bthere is\b/gi, "there's"], [/\bwhat is\b/gi, "what's"],
    [/\bwho is\b/gi, "who's"], [/\bhe is\b/gi, "he's"],
    [/\bshe is\b/gi, "she's"], [/\bdo not\b/gi, "don't"],
    [/\bdoes not\b/gi, "doesn't"], [/\bdid not\b/gi, "didn't"],
    [/\bis not\b/gi, "isn't"], [/\bare not\b/gi, "aren't"],
    [/\bwas not\b/gi, "wasn't"], [/\bwere not\b/gi, "weren't"],
    [/\bhave not\b/gi, "haven't"], [/\bhas not\b/gi, "hasn't"],
    [/\bhad not\b/gi, "hadn't"], [/\bwill not\b/gi, "won't"],
    [/\bwould not\b/gi, "wouldn't"], [/\bcannot\b/gi, "can't"],
    [/\bcan not\b/gi, "can't"], [/\bcould not\b/gi, "couldn't"],
    [/\bshould not\b/gi, "shouldn't"], [/\byou are\b/gi, "you're"],
    [/\bwe are\b/gi, "we're"], [/\bthey are\b/gi, "they're"],
    [/\bI am\b/g, "I'm"], [/\byou will\b/gi, "you'll"],
    [/\bwe will\b/gi, "we'll"], [/\bthey will\b/gi, "they'll"],
    [/\bthat will\b/gi, "that'll"], [/\bthere will\b/gi, "there'll"],
    [/\byou have\b/gi, "you've"], [/\bwe have\b/gi, "we've"],
    [/\bthey have\b/gi, "they've"], [/\bI have\b/g, "I've"],
    [/\blet us\b/gi, "let's"]
  ];

  /* --- 3c. Synonym bank (guarded token pass) --- */

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
    robust: ["solid", "strong", "reliable"],
    increase: ["bump up", "lift"],
    increases: ["bumps up", "lifts"],
    reduce: ["cut", "trim"],
    reduces: ["cuts", "trims"],
    wants: ["needs", "is after"],
    want: ["need", "is after"],
    knows: ["gets", "has down"],
    know: ["get", "have down"]
  };

  /* --- 3d. Texture material --- */

  const OPENERS = [
    "Honestly,", "The thing is,", "Look —", "Here's the deal:",
    "Truth is,", "Okay, so", "Real talk:", "Not gonna lie,",
    "Here's the catch:", "Let's be real —"
  ];

  const SENT_STARTERS = ["And", "But", "Still,", "Even so,", "That said,", "Plus,"];

  const TAIL_TAGS = [
    ", really.", ", honestly.", ", at least in my experience.",
    ". And that matters.", ", plain and simple.", " — full stop.",
    ", no question.", ". Simple as that."
  ];

  const CONNECTORS = [", and", ", but", " — and", " — but", "; ", ", so", " because"];

  const HEDGES = [
    ["definitely", 0.35], ["certainly", 0.35], ["absolutely", 0.3],
    ["totally", 0.3], ["probably", 0.4], ["honestly", 0.35]
  ];

  const FILLERS = [
    ["basically", 0.4], ["pretty much", 0.35], ["more or less", 0.3],
    ["in a way", 0.3], ["kind of", 0.3]
  ];

  const INTENSIFIERS = ["genuinely", "particularly", "seriously", "especially"];

  const PUNCHES = [
    "That's the part that counts.", "Worth remembering.",
    "That last bit matters.", "It adds up.", "No shortcuts here."
  ];

  /* --- 3e. Style banks -------------------------------------------------
     Each style swaps the texture material (openers, fillers, tails),
     the synonym bank (merged over the base), the contraction rate and
     the emoji behavior. Unknown style names fall back to casual. */

  var STYLES = {
    casual: {
      openers: OPENERS,
      sentStarters: SENT_STARTERS,
      tailTags: TAIL_TAGS,
      connectors: CONNECTORS,
      hedges: HEDGES,
      fillers: FILLERS,
      intensifiers: INTENSIFIERS,
      punches: PUNCHES,
      emoji: [" 🙂", " ✨", " 👍", " 🔥"],
      emojiProb: 0,
      contractionRate: 0.9,
      postCliches: null,
      synonyms: null
    },
    professional: {
      openers: ["In practice,", "That said,", "Worth noting:", "From what we've seen,", "Simply put,"],
      sentStarters: ["And", "But", "That said,", "Even so,", "Plus,"],
      tailTags: [". Worth keeping in mind.", ". The results speak for themselves.", ", in practice.", ". That's what matters here."],
      connectors: [", and", ", but", "; ", ", so", " — and"],
      hedges: [["likely", 0.4], ["probably", 0.35], ["in most cases", 0.3], ["generally", 0.35]],
      fillers: [["in practice", 0.4], ["for the most part", 0.35], ["by and large", 0.3]],
      intensifiers: ["particularly", "notably", "consistently", "materially"],
      punches: ["That's what moves the needle.", "Worth acting on.", "The rest is execution."],
      emoji: [],
      emojiProb: 0,
      contractionRate: 0.35,
      synonyms: {
        good: ["strong", "effective"], great: ["excellent", "outstanding"],
        bad: ["weak", "problematic"], big: ["significant", "substantial"],
        small: ["modest", "minor"], important: ["material", "consequential"],
        many: ["numerous", "a range of"], very: ["particularly", "highly"],
        people: ["teams", "professionals"], fast: ["rapid", "efficient"],
        get: ["obtain", "secure"], gets: ["obtains", "secures"],
        help: ["support", "enable"], helps: ["supports", "enables"],
        make: ["produce", "deliver"], makes: ["produces", "delivers"],
        think: ["believe", "assess"], often: ["frequently", "routinely"],
        robust: ["strong", "dependable"]
      },
      postCliches: [
        [/\bto dig into\b/gi, "to look closely at"],
        [/\bthese days online\b/gi, "in the online space"],
        [/\bthese days\b/gi, "today"]
      ]
    },
    academic: {
      openers: ["Notably,", "In sum,", "Consider this:", "On examination,", "Critically,"],
      sentStarters: ["Moreover,", "Further,", "Yet", "Indeed,", "Still,"],
      tailTags: [". This distinction matters.", ". The evidence supports this.", ". Further study is warranted.", ". The implications are considerable."],
      connectors: [", and", ", whereas", "; moreover,", ", and thus", " — and"],
      hedges: [["arguably", 0.4], ["plausibly", 0.35], ["in all likelihood", 0.3], ["to a meaningful degree", 0.3]],
      fillers: [["in effect", 0.4], ["to a large extent", 0.35], ["in substantive terms", 0.25]],
      intensifiers: ["markedly", "materially", "consistently", "measurably"],
      punches: ["The literature bears this out.", "This finding is robust.", "The pattern is consistent."],
      emoji: [],
      emojiProb: 0,
      contractionRate: 0.1,
      synonyms: {
        good: ["sound", "robust"], great: ["considerable", "notable"],
        bad: ["deficient", "problematic"], big: ["substantial", "considerable"],
        small: ["marginal", "minimal"], important: ["significant", "consequential"],
        many: ["numerous", "multiple"], very: ["highly", "markedly"],
        people: ["individuals", "participants"], fast: ["rapid", "accelerated"],
        get: ["acquire", "obtain"], gets: ["acquires", "obtains"],
        help: ["facilitate", "support"], helps: ["facilitates", "supports"],
        make: ["generate", "produce"], makes: ["generates", "produces"],
        think: ["posit", "contend"], often: ["frequently", "systematically"],
        shows: ["indicates", "demonstrates"], show: ["indicate", "demonstrate"],
        robust: ["sound", "rigorous"]
      },
      postCliches: [
        [/\bto dig into\b/gi, "to examine"],
        [/\bthese days online\b/gi, "in online environments"],
        [/\bthese days\b/gi, "in recent years"]
      ]
    },
    genz: {
      openers: ["Okay but", "No cap,", "Real talk:", "Lowkey,", "Not gonna lie,", "Bestie,"],
      sentStarters: ["And", "But", "Also", "Tbh,", "Ngl,"],
      tailTags: [", no cap.", ", fr.", ". Period.", ", tbh.", ", lowkey iconic."],
      connectors: [", and", ", but", " — and", ", so"],
      hedges: [["lowkey", 0.45], ["kinda", 0.4], ["honestly", 0.35]],
      fillers: [["honestly", 0.4], ["ngl", 0.3], ["deadass", 0.25]],
      intensifiers: ["insanely", "lowkey", "genuinely", "wildly"],
      punches: ["That's it. That's the tweet.", "No notes.", "Understood the assignment."],
      emoji: [" 💀", " ✨", " 😭", " 🔥", " 💅"],
      emojiProb: 0.45,
      contractionRate: 1,
      postCliches: null,
      synonyms: {
        good: ["fire", "solid"], great: ["elite", "chef's kiss"],
        bad: ["mid", "rough"], big: ["massive", "huge"],
        small: ["tiny", "minor"], important: ["crucial", "a whole thing"],
        interesting: ["wild", "fascinating"],
        many: ["so many", "a ton of"], very: ["super", "hella"],
        really: ["legit", "genuinely"], people: ["besties", "everyone"],
        fast: ["ridiculously quick", "quick"], get: ["snag", "cop"],
        gets: ["snags", "cops"], think: ["feel like", "reckon"],
        help: ["come through for", "save"], helps: ["comes through for", "saves"],
        make: ["whip up", "pull off"], makes: ["whips up", "pulls off"],
        difficult: ["a struggle", "tough"], challenging: ["a struggle", "tough"],
        significant: ["major", "huge"], often: ["all the time", "constantly"]
      }
    }
  };

  var DEFAULT_STYLE = "casual";

  function resolveStyle(name) {
    if (!name || !STYLES[name]) name = DEFAULT_STYLE;
    const S = STYLES[name];
    let syn = SYNONYMS;
    if (S.synonyms) {
      syn = {};
      for (const k in SYNONYMS) syn[k] = SYNONYMS[k];
      for (const k in S.synonyms) syn[k] = S.synonyms[k];
    }
    return {
      name: name,
      openers: S.openers,
      sentStarters: S.sentStarters,
      tailTags: S.tailTags,
      connectors: S.connectors,
      hedges: S.hedges,
      fillers: S.fillers,
      intensifiers: S.intensifiers,
      punches: S.punches,
      emoji: S.emoji,
      emojiProb: S.emojiProb,
      contractionRate: S.contractionRate,
      postCliches: S.postCliches || null,
      synonyms: syn
    };
  }

  /* ============================================================
     SECTION 4 — Span protection (quotes, URLs, acronyms, names)
     ============================================================ */

  function protectSpans(text) {
    const vault = [];
    let t = String(text);

    function stash(match) {
      const slot = "\u0001" + vault.length + "\u0001";
      vault.push(match);
      return slot;
    }

    t = t.replace(/```[\s\S]*?```/g, stash);
    t = t.replace(/`[^`\n]+`/g, stash);
    t = t.replace(/"[^"\n]{2,300}"/g, stash);
    t = t.replace(/‘[^‘’\n]{2,300}’/g, stash);
    t = t.replace(/\b(?:https?:\/\/|www\.)[^\s)]+/gi, stash);
    t = t.replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, stash);
    t = t.replace(/\b[A-Z]{2,7}\b/g, stash);                       /* acronyms  */
    t = t.replace(/(?<![.!?]\s)(?<!^)(?<!\n)\b[A-Z][a-z]{2,}(?:\s+[A-Z][a-z]{2,}){0,3}\b/g, stash); /* proper nouns, not sentence starts */

    return { text: t, vault: vault };
  }

  function restoreSpans(text, vault) {
    return String(text).replace(/\u0001(\d+)\u0001/g, function (m, i) {
      return vault[+i] !== undefined ? vault[+i] : m;
    });
  }

  /* ============================================================
     SECTION 5 — Structural passes
     ============================================================ */

  /* --- 5a. Passive -> active, past tense, conservative --- */

  var IRREGULAR_PAST = {
    written: "wrote", driven: "drove", given: "gave", taken: "took",
    made: "made", known: "knew", done: "did", seen: "saw",
    built: "built", held: "held", kept: "kept", told: "told",
    sold: "sold", sent: "sent", led: "led", won: "won",
    chosen: "chose", broken: "broke", spoken: "spoke",
    stolen: "stole", forgotten: "forgot", hidden: "hid"
  };

  var AGENT_STOP = /^(?:in|on|at|for|with|during|after|before|by|through|across|between|into|over|about|from|as|when|while|because|and|but|or|that|which|who|whom|yesterday|today|tomorrow|recently|last|next|this|every|each|soon|later|already|just|now|then|so|thus|to|using|via)$/i;
  var PRON_SUBJ = { them: "they", him: "he", me: "i", us: "we" };

  function pastTenseOf(v) {
    if (IRREGULAR_PAST[v]) return IRREGULAR_PAST[v];
    if (/ied$/.test(v)) return v;
    if (/e$/.test(v)) return v + "d";
    if (/[^aeiou]y$/.test(v)) return v.slice(0, -1) + "ied";
    return v;
  }

  function fixPassiveClause(clause) {
    const m = clause.match(/\b(am|is|are|was|were)\s+(\w+ed|\w+n)\s+by\s+/i);
    if (!m) return clause;

    const verb = m[2].toLowerCase();
    const past = pastTenseOf(verb);

    /* subject = words before the be-verb (<=4, no internal punctuation) */
    const before = clause.slice(0, m.index).trim();
    if (!before || /[,;:\u2014]/.test(before)) return clause;
    const subjWords = before.split(/\s+/);
    if (subjWords.length > 4) return clause;
    const headSubj = subjWords[0].toLowerCase().replace(/\W/g, "");
    if (subjWords.length === 1 && (headSubj === "it" || headSubj === "there" || headSubj === "i")) return clause;

    /* agent = words after "by" until stop-word or punctuation (max 3) */
    const rest = clause.slice(m.index + m[0].length);
    const tokens = rest.split(/\s+/);
    const agentWords = [];
    for (const w of tokens) {
      const bare = w.toLowerCase().replace(/[^a-z'\u2019-]/g, "");
      if (!bare) break;
      if (AGENT_STOP.test(bare)) break;
      if (agentWords.length >= 3) return clause;
      agentWords.push(w.replace(/[,.;:!?]+$/, ""));
      if (/[,.;:!?]$/.test(w)) break;
    }
    if (!agentWords.length) return clause;

    const agentHead = agentWords[0].toLowerCase().replace(/\W/g, "");
    let agent;
    if (agentWords.length === 1 && PRON_SUBJ[agentHead]) {
      agent = PRON_SUBJ[agentHead];
    } else if (PRON_SUBJ[agentHead]) {
      return clause; /* pronoun + extra words: too risky */
    } else {
      agent = agentWords.join(" ");
    }

    /* remainder of the clause after the agent */
    const consumed = agentWords[agentWords.length - 1];
    let tail = rest.slice(rest.indexOf(consumed) + consumed.length);
    if (/^\s*(?:that|which)\b/i.test(tail)) return clause; /* sentential complement */
    tail = tail.replace(/^\s*(?=[,.;:!?])/, "");
    if (tail && !/^[,.;:!?]/.test(tail)) tail = " " + tail.replace(/^\s+/, "");

    /* object = old subject; lowercase a leading determiner only */
    let obj = before;
    const det = obj.match(/^(The|A|An|This|That|These|Those)\b/);
    if (det) obj = det[1].toLowerCase() + obj.slice(det[1].length);

    return agent + " " + past + " " + obj + tail;
  }

  function passiveToActive(s) {
    return splitSentences(s).map(function (sent, si) {
      const parts = sent.split(/(,\s*(?:and|but|so|which)\s+)/i);
      for (let i = 0; i < parts.length; i += 2) {
        if (/\b(?:was|were|is|are|am)\s+\w+(?:ed|n)\s+by\s+/i.test(parts[i])) {
          parts[i] = fixPassiveClause(parts[i]);
        }
      }
      /* only the sentence-initial clause gets capitalized */
      if (si === 0 || true) parts[0] = capFirst(parts[0]);
      return parts.join("");
    }).join(" ");
  }

  /* --- 5b. "There is/are X that/which Y" -> "X Y" (probabilistic) --- */

  function thereIsExtraction(s) {
    return s.replace(/\bthere (is|are)\s+((?:a|an|the|some|two|three|\d+)?\s?[a-z][\w-]*(?:\s+[a-z][\w-]*){0,3}?)\s+(that|which)\s+(\w+)/gi,
      function (m, be, np, rel, verb) {
        if (rand() > 0.7) return m;
        /* keep number agreement: "there are X that Y" -> "X that Y" is
           fine when Y already agrees; we only take the low-risk shape
           where the relative clause verb does not end in -s for "are". */
        if (/are/i.test(be) && /s$/.test(verb) && !/ss$/.test(verb)) return m;
        if (/is/i.test(be) && !/s$/.test(verb)) return m;
        void rel;
        return capFirst(np) + " " + verb;
      });
  }

  /* --- 5c. Discourse-marker demotion (drop repetitive "Also," etc.) --- */

  function demoteMarkers(s, degree, probOverride) {
    const prob = probOverride !== undefined ? probOverride : [0, 0.3, 0.45, 0.6][degree];
    let out = "";
    let last = 0;
    const re = /(^|[.!?]\s+)(Also|Plus|So|Even so|Still|But|And)(,\s*)([a-z])/g;
    let m;
    while ((m = re.exec(s)) !== null) {
      out += s.slice(last, m.index);
      if (rand() < prob && m[2] !== "And" && m[2] !== "But") {
        out += m[1] + m[4];
      } else {
        out += m[0];
      }
      last = m.index + m[0].length;
    }
    out += s.slice(last);
    return out;
  }

  /* --- 5d. Clause splitting for burstiness --- */

  function splitLongSentences(s, degree) {
    const maxWords = [28, 23, 18][degree - 1];
    const CONJ = /^(?:and|but|which|that|so|because|while|although|though|whereas|since|after|before|when|if)$/;
    const out = [];
    for (const sentence of splitSentences(s)) {
      const words = sentence.split(/\s+/);
      if (words.length <= maxWords) { out.push(sentence); continue; }

      let best = -1, bestScore = Infinity;
      for (let j = 4; j < words.length - 4; j++) {
        const bare = words[j].toLowerCase().replace(/[^a-z]/g, "");
        if (CONJ.test(bare)) {
          const balance = Math.abs(j - words.length / 2);
          const nxt = words[j + 1] || "";
          const score = balance - (/^(the|a|an)$/i.test(nxt) ? 0.5 : 0);
          if (score < bestScore) { bestScore = score; best = j; }
        }
      }

      if (best > 0) {
        const first = words.slice(0, best).join(" ").replace(/[,;:]$/, "") + ".";
        const rest = words.slice(best).join(" ");
        out.push(first, capFirst(rest));
      } else {
        out.push(sentence);
      }
    }
    return out.join(" ");
  }

  /* --- 5e. Merging short sentences --- */

  function mergeShortSentences(s, degree, S, probOverride) {
    const prob = probOverride !== undefined ? probOverride : [0, 0.2, 0.35, 0.5][degree];
    const sentences = splitSentences(s);
    if (sentences.length < 2) return s;
    const out = [];
    let i = 0;
    while (i < sentences.length) {
      const cur = sentences[i];
      const next = sentences[i + 1];
      const curLen = cur.split(/\s+/).length;
      const nextLen = next ? next.split(/\s+/).length : 99;
      if (next && rand() < prob && curLen <= 12 && nextLen <= 20) {
        /* avoid doubling a contrast word already in the first clause */
        const curLow = cur.toLowerCase();
        const usable = S.connectors.filter(function (c) {
          if (/but/.test(c) && /\bbut\b|however/i.test(curLow)) return false;
          if (/and/.test(c) && /\band\b/.test(curLow)) return false;
          if (/because/.test(c) && /\bbecause\b|since\b/i.test(curLow)) return false;
          return true;
        });
        const conn = usable.length ? pick(usable) : ", and";
        let rest = lowerFirstWord(next);
        const stripped = rest.replace(/^(?:also|plus|so|and|but|still|even so|that said),\s*/i, "");
        if (stripped && stripped !== rest) rest = stripped;
        out.push(cur.replace(/[.!?]+$/, "") + conn + " " + rest);
        i += 2;
      } else {
        out.push(cur);
        i++;
      }
    }
    return out.join(" ");
  }

  /* --- 5f. Repetition variety: don't start two sentences the same --- */

  function varyRepeats(s, degree, probOverride) {
    const prob = probOverride !== undefined ? probOverride : [0, 0.4, 0.55, 0.7][degree];
    const seen = {};
    let out = "";
    let last = 0;
    const re = /(^|[.!?]\s+)(\w+)/g;
    let m;
    while ((m = re.exec(s)) !== null) {
      out += s.slice(last, m.index);
      const key = m[2].toLowerCase().replace(/\W/g, "");
      if (key && seen[key] && rand() < prob && key.length > 2) {
        const alts = {
          also: "there's also ",
          plus: "and you can add ",
          so: "which means ",
          these: "those"
        };
        if (alts[key]) out += m[1] + alts[key] + lowerFirstWord(m[2]);
        else out += m[0];
      } else {
        out += m[0];
      }
      if (key) seen[key] = (seen[key] || 0) + 1;
      last = m.index + m[0].length;
    }
    out += s.slice(last);
    return out;
  }

  /* --- 5g. Human texture --- */

  function addHumanTexture(s, degree, S) {
    const openerProb = [0, 0.18, 0.4, 0.6][degree];
    if (degree >= 2 && rand() < openerProb) {
      s = pick(S.openers) + " " + lowerFirstWord(s);
    }

    if (degree >= 2 && rand() < 0.35) {
      const adv = pick(S.intensifiers);
      s = s.replace(/\b(is|are|was|were|seems?|feels?|looks?)\s+(\w+ed|\w+n|good|bad|big|small|hard|easy|clear|strong|weak)\b/i,
        function (m, be, adj) {
          if (rand() < 0.6) return be + " " + adv + " " + adj;
          return m;
        });
    }

    if (degree >= 3 && rand() < 0.4) {
      s = s.replace(/\b(will|would|should|could|can)\s+([a-z]+)(?!\s)/i,
        function (m, modal, verb) {
          if (rand() < 0.35) return modal + " " + pickWeighted(S.hedges) + " " + verb;
          return m;
        });
    }

    if (degree >= 3 && rand() < 0.45) {
      s = s.replace(/,\s+/, function (m) {
        const f = pickWeighted(S.fillers);
        return rand() < 0.5 ? ", " + f + ", " : m;
      });
    }

    const MARKER = /^(?:also|plus|and|but|so|still|even so|that said|however)\b/i;
    if (degree >= 3) {
      s = s.replace(/([.!?])\s+([A-Z])([a-z]+)/g, function (m, p, ch, rest, offset) {
        if (rand() < 0.14 && !MARKER.test(ch + rest)) {
          /* skip after initials ("d. Smith") and abbreviations ("Dr. Smith") */
          const before = s.slice(Math.max(0, offset - 12), offset + 1);
          if (/(?:^|\s)(?:[A-Za-z]|Mr|Mrs|Ms|Dr|Prof|Sr|Jr|vs|etc|St)\.$/i.test(before)) return m;
          return p + " " + pick(S.sentStarters) + " " + ch.toLowerCase() + rest;
        }
        return m;
      });
    }

    if (degree >= 2 && rand() < 0.3) {
      s = s.replace(/,\s+and\s+/, function () {
        return rand() < 0.6 ? " — and " : ", and ";
      });
    }

    if (degree >= 2 && rand() < 0.25) {
      s = s.replace(/[.!?]+\s*$/, function () {
        const tail = s.slice(-80).toLowerCase();
        const options = S.tailTags.filter(function (tag) {
          const core = tag.toLowerCase().replace(/[^a-z ]/g, "").trim();
          return core.split(/\s+/).every(function (w) { return !w || tail.indexOf(w) === -1; });
        });
        return options.length ? pick(options) : "";
      });
    }

    if (degree >= 3 && rand() < 0.3 && s.split(/\s+/).length > 25) {
      s += " " + pick(S.punches);
    }

    /* style emoji (genz) */
    if (degree >= 2 && S.emojiProb > 0 && S.emoji.length && rand() < S.emojiProb) {
      s = s.replace(/\s*$/, "") + pick(S.emoji);
    }

    return s;
  }

  /* --- 5h. Cleanup --- */

  function cleanup(text) {
    return text
      .replace(/\s{2,}/g, " ")
      .replace(/\s+([,.;:!?)\]])/g, "$1")
      .replace(/([(])\s+/g, "$1")
      .replace(/,\s*,/g, ",")
      .replace(/,\s*\./g, ".")
      .replace(/\(\s*\)|\[\s*\]/g, "")
      .replace(/\s+—\s+/g, " — ")
      .replace(/—\s*\./g, ".")
      .replace(/\.\s*\./g, ".")
      .replace(/\.{4,}/g, "...")
      .replace(/\b(also|plus|so|and|but),?\s+(also|plus|so|and|but)\b/gi, "$2")
      .replace(/\b(a|an|the)\s+(a|an|the)\b/gi, "$2")
      .replace(/([.!?]\s+)([a-z])/g, function (m, p, c) { return p + c.toUpperCase(); })
      .replace(/,\s*and\s+and\s+/g, ", and ")
      .replace(/\s+([.!?])(?=\s|$)/g, "$1")
      .replace(/^\s+|\s+$/g, "");
  }

  function cleanupTokens(t) {
    return t
      .replace(/\s+([,.;:!?)\]])/g, "$1")
      .replace(/([(])\s+/g, "$1")
      .replace(/,\s*,/g, ",")
      .replace(/([.!?]\s+)([a-z])/g, function (m, p, c) { return p + c.toUpperCase(); });
  }

  /* ============================================================
     SECTION 6 — AI-likeness detector
     ============================================================ */

  const STOPWORDS = {};
  "the a an and or but if then else when while because of to in on at for with by from as is are was were be been being this that these those it its he she they we you i not no do does did have has had will would can could should may might must about into over under between out up down off again further once here there all any both each few more most other some such only own same so than too just dont now also plus however therefore".split(" ").forEach(function (w) { STOPWORDS[w] = 1; });

  const AI_MARKERS_RE = [
    /\bit is important to note\b/gi, /\bit is worth noting\b/gi,
    /\bdelve\b/gi, /\bfurthermore\b/gi, /\bmoreover\b/gi,
    /\badditionally\b/gi, /\bin conclusion\b/gi, /\bnevertheless\b/gi,
    /\bleverag(?:e|ing|ed)\b/gi, /\butiliz(?:e|ing|ed)\b/gi,
    /\bfoster(?:ing|s)?\b/gi, /\bpivotal\b/gi, /\bcrucial\b/gi,
    /\brobust\b/gi, /\bseamless(?:ly)?\b/gi, /\btapestry\b/gi,
    /\bmultifaceted\b/gi, /\blandscape\b/gi, /\brealm\b/gi,
    /\bunparalle(?:l|le)led\b/gi, /\btestament to\b/gi,
    /\bplays a [a-z]+ role\b/gi, /\bin today's\b/gi, /\bparadigm\b/gi,
    /\bnavigat(?:e|ing) the complexit/gi, /\bunderscor(?:e|es|ing)\b/gi,
    /\bin the realm of\b/gi, /\bit is essential to\b/gi
  ];

  const HUMAN_BONUS_RE = [
    /—/g, /\b\w+'\w+\b/g, /\bhonestly\b/gi, /\bbasically\b/gi,
    /\bkind of\b/gi, /\bsort of\b/gi, /\bpretty much\b/gi,
    /\bthing is\b/gi, /\bfolks\b/gi, /\bgrab\b/gi, /\bfigure\b/gi,
    /\bstuff\b/gi, /\breckon\b/gi, /\btricky\b/gi, /\btough\b/gi
  ];

  function detectScore(text) {
    const t = String(text).trim();
    if (!t) return { score: 0, humanPct: 0 };

    const words = t.match(/[A-Za-z]['A-Za-z-]*/g) || [];
    const n = words.length;
    if (n < 4) return { score: 50, humanPct: 50 };

    const lower = t.toLowerCase();
    const sentences = splitSentences(t);
    const lens = sentences.map(function (s) {
      return (s.match(/[A-Za-z][A-Za-z'-]*/g) || []).length;
    }).filter(Boolean);

    /* 1. Burstiness */
    let burst = 0;
    if (lens.length >= 2) {
      const mean = lens.reduce(function (a, b) { return a + b; }, 0) / lens.length;
      const varr = lens.reduce(function (a, b) { return a + Math.pow(b - mean, 2); }, 0) / lens.length;
      burst = Math.min(1, Math.sqrt(varr) / Math.max(5, mean * 0.85));
    }

    /* 2. Lexical diversity (windowed TTR) */
    let ttr = 0.5;
    if (n > 12) {
      const vals = [];
      const win = 60;
      for (let i = 0; i < n; i += win) {
        const chunk = words.slice(i, i + win);
        vals.push(new Set(chunk.map(function (w) { return w.toLowerCase(); })).size / chunk.length);
      }
      ttr = vals.reduce(function (a, b) { return a + b; }, 0) / vals.length;
      ttr = Math.min(1, Math.max(0, (ttr - 0.62) / 0.26));
    }

    /* 3. Stopword band */
    let stopCount = 0;
    for (const w of words) { if (STOPWORDS[w.toLowerCase()]) stopCount++; }
    const stopRatio = stopCount / n;
    const stopScore = Math.max(0, 1 - Math.abs(stopRatio - 0.42) / 0.2);

    /* 4. Punctuation cadence */
    const dashes = (t.match(/—/g) || []).length;
    const semis = (t.match(/;/g) || []).length;
    const commas = (t.match(/,/g) || []).length;
    const contractions = (t.match(/\b\w+'\w+\b/g) || []).length;
    const cadence = Math.min(1,
      (Math.min(dashes, 4) * 0.25 +
       Math.min(semis, 2) * 0.3 +
       Math.min((commas / n) * 60, 0.5) +
       Math.min(contractions / Math.max(1, n / 22), 1) * 0.5) / 1.55);

    /* 5/6. Marker counts — match() not test(): /g regexes carry lastIndex
       state between .test() calls, which made scores non-deterministic */
    let aiHits = 0;
    for (const re of AI_MARKERS_RE) { if ((lower.match(re) || []).length) aiHits++; }
    let humanHits = 0;
    for (const re of HUMAN_BONUS_RE) { humanHits += (t.match(re) || []).length; }

    let score =
      burst * 26 +
      ttr * 16 +
      stopScore * 12 +
      cadence * 14 +
      Math.min(contractions / Math.max(2, n / 20), 1) * 10 +
      Math.min(humanHits, 6) * 2 -
      aiHits * 4.5;

    if (/^(furthermore|moreover|additionally|in conclusion)\b/i.test(t)) score -= 5;

    score = Math.max(3, Math.min(97, score));
    return { score: score, humanPct: Math.round(score) };
  }

  /* ============================================================
     SECTION 7 — Candidate generation & selection
     ============================================================ */

  function generateCandidate(text, degree, skipStructure, S) {
    let s = text;

    if (!skipStructure) {
      s = passiveToActive(s);
      s = thereIsExtraction(s);
    }

    const guarded = protectSpans(s);
    s = guarded.text;

    for (const [re, rep] of CLICHES) {
      if (typeof rep === "function") {
        s = s.replace(re, function () {
          const args = Array.prototype.slice.call(arguments);
          const m = args[0];
          const out = rep.apply(null, [m].concat(args.slice(1)));
          return typeof out === "string" ? out : m;
        });
      } else {
        s = smartReplace(s, re, rep);
      }
    }

    s = demoteMarkers(s, degree);

    /* style-specific corrections applied after the shared cliché bank */
    if (S.postCliches) {
      for (const [re, rep] of S.postCliches) {
        s = smartReplace(s, re, rep);
      }
    }

    for (const [re, rep] of CONTRACTIONS) {
      if (S.contractionRate >= 0.95) {
        s = smartReplace(s, re, rep);
      } else {
        s = s.replace(re, function (m) {
          return rand() < S.contractionRate ? matchCase(m, rep) : m;
        });
      }
    }

    s = guardedSynonymPass(s, degree, S);
    s = varyRepeats(s, degree);

    s = restoreSpans(s, guarded.vault);

    s = splitLongSentences(s, degree);
    s = mergeShortSentences(s, degree, S);
    s = addHumanTexture(s, degree, S);

    s = cleanup(s);
    s = capFirst(s);
    return s;
  }

  function guardedSynonymPass(text, degree, S) {
    let out = text;
    const prob = [0, 0.3, 0.45, 0.6][degree];
    const bank = S.synonyms;
    const toks = tokenize(out);

    for (let i = 0; i < toks.length; i++) {
      const tok = toks[i];
      if (!isWordTok(tok)) continue;
      const bare = tok.replace(/[^A-Za-z']/g, "");
      if (!bare) continue;
      const entry = bank[bare.toLowerCase()];
      if (!entry) continue;
      /* guarded: capitalized mid-sentence tokens are probably proper nouns
         (acronyms were already stashed); sentence starts are fine to swap. */
      if (i > 0 && /^[A-Z]/.test(bare) && !/[.!?]\s*$/.test(toks[i - 1])) continue;
      if (rand() > prob) continue;
      const repl = pick(entry);
      let newTok = /^[A-Z]/.test(bare) ? repl[0].toUpperCase() + repl.slice(1) : repl;
      const trailing = (tok.match(/[.,;:!?"']+$/) || [""])[0];
      if (trailing && !/[.,;:!?"']$/.test(newTok)) newTok += trailing;
      toks[i] = newTok;
    }

    return cleanupTokens(toks.join(""));
  }

  function humanize(text, opts) {
    reseed();
    const o = opts || {};
    const degree = Math.max(1, Math.min(3, o.degree || 2));
    const S = resolveStyle(o.style);
    const raw = String(text).replace(/\r\n/g, "\n");

    if (!raw.trim()) {
      return { text: "", score: 0, fromScore: null, attempts: 0, style: S.name };
    }

    const paragraphs = raw.split(/\n{2,}/);
    const attempts = o.candidates || (degree === 1 ? 2 : degree === 3 ? 4 : 3);

    const outParas = [];
    let fromSum = 0, paraCount = 0;

    for (const para of paragraphs) {
      if (!para.trim()) { outParas.push(para); continue; }

      const base = detectScore(para).score;
      let best = null, bestScore = -1;

      for (let i = 0; i < attempts; i++) {
        const cand = generateCandidate(para, degree, false, S);
        const sc = detectScore(cand).score;
        if (sc > bestScore) { bestScore = sc; best = cand; }
      }

      /* never ship a rewrite that scores worse than the original */
      const finalText = bestScore >= base ? best : para;
      fromSum += base;
      paraCount++;
      outParas.push(finalText);
    }

    const joined = outParas.join("\n\n");
    return {
      text: joined,
      score: detectScore(joined).humanPct,
      fromScore: paraCount ? Math.round(fromSum / paraCount) : null,
      attempts: attempts,
      style: S.name
    };
  }

  function listStyles() {
    return Object.keys(STYLES);
  }

  /* ============================================================
     SECTION 8 — Pipeline analysis (stages 2-4)
     Stages: 2 Content & Context, 3 Semantic Representation,
             4 Writing-Style Analyzer. Pure analysis, no rewriting.
     ============================================================ */

  var ACADEMIC_SIGNALS = [
    "hypothesis", "empirical", "methodology", "literature", "correlation",
    "findings", "participants", "variables", "framework", "regression",
    "qualitative", "quantitative", "theoretical", "phenomenon", "dataset"
  ];

  function analyzeDocument(text) {
    const lower = String(text).toLowerCase();
    const words = lower.match(/[a-z]['a-z-]*/g) || [];
    const n = words.length || 1;

    /* content-word frequency map — backbone of the meaning gate */
    const contentFreq = {};
    let contentTotal = 0;
    for (const w of words) {
      if (STOPWORDS[w] || w.length < 4) continue;
      contentFreq[w] = (contentFreq[w] || 0) + 1;
      contentTotal++;
    }

    /* stage 2: domain guess */
    let techHits = 0, academicHits = 0;
    for (const w of words) {
      if (/^(data|system|software|user|digital|platform|algorithm|network|cloud|api|engine|process|automation|comput|analytic)/.test(w)) techHits++;
    }
    for (const sig of ACADEMIC_SIGNALS) { if (lower.indexOf(sig) !== -1) academicHits++; }
    const counts = { technical: techHits, academic: academicHits };
    let domain = "general";
    let topDomain = techHits;
    if (academicHits > topDomain) { domain = "academic"; topDomain = academicHits; }
    if (topDomain / n < 0.02) domain = "general";

    /* stage 2: formality 0-1 — formal markers vs contraction/talk markers */
    const formalMarkers = (lower.match(/\b(therefore|however|furthermore|moreover|whereas|thus|pursuant|regarding|notwithstanding)\b/g) || []).length;
    const talkMarkers = (lower.match(/\b(stuff|folks|kinda|gonna|wanna|yeah|basically|pretty much)\b/g) || []).length;
    const contractionsN = (lower.match(/\b\w+'\w+\b/g) || []).length;
    const formality = Math.max(0, Math.min(1,
      0.5 + (formalMarkers * 0.04 - talkMarkers * 0.06 - (contractionsN / n) * 2.2)));

    /* stage 2: density — heavy nouns (nominal style) vs verbs */
    const density = Math.min(1, contentTotal / n / 0.55);

    /* stage 3: semantic representation — one significance score per paragraph */
    const paragraphs = String(text).split(/\n{2,}/);
    const significance = paragraphs.map(function (p) {
      const pw = (p.toLowerCase().match(/[a-z]['a-z-]*/g) || []);
      if (!pw.length) return 0;
      let uniq = 0, num = /[0-9]/.test(p) ? 1 : 0;
      const seen = {};
      for (const w of pw) {
        if (STOPWORDS[w] || w.length < 4) continue;
        if (!seen[w]) { seen[w] = 1; uniq++; }
      }
      return Math.min(1, (uniq / pw.length) * 1.6 + num * 0.25);
    });

    /* stage 4: writing-style analyzer — the input's own voice */
    const sentences = splitSentences(String(text));
    const lens = sentences.map(function (s) {
      return (s.match(/[A-Za-z][A-Za-z'-]*/g) || []).length;
    }).filter(function (l) { return l > 0; });
    const avgLen = lens.length ? lens.reduce(function (a, b) { return a + b; }, 0) / lens.length : 14;
    const dashes = (String(text).match(/—/g) || []).length;
    const markerDensity = (lower.match(/\b(however|therefore|furthermore|moreover|nevertheless|thus)\b/g) || []).length / Math.max(1, lens.length);

    return {
      domain: domain,
      formality: formality,
      density: density,
      significance: significance,
      styleProfile: {
        avgSentenceLen: avgLen,
        contractionRate: Math.min(1, contractionsN / Math.max(1, lens.length)),
        dashCadence: Math.min(1, dashes / Math.max(1, lens.length / 4)),
        markerDensity: markerDensity,
        formalBias: formality
      },
      contentFreq: contentFreq,
      wordCount: words.length
    };
  }

  /* ============================================================
     SECTION 9 — Rewrite planner (stage 5)
     Turns the analysis into per-run probabilities. Blends the
     document-level plan with the user's style + intensity.
     ============================================================ */

  function buildPlan(analysis, degree, S) {
    const sp = analysis.styleProfile;
    /* the more formal the source, the more we calm the casual texture */
    const formalCalm = sp.formalBias;                    /* 0..1 */
    /* the input already talks like a human — nudge, don't bulldoze */
    const alreadyHuman = Math.max(0, Math.min(1, (sp.contractionRate - 0.12) * 2 + sp.dashCadence * 0.4));

    const P = {
      structural:    [0.9, 1, 1][degree - 1],
      cliche:        [0.6, 0.85, 1][degree - 1] * (1 - alreadyHuman * 0.15),
      synonyms:      [0.3, 0.45, 0.6][degree - 1] * (1 - alreadyHuman * 0.3),
      contractions:  Math.max(S.contractionRate * (1 - formalCalm * 0.65),
                              degree === 1 ? 0 : S.contractionRate * (1 - formalCalm * 0.35)),
      openers:       [0.18, 0.4, 0.6][degree - 1] * (1 - formalCalm * 0.5),
      hedges:        [0, 0.35, 0.4][degree - 1] * (1 - formalCalm * 0.4),
      fillers:       [0, 0.45, 0.45][degree - 1] * (1 - formalCalm * 0.55),
      starters:      degree >= 3 ? 0.14 * (1 - formalCalm * 0.4) : 0,
      tails:         [0, 0.25, 0.25][degree - 1] * (1 - formalCalm * 0.5),
      punches:       degree >= 3 ? 0.3 * (1 - formalCalm * 0.6) : 0,
      splitProb:     [0, 0.7, 0.85][degree - 1],
      mergeProb:     [0, 0.2, 0.35, 0.5][degree],
      demoteProb:    [0, 0.3, 0.45, 0.6][degree],
      varyProb:      [0, 0.4, 0.55, 0.7][degree],
      emojiProb:     S.emojiProb * (1 - formalCalm * 0.85)
    };
    P.contractions = Math.min(P.contractions, S.contractionRate);
    return P;
  }

  /* ============================================================
     SECTION 10 — Gates
     Stage 7 Meaning Preservation, Stage 8 Grammar & Coherence,
     Stage 11 Final Quality. Every candidate must clear all three.
     ============================================================ */

  var MEANING_STOP = {};
  "the a an and or but if then else when while because of to in on at for with by from as is are was were be been being this that these those it its he she they we you i not no do does did have has had will would can could should may might must about into over under between out up down off again further once here there all any both each few more most other some such only own same so than too just also plus very really quite rather their our your my his her its dont cant wont".split(" ").forEach(function (w) { MEANING_STOP[w] = 1; });

  /* Words the cliché bank intentionally swaps — the meaning gate must
     treat these pairs as preserved, not lost. */
  var MEANING_ALIASES = {
    delve: ["dig"], delves: ["digs"], delving: ["digging"],
    leverage: ["use", "uses", "used"], leveraging: ["using"], leveraged: ["used"], leverages: ["uses"],
    utilize: ["use", "uses", "used"], utilizing: ["using"], utilized: ["used"], utilizes: ["uses"],
    facilitate: ["help", "helps", "helped"], facilitates: ["helps"], facilitating: ["helping"], facilitated: ["helped"],
    endeavor: ["try", "tries"], endeavors: ["tries"],
    commence: ["start", "starts"], commence: ["start"],
    terminate: ["end", "ends"],
    inquire: ["ask"], ascertain: ["find"],
    demonstrate: ["show", "shows"], demonstrates: ["shows"], demonstrating: ["showing"],
    possess: ["have", "has", "had"], possesses: ["has"], possessed: ["had"],
    navigate: ["handle", "handles", "handling", "deal"], navigating: ["handling"], navigates: ["handles"],
    foster: ["build", "builds", "building"], fosters: ["builds"], fostering: ["building"],
    garner: ["earn", "earns", "earned"], garners: ["earns"], garnered: ["earned"],
    employ: ["use", "uses"], employs: ["uses"],
    revolutionize: ["shake", "shakes", "shaking"], revolutionizes: ["shakes"], revolutionizing: ["shaking"], revolutionized: ["shook"],
    unparalleled: ["outstanding"], unprecedented: ["record"], unequivocally: ["clearly"],
    furthermore: ["also"], moreover: ["plus"], additionally: ["also"],
    nevertheless: ["even", "still"], nonetheless: ["still"],
    therefore: ["so", "thus"], consequently: ["so"], however: ["but", "yet"],
    crucial: ["key"], pivotal: ["key"], vital: ["key"], paramount: ["key"],
    monumental: ["huge"], significantly: ["lot"], substantially: ["lot"], markedly: ["clearly"],
    fundamentally: ["heart"], essentially: ["basically"], notably: ["especially"], particularly: ["especially"],
    myriad: ["lot", "plenty"], plethora: ["lot", "plenty"],
    cutting: ["new"], seamless: ["smooth"], seamlessly: ["smoothly"],
    holistic: ["complete"], comprehensive: ["full"], transformative: ["big"],
    synergy: ["teamwork"], synergies: ["teamwork"], cornerstone: ["backbone"],
    testament: ["proof"], tapestry: ["mix"], multifaceted: ["layered"], nuanced: ["layered"],
    underscore: ["show", "shows"], underscores: ["shows"], underscoring: ["showing"],
    highlight: ["show", "shows"], highlights: ["shows"], highlighting: ["showing"],
    emphasize: ["stress", "stresses"], emphasizes: ["stresses"], emphasizing: ["stressing"],
    journey: ["path"], unlock: ["open"], unlocking: ["opening"],
    harness: ["use", "uses"], meticulous: ["careful"], meticulously: ["carefully"],
    exhaustive: ["thorough"], robust: ["solid", "strong", "reliable", "sound", "rigorous"],
    world: ["great"], realm: ["field", "area"], landscape: ["world", "space"],
    important: ["key", "serious", "major"],
    note: [], noting: [], mentioning: [], noteworthy: []
  };

  function contentWords(t) {
    const out = [];
    const toks = String(t).toLowerCase().match(/[a-z][a-z'-]*/g) || [];
    for (const w of toks) {
      if (w.length < 4 || MEANING_STOP[w]) continue;
      out.push(w);
    }
    return out;
  }

  function numbersIn(t) {
    const set = {};
    const m = String(t).match(/\d+(?:[.,]\d+)?/g) || [];
    for (const x of m) set[x.replace(/,$/, "")] = 1;
    return set;
  }

  function properNounsIn(t) {
    const set = {};
    const s = String(t);
    const lowerAll = s.toLowerCase();
    const re = /\b[A-Z][a-z]{2,}\b/g;
    let m;
    while ((m = re.exec(s)) !== null) {
      const w = m[0];
      const before = s.slice(Math.max(0, m.index - 3), m.index);
      /* skip sentence-initial capitals — they're just grammar */
      if (m.index === 0 || /[.!?]\s$/.test(before) || /\n\s*$/.test(before)) continue;
      /* skip words that are common words, whatever their position */
      if (SAFE_LOWER[w.toLowerCase()]) continue;
      /* skip words that also appear lowercase anywhere in the text */
      if (lowerAll.indexOf(w.toLowerCase()) !== -1) continue;
      set[w] = 1;
    }
    return set;
  }

  /* Stage 7 gate: 0-1. Numbers & proper nouns are hard requirements,
     content overlap is scored. */
  function meaningScore(orig, cand, analysis, styleSyn) {
    const o = contentWords(orig);
    const cset = {};
    for (const w of contentWords(cand)) cset[w] = 1;
    if (!o.length) return 1;
    let kept = 0;
    for (const w of o) {
      if (cset[w]) { kept++; continue; }
      /* a rewritten content word is acceptable if it's a known rewrite pair */
      let ok = false;
      const banks = [MEANING_ALIASES[w], styleSyn ? styleSyn[w] : null, SYNONYMS[w]];
      for (const bank of banks) {
        if (!bank) continue;
        if (!bank.length) { ok = true; break; }  /* empty alias = safe deletion */
        for (const a of bank) { if (cset[a.split(" ")[0]]) { ok = true; break; } }
        if (ok) break;
      }
      if (ok) kept++;
    }
    const overlap = kept / o.length;

    /* hard checks */
    const on = numbersIn(orig), cn = numbersIn(cand);
    for (const k in on) { if (!cn[k]) return 0; }
    const op = properNounsIn(orig), cp = properNounsIn(cand);
    for (const k in op) { if (!cp[k]) return 0; }

    /* significance weighting: dense paragraphs get stricter overlap */
    const weight = analysis ? 0.35 + analysis.density * 0.65 : 1;
    return Math.max(0, (overlap - (1 - weight) * 0.35) / weight);
  }

  /* Stage 8 gate: mechanical defects. Returns list of problems. */
  function grammarCheck(text) {
    const problems = [];
    const t = String(text);
    if (/\s{2,}/.test(t)) problems.push("double-space");
    if (/\s+[,.;:!?]/.test(t)) problems.push("space-before-punct");
    if (/,\s*,|,\s*\./.test(t)) problems.push("dangling-comma");
    if (/\b(a|an|the)\s+(a|an|the)\b/i.test(t)) problems.push("double-article");
    if (/\b(and|but|so|also|plus)\s+(and|but|so|also|plus)\b/i.test(t)) problems.push("marker-dup");
    if (/[.!?]\s+[a-z]/.test(t)) problems.push("lowercase-start");
    if (/\b\w+ly,\s*\w+ly\b/i.test(t)) problems.push("adverb-dup");
    if ((t.match(/"/g) || []).length % 2 !== 0) problems.push("unbalanced-quote");
    if ((t.match(/\(/g) || []).length !== (t.match(/\)/g) || []).length) problems.push("unbalanced-paren");
    if (/\u0001/.test(t)) problems.push("vault-leak");
    if (/[A-Za-z]\s*—\s*[.!?]/.test(t)) problems.push("dash-punct");
    return problems;
  }

  /* Stage 11: weighted blend. Detector stays dominant; meaning and
     grammar act as thresholds (checked by the caller). */
  function qualityScore(humanScore, meaning) {
    return humanScore * 0.85 + meaning * 100 * 0.15;
  }

  /* ============================================================
     SECTION 11 — The 12-stage pipeline runner
     ============================================================ */

  function generateCandidateP(text, degree, skipStructure, S, P) {
    let s = text;

    /* stage 6a: structural rewrites */
    if (!skipStructure && rand() < P.structural) {
      s = passiveToActive(s);
      s = thereIsExtraction(s);
    }

    const guarded = protectSpans(s);
    s = guarded.text;

    /* stage 6b: cliché bank */
    if (rand() < P.cliche) {
      for (const [re, rep] of CLICHES) {
        if (typeof rep === "function") {
          s = s.replace(re, function () {
            const args = Array.prototype.slice.call(arguments);
            const m = args[0];
            const out = rep.apply(null, [m].concat(args.slice(1)));
            return typeof out === "string" ? out : m;
          });
        } else {
          s = smartReplace(s, re, rep);
        }
      }
      s = demoteMarkers(s, degree, P.demoteProb);

      if (S.postCliches) {
        for (const [re, rep] of S.postCliches) s = smartReplace(s, re, rep);
      }
    }

    /* stage 6c: contractions at the planned rate */
    for (const [re, rep] of CONTRACTIONS) {
      if (P.contractions >= 0.95) {
        s = smartReplace(s, re, rep);
      } else {
        s = s.replace(re, function (m) {
          return rand() < P.contractions ? matchCase(m, rep) : m;
        });
      }
    }

    s = guardedSynonymPassP(s, P.synonyms, S);
    s = varyRepeats(s, degree, P.varyProb);
    s = restoreSpans(s, guarded.vault);

    /* stage 6d: rhythm */
    s = splitLongSentences(s, degree);
    s = mergeShortSentences(s, degree, S, P.mergeProb);

    /* stage 9: naturalness refinement texture */
    s = addHumanTextureP(s, degree, S, P);

    s = cleanup(s);
    s = capFirst(s);
    return s;
  }

  function guardedSynonymPassP(text, prob, S) {
    if (rand() > prob + 0.001) return cleanupTokens(text);
    let out = text;
    const bank = S.synonyms;
    const toks = tokenize(out);
    for (let i = 0; i < toks.length; i++) {
      const tok = toks[i];
      if (!isWordTok(tok)) continue;
      const bare = tok.replace(/[^A-Za-z']/g, "");
      if (!bare) continue;
      const entry = bank[bare.toLowerCase()];
      if (!entry) continue;
      if (i > 0 && /^[A-Z]/.test(bare) && !/[.!?]\s*$/.test(toks[i - 1])) continue;
      if (rand() > prob) continue;
      const repl = pick(entry);
      let newTok = /^[A-Z]/.test(bare) ? repl[0].toUpperCase() + repl.slice(1) : repl;
      const trailing = (tok.match(/[.,;:!?"']+$/) || [""])[0];
      if (trailing && !/[.,;:!?"']$/.test(newTok)) newTok += trailing;
      toks[i] = newTok;
    }
    return cleanupTokens(toks.join(""));
  }

  function addHumanTextureP(s, degree, S, P) {
    if (degree >= 2 && rand() < P.openers) {
      s = pick(S.openers) + " " + lowerFirstWord(s);
    }

    if (degree >= 2 && rand() < P.hedges) {
      const adv = pick(S.intensifiers);
      s = s.replace(/\b(is|are|was|were|seems?|feels?|looks?)\s+(\w+ed|\w+n|good|bad|big|small|hard|easy|clear|strong|weak)\b/i,
        function (m, be, adj) {
          if (rand() < 0.6) return be + " " + adv + " " + adj;
          return m;
        });
    }

    if (degree >= 3 && rand() < P.hedges) {
      s = s.replace(/\b(will|would|should|could|can)\s+([a-z]+)(?!\s)/i,
        function (m, modal, verb) {
          if (rand() < 0.35) return modal + " " + pickWeighted(S.hedges) + " " + verb;
          return m;
        });
    }

    if (degree >= 3 && rand() < P.fillers) {
      s = s.replace(/,\s+/, function (m) {
        const f = pickWeighted(S.fillers);
        return rand() < 0.5 ? ", " + f + ", " : m;
      });
    }

    const MARKER = /^(?:also|plus|and|but|so|still|even so|that said|however)\b/i;
    if (degree >= 3 && P.starters > 0) {
      s = s.replace(/([.!?])\s+([A-Z])([a-z]+)/g, function (m, p, ch, rest, offset) {
        if (rand() < P.starters && !MARKER.test(ch + rest)) {
          const before = s.slice(Math.max(0, offset - 12), offset + 1);
          if (/(?:^|\s)(?:[A-Za-z]|Mr|Mrs|Ms|Dr|Prof|Sr|Jr|vs|etc|St)\.$/i.test(before)) return m;
          return p + " " + pick(S.sentStarters) + " " + ch.toLowerCase() + rest;
        }
        return m;
      });
    }

    if (degree >= 2 && rand() < 0.3) {
      s = s.replace(/,\s+and\s+/, function () {
        return rand() < 0.6 ? " — and " : ", and ";
      });
    }

    if (degree >= 2 && rand() < P.tails) {
      s = s.replace(/[.!?]+\s*$/, function () {
        const tail = s.slice(-80).toLowerCase();
        const options = S.tailTags.filter(function (tag) {
          const core = tag.toLowerCase().replace(/[^a-z ]/g, "").trim();
          return core.split(/\s+/).every(function (w) { return !w || tail.indexOf(w) === -1; });
        });
        return options.length ? pick(options) : "";
      });
    }

    if (degree >= 3 && rand() < P.punches && s.split(/\s+/).length > 25) {
      s += " " + pick(S.punches);
    }

    if (degree >= 2 && P.emojiProb > 0 && S.emoji.length && rand() < P.emojiProb) {
      s = s.replace(/\s*$/, "") + pick(S.emoji);
    }

    return s;
  }

  /* generateCandidate for the legacy humanize() path — builds a default
     plan and delegates. */
  function generateCandidate(text, degree, skipStructure, S) {
    const P = buildPlan(analyzeDocument(text), degree, S);
    return generateCandidateP(text, degree, skipStructure, S, P);
  }

  /* ---------- full pipeline: analyze -> plan -> candidates -> gates ---------- */

  function pipelineRewrite(para, degree, S, opts) {
    const o = opts || {};
    const analysis = o.analysis || analyzeDocument(para);
    const P = buildPlan(analysis, degree, S);
    const attempts = o.candidates || (degree === 1 ? 2 : degree === 3 ? 4 : 3);
    const base = detectScore(para).score;
    const baseMeaning = 1;

    let best = null, bestQ = -1, bestMeaning = 0;
    let attemptsUsed = 0;

    for (let i = 0; i < attempts; i++) {
      const skip = attempts >= 3 && i === attempts - 1; /* last candidate = mild */
      let cand = generateCandidateP(para, degree, skip, S, P);
      attemptsUsed++;

      const g = grammarCheck(cand);
      if (g.length) continue;                       /* stage 8 gate */
      const meaning = meaningScore(para, cand, analysis, S.synonyms);
      if (meaning < 0.55) continue;                 /* stage 7 gate */
      const human = detectScore(cand).score;
      const q = qualityScore(human, meaning);       /* stage 11 */
      if (q > bestQ) { bestQ = q; best = cand; bestMeaning = meaning; }
    }

    /* fallback ladder: progressively milder rewrites of the best plan */
    if (!best) {
      const ladder = [
        { d: degree, skip: true },
        { d: Math.max(1, degree - 1), skip: false },
        { d: 1, skip: true }
      ];
      for (const step of ladder) {
        for (let k = 0; k < 2; k++) {
          const P2 = buildPlan(analysis, step.d, S);
          const cand = generateCandidateP(para, step.d, step.skip, S, P2);
          attemptsUsed++;
          const g = grammarCheck(cand);
          if (g.length) continue;
          const meaning = meaningScore(para, cand, analysis, S.synonyms);
          if (meaning < 0.5) continue;
          const human = detectScore(cand).score;
          const q = qualityScore(human, meaning);
          if (q > bestQ) { bestQ = q; best = cand; bestMeaning = meaning; }
        }
        if (best) break;
      }
    }

    /* never ship a rewrite worse than the original */
    if (!best || bestQ < base) {
      return {
        text: para, changed: false,
        humanScore: base, meaning: 1, quality: base,
        fromScore: base, attempts: attemptsUsed
      };
    }

    return {
      text: best, changed: true,
      humanScore: detectScore(best).score,
      meaning: bestMeaning,
      quality: bestQ,
      fromScore: base,
      attempts: attemptsUsed
    };
  }

  /* ============================================================
     SECTION 12 — humanize() on the v3 pipeline (back-compat API)
     ============================================================ */

  function humanize(text, opts) {
    reseed();
    const o = opts || {};
    const degree = Math.max(1, Math.min(3, o.degree || 2));
    const S = resolveStyle(o.style);
    const raw = String(text).replace(/\r\n/g, "\n");

    if (!raw.trim()) {
      return { text: "", score: 0, fromScore: null, attempts: 0, style: S.name, changed: 0 };
    }

    const analysis = analyzeDocument(raw);
    const paragraphs = raw.split(/\n{2,}/);
    const attemptsVal = o.candidates || (degree === 1 ? 2 : degree === 3 ? 4 : 3);

    const outParas = [];
    let qualitySum = 0, fromSum = 0, paraCount = 0, changedCount = 0;

    for (const para of paragraphs) {
      if (!para.trim()) { outParas.push(para); continue; }
      const r = pipelineRewrite(para, degree, S, { analysis: analysis, candidates: attemptsVal });
      outParas.push(r.text);
      qualitySum += r.quality;
      fromSum += r.fromScore;
      paraCount++;
      if (r.changed) changedCount++;
    }

    const joined = outParas.join("\n\n");
    return {
      text: joined,
      score: detectScore(joined).humanPct,
      fromScore: paraCount ? Math.round(fromSum / paraCount) : null,
      quality: paraCount ? Math.round(qualitySum / paraCount) : null,
      changed: changedCount,
      attempts: attemptsVal,
      style: S.name
    };
  }

  function listStyles() {
    return Object.keys(STYLES);
  }

  /* ============================================================
     SECTION 13 — Document pipeline (IHumanDocs)
     Stage 1 Document Parser -> Stage 2 Text+Structure Extraction ->
     Stage 3 Page/Paragraph/Heading Detection -> Stage 4 humanization
     (the 12-stage engine, per block) -> Stage 5 Reconstruct ->
     Stage 6 Download.
     Runs on window.IHumanizer internals via the injected I handle.
     ============================================================ */

  function mkRuntime(I) {
    const PARSER_VERSION = "1";

    /* ---------- external libraries (lazy, from CDN) ---------- */

    var CDN = {
      pdfjs: "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js",
      pdfworker: "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js",
      mammoth: "https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.6.0/mammoth.browser.min.js",
      jspdf: "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js",
      docx: "https://cdn.jsdelivr.net/npm/docx@8.5.0/build/index.umd.js"
    };

    function loadScript(url) {
      return new Promise(function (resolve, reject) {
        var el = document.createElement("script");
        el.src = url;
        el.async = true;
        el.onload = function () { resolve(); };
        el.onerror = function () { reject(new Error("Failed to load " + url)); };
        document.head.appendChild(el);
      });
    }

    function ensure(tag) {
      if (tag === "pdfjs") {
        if (window.pdfjsLib) return Promise.resolve();
        return loadScript(CDN.pdfjs).then(function () {
          window.pdfjsLib.GlobalWorkerOptions.workerSrc = CDN.pdfworker;
        });
      }
      if (tag === "mammoth") {
        if (window.mammoth) return Promise.resolve();
        return loadScript(CDN.mammoth);
      }
      if (tag === "jspdf") {
        if (window.jspdf && window.jspdf.jsPDF) return Promise.resolve();
        return loadScript(CDN.jspdf);
      }
      if (tag === "docx") {
        if (window.docx && window.docx.Document) return Promise.resolve();
        return loadScript(CDN.docx);
      }
      return Promise.reject(new Error("unknown lib " + tag));
    }

    /* ---------- stage 1+2+3: parse & block extraction ---------- */

    function parsePDF(arrayBuffer, onProgress) {
      return ensure("pdfjs").then(function () {
        return window.pdfjsLib.getDocument({ data: arrayBuffer }).promise;
      }).then(function (pdf) {
        var blocks = [];
        var pageNum, page;

        function next() {
          if (pageNum > pdf.numPages) return Promise.resolve();
          return pdf.getPage(pageNum).then(function (p) {
            page = p;
            return p.getTextContent();
          }).then(function (tc) {
            if (onProgress) onProgress("Extracting page " + pageNum + " of " + pdf.numPages, pageNum / pdf.numPages);
            /* group items into lines by rounded Y, preserving X order */
            var lines = [];
            var items = tc.items;
            var i, it;
            for (i = 0; i < items.length; i++) {
              it = items[i];
              if (!it.str) continue;
              var y = Math.round(it.transform[5]);
              var line = null;
              for (var j = lines.length - 1; j >= 0; j--) {
                if (Math.abs(lines[j].y - y) <= 2) { line = lines[j]; break; }
                if (lines[j].y < y - 2) break;
              }
              if (!line) { line = { y: y, parts: [], x: it.transform[4] }; lines.push(line); }
              line.parts.push({ x: it.transform[4], str: it.str });
            }
            lines.sort(function (a, b) { return b.y - a.y; });
            var textLines = lines.map(function (l) {
              l.parts.sort(function (a, b) { return a.x - b.x; });
              return l.parts.map(function (p) { return p.str; }).join("").replace(/\s+/g, " ").trim();
            }).filter(Boolean);

            var para = "";

            /* title-case / ALL-CAPS, short, no terminal punctuation */
            function looksLikeHeading(s) {
              if (!s || s.length > 90) return false;
              if (/[.!?,;:]$/.test(s)) return false;
              var words = s.replace(/\s+/g, " ").trim().split(" ");
              if (words.length > 9) return false;
              var capCount = 0, alphaCount = 0;
              for (var k = 0; k < words.length; k++) {
                var w = words[k].replace(/[^A-Za-z]/g, "");
                if (!w) continue;
                alphaCount++;
                if (w.length >= 2 && w === w.toUpperCase()) { capCount++; continue; }
                if (/^[A-Z]/.test(w)) capCount++;
              }
              return alphaCount > 0 && capCount / alphaCount >= 0.67;
            }

            function flushPara() {
              para = para.replace(/\s+/g, " ").trim();
              if (!para) return;
              var isHeading = looksLikeHeading(para) && !/^\d+[.)]\s/.test(para);
              blocks.push({ type: isHeading ? "heading" : "para", text: para, page: pageNum });
              para = "";
            }

            for (i = 0; i < textLines.length; i++) {
              var ln = textLines[i];
              if (!para) { para = ln; continue; }
              /* a heading line (incoming or accumulated) always stands alone */
              if (looksLikeHeading(ln)) { flushPara(); para = ln; continue; }
              if (looksLikeHeading(para)) { flushPara(); para = ln; continue; }
              /* new paragraph if previous line ended a sentence and this looks like a start */
              if (/[.!?"”]$/.test(para) && /^[A-Z0-9\u00C0-\u024F"“(]/.test(ln)) {
                flushPara();
                para = ln;
              } else {
                para += " " + ln;
              }
            }
            flushPara();
            pageNum++;
            return next();
          });
        }

        pageNum = 1;
        return next().then(function () {
          return { blocks: blocks, pages: pdf.numPages, format: "pdf" };
        });
      });
    }

    function parseDOCX(arrayBuffer) {
      return ensure("mammoth").then(function () {
        return window.mammoth.convertToHtml({ arrayBuffer: arrayBuffer });
      }).then(function (res) {
        var holder = document.createElement("div");
        holder.innerHTML = res.value || "";
        var blocks = [];
        var kids = holder.children;
        for (var i = 0; i < kids.length; i++) {
          var el = kids[i];
          var tag = el.tagName.toLowerCase();
          var text = (el.textContent || "").replace(/\s+/g, " ").trim();
          if (!text) continue;
          if (/^h[1-6]$/.test(tag)) {
            blocks.push({ type: "heading", text: text, level: +tag[1], page: 0 });
          } else if (tag === "li") {
            blocks.push({ type: "para", text: "\u2022 " + text, page: 0, list: true });
          } else if (tag === "p") {
            blocks.push({ type: "para", text: text, page: 0 });
          }
        }
        return { blocks: blocks, pages: 0, format: "docx" };
      });
    }

    /* ---------- stage 4: humanization over blocks ---------- */

    function isSkippable(text) {
      if (!text) return true;
      var t = text.trim();
      if (!t) return true;
      if (/^(https?:\/\/|www\.)\S+$/i.test(t)) return true;
      if (/^[\d\s.,;:%–—-]+$/.test(t)) return true;
      if (t.length < 4) return true;
      return false;
    }

    function humanizeBlocks(blocks, degree, style, onProgress) {
      var S = I.resolveStyle(style);
      var out = [];
      var cache = {};
      var changed = 0, qualitySum = 0, fromSum = 0, processed = 0;
      var work = blocks.filter(function (b) { return b.type === "para" && !isSkippable(b.text); });
      var i = 0;

      function next() {
        if (i >= work.length) return Promise.resolve();
        var b = work[i];
        if (onProgress) onProgress("Humanizing paragraph " + (i + 1) + " of " + work.length, i / work.length);
        return new Promise(function (resolve) {
          setTimeout(function () {
            var r;
            try {
              I.reseed();  /* decorrelate texture from the previous paragraph */
              r = I.pipelineRewrite(b.text, degree, S, {});
            } catch (e) {
              r = { text: b.text, changed: false, quality: 0, fromScore: 0 };
            }
            cache[i] = r;
            b._result = r;
            if (r.changed) changed++;
            qualitySum += r.quality;
            fromSum += r.fromScore;
            processed++;
            i++;
            resolve();
          }, 0);
        }).then(next);
      }

      return next().then(function () {
        if (onProgress) onProgress("Reconstructing document…", 1);
        return {
          blocks: blocks,
          changed: changed,
          processed: processed,
          avgQuality: processed ? Math.round(qualitySum / processed) : 0,
          avgFrom: processed ? Math.round(fromSum / processed) : 0,
          cache: cache,
          style: S.name
        };
      });
    }

    /* ---------- stage 5: reconstruction ---------- */

    function docxParagraphs(blocks) {
      var docx = window.docx;
      var paras = [];
      for (var i = 0; i < blocks.length; i++) {
        var b = blocks[i];
        var txt = b.type === "heading" ? b.text : (b._result && b._result.changed ? b._result.text : b.text);
        if (b.type === "heading") {
          paras.push(new docx.Paragraph({ text: txt, heading: docx.HeadingLevel["HEADING_" + (b.level || 1)] }));
        } else {
          paras.push(new docx.Paragraph({ text: txt, spacing: { after: 160 } }));
        }
      }
      return paras;
    }

    function reconstructDOCX(blocks, name) {
      return ensure("docx").then(function () {
        var docx = window.docx;
        var doc = new docx.Document({
          creator: "iHuman",
          title: name || "Humanized document",
          sections: [{ children: docxParagraphs(blocks) }]
        });
        return docx.Packer.toBlob(doc);
      });
    }

    function reconstructPDF(blocks, name) {
      return ensure("jspdf").then(function () {
        var jsPDF = window.jspdf.jsPDF;
        var doc = new jsPDF({ unit: "pt", format: "a4" });
        var W = doc.internal.pageSize.getWidth();
        var H = doc.internal.pageSize.getHeight();
        var M = 56;
        var y = M;

        function ensureRoom(h) {
          if (y + h > H - M) { doc.addPage(); y = M; }
        }

        for (var i = 0; i < blocks.length; i++) {
          var b = blocks[i];
          var txt = b.type === "heading" ? b.text : (b._result && b._result.changed ? b._result.text : b.text);
          if (b.type === "heading") {
            ensureRoom(30);
            y += 8;
            doc.setFont("helvetica", "bold");
            doc.setFontSize(14);
            var hl = doc.splitTextToSize(txt, W - M * 2);
            doc.text(hl, M, y);
            y += hl.length * 18 + 6;
            doc.setFont("helvetica", "normal");
          } else {
            doc.setFontSize(11);
            var lines = doc.splitTextToSize(txt, W - M * 2);
            for (var j = 0; j < lines.length; j++) {
              ensureRoom(16);
              doc.text(lines[j], M, y);
              y += 15;
            }
            y += 9;
          }
        }
        return doc.output("blob");
      });
    }

    function saveBlob(blob, filename) {
      var url = URL.createObjectURL(blob);
      var a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 1500);
    }

    /* ---------- public document API ---------- */

    function parseFile(file, onProgress) {
      var name = (file.name || "").toLowerCase();
      if (file.size > 15 * 1024 * 1024) {
        return Promise.reject(new Error("File is larger than 15 MB"));
      }
      if (name.slice(-4) === ".pdf") {
        return file.arrayBuffer().then(function (buf) { return parsePDF(buf, onProgress); });
      }
      if (name.slice(-5) === ".docx") {
        return file.arrayBuffer().then(parseDOCX);
      }
      if (name.slice(-4) === ".doc" || name.slice(-4) === ".txt") {
        return Promise.reject(new Error("Please use .pdf or .docx (legacy .doc and .txt are not supported)"));
      }
      return Promise.reject(new Error("Unsupported file type — use PDF or DOCX"));
    }

    return {
      parseFile: parseFile,
      humanizeBlocks: humanizeBlocks,
      reconstructDOCX: reconstructDOCX,
      reconstructPDF: reconstructPDF,
      saveBlob: saveBlob,
      isSkippable: isSkippable,
      version: PARSER_VERSION
    };
  }

  /* ============================================================
     SECTION 14 — Public API
     ============================================================ */

  window.IHumanizer = {
    humanize: humanize,
    detect: function (t) { const r = detectScore(t); return { score: r.humanPct, humanPct: r.humanPct }; },
    score: function (t) { return detectScore(t).humanPct; },
    reseed: reseed,
    styles: listStyles,
    analyze: analyzeDocument,
    pipelineRewrite: pipelineRewrite,
    resolveStyle: resolveStyle,
    grammarCheck: grammarCheck,
    meaningScore: function (orig, cand) { return meaningScore(orig, cand, null, null); },
    qualityScore: qualityScore,
    version: "3.0.0"
  };

  window.IHumanDocs = mkRuntime(window.IHumanizer);
})();
