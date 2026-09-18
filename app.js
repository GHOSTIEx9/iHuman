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
    setMeter(score);
    copyBtn.disabled = false;
    downloadBtn.disabled = false;
    rerollBtn.disabled = false;
    speakBtn.disabled = false;
  }

  function setMeter(score) {
    var fill = $("meterFill");
    var value = $("meterValue");
    fill.style.width = score + "%";
    value.textContent = score + "%";
    fill.style.background =
      score >= 75 ? "linear-gradient(90deg,#34d399,#a7f3d0)"
      : score >= 50 ? "linear-gradient(90deg,#7c5cff,#ff6ec7)"
      : "linear-gradient(90deg,#ff6ec7,#ff9d5c)";
  }

  function resetMeter() {
    $("meterFill").style.width = "0%";
    $("meterValue").textContent = "—";
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
    resetMeter();
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
  resetMeter();
})();
