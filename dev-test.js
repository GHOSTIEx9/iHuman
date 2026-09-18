/* Dev-only harness for the humanizer engine (not shipped). */
global.window = global;
const fs = require("fs");
eval(fs.readFileSync("humanizer.js", "utf8"));

const H = window.IHumanizer;
let failures = 0;
function check(cond, label, extra) {
  if (!cond) { failures++; console.log("FAIL:", label, extra || ""); }
}

/* --- 1. The "these days" bug --- */
const t1 = "In today's fast-paced digital landscape, it is important to note that leveraging cutting-edge technologies is crucial for organizations seeking to delve into new market opportunities.";
for (let i = 0; i < 30; i++) {
  const r = H.humanize(t1, { degree: 3 }).text;
  check(!/\bt days\b/.test(r), "these-eaten", r);
  check(!/\bhandles the complexit/i.test(r), "navigate-verb", r);
  check(!/\u0001/.test(r), "vault-leak", r);
}

/* --- 2. Preservation guards --- */
const t2 = 'Dr. Smith visited NASA headquarters, per the "official report" from the IT department.';
for (let i = 0; i < 20; i++) {
  const r = H.humanize(t2, { degree: 3 }).text;
  check(r.includes("NASA"), "acronym-preserved", r);
  check(r.includes("Dr."), "abbrev-preserved", r);
  check(r.includes("Smith"), "name-preserved", r);
}

/* --- 3. Deterministic reseed + no crash on edge inputs --- */
const edges = ["", "   ", "Hi.", "1234 5678.", "don't can't it's", "CAPS LOCK SENTENCE.", "e.g. i.e. etc.", "a", "\n\n\n"];
for (const e of edges) {
  try { H.humanize(e, { degree: 2 }); } catch (err) { failures++; console.log("CRASH on", JSON.stringify(e), err.message); }
}

/* --- 4. Score must improve on classic AI prose --- */
const t3 = "In today's fast-paced digital landscape, it is important to note that leveraging cutting-edge technologies is crucial for organizations seeking to delve into new market opportunities. Furthermore, businesses must navigate the complexities of modern consumer behavior in order to remain competitive. Additionally, it is worth mentioning that a robust digital strategy plays a pivotal role in driving sustainable growth and fostering innovation across all sectors. It goes without saying that this paradigm shift will revolutionize how we utilize data. Moreover, in the realm of marketing, a myriad of factors must be considered when utilizing such robust systems. In conclusion, businesses that navigate the complexities of implementation will undoubtedly remain competitive.";
let improved = 0;
const runs = 25;
for (let i = 0; i < runs; i++) {
  const r = H.humanize(t3, { degree: 3 });
  if (r.score > r.fromScore) improved++;
}
console.log("score improved on", improved + "/" + runs, "runs");
check(improved >= runs * 0.9, "score-improvement-rate", improved + "/" + runs);

/* --- 5. Artifact zoo across random runs --- */
const zoo = [
  [/\b(and|but|so) also\b/i, "marker dup"],
  [/[.!?]\s+[a-z]/, "lowercase sentence start"],
  [/\ba plenty\b/, "article-plenty"],
  [/\bthe the\b|\ba a\b|\ban an\b/i, "double article"],
  [/\s{2,}/, "double space"],
  [/\bvery very\b/i, "double intensifier"],
  [/\u0001/, "vault leak"]
];
const t4 = "Furthermore, it is important to note that the results were very good. However, many people think it is very difficult to understand this concept. Additionally, robust systems provide significant value. In conclusion, a myriad of factors must be considered. Moreover, this tapestry of ideas plays a pivotal role.";
for (let i = 0; i < 60; i++) {
  const r = H.humanize(t4, { degree: (i % 3) + 1 }).text;
  for (const [re, label] of zoo) check(!re.test(r), label, JSON.stringify(r.slice(0, 120)));
}

/* --- 6. Detector sanity --- */
check(H.score(t3) < 30, "detector-flags-AI-text", H.score(t3));
const humanish = "Look, I tried this last week and honestly it works. Grab the files, run the script, done. The tricky part is permissions — but you've got this, kind of.";
check(H.score(humanish) > 55, "detector-likes-human-text", H.score(humanish));

console.log(failures === 0 ? "\nALL CHECKS PASSED" : "\n" + failures + " FAILURES");
process.exit(failures === 0 ? 0 : 1);
