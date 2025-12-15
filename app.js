/* Transfer-to-Grad Planner
   - Extracts course codes from a PDF (via pdf.js)
   - Lets student confirm completed courses + equivalency mapping
   - Builds a simple prerequisite-aware term plan
*/

const $ = (id) => document.getElementById(id);

const STATE = {
  transcriptText: "",
  requirementsText: "",
  completed: new Set(),
  requirements: new Set(),
  prereqs: {}, // { "CS 112": ["CS 111"] }
  plan: null
};

// pdf.js worker
if (window.pdfjsLib) {
  // Use a matching CDN worker version for pdf.js
  pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.7.76/pdf.worker.min.js";
}

function setPill(el, text, tone = "neutral") {
  el.textContent = text;
  el.style.borderColor =
    tone === "good" ? "rgba(46,229,157,.35)" :
    tone === "warn" ? "rgba(255,211,107,.35)" :
    tone === "bad"  ? "rgba(255,107,139,.35)" :
                      "rgba(255,255,255,.12)";
  el.style.color =
    tone === "good" ? "rgba(46,229,157,.95)" :
    tone === "warn" ? "rgba(255,211,107,.95)" :
    tone === "bad"  ? "rgba(255,107,139,.95)" :
                      "rgba(255,255,255,.70)";
  el.style.background =
    tone === "good" ? "rgba(46,229,157,.09)" :
    tone === "warn" ? "rgba(255,211,107,.09)" :
    tone === "bad"  ? "rgba(255,107,139,.09)" :
                      "rgba(0,0,0,.18)";
}

function normalizeCode(s) {
  // Normalize: collapse whitespace, convert dashes to space, uppercase dept.
  const t = s.replace(/[-_]/g, " ").replace(/\s+/g, " ").trim();
  // Convert "cs 111" -> "CS 111"
  const m = t.match(/^([A-Za-z]{2,6})\s*(\d{2,4}[A-Za-z]?)$/);
  if (m) return `${m[1].toUpperCase()} ${m[2].toUpperCase()}`;
  return t.toUpperCase();
}

function uniqueSorted(arr) {
  return Array.from(new Set(arr)).sort((a,b)=>a.localeCompare(b));
}

function renderChips(container, setRef) {
  container.innerHTML = "";
  const items = Array.from(setRef).sort((a,b)=>a.localeCompare(b));
  if (!items.length) {
    const empty = document.createElement("div");
    empty.className = "muted small";
    empty.textContent = "No courses yet.";
    container.appendChild(empty);
    return;
  }
  for (const code of items) {
    const chip = document.createElement("div");
    chip.className = "chip";
    chip.innerHTML = `<span>${escapeHtml(code)}</span>`;
    const x = document.createElement("div");
    x.className = "x";
    x.title = "Remove";
    x.textContent = "×";
    x.onclick = () => { setRef.delete(code); renderAll(); };
    chip.appendChild(x);
    container.appendChild(chip);
  }
}

function escapeHtml(s){
  return s.replace(/[&<>"]/g, (c)=>({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;" }[c]));
}

async function readPdfText(file) {
  const buf = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
  let out = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    const strings = content.items.map((it) => it.str);
    out.push(strings.join(" "));
  }
  return out.join("\n");
}

// Heuristic course-code matcher.
// Tries to capture common formats: "CS 111", "CS-111", "MATH151", "ENGR 201A"
function extractCourseCodes(text) {
  const codes = [];
  const regexes = [
    /\b([A-Za-z]{2,6})\s*[- ]\s*(\d{2,4}[A-Za-z]?)\b/g,
    /\b([A-Za-z]{2,6})(\d{3}[A-Za-z]?)\b/g, // e.g., MATH151
  ];
  for (const rx of regexes) {
    let m;
    while ((m = rx.exec(text)) !== null) {
      codes.push(normalizeCode(`${m[1]} ${m[2]}`));
    }
  }
  // Remove obvious false positives like years (e.g., "FALL 2024" -> "FALL 2024" won't match dept letters)
  return uniqueSorted(codes);
}

function parseEquivalency(text) {
  // Lines like: "MAT 152 = MATH 152"
  const map = new Map();
  const lines = text.split(/\r?\n/).map(l=>l.trim()).filter(Boolean);
  for (const line of lines) {
    const parts = line.split("=").map(s=>s.trim());
    if (parts.length !== 2) continue;
    const from = normalizeCode(parts[0]);
    const to   = normalizeCode(parts[1]);
    map.set(from, to);
  }
  return map;
}

function applyEquivalency() {
  const map = parseEquivalency($("equivalency").value || "");
  if (!map.size) return;

  const newCompleted = new Set();
  for (const c of STATE.completed) {
    newCompleted.add(map.get(c) || c);
  }
  STATE.completed = newCompleted;

  // Also translate requirements if user wants (usually they are already university codes)
  renderAll();
}

function parseRequirementsList(text) {
  const lines = text.split(/\r?\n/).map(l=>l.trim()).filter(Boolean);
  const out = new Set();
  for (const l of lines) {
    // If line contains multiple codes, extract them
    const codes = extractCourseCodes(l);
    if (codes.length) codes.forEach(c=>out.add(c));
    else out.add(normalizeCode(l));
  }
  return out;
}

function validatePrereqJson() {
  try {
    const obj = JSON.parse($("prereqJson").value || "{}");
    // Normalize keys/values
    const norm = {};
    for (const [k, v] of Object.entries(obj)) {
      const key = normalizeCode(k);
      const arr = Array.isArray(v) ? v : [];
      norm[key] = arr.map(normalizeCode);
    }
    STATE.prereqs = norm;
    setPill($("prereqStatus"), "Valid ✔", "good");
  } catch (e) {
    setPill($("prereqStatus"), "Invalid JSON ✖", "bad");
  }
}

function computeRemaining() {
  const remaining = new Set();
  for (const r of STATE.requirements) {
    if (!STATE.completed.has(r)) remaining.add(r);
  }
  return remaining;
}

// Build term labels like: "Spring 2026", "Fall 2026", alternating.
function buildTermLabels(startLabel, n) {
  // If user types something unknown, just enumerate
  const m = startLabel.match(/\b(Spring|Summer|Fall|Winter)\b\s*(\d{4})/i);
  if (!m) return Array.from({length:n}, (_,i)=>`Term ${i+1}`);
  const season0 = m[1][0].toUpperCase() + m[1].slice(1).toLowerCase();
  let year = parseInt(m[2],10);
  const order = ["Spring","Summer","Fall","Winter"];
  let idx = order.indexOf(season0);
  if (idx < 0) idx = 0;

  const labels = [];
  for (let i=0;i<n;i++){
    labels.push(`${order[idx]} ${year}`);
    idx = (idx + 1) % order.length;
    if (idx === 0) year += 1; // wrap after Winter -> Spring
  }
  return labels;
}

// Prerequisite-aware greedy scheduler.
// - Each term picks up to maxPerTerm courses that have prereqs satisfied by completed + prior terms.
// - If a course has unknown prereqs, we treat it as no prereq (warn in UI).
function generatePlan({ startTerm, termCount, maxPerTerm, includeElectives }) {
  const termLabels = buildTermLabels(startTerm, termCount);
  const remaining = computeRemaining();

  // Build adjacency / indegree for remaining using prereqs, but enforce only prereqs that are in requirements or already completed.
  const prereqs = STATE.prereqs || {};

  const satisfied = new Set(STATE.completed);
  const planned = new Set(); // courses we place into terms
  const plan = termLabels.map(label => ({ label, courses: [] }));

  // Helper: can we take course now?
  const canTake = (course) => {
    const reqs = prereqs[course] || [];
    // Only require prereqs that are actual courses (if user includes them)
    for (const r of reqs) {
      if (!satisfied.has(r)) return false;
    }
    return true;
  };

  const remainingList = () => Array.from(remaining).filter(c=>!planned.has(c)).sort((a,b)=>a.localeCompare(b));

  for (let t=0; t<plan.length; t++){
    const term = plan[t];

    let picked = [];
    for (const c of remainingList()) {
      if (picked.length >= maxPerTerm) break;
      if (canTake(c)) {
        picked.push(c);
      }
    }

    // If nothing is pickable, we might be blocked by missing prereqs. Try to pull in missing prereqs if they exist in prereq graph.
    if (picked.length === 0) {
      // Find a blocked course and suggest prereqs
      const blocked = remainingList()[0];
      if (blocked) {
        const reqs = (prereqs[blocked] || []).filter(r=>!satisfied.has(r));
        term.courses.push({ code: "⚠ Blocked", note: `Need prereqs for ${blocked}: ${reqs.join(", ") || "unknown"}` });
      }
      continue;
    }

    // Add picked
    for (const c of picked) {
      term.courses.push({ code: c });
      planned.add(c);
    }
    // Mark as satisfied for future terms
    for (const c of picked) satisfied.add(c);

    // Optionally fill with electives placeholders
    if (includeElectives === "yes") {
      while (term.courses.length < maxPerTerm) {
        term.courses.push({ code: "ELECTIVE", note: "Choose a major/tech elective offered this term." });
      }
    }
  }

  const notScheduled = remainingList().filter(c=>!planned.has(c));
  return { termLabels, plan, notScheduled, completed: Array.from(STATE.completed).sort(), requirements: Array.from(STATE.requirements).sort(), prereqs: STATE.prereqs };
}

function renderPlan(planObj) {
  const wrap = $("planView");
  wrap.innerHTML = "";
  if (!planObj) return;

  for (const term of planObj.plan) {
    const card = document.createElement("div");
    card.className = "term";

    const head = document.createElement("div");
    head.className = "term-head";
    head.innerHTML = `<div class="term-title">${escapeHtml(term.label)}</div>
                      <div class="term-meta">${term.courses.length} item(s)</div>`;
    card.appendChild(head);

    const list = document.createElement("div");
    list.className = "term-list";

    for (const c of term.courses) {
      const chip = document.createElement("div");
      chip.className = "chip";
      const note = c.note ? ` <span class="muted small">— ${escapeHtml(c.note)}</span>` : "";
      chip.innerHTML = `<span>${escapeHtml(c.code)}</span>${note}`;
      list.appendChild(chip);
    }
    card.appendChild(list);
    wrap.appendChild(card);
  }
}

function renderAll() {
  $("rawText").value = STATE.transcriptText || "";
  renderChips($("completedChips"), STATE.completed);
  const cc = document.getElementById("completedCount");
  if (cc) cc.textContent = `${STATE.completed.size} course(s)`;

  // Requirements textarea
  $("requirementsList").value = Array.from(STATE.requirements).sort((a,b)=>a.localeCompare(b)).join("\n");
  const rc = document.getElementById("reqCount");
  if (rc) rc.textContent = `${STATE.requirements.size} required`;

  // Remaining
  const remaining = computeRemaining();
  $("remainingChips").innerHTML = "";
  if (remaining.size) {
    for (const code of Array.from(remaining).sort((a,b)=>a.localeCompare(b))) {
      const chip = document.createElement("div");
      chip.className = "chip";
      chip.innerHTML = `<span>${escapeHtml(code)}</span>`;
      $("remainingChips").appendChild(chip);
    }
  } else {
    const done = document.createElement("div");
    done.className = "muted small";
    done.textContent = "No remaining courses detected (check your requirements list).";
    $("remainingChips").appendChild(done);
  }

  renderPlan(STATE.plan);

  // Plan status summary
  if (STATE.plan?.notScheduled?.length) {
    setPill($("planStatus"), `Planned with leftovers: ${STATE.plan.notScheduled.length}`, "warn");
  } else if (STATE.plan) {
    setPill($("planStatus"), "Plan generated ✔", "good");
  } else {
    setPill($("planStatus"), "Ready");
  }
}

// --- Wire up UI ---
function bindFileMeta(inputEl, metaEl) {
  inputEl.addEventListener("change", () => {
    if (!inputEl.files || !inputEl.files[0]) {
      metaEl.textContent = "Choose a PDF…";
      return;
    }
    const f = inputEl.files[0];
    metaEl.textContent = `${f.name} • ${(f.size/1024/1024).toFixed(2)} MB`;
  });
}

bindFileMeta($("transcriptPdf"), $("transcriptMeta"));
bindFileMeta($("requirementsPdf"), $("requirementsMeta"));

$("btnParse").addEventListener("click", async () => {
  const file = $("transcriptPdf").files?.[0];
  if (!file) {
    setPill($("parseStatus"), "Upload a transcript PDF first", "warn");
    return;
  }
  if (!window.pdfjsLib) {
    setPill($("parseStatus"), "PDF engine not available (CDN blocked). If you need offline, bundle pdf.js locally under vendor/pdfjs/", "bad");
    const helpBox = document.getElementById("pdfHelp");
    if (helpBox) helpBox.hidden = false;
    return;
  }

  setPill($("parseStatus"), "Parsing PDF…");
  try {
    const text = await readPdfText(file);
    STATE.transcriptText = text;
    $("rawText").value = text;

    const codes = extractCourseCodes(text);
    codes.forEach(c=>STATE.completed.add(c));
    setPill($("parseStatus"), `Found ${codes.length} course code(s)`, codes.length ? "good" : "warn");
    renderAll();
  } catch (e) {
    console.error(e);
    setPill($("parseStatus"), "Could not parse PDF text", "bad");
  }
});

$("btnUseReqPdf").addEventListener("click", async () => {
  // If used as a button, open file picker first
  const reqInput = $("requirementsPdf");
  if (reqInput && reqInput.type === "file" && (!reqInput.files || !reqInput.files[0])) {
    reqInput.click();
    return;
  }
  const file = $("requirementsPdf").files?.[0];
  if (!file) {
    setPill($("planStatus"), "Upload a requirements PDF or paste requirements", "warn");
    return;
  }
  if (!window.pdfjsLib) {
    setPill($("planStatus"), "pdf.js failed to load (check internet)", "bad");
    return;
  }

  setPill($("planStatus"), "Parsing requirements PDF…");
  try {
    const text = await readPdfText(file);
    STATE.requirementsText = text;

    const codes = extractCourseCodes(text);
    STATE.requirements = new Set(codes);
    $("requirementsList").value = codes.join("\n");
    setPill($("planStatus"), `Loaded ${codes.length} requirement code(s)`, codes.length ? "good" : "warn");
    renderAll();
  } catch (e) {
    console.error(e);
    setPill($("planStatus"), "Could not parse requirements PDF", "bad");
  }
});

$("btnAddCompleted").addEventListener("click", () => {
  const v = $("addCompleted").value.trim();
  if (!v) return;
  STATE.completed.add(normalizeCode(v));
  $("addCompleted").value = "";
  renderAll();
});

$("btnApplyEquiv").addEventListener("click", () => {
  applyEquivalency();
  setPill($("parseStatus"), "Mapping applied", "good");
});

$("btnLoadTemplate").addEventListener("click", async () => {
  try {
    const res = await fetch("./data/sample_requirements.txt");
    const txt = await res.text();
    $("requirementsList").value = txt.trim();
    STATE.requirements = parseRequirementsList(txt);
    setPill($("planStatus"), "Template loaded", "good");
    renderAll();
  } catch {
    setPill($("planStatus"), "Could not load template", "bad");
  }
});

$("btnValidatePrereq").addEventListener("click", () => validatePrereqJson());

$("btnPlan").addEventListener("click", () => {
  // Requirements from textarea
  STATE.requirements = parseRequirementsList($("requirementsList").value || "");
  // Prereqs from JSON
  try {
    const obj = JSON.parse($("prereqJson").value || "{}");
    const norm = {};
    for (const [k, v] of Object.entries(obj)) {
      const key = normalizeCode(k);
      const arr = Array.isArray(v) ? v : [];
      norm[key] = arr.map(normalizeCode);
    }
    STATE.prereqs = norm;
  } catch {
    // leave prereqs as-is
  }

  const startTerm = $("startTerm").value.trim() || "Term 1";
  const termCount = Math.max(1, Math.min(20, parseInt($("termCount").value || "6", 10)));
  const maxPerTerm = Math.max(1, Math.min(8, parseInt($("maxPerTerm").value || "5", 10)));
  const includeElectives = $("includeElectives").value;

  const plan = generatePlan({ startTerm, termCount, maxPerTerm, includeElectives });
  STATE.plan = plan;

  const rem = computeRemaining();
  if (!rem.size) setPill($("planStatus"), "No remaining courses (check requirements)", "warn");
  else if (plan.notScheduled.length) setPill($("planStatus"), `Planned with ${plan.notScheduled.length} not scheduled`, "warn");
  else setPill($("planStatus"), "Plan generated ✔", "good");

  renderAll();
});

$("btnExportPlan").addEventListener("click", () => {
  const payload = STATE.plan || generatePlan({
    startTerm: $("startTerm").value.trim() || "Term 1",
    termCount: parseInt($("termCount").value || "6", 10),
    maxPerTerm: parseInt($("maxPerTerm").value || "5", 10),
    includeElectives: $("includeElectives").value
  });
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "transfer_plan.json";
  a.click();
  URL.revokeObjectURL(a.href);
});

$("btnLoadSample").addEventListener("click", async () => {
  try {
    // Load sample completed + requirements + prereqs
    const [reqTxt, prereq] = await Promise.all([
      fetch("./data/sample_requirements.txt").then(r=>r.text()),
      fetch("./data/sample_prereqs.json").then(r=>r.json())
    ]);

    STATE.completed = new Set(["MATH 151","CS 111","ENG 101"].map(normalizeCode));
    STATE.requirements = parseRequirementsList(reqTxt);
    STATE.prereqs = prereq;
    $("prereqJson").value = JSON.stringify(prereq, null, 2);
    $("equivalency").value = "MAT 151 = MATH 151\nCIS 111 = CS 111";
    $("requirementsList").value = reqTxt.trim();

    setPill($("parseStatus"), "Sample loaded", "good");
    setPill($("planStatus"), "Sample ready", "good");
    renderAll();
  } catch (e) {
    console.error(e);
    setPill($("planStatus"), "Could not load sample", "bad");
  }
});

// Initial load sample prereq JSON into editor
(async function init(){
  try{
    const prereq = await fetch("./data/sample_prereqs.json").then(r=>r.json());
    $("prereqJson").value = JSON.stringify(prereq, null, 2);
  } catch {
    $("prereqJson").value = "{\n  \"CS 112\": [\"CS 111\"],\n  \"MATH 152\": [\"MATH 151\"]\n}";
  }
  $("equivalency").value = "MAT 152 = MATH 152\nCIS 112 = CS 112";
  renderAll();
})();

// --- Minimal UI extras (offline build) ---
(function uiExtras(){
  const helpBtn = document.getElementById("btnShowHelp");
  const helpBox = document.getElementById("pdfHelp");
  if (helpBtn && helpBox) {
    helpBtn.addEventListener("click", () => {
      helpBox.hidden = !helpBox.hidden;
    });
  }

  const rawBtn = document.getElementById("btnToggleRaw");
  const raw = document.getElementById("rawText");
  if (rawBtn && raw) {
    rawBtn.addEventListener("click", () => {
      raw.hidden = !raw.hidden;
    });
  }

  // Requirements PDF button now triggers hidden input
  const btnUseReqPdf = document.getElementById("btnUseReqPdf");
  const reqInput = document.getElementById("requirementsPdf");
  if (btnUseReqPdf && reqInput) {
    btnUseReqPdf.addEventListener("click", () => reqInput.click());
  }
})();
