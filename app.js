/* ============================================================
   iHuman — UI wiring
   ============================================================ */
(function () {
  "use strict";

  var $ = function (id) { return document.getElementById(id); };

  var inputEl = $("inputText");
  var outputEl = $("outputText");
  var inputStats = $("inputStats");
  var outputStats = $("outputStats");
  var humanizeBtn = $("humanizeBtn");
  var rerollBtn = $("rerollBtn");
  var copyBtn = $("copyBtn");
  var downloadBtn = $("downloadBtn");
  var speakBtn = $("speakBtn");
  var pasteBtn = $("pasteBtn");
  var clearBtn = $("clearBtn");

  var mode = "balanced";
  var style = "casual";
  var lastInput = "";
  var DEGREE = { subtle: 1, balanced: 2, deep: 3 };

  var SAMPLE =
    "In today's fast-paced digital landscape, it is important to note that leveraging cutting-edge technologies is crucial for organizations seeking to delve into new market opportunities. Furthermore, businesses must navigate the complexities of modern consumer behavior in order to remain competitive. Additionally, it is worth mentioning that a robust digital strategy plays a pivotal role in driving sustainable growth and fostering innovation across all sectors. It goes without saying that this paradigm shift will revolutionize how we utilize data.";

  function countWords(s) {
    var w = s.trim().match(/\S+/g);
    return w ? w.length : 0;
  }

  function toast(msg) {
    var wrap = $("toasts");
    var el = document.createElement("div");
    el.className = "toast";
    el.textContent = msg;
    el.addEventListener("animationend", function (e) {
      if (e.animationName === "toastOut") el.remove();
    });
    wrap.appendChild(el);
  }

  function setBusy(b) {
    humanizeBtn.disabled = b;
    humanizeBtn.classList.toggle("is-working", b);
    var label = humanizeBtn.querySelector(".btn__label");
    if (label) label.textContent = b ? "Humanizing…" : "Humanize";
    rerollBtn.disabled = b || !lastInput;
  }

  /* ---------- mode selector ---------- */

  var segBtns = Array.prototype.slice.call(document.querySelectorAll(".seg:not(.seg--voice) .seg__btn"));
  var styleBtns = Array.prototype.slice.call(document.querySelectorAll(".seg--voice .seg__btn"));

  function updateGlider(scope) {
    var sel = scope ? ".seg--voice .seg__glider" : ".seg:not(.seg--voice) .seg__glider";
    var glider = document.querySelector(sel);
    var activeSel = scope ? ".seg--voice .seg__btn.is-active" : ".seg:not(.seg--voice) .seg__btn.is-active";
    var active = document.querySelector(activeSel);
    if (!glider || !active) return;
    glider.style.left = active.offsetLeft + "px";
    glider.style.width = active.offsetWidth + "px";
  }

  segBtns.forEach(function (b) {
    b.addEventListener("click", function () {
      segBtns.forEach(function (x) { x.classList.remove("is-active"); });
      b.classList.add("is-active");
      mode = b.dataset.mode;
      updateGlider(false);
    });
  });

  styleBtns.forEach(function (b) {
    b.addEventListener("click", function () {
      styleBtns.forEach(function (x) { x.classList.remove("is-active"); });
      b.classList.add("is-active");
      style = b.dataset.style;
      updateGlider(true);
    });
  });

  window.addEventListener("resize", function () { updateGlider(false); updateGlider(true); });
  updateGlider(false);
  updateGlider(true);

  /* ---------- output ---------- */

  function renderOutput(text, score) {
    outputEl.textContent = text;
    outputEl.classList.remove("is-typing");
    void outputEl.offsetWidth;
    outputEl.classList.add("is-typing");
    outputStats.textContent = countWords(text) + " words";
    setMeter("meterFill", "meterValue", score);
    copyBtn.disabled = false;
    downloadBtn.disabled = false;
    rerollBtn.disabled = false;
    speakBtn.disabled = false;
  }

  function setMeter(fillId, valueId, score) {
    var fill = $(fillId);
    var value = $(valueId);
    fill.style.width = score + "%";
    value.textContent = score + "%";
    fill.style.background =
      score >= 75 ? "linear-gradient(90deg,#34d399,#a7f3d0)"
      : score >= 50 ? "linear-gradient(90deg,#8db857,#ffb347)"
      : "linear-gradient(90deg,#d64545,#ff6b35)";
  }

  function resetMeter(fillId, valueId) {
    $(fillId).style.width = "0%";
    $(valueId).textContent = "—";
  }

  function showEmpty() {
    outputEl.innerHTML =
      '<div class="output__empty">' +
      '<svg viewBox="0 0 64 64" class="output__icon" aria-hidden="true"><path d="M32 10c9 12 15 19 15 27a15 15 0 0 1-30 0c0-8 6-15 15-27z"/></svg>' +
      "<p>Your humanized text will appear here.</p></div>";
  }

  /* ---------- core actions ---------- */

  function runHumanize() {
    var text = inputEl.value;
    if (!text.trim()) {
      toast("Type or paste something first ✍️");
      inputEl.focus();
      return;
    }
    lastInput = text;
    setBusy(true);
    setTimeout(function () {
      var res = window.IHumanizer.humanize(text, { degree: DEGREE[mode], style: style });
      renderOutput(res.text, res.score);
      setBusy(false);
    }, 520);
  }

  function reroll() {
    if (!lastInput) return;
    var res = window.IHumanizer.humanize(lastInput, { degree: DEGREE[mode], style: style });
    renderOutput(res.text, res.score);
  }

  function updateInputStats() {
    inputStats.textContent =
      countWords(inputEl.value) + " words · " + inputEl.value.length + " chars";
  }

  /* ---------- clipboard, download, speech, sample ---------- */

  function copyText() {
    var t = outputEl.textContent;
    if (!t) return;
    var fallback = function () {
      var ta = document.createElement("textarea");
      ta.value = t;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand("copy"); } catch (e) {}
      ta.remove();
      toast("Copied to clipboard ✓");
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(t).then(toast.bind(null, "Copied to clipboard ✓"), fallback);
    } else {
      fallback();
    }
  }

  function downloadText() {
    var t = outputEl.textContent;
    if (!t) return;
    var blob = new Blob([t], { type: "text/plain;charset=utf-8" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = "ihuman-text.txt";
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    toast("Downloading ihuman-text.txt");
  }

  function speak() {
    if (!("speechSynthesis" in window)) { toast("Speech not supported here"); return; }
    if (!outputEl.textContent) return;
    window.speechSynthesis.cancel();
    var u = new SpeechSynthesisUtterance(outputEl.textContent);
    u.rate = 0.98;
    window.speechSynthesis.speak(u);
    toast("Reading aloud 🔊");
  }

  function loadSample() {
    inputEl.value = SAMPLE;
    updateInputStats();
    inputEl.focus();
    toast("Sample AI text loaded — hit Humanize");
  }

  function pasteFromClipboard() {
    if (navigator.clipboard && navigator.clipboard.readText) {
      pasteBtn.textContent = "Pasting…";
      navigator.clipboard.readText().then(function (text) {
        pasteBtn.textContent = "Paste";
        if (text) {
          inputEl.value = text;
          updateInputStats();
          toast("Pasted from clipboard");
        } else {
          toast("Clipboard is empty");
        }
      }, function () {
        pasteBtn.textContent = "Paste";
        toast("Allow clipboard access to paste");
      });
    } else {
      toast("Use Ctrl+V to paste");
      inputEl.focus();
    }
  }

  function clearAll() {
    inputEl.value = "";
    updateInputStats();
    lastInput = "";
    rerollBtn.disabled = true;
    outputStats.textContent = "0 words";
    resetMeter("meterFill", "meterValue");
    showEmpty();
    inputEl.focus();
  }

  /* ---------- events ---------- */

  humanizeBtn.addEventListener("click", runHumanize);
  rerollBtn.addEventListener("click", reroll);
  copyBtn.addEventListener("click", copyText);
  downloadBtn.addEventListener("click", downloadText);
  speakBtn.addEventListener("click", speak);
  pasteBtn.addEventListener("click", pasteFromClipboard);
  clearBtn.addEventListener("click", clearAll);
  $("sampleBtn").addEventListener("click", loadSample);

  inputEl.addEventListener("input", updateInputStats);
  inputEl.addEventListener("keydown", function (e) {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      runHumanize();
    }
  });

  showEmpty();
  updateInputStats();
  resetMeter("meterFill", "meterValue");

  /* ---------- hero glow cursor ---------- */

  (function () {
    var fine = window.matchMedia && window.matchMedia("(pointer: fine)").matches;
    var title = document.querySelector(".hero__title");
    var word = document.querySelector(".grad-text");
    if (!fine || !title || !word) return;

    var raf = null;
    var lastEvent = null;

    function apply() {
      raf = null;
      if (!lastEvent) return;
      var wr = word.getBoundingClientRect();
      var tr = title.getBoundingClientRect();
      word.style.setProperty("--glow-x", (lastEvent.clientX - wr.left) + "px");
      word.style.setProperty("--glow-y", (lastEvent.clientY - wr.top) + "px");
      title.style.setProperty("--halo-x", (lastEvent.clientX - tr.left) + "px");
      title.style.setProperty("--halo-y", (lastEvent.clientY - tr.top) + "px");
    }

    title.addEventListener("pointermove", function (e) {
      lastEvent = e;
      title.classList.add("is-lit");
      if (!raf) raf = requestAnimationFrame(apply);
    });

    title.addEventListener("pointerleave", function () {
      title.classList.remove("is-lit");
      lastEvent = null;
    });
  })();

  /* ---------- scroll animations ---------- */

  (function () {
    var reduced = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    /* scroll progress bar */
    var progress = document.querySelector(".scroll-progress");
    var nav = document.querySelector(".nav");
    var pTicking = false;

    function updateScrollUI() {
      pTicking = false;
      var doc = document.documentElement;
      var max = doc.scrollHeight - window.innerHeight;
      var p = max > 0 ? Math.min(1, window.scrollY / max) : 0;
      if (progress) progress.style.transform = "scaleX(" + p + ")";
      if (nav) nav.classList.toggle("is-scrolled", window.scrollY > 24);
    }

    window.addEventListener("scroll", function () {
      if (!pTicking) { pTicking = true; requestAnimationFrame(updateScrollUI); }
    }, { passive: true });
    updateScrollUI();

    if (reduced || !("IntersectionObserver" in window)) {
      [].forEach.call(document.querySelectorAll(".scroll-reveal"), function (el) {
        el.classList.add("is-visible");
      });
      return;
    }

    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-visible");
          io.unobserve(entry.target);
        }
      });
    }, { threshold: 0.12, rootMargin: "0px 0px -8% 0px" });

    [].forEach.call(document.querySelectorAll(".scroll-reveal"), function (el) {
      io.observe(el);
    });
  })();

  /* ---------- background blob parallax ---------- */

  (function () {
    var fine = window.matchMedia && window.matchMedia("(pointer: fine)").matches;
    var reduced = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!fine || reduced) return;

    var blobs = [].slice.call(document.querySelectorAll(".bg__blob"));
    if (!blobs.length) return;

    /* per-layer depth: nearer/brighter blobs travel farther */
    var DEPTH = [22, -30, 14, -38, 48];
    var tx = 0, ty = 0, cx = 0, cy = 0, raf = null;

    function tick() {
      cx += (tx - cx) * 0.06;
      cy += (ty - cy) * 0.06;
      for (var i = 0; i < blobs.length; i++) {
        var d = DEPTH[i] || 20;
        blobs[i].style.transform =
          "translate3d(" + (cx * d).toFixed(2) + "px," + (cy * d).toFixed(2) + "px,0)";
      }
      if (Math.abs(tx - cx) > 0.0004 || Math.abs(ty - cy) > 0.0004) {
        raf = requestAnimationFrame(tick);
      } else {
        raf = null;
      }
    }

    function kick() { if (!raf) raf = requestAnimationFrame(tick); }

    window.addEventListener("pointermove", function (e) {
      tx = e.clientX / window.innerWidth - 0.5;
      ty = e.clientY / window.innerHeight - 0.5;
      kick();
    });

    document.addEventListener("mouseleave", function () {
      tx = 0; ty = 0;
      kick();
    });
  })();
})();
