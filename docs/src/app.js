/* =========================================================
   Broker Copilot – Agent-driven (no pre-scripted products)
   - Phase 1: /analyze -> clarifiers (if needed)
   - Phase 2: /recommend -> recommendations with rationale
   ========================================================= */

const AGENT_BASE_URL = ""; // e.g. "https://your-worker.yourdomain.workers.dev"

// IDs expected in your HTML (from your existing UI)
const IDS = {
  runBtn: "runBtn",
  resetBtn: "resetBtn",
  activityText: "activityText",

  // Optional capture fields (if present in your HTML)
  lineSelect: "lineSelect",
  businessType: "businessType",
  turnover: "turnover",
  staff: "staff",
  premises: "premises",
  vehicles: "vehicles",
  customerName: "customerName",

  // Concerns
  concernChips: "concernChips",     // optional (your existing chips)
  concernsFreeText: "concernsFreeText",

  // Clarifiers UI
  clarifiersPanel: "clarifiersPanel",
  clarifiersList: "clarifiersList",

  // Recommendation UI containers (your existing UI likely has these)
  groups: "groups",                 // where recommendation cards render
  followupList: "followupList",     // optional (we can reuse to show clarifier questions)
  tagChips: "tagChips",             // optional

  // Quote pack UI (your existing buttons)
  exportBtn: "exportBtn",           // if you have it; otherwise we wire by text later
  startQuotesBtn: "startQuotesBtn", // if you have it; otherwise we wire by text later
  packCount: "packCount",           // optional
  packList: "packList"              // optional
};

const $ = (id) => document.getElementById(id);

function safeVal(id) {
  const el = $(id);
  return el ? el.value : "";
}

function toast(msg) {
  const el = $("toast");
  if (!el) return;
  el.textContent = msg;
  el.classList.add("show");
  setTimeout(() => el.classList.remove("show"), 2500);
}

/* ------------------ State ------------------ */
let lastAnalysis = null; // stores clarifiers/questions returned by agent
let selectedProducts = new Map(); // key -> product object returned by agent

/* ------------------ Concerns collection ------------------ */
function getSelectedConcernChips() {
  const wrap = $(IDS.concernChips);
  if (!wrap) return [];
  return [...wrap.querySelectorAll(".chip.on")].map(x => x.textContent.trim());
}

function buildPayload(extra = {}) {
  const activity = safeVal(IDS.activityText).trim();

  return {
    // core
    line: safeVal(IDS.lineSelect) || "Commercial (SME)",
    customerName: safeVal(IDS.customerName) || "",
    businessType: safeVal(IDS.businessType) || "",
    turnoverBand: safeVal(IDS.turnover) || "",
    staffBand: safeVal(IDS.staff) || "",
    premises: safeVal(IDS.premises) || "",
    vehicles: safeVal(IDS.vehicles) || "",

    // customer statements
    businessDescription: activity,
    concerns: {
      selected: getSelectedConcernChips(),               // optional “quick toggles”
      freeText: (safeVal(IDS.concernsFreeText) || "").trim()
    },

    // clarifier answers (if any)
    clarifierAnswers: collectClarifierAnswers(),

    // passthrough
    ...extra
  };
}

function collectClarifierAnswers() {
  const panel = $(IDS.clarifiersPanel);
  if (!panel || panel.style.display === "none") return {};
  const inputs = panel.querySelectorAll("[data-clarifier-id]");
  const out = {};
  inputs.forEach(inp => {
    out[inp.dataset.clarifierId] = (inp.value || "").trim();
  });
  return out;
}

/* ------------------ Agent calls ------------------ */

async function agentPost(path, payload) {
  if (!AGENT_BASE_URL) {
    throw new Error("AGENT_BASE_URL is not set. Add your real agent endpoint URL.");
  }

  const res = await fetch(`${AGENT_BASE_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Agent error ${res.status}: ${text}`);
  }
  return res.json();
}

/**
 * Expected /analyze response:
 * {
 *   needsClarifiers: boolean,
 *   clarifiers: [{ id, question, type: "text"|"choice", choices?: string[] }],
 *   extracted: { tags?: string[], riskSignals?: string[] },
 *   confidence?: "Low"|"Medium"|"High"
 * }
 */
async function analyze(payload) {
  return agentPost("/broker-copilot/analyze", payload);
}

/**
 * Expected /recommend response:
 * {
 *   recommendations: [
 *     {
 *       key: string,                // stable id e.g. "pl", "el", "pi" or your own
 *       name: string,               // product name e.g. "Public Liability"
 *       relevance: "High"|"Med"|"Low",
 *       whyRelevant: string,        // MUST be specific to this prospect
 *       whatItCovers: string,       // short plain-English summary
 *       typicalAsks: string[],      // questions the broker might ask
 *       notes?: string,             // e.g. limits, contract language hints
 *       confidence?: number         // 0-100 optional
 *     }
 *   ],
 *   exclusions?: string[],          // optional
 *   confidence?: "Low"|"Medium"|"High"
 * }
 */
async function recommend(payload) {
  return agentPost("/broker-copilot/recommend", payload);
}

/* ------------------ Clarifiers UI ------------------ */

function showClarifiers(clarifiers = []) {
  const panel = $(IDS.clarifiersPanel);
  const list = $(IDS.clarifiersList);
  if (!panel || !list) return;

  if (!clarifiers.length) {
    panel.style.display = "none";
    list.innerHTML = "";
    return;
  }

  panel.style.display = "block";

  list.innerHTML = clarifiers.map(c => {
    if (c.type === "choice" && Array.isArray(c.choices)) {
      return `
        <div class="clarifier">
          <div class="small"><b>${escapeHtml(c.question)}</b></div>
          <select class="input" data-clarifier-id="${escapeHtml(c.id)}">
            <option value="">Select...</option>
            ${c.choices.map(ch => `<option value="${escapeHtml(ch)}">${escapeHtml(ch)}</option>`).join("")}
          </select>
        </div>
      `;
    }

    return `
      <div class="clarifier">
        <div class="small"><b>${escapeHtml(c.question)}</b></div>
        <input class="input" data-clarifier-id="${escapeHtml(c.id)}" placeholder="Type answer..." />
      </div>
    `;
  }).join("");

  toast("Answer clarifiers, then Generate again");
}

/* ------------------ Recommendations UI ------------------ */

function renderRecommendations(items = []) {
  const wrap = $(IDS.groups);
  if (!wrap) return;

  if (!items.length) {
    wrap.innerHTML = `<div class="small">No recommendations returned.</div>`;
    return;
  }

  wrap.innerHTML = `
    <div class="group">
      <div class="groupHead">
        <div><span class="dot good"></span> <b>Recommended to discuss</b></div>
        <span>${items.length} items</span>
      </div>
      <div class="products">
        ${items.map(renderProductCard).join("")}
      </div>
    </div>
  `;

  // wire up selects
  wrap.querySelectorAll("[data-select-product]").forEach(btn => {
    btn.addEventListener("click", () => {
      const key = btn.dataset.selectProduct;
      const raw = btn.dataset.productJson;
      const obj = JSON.parse(raw);

      if (selectedProducts.has(key)) {
        selectedProducts.delete(key);
        btn.textContent = "Add to quote pack";
        btn.classList.remove("on");
      } else {
        selectedProducts.set(key, obj);
        btn.textContent = "Added";
        btn.classList.add("on");
      }

      updatePackUI();
    });
  });

  updatePackUI();
}

function renderProductCard(p) {
  const key = p.key || p.name || cryptoKey(p);
  const conf = typeof p.confidence === "number" ? Math.round(p.confidence) : null;
  const isOn = selectedProducts.has(key);

  // store product JSON in dataset for pack export
  const json = escapeAttr(JSON.stringify({
    key,
    name: p.name,
    relevance: p.relevance || "Med",
    whyRelevant: p.whyRelevant || "",
    whatItCovers: p.whatItCovers || "",
    typicalAsks: Array.isArray(p.typicalAsks) ? p.typicalAsks : [],
    notes: p.notes || ""
  }));

  return `
    <div class="prod">
      <div class="prodTop">
        <div>
          <div class="prodName">${escapeHtml(p.name || "Recommendation")}</div>
          <div class="why">${escapeHtml(p.whatItCovers || "")}</div>
        </div>
        <span class="badge">
          <span class="dot ${p.relevance === "High" ? "good" : "warn"}"></span>
          ${conf !== null ? conf : escapeHtml(p.relevance || "Med")}
        </span>
      </div>

      <div class="small" style="margin-top:10px;">
        <b>Why this is relevant</b><br/>
        ${escapeHtml(p.whyRelevant || "—")}
      </div>

      ${Array.isArray(p.typicalAsks) && p.typicalAsks.length ? `
        <ul class="qList">
          ${p.typicalAsks.slice(0, 4).map(q => `<li>${escapeHtml(q)}</li>`).join("")}
        </ul>
      ` : ""}

      ${p.notes ? `<div class="small"><b>Notes</b><br/>${escapeHtml(p.notes)}</div>` : ""}

      <div style="margin-top:12px; display:flex; gap:10px;">
        <button class="btn ${isOn ? "on" : ""}" data-select-product="${escapeAttr(key)}" data-product-json="${json}">
          ${isOn ? "Added" : "Add to quote pack"}
        </button>
      </div>
    </div>
  `;
}

/* ------------------ Quote pack ------------------ */

function updatePackUI() {
  const countEl = $(IDS.packCount);
  if (countEl) countEl.textContent = `${selectedProducts.size}`;

  const listEl = $(IDS.packList);
  if (listEl) {
    listEl.innerHTML = [...selectedProducts.values()].map(p => `
      <div class="small">• <b>${escapeHtml(p.name)}</b> — ${escapeHtml(p.relevance || "")}</div>
    `).join("");
  }
}

function exportPackJSON() {
  const payload = {
    createdAt: new Date().toISOString(),
    line: safeVal(IDS.lineSelect) || "Commercial (SME)",
    customerName: safeVal(IDS.customerName) || "",
    businessDescription: safeVal(IDS.activityText) || "",
    concerns: {
      selected: getSelectedConcernChips(),
      freeText: (safeVal(IDS.concernsFreeText) || "").trim()
    },
    clarifierAnswers: collectClarifierAnswers(),
    selectedProducts: [...selectedProducts.values()]
  };

  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `quote-pack-${Date.now()}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function startQuotesStub() {
  if (!selectedProducts.size) {
    toast("Select at least one product first");
    return;
  }
  // Stub: in real integration, this is where you’d deep-link into your quote journeys / PAS
  alert(`Start quotes (stub)\n\nSelected:\n- ${[...selectedProducts.values()].map(p => p.name).join("\n- ")}`);
}

/* ------------------ Main button flow ------------------ */

async function runAgentFlow() {
  const activity = safeVal(IDS.activityText).trim();
  if (!activity) {
    toast("Add a business description first");
    return;
  }

  const payload = buildPayload();

  try {
    // Phase 1: analyze for clarifiers
    const analysis = await analyze(payload);
    lastAnalysis = analysis;

    if (analysis.needsClarifiers && Array.isArray(analysis.clarifiers) && analysis.clarifiers.length) {
      showClarifiers(analysis.clarifiers);
      // Do NOT recommend yet until clarifiers answered
      return;
    }

    // No clarifiers needed -> proceed directly
    showClarifiers([]); // hide
    const rec = await recommend(payload);

    selectedProducts.clear();
    renderRecommendations(Array.isArray(rec.recommendations) ? rec.recommendations : []);
    toast("Recommendations ready");
  } catch (e) {
    console.error(e);
    toast(e.message || "Agent error");
    // Keep UI stable even if agent fails
  }
}

/* ------------------ Helpers ------------------ */
function escapeHtml(s) {
  return String(s || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttr(s) {
  return String(s || "").replaceAll('"', "&quot;");
}

function cryptoKey(obj) {
  // stable-ish key fallback
  try {
    const str = JSON.stringify(obj);
    let h = 0;
    for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
    return `rec_${h}`;
  } catch {
    return `rec_${Math.random().toString(16).slice(2)}`;
  }
}

/* ------------------ Wire buttons ------------------ */
function wireButtons() {
  const run = $(IDS.runBtn);
  const reset = $(IDS.resetBtn);

  if (run) run.onclick = runAgentFlow;
  if (reset) reset.onclick = () => location.reload();

  // If your buttons don’t have IDs, we can wire by text (fallback)
  document.querySelectorAll("button").forEach(btn => {
    const t = (btn.textContent || "").trim().toLowerCase();
    if (t.includes("export") && t.includes("json")) btn.onclick = exportPackJSON;
    if (t.includes("start") && t.includes("quote")) btn.onclick = startQuotesStub;
  });

  // If you *do* add IDs later, these take priority:
  const exportBtn = $(IDS.exportBtn);
  if (exportBtn) exportBtn.onclick = exportPackJSON;

  const startBtn = $(IDS.startQuotesBtn);
  if (startBtn) startBtn.onclick = startQuotesStub;
}

/* ------------------ Init ------------------ */
wireButtons();
updatePackUI();
