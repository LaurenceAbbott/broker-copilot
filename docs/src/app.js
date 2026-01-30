/* =========================================================
   Broker Copilot – Agent-driven (no pre-scripted products)
   - Phase 1: /analyze -> clarifiers (if needed)
   - Phase 2: /recommend -> recommendations with rationale
   ========================================================= */

const WORKER_BASE_URL = "https://broker-copilot-agent.laurence-ogi.workers.dev";

// IDs expected in your HTML (from your existing UI)
const IDS = {
  runBtn: "runBtn",
  resetBtn: "resetBtn",
  continueBtn: "continueBtn",
  activityText: "activityText",
  statusMessage: "statusMessage",
  errorMessage: "errorMessage",

  // Optional capture fields (if present in your HTML)
  lineSelect: "lineSelect",
  businessType: "bizType",
  turnover: "turnover",
  staff: "staff",
  premises: "premises",
  vehicles: "vehicles",
  customerName: "custName",

  // Concerns
  concernsFreeText: "concernsFreeText",

     // Clarifiers UI (deprecated, follow-up questions removed)
  clarifiersPanel: "clarifiersPanel",
  clarifiersList: "clarifiersList",

  // Recommendation UI containers (your existing UI likely has these)
  groups: "groups",                 // where recommendation cards render
  followupList: "followupList",     // optional

  // Quote pack UI (your existing buttons)
  startQuotesBtn: "startPackBtn",   // if you have it; otherwise we wire by text later
  packCount: "packCount",           // optional
  packList: "packList",             // optional
  packBadge: "packBadge"
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
let lastAnalysis = null;
let lastPayload = null;
let lastRecommendations = [];
let lastClarifierAnswers = {};
let isLoading = false;
let selectedProducts = new Map(); // key -> product object returned by agent
/* ------------------ Concerns collection ------------------ */

function getLineLabel() {
  const select = $(IDS.lineSelect);
  if (!select) return "";
  const opt = select.options[select.selectedIndex];
  return opt ? opt.textContent.trim() : select.value;
}

function buildPayload(extra = {}) {
  const activity = safeVal(IDS.activityText).trim();

  return {
    // core
    line: getLineLabel() || safeVal(IDS.lineSelect) || "Commercial (SME)",
    customerName: safeVal(IDS.customerName) || "",
    businessType: safeVal(IDS.businessType) || "",
    turnoverBand: safeVal(IDS.turnover) || "",
    staffBand: safeVal(IDS.staff) || "",
    premises: safeVal(IDS.premises) || "",
    vehicles: safeVal(IDS.vehicles) || "",

    // customer statements
    businessDescription: activity,
    concerns: {
      freeText: (safeVal(IDS.concernsFreeText) || "").trim()
    },
     
    // passthrough
    ...extra
  };
}

/* ------------------ Worker calls ------------------ */

async function callWorker(path, payload, options = {}) {
  const res = await fetch(`${WORKER_BASE_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
    ...options
  });

     const text = await res.text();
  if (!res.ok) {
        throw new Error(`Worker error ${res.status}: ${text}`);
  }

  try {
    return text ? JSON.parse(text) : {};
  } catch (err) {
    throw new Error(`Worker returned invalid JSON: ${err.message}`);
  }
  
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
  return callWorker("/broker-copilot/recommend", payload);
}

/* ------------------ UI state ------------------ */

function setLoading(nextState, message = "") {
  isLoading = nextState;
  const run = $(IDS.runBtn);
  const cont = $(IDS.continueBtn);
  const reset = $(IDS.resetBtn);

  if (run) run.disabled = nextState;
  if (cont) cont.disabled = nextState;
  if (reset) reset.disabled = nextState;

  if (run) {
    const label = run.querySelector(".btnLabel");
    if (label) {
      run.dataset.originalText = run.dataset.originalText || label.textContent;
      label.textContent = nextState ? "Generating" : run.dataset.originalText;
    } else {
      run.dataset.originalText = run.dataset.originalText || run.textContent;
      run.textContent = nextState ? "Generating" : run.dataset.originalText;
    }
    run.classList.toggle("is-loading", nextState);
  }

  const status = $(IDS.statusMessage);
  if (status) {
    status.textContent = message || (nextState ? "Working on recommendations..." : "");
  }
}

function showError(message) {
  const err = $(IDS.errorMessage);
  if (err) {
    err.textContent = message;
    err.style.display = "block";
  }
  if (!err) toast(message);
}

function clearError() {
  const err = $(IDS.errorMessage);
  if (err) {
    err.textContent = "";
    err.style.display = "none";
  }
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
panel.style.display = "block";
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
                btn.textContent = "Add to quote";
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
  const isOn = selectedProducts.has(key);
     const confidenceValue = getConfidenceValue(p);
  const confidenceLabel = `${confidenceValue}%`;

  // store product JSON in dataset for pack export
  const json = escapeAttr(JSON.stringify({
    key,
    name: p.name,
    relevance: p.relevance || "Med",
    whyRelevant: p.whyRelevant || "",
    whatItCovers: p.whatItCovers || "",
    typicalAsks: Array.isArray(p.typicalAsks) ? p.typicalAsks : [],
    assumptions: Array.isArray(p.assumptions) ? p.assumptions : [],
    notes: p.notes || "",
    confidence: p.confidence ?? null
  }));

  return `
    <div class="prod">
      <div class="prodTop">
        <div>
          <div class="prodName">${escapeHtml(p.name || "Recommendation")}</div>
          <div class="why"><b>${escapeHtml(p.whyRelevant || "—")}</b></div>
          <div class="small">${escapeHtml(p.whatItCovers || "")}</div>
        </div>
        <span class="badge confidenceBadge" aria-label="Confidence ${escapeHtml(confidenceLabel)}">
          <span class="confidencePie" style="--confidence:${confidenceValue}">
            <span class="confidenceValue">${escapeHtml(confidenceLabel)}</span>
          </span>
        </span>
      </div>

      ${Array.isArray(p.typicalAsks) && p.typicalAsks.length ? `
        <ul class="qList">
          ${p.typicalAsks.map(q => `<li>${escapeHtml(q)}</li>`).join("")}
        </ul>
      ` : ""}

      ${Array.isArray(p.assumptions) && p.assumptions.length ? `
        <div class="small"><b>Assumptions</b></div>
        <ul class="qList">
          ${p.assumptions.map(a => `<li>${escapeHtml(a)}</li>`).join("")}
        </ul>
      ` : ""}

      ${p.notes ? `<div class="small"><b>Notes</b><br/>${escapeHtml(p.notes)}</div>` : ""}

      <div style="margin-top:12px; display:flex; gap:10px;">
        <button class="btn ${isOn ? "on" : ""}" data-select-product="${escapeAttr(key)}" data-product-json="${json}">
          ${isOn ? "Added" : "Add to quote"}
        </button>
      </div>
    </div>
  `;
}

/* ------------------ Quote pack ------------------ */

function updatePackUI() {
  const countEl = $(IDS.packCount);
  if (countEl) countEl.textContent = `${selectedProducts.size}`;

   const badge = $(IDS.packBadge);
  if (badge) {
    badge.innerHTML = `<span class="dot ${selectedProducts.size ? "good" : "warn"}"></span><span>${selectedProducts.size} selected</span>`;
  }

  const listEl = $(IDS.packList);
  if (listEl) {
     if (!selectedProducts.size) {
      listEl.innerHTML = `<span class="muted">No selections yet</span>`;
      return;
    }

    listEl.innerHTML = [...selectedProducts.values()].map(p => `
      <span class="quoteChip">${escapeHtml(p.name)}</span>
    `).join("");
  }
}

function startQuotesStub() {
  if (!selectedProducts.size) {
    toast("Select at least one product first");
    return;
  }
  // Stub: in real integration, this is where you’d deep-link into your quote journeys / PAS
alert(`Start quote (stub)\n\nSelected:\n- ${[...selectedProducts.values()].map(p => p.name).join("\n- ")}`);
}

/* ------------------ Main button flow ------------------ */

async function runAgentFlow() {
  const activity = safeVal(IDS.activityText).trim();
  if (!activity) {
    toast("Add a business description first");
    return;
  }

   clearError();
  setLoading(true, "Generating recommendations...");

  const payload = buildPayload();
   lastPayload = payload;

  try {
    showClarifiers([]);
    lastAnalysis = null;

    const rec = await recommend(payload);

    lastRecommendations = Array.isArray(rec.recommendations) ? rec.recommendations : [];
    lastClarifierAnswers = {};

    selectedProducts.clear();
    renderRecommendations(lastRecommendations);
    toast("Recommendations ready");
  } catch (e) {
    console.error(e);
    showError(e.message || "Worker error");
  } finally {
    setLoading(false);
  }
}

async function continueAgentFlow() {
  if (!lastPayload) {
    toast("Run recommendations first");
    return;
  }

  clearError();
  setLoading(true, "Generating recommendations...");

  try {
    const rec = await recommend(lastPayload);

    lastRecommendations = Array.isArray(rec.recommendations) ? rec.recommendations : [];
lastClarifierAnswers = {};
     
    selectedProducts.clear();
    renderRecommendations(lastRecommendations);
    toast("Recommendations ready");
  } catch (e) {
    console.error(e);
    showError(e.message || "Worker error");
  } finally {
    setLoading(false);
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

function getConfidenceValue(p) {
  if (typeof p.confidence === "number" && !Number.isNaN(p.confidence)) {
    return Math.max(0, Math.min(100, Math.round(p.confidence)));
  }

  const relevance = (p.relevance || "").toLowerCase();
  if (relevance === "high") return 85;
  if (relevance === "low") return 45;
  return 65;
}

/* ------------------ Wire buttons ------------------ */
function wireButtons() {
  const run = $(IDS.runBtn);
  const reset = $(IDS.resetBtn);
   const cont = $(IDS.continueBtn);

  if (run) run.onclick = runAgentFlow;
  if (reset) reset.onclick = () => location.reload();
   if (cont) {
    cont.onclick = continueAgentFlow;
    cont.style.display = "none";
  }

  // If your buttons don’t have IDs, we can wire by text (fallback)
  document.querySelectorAll("button").forEach(btn => {
    const t = (btn.textContent || "").trim().toLowerCase();
    if (t.includes("start") && t.includes("quote")) btn.onclick = startQuotesStub;
  });

  // If you *do* add IDs later, these take priority:
  const startBtn = $(IDS.startQuotesBtn);
  if (startBtn) startBtn.onclick = startQuotesStub;  
}

/* ------------------ Init ------------------ */
wireButtons();
updatePackUI();
