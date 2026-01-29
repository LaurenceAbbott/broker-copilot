/* =========================================================
   Broker Copilot – app.js
   Full client-side prototype logic
   ========================================================= */

/* ------------------ Utilities ------------------ */
const $ = (id) => document.getElementById(id);

function toast(msg) {
  const el = $("toast");
  el.textContent = msg;
  el.classList.add("show");
  setTimeout(() => el.classList.remove("show"), 2500);
}

/* ------------------ Static data ------------------ */

const CONCERNS = [
  { id: "tools", label: "Tools & equipment theft" },
  { id: "public", label: "Public injury / property damage" },
  { id: "employees", label: "Anyone helps me (casual / labour-only)" },
  { id: "contracts", label: "Contracts / required cover" },
  { id: "advice", label: "I give advice / design / specifications" },
  { id: "data", label: "Customer data / online systems" },
  { id: "stock", label: "I hold stock / materials" },
  { id: "premises", label: "Premises damage / contents" },
  { id: "vehicles", label: "Business vehicle risk" },
];

/* Commercial product catalogue (rules-lite version) */
const PRODUCTS = [
  {
    key: "pl",
    name: "Public Liability",
    why: "Covers injury or property damage to third parties.",
    score(ctx) {
      let s = 20;
      if (ctx.concerns.has("public")) s += 30;
      if (ctx.tags.has("trades")) s += 30;
      if (ctx.tags.has("publicFacing")) s += 20;
      return s;
    },
    questions: [
      "Do you work on customer sites?",
      "Any hazardous activities or tools?"
    ]
  },
  {
    key: "el",
    name: "Employers’ Liability",
    why: "Legally required if you employ staff or labour-only workers.",
    score(ctx) {
      let s = 10;
      if (ctx.staff && ctx.staff !== "0") s += 60;
      if (ctx.concerns.has("employees")) s += 50;
      return s;
    },
    questions: [
      "Do you employ anyone, even part time?",
      "Any subcontractors or labour-only workers?"
    ]
  },
  {
    key: "pi",
    name: "Professional Indemnity",
    why: "Covers claims arising from advice or design work.",
    score(ctx) {
      let s = 5;
      if (ctx.concerns.has("advice")) s += 60;
      if (ctx.tags.has("professional")) s += 40;
      return s;
    },
    questions: [
      "Do customers rely on your advice or designs?",
      "Any contracts requiring PI?"
    ]
  },
  {
    key: "tools",
    name: "Tools & Plant",
    why: "Covers theft, loss or damage of tools and equipment.",
    score(ctx) {
      let s = 10;
      if (ctx.concerns.has("tools")) s += 60;
      if (ctx.tags.has("mobileTools")) s += 40;
      return s;
    },
    questions: [
      "Where are tools stored overnight?",
      "Approximate replacement value?"
    ]
  },
  {
    key: "cyber",
    name: "Cyber & Data",
    why: "Helps with data breaches, ransomware and IT disruption.",
    score(ctx) {
      let s = 10;
      if (ctx.concerns.has("data")) s += 50;
      if (ctx.tags.has("online")) s += 40;
      return s;
    },
    questions: [
      "Do you store customer data digitally?",
      "Any online payments or systems?"
    ]
  }
];

/* ------------------ AI-style classification ------------------ */

function classifyActivity(text) {
  const t = text.toLowerCase();
  const tags = new Set();
  const followups = [];

  if (/builder|plumb|electric|garden|fenc|patio|trade/.test(t)) {
    tags.add("trades");
    tags.add("mobileTools");
    followups.push("Any work at height or hot work?");
    followups.push("Do you use subcontractors?");
  }

  if (/consult|design|spec|advice/.test(t)) {
    tags.add("professional");
    followups.push("Do clients rely on your advice or designs?");
  }

  if (/shop|customer|public/.test(t)) {
    tags.add("publicFacing");
    followups.push("Is the public present on site?");
  }

  if (/online|website|data|email/.test(t)) {
    tags.add("online");
    followups.push("Do you store customer data digitally?");
  }

  return { tags, followups };
}

/* ------------------ UI helpers ------------------ */

function renderChips() {
  const wrap = $("concernChips");
  wrap.innerHTML = "";
  CONCERNS.forEach(c => {
    const d = document.createElement("div");
    d.className = "chip";
    d.textContent = c.label;
    d.onclick = () => d.classList.toggle("on");
    d.dataset.id = c.id;
    wrap.appendChild(d);
  });
}

function selectedConcerns() {
  return new Set(
    [...document.querySelectorAll("#concernChips .chip.on")]
      .map(c => c.dataset.id)
  );
}

function renderTags(tags) {
  const wrap = $("tagChips");
  wrap.innerHTML = "";
  tags.forEach(t => {
    const d = document.createElement("div");
    d.className = "chip on";
    d.textContent = t;
    d.onclick = () => d.classList.toggle("on");
    wrap.appendChild(d);
  });
}

function selectedTags() {
  return new Set(
    [...document.querySelectorAll("#tagChips .chip.on")]
      .map(c => c.textContent)
  );
}

/* ------------------ Core flow ------------------ */

function buildContext() {
  return {
    staff: $("staff").value,
    concerns: selectedConcerns(),
    tags: selectedTags()
  };
}

function runCopilot() {
  const activity = $("activityText").value.trim();
  if (!activity) {
    toast("Add a business description first");
    return;
  }

  const ai = classifyActivity(activity);
  renderTags(ai.tags);

  const ctx = buildContext();

  const scored = PRODUCTS.map(p => ({
    ...p,
    scoreValue: p.score(ctx)
  })).sort((a, b) => b.scoreValue - a.scoreValue);

  renderResults(scored, ai.followups);
  toast("Recommendations updated");
}

function renderResults(products, followups) {
  $("followupList").innerHTML =
    followups.map(q => `<li>${q}</li>`).join("");

  const groups = {
    recommended: [],
    often: [],
    not: []
  };

  products.forEach(p => {
    if (p.scoreValue >= 60) groups.recommended.push(p);
    else if (p.scoreValue >= 30) groups.often.push(p);
    else groups.not.push(p);
  });

  $("groups").innerHTML = `
    ${renderGroup("Recommended to discuss", groups.recommended, "good")}
    ${renderGroup("Often relevant", groups.often, "warn")}
    ${renderGroup("Probably not needed", groups.not, "bad")}
  `;
}

function renderGroup(title, items, dot) {
  return `
    <div class="group">
      <div class="groupHead">
        <div><span class="dot ${dot}"></span> <b>${title}</b></div>
        <span>${items.length} items</span>
      </div>
      <div class="products">
        ${items.length ? items.map(renderProduct).join("") :
          `<div class="small">No products in this group.</div>`}
      </div>
    </div>
  `;
}

function renderProduct(p) {
  return `
    <div class="prod">
      <div class="prodTop">
        <div>
          <div class="prodName">${p.name}</div>
          <div class="why">${p.why}</div>
        </div>
        <span class="badge"><span class="dot ${p.scoreValue >= 60 ? "good" : "warn"}"></span>${p.scoreValue}</span>
      </div>

      <ul class="qList">
        ${p.questions.map(q => `<li>${q}</li>`).join("")}
      </ul>
    </div>
  `;
}

/* ------------------ Events ------------------ */

$("runBtn").onclick = runCopilot;
$("resetBtn").onclick = () => location.reload();

/* ------------------ Init ------------------ */
renderChips();
