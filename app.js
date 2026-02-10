const esc = (s) => (s ?? "").toString()
  .replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#39;");

function toast(title, msg) {
  const el = document.getElementById("toast");
  el.innerHTML = `<strong>${esc(title)}</strong><div class="small">${esc(msg)}</div>`;
  el.style.display = "block";
  clearTimeout(window.__toastTimer);
  window.__toastTimer = setTimeout(() => { el.style.display = "none"; }, 5500);
}

function getHiddenSet() {
  try {
    const raw = localStorage.getItem("hidden_jobs") || "[]";
    return new Set(JSON.parse(raw));
  } catch { return new Set(); }
}
function saveHiddenSet(set) {
  localStorage.setItem("hidden_jobs", JSON.stringify(Array.from(set)));
  updateHiddenCount();
}
function updateHiddenCount() {
  const n = getHiddenSet().size;
  document.getElementById("hiddenToggleBtn").textContent = `Hidden (${n})`;
}
function toggleHiddenPanel() {
  const p = document.getElementById("hiddenPanel");
  p.classList.toggle("open");
  renderHiddenPanel();
}
function clearHidden() {
  localStorage.removeItem("hidden_jobs");
  updateHiddenCount();
  renderHiddenPanel();
}
function hideJob(id) {
  const set = getHiddenSet();
  set.add(String(id));
  saveHiddenSet(set);
  renderHiddenPanel();
}
function unhideJob(id) {
  const set = getHiddenSet();
  set.delete(String(id));
  saveHiddenSet(set);
  renderHiddenPanel();
}
function renderHiddenPanel() {
  const set = getHiddenSet();
  const container = document.getElementById("hiddenJobs");
  if (set.size === 0) {
    container.innerHTML = `<div class="muted small">No hidden jobs.</div>`;
    return;
  }
  const items = Array.from(set).slice(-200).reverse();
  container.innerHTML = items.map(id => `
    <div class="job-line" style="padding:.5rem 0; border-bottom:1px solid #2a2f3a;">
      <div><code>${esc(id)}</code></div>
      <div class="job-actions">
        <button class="secondary" data-action="hidden-clear" data-id="${esc(id)}">Clear</button>
        <button class="secondary" data-action="hidden-unhide" data-id="${esc(id)}">Unhide</button>
      </div>
    </div>
  `).join("");
}

async function clearHiddenJob(id) {
  // Removes from hidden list + deletes from DB (safe if already gone)
  const set = getHiddenSet();
  set.delete(id);
  localStorage.setItem(HIDDEN_KEY, JSON.stringify(Array.from(set)));
  renderHiddenPanel();
  try {
    await fetch("/api/jobs/delete", { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ id }) });
  } catch {}
}

function getLastEnqueue() {
  try { return JSON.parse(sessionStorage.getItem("last_enqueue") || "null"); } catch { return null; }
}

let SITES = [];
let COVERAGE = new Map();
let SELECTED_REPOS = new Set();
let TAGS_CACHE = null;


async function readJsonOrText(r) {
  const ct = (r.headers.get("content-type") || "").toLowerCase();
  if (ct.includes("application/json")) {
    try { return await r.json(); } catch { /* fall through */ }
  }
  const text = await r.text();
  try { return JSON.parse(text); } catch { return { message: text }; }
}


async function setTotalPages(repo, totalPagesVal) {
  try {
    const r = await fetch("/api/sites/update", {
      method:"POST",
      headers: {"Content-Type":"application/json"},
      body: JSON.stringify({ repo, patch: { total_pages: totalPagesVal } })
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data?.message || r.statusText);
    toast("Site updated", "Total pages saved.");
    await loadSites();
  } catch(e) {
    toast("Update error", e.message || String(e));
  }
}

async function setDefaultPages(repo, defaultPagesVal) {
  try {
    const r = await fetch("/api/sites/update", {
      method:"POST",
      headers: {"Content-Type":"application/json"},
      body: JSON.stringify({ repo, patch: { default_pages: defaultPagesVal } })
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data?.message || r.statusText);
    toast("Site updated", "Default pages saved.");
    await loadSites();
  } catch(e) {
    toast("Update error", e.message || String(e));
  }
}

async function downloadJobsCsv() {
  const status = document.getElementById("statusFilter")?.value || "all";
  const repo = document.getElementById("repoFilter")?.value || "";
  const url = new URL(location.origin + "/api/jobs/export");
  url.searchParams.set("limit","5000");
  if (status && status !== "all") url.searchParams.set("status", status);
  if (repo) url.searchParams.set("repo", repo);
  window.open(url.toString(), "_blank");
}

async function retryJob(id) {
  try {
    const r = await fetch("/api/jobs/retry", { method:"POST", headers:{ "Content-Type":"application/json" }, body: JSON.stringify({ id }) });
    const data = await r.json();
    if (!r.ok) throw new Error(data?.error || data?.message || r.statusText);
    toast("Retry", `Re-queued ${id}`);
    await loadJobs();
  } catch(e) {
    toast("Retry error", e.message || String(e));
  }
}

async function deleteJob(id) {
  if (!confirm("Delete this job from history?")) return;
  try {
    const r = await fetch("/api/jobs/delete", { method:"POST", headers:{ "Content-Type":"application/json" }, body: JSON.stringify({ id }) });
    const data = await r.json();
    if (!r.ok) throw new Error(data?.error || data?.message || r.statusText);
    toast("Deleted", id);
    await loadJobs();
  } catch(e) {
    toast("Delete error", e.message || String(e));
  }
}

async function loadSites() {
  const status = document.getElementById("sitesStatus");
  status.textContent = "Loading…";
  try {
    const r = await fetch("/api/sites");
    const data = await readJsonOrText(r);
    if (!r.ok) throw new Error(data?.message || data?.error || r.statusText);
    SITES = data.sites || [];

    // Optional: coverage snapshot (done/remaining/completion)
    try {
      const rc = await fetch("/api/sites/coverage");
      const cov = await readJsonOrText(rc);
      COVERAGE = new Map();
      if (rc.ok && Array.isArray(cov.coverage)) {
        for (const c of cov.coverage) COVERAGE.set(c.repo, c);
      }
    } catch {}

    renderSites();
    renderCoreTargets();
    status.textContent = `Loaded ${SITES.length} site(s).`;
  } catch (e) {
    status.textContent = `Error: ${e.message || e}`;
    toast("Sites error", status.textContent);
  }
}

function normalizeTags(tags) {
  if (!tags) return [];
  if (Array.isArray(tags)) return tags.map(t => String(t).trim()).filter(Boolean);
  return String(tags).split(",").map(t => t.trim()).filter(Boolean);
}

function refreshTagFilterOptions() {
  const sel = document.getElementById("siteTagFilter");
  if (!sel) return;
  const tags = new Set();
  for (const s of SITES) for (const t of normalizeTags(s.tags)) tags.add(t);
  const all = Array.from(tags).sort((a,b)=>a.localeCompare(b));
  // Only rebuild if changed
  const key = all.join("|");
  if (TAGS_CACHE === key) return;
  TAGS_CACHE = key;
  const current = sel.value || "";
  sel.innerHTML = `<option value="">(all)</option>` + all.map(t => `<option value="${esc(t)}">${esc(t)}</option>`).join("");
  sel.value = current;
}

function siteMatchesFilters(s) {
  const q = (document.getElementById("siteSearch")?.value || "").trim().toLowerCase();
  const tag = (document.getElementById("siteTagFilter")?.value || "").trim();
  const nameRepo = `${s.name||""} ${s.repo||""}`.toLowerCase();
  if (q && !nameRepo.includes(q)) return false;
  if (tag) {
    const tags = normalizeTags(s.tags);
    if (!tags.includes(tag)) return false;
  }
  return true;
}

function toggleSelectAllSites() {
  const visible = SITES.filter(siteMatchesFilters);
  const allSelected = visible.length && visible.every(s => SELECTED_REPOS.has(s.repo));
  if (allSelected) {
    for (const s of visible) SELECTED_REPOS.delete(s.repo);
  } else {
    for (const s of visible) SELECTED_REPOS.add(s.repo);
  }
  renderSites();
}

function setSiteSelected(repo, checked) {
  if (checked) SELECTED_REPOS.add(repo);
  else SELECTED_REPOS.delete(repo);
  const btn = document.getElementById("bulkEnqueueBtn");
  if (btn) btn.disabled = SELECTED_REPOS.size === 0;
}

async function bulkEnqueueSelected() {
  if (!SELECTED_REPOS.size) return;
  const repos = Array.from(SELECTED_REPOS);
  const jobs = [];
  for (const repo of repos) {
    const s = SITES.find(x => x.repo === repo);
    if (!s) continue;
    jobs.push({
      repo,
      site_name: s.name || repo,
      pages: Number(s.default_pages || 5),
      mode: "generate",
      template: "default",
      priority: 0
    });
  }

  toast("Bulk enqueue", `Enqueuing ${jobs.length} site(s)…`);
  try {
    const r = await fetch("/api/jobs/bulk", {
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body: JSON.stringify({ jobs })
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data?.error || data?.message || r.statusText);
    const reused = (data.results || []).filter(x => x.reused).length;
    toast("Bulk enqueue", `Done. ${reused ? reused + " reused, " : ""}${jobs.length} requested.`);
    await loadJobs();
    // Keep selection but you can clear manually
  } catch (e) {
    toast("Bulk enqueue error", e.message || String(e));
  }
}

function renderSites() {
  refreshTagFilterOptions();

  const container = document.getElementById("sites");
  if (!SITES.length) {
    container.innerHTML = `<div class="muted">No sites found. Check <code>SITES_REPO</code>/<code>SITES_PATH</code>.</div>`;
    return;
  }

  const visible = SITES.filter(siteMatchesFilters);
  const btn = document.getElementById("bulkEnqueueBtn");
  if (btn) btn.disabled = SELECTED_REPOS.size === 0;

  if (!visible.length) {
    container.innerHTML = `<div class="muted">No sites match your filters.</div>`;
    return;
  }

  container.innerHTML = visible.map(s => {
    const repo = s.repo;
    const adsEligible = !!(s.ads && s.ads.eligible);
    const provider = (s.ads && s.ads.provider) || "none";
    const tags = normalizeTags(s.tags);
    const totalPages = Number(s.total_pages || s.pages_total || 0);
    const defaultPages = Number(s.default_pages || 5);
    const cov = COVERAGE.get(repo) || null;
    const done = cov ? Number(cov.done_pages || 0) : 0;
    const remaining = cov ? Number(cov.remaining || 0) : (totalPages ? Math.max(0, totalPages - done) : 0);
    const completion = cov ? Number(cov.completion || 0) : (totalPages ? Math.min(1, done/totalPages) : 0);
    const selected = SELECTED_REPOS.has(repo);

    return `
      <div class="card site-card">
        <div class="row" style="justify-content:space-between; align-items:flex-start;">
          <div>
            <div><strong>${esc(s.name || repo)}</strong></div>
            <div class="muted small" style="margin-top:.25rem;">${esc(repo)}</div>
          </div>
          <label class="small muted" style="display:flex; gap:.35rem; align-items:center;">
            <input type="checkbox" ${selected ? "checked" : ""} onchange="setSiteSelected('${esc(repo)}', this.checked)" />
            select
          </label>
        </div>

        ${tags.length ? `<div class="small muted" style="margin-top:.35rem;">Tags: ${tags.map(t=>`<span class="badge">${esc(t)}</span>`).join(" ")}</div>` : ""}

        ${totalPages ? `
          <div class="small muted" style="margin-top:.35rem;">Coverage: ${done}/${totalPages} (${Math.round(completion*100)}%) • Remaining: ${remaining}</div>
          <div class="progress" style="margin-top:.35rem;"><div style="width:${Math.round(completion*100)}%"></div></div>
        ` : ""}

        <div class="divider"></div>

        <div class="row" style="justify-content:space-between;">
          <div class="small">
            Total pages:
            <input type="number" min="0" step="1" value="${totalPages || ""}" placeholder="(optional)" style="width:7rem; margin-left:.4rem;"
              onchange="setTotalPages('${esc(repo)}', this.value)" />
          </div>
          <div class="small">
            Default enqueue:
            <input type="number" min="1" step="1" value="${defaultPages}" style="width:5rem; margin-left:.4rem;"
              onchange="setDefaultPages('${esc(repo)}', this.value)" />
          </div>
        </div>

        <div class="divider"></div>

        <div class="row" style="justify-content:space-between;">
          <div class="small">
            Ads eligible:
            <select onchange="setAdsEligible('${esc(repo)}', this.value)" style="margin-left:.4rem;">
              <option value="0" ${adsEligible ? "" : "selected"}>No</option>
              <option value="1" ${adsEligible ? "selected" : ""}>Yes</option>
            </select>
          </div>
          <div class="small">
            Provider:
            <select onchange="setAdsProvider('${esc(repo)}', this.value)" style="margin-left:.4rem;">
              ${["none","adsense","journey","raptive"].map(p=>`<option value="${p}" ${(provider===p)?"selected":""}>${p}</option>`).join("")}
            </select>
          </div>
        </div>

        <div class="divider"></div>
        <div class="row">
          <button data-action="site-enqueue-default" data-repo="${esc(repo)}" data-pages="${defaultPages}">Enqueue (${defaultPages})</button>
          <button class="secondary" data-action="site-enqueue-1" data-repo="${esc(repo)}" data-pages="1">Enqueue (1)</button>
        </div>
      </div>
    `;
  }).join("");
}

async function setAdsEligible(repo, eligibleVal) {(repo, eligibleVal) {
  const eligible = eligibleVal === "1";
  toast("Ads", `Updating ads eligibility for ${repo}…`);
  try {
    const r = await fetch("/api/site/ads/toggle", {
      method:"POST",
      headers: {"Content-Type":"application/json"},
      body: JSON.stringify({ repo, eligible })
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data?.message || r.statusText);
    toast("Ads", `Updated ${repo}: eligible=${eligible}`);
    await loadSites();
  } catch(e) {
    toast("Ads error", e.message || String(e));
  }
}

async function setAdsProvider(repo, provider) {
  toast("Ads", `Updating ads provider for ${repo}…`);
  try {
    const r = await fetch("/api/site/ads/toggle", {
      method:"POST",
      headers: {"Content-Type":"application/json"},
      body: JSON.stringify({ repo, provider })
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data?.message || r.statusText);
    toast("Ads", `Updated ${repo}: provider=${provider}`);
    await loadSites();
  } catch(e) {
    toast("Ads error", e.message || String(e));
  }
}

async function enqueue(repo, pages) {
  const dry_run = document.getElementById("dryRun").checked;
  try {
    const r = await fetch("/api/dispatch", {
      method:"POST",
      headers: {"Content-Type":"application/json"},
      body: JSON.stringify({ repo, pages, dry_run })
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data?.message || r.statusText);

    if (data.dry_run) {
      toast("Dry-run", `Would enqueue ${repo} (${pages})`);
    } else {
      const jobId = data.job?.id || data.job_id;
      const reused = !!data.reused;
      sessionStorage.setItem("last_enqueue", JSON.stringify({ jobId, reused, ts: Date.now() }));
      toast("Enqueue", reused ? `Reused existing job: ${jobId}` : `Enqueued job: ${jobId}`);
      updateHiddenCount();
      await loadJobs();
    }
  } catch(e) {
    toast("Enqueue error", e.message || String(e));
  }
}

async function loadJobs() {
  const status = document.getElementById("jobsStatus");
  status.textContent = "Loading…";
  try {
    const r = await fetch("/api/jobs?limit=50");
    const data = await r.json();
    if (!r.ok) throw new Error(data?.message || r.statusText);

    const hidden = getHiddenSet();
    const jobs = (data.jobs || []).filter(j => !hidden.has(String(j.id)));

    const last = getLastEnqueue();
    const lastJobId = last?.jobId;
    const lastIsFresh = last?.ts && (Date.now() - last.ts) < (2*60*1000);

    const container = document.getElementById("jobs");
    if (!jobs.length) {
      container.innerHTML = `<div class="muted">No jobs.</div>`;
      status.textContent = "";
      return;
    }
    container.innerHTML = jobs.map(j => {
      const isLast = lastIsFresh && lastJobId && String(j.id) === String(lastJobId);
      const badge = isLast ? `<span class="pill ${last.reused ? "reused" : "new"}">${last.reused ? "REUSED" : "ENQUEUED"}</span>` : "";
      const runLink = j.gh_run_url ? `<a href="${esc(j.gh_run_url)}" target="_blank" rel="noreferrer">Open run</a>` : "";
      const err = j.error ? `<div class="small" style="color:#ffb3b3; margin-top:.35rem;">${esc(j.error)}</div>` : "";
      return `
        <div class="card site-card ${isLast ? "highlight" : ""}">
          <div class="job-line">
            <div>
              <strong>${esc(j.site_name || j.repo)}${badge}</strong>
              <div class="muted small">${esc(j.repo)} • <span>${esc(j.status)}</span> • <code>${esc(j.id)}</code></div>
              <div class="muted small">pages=${esc(j.pages)} mode=${esc(j.mode)} ${runLink ? " • " + runLink : ""}</div>
              ${err}
            </div>
            <div class="job-actions">
              <button class="secondary" data-action="job-hide" data-id="${esc(j.id)}">Hide</button>
              ${(j.status==="failed"||j.status==="canceled")?`<button class="secondary" data-action="job-retry" data-id="${esc(j.id)}">Retry</button>`:""}
              <button class="secondary" data-action="job-delete" data-id="${esc(j.id)}">Delete</button>
            </div>
          </div>
        </div>
      `;
    }).join("");
    status.textContent = "";
    updateHiddenCount();
  } catch(e) {
    status.textContent = `Worker error`;
    toast("Jobs error", e.message || String(e));
  }
}

async function processQueue() {
  try {
    const dry_run = document.getElementById("dryRun").checked;
    const r = await fetch("/api/worker/tick", { method:"POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify({ dry_run }) });
    const data = await r.json();
    if (!r.ok) throw new Error(data?.message || r.statusText);
    toast("Worker tick", data?.message || "OK");
    await loadJobs();
  } catch(e) {
    toast("Worker tick error", e.message || String(e));
  }
}

async function configureSite() {
  const repo = document.getElementById("builderRepo").value.trim();
  const pack = document.getElementById("builderPack").value.trim();
  const brand = document.getElementById("builderBrand").value.trim();
  const niche = document.getElementById("builderNiche").value.trim();
  const status = document.getElementById("configureStatus");
  status.textContent = "";
  if (!repo || !niche) { status.textContent = "Repo + niche required"; return; }

  try {
    const r = await fetch("/api/site/configure", {
      method:"POST",
      headers: {"Content-Type":"application/json"},
      body: JSON.stringify({ repo, pack, brand, niche })
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data?.message || r.statusText);
    status.textContent = "Wrote data/site.yaml";
    toast("Site builder", `Configured ${repo}`);
    await loadSites();
  } catch(e) {
    status.textContent = `Error: ${e.message || e}`;
    toast("Configure error", status.textContent);
  }
}

async function loadFileIntoTextarea() {
  const f = document.getElementById("pagesFile").files?.[0];
  if (!f) { toast("Import", "Pick a .txt file first."); return; }
  const text = await f.text();
  document.getElementById("pagesText").value = text;
  toast("Import", "Loaded file into textarea.");
}

async function importPlan() {
  const repo = document.getElementById("builderRepo").value.trim();
  const text = document.getElementById("pagesText").value;
  const status = document.getElementById("importStatus");
  status.textContent = "";
  if (!repo) { status.textContent = "Target repo required"; return; }

  const lines = text.split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
  if (!lines.length) { status.textContent = "No titles provided"; return; }

  try {
    const r = await fetch("/api/plan/import", {
      method:"POST",
      headers: {"Content-Type":"application/json"},
      body: JSON.stringify({ repo, titles: lines })
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data?.message || r.statusText);
    status.textContent = `Imported ${data.added || 0} item(s)`;
    toast("Plan import", status.textContent);
  } catch(e) {
    status.textContent = `Error: ${e.message || e}`;
    toast("Import error", status.textContent);
  }
}

function renderCoreTargets() {
  const container = document.getElementById("coreTargets");
  if (!SITES.length) {
    container.innerHTML = `<div class="muted small">Load sites first.</div>`;
    return;
  }
  container.innerHTML = SITES.map(s => {
    const id = `core_${(s.name || s.repo).replace(/[^a-z0-9]+/ig,'_')}`;
    return `
      <label class="card small" style="padding:.6rem .8rem; width: 360px;">
        <div class="row" style="justify-content:space-between;">
          <div>
            <input type="checkbox" id="${esc(id)}" data-repo="${esc(s.repo)}" checked />
            <strong style="margin-left:.4rem;">${esc(s.name || s.repo)}</strong>
          </div>
          <span class="muted">${(s.tags||[]).map(t=>`#${esc(t)}`).join(" ")}</span>
        </div>
        <div class="muted">${esc(s.repo)}</div>
      </label>
    `;
  }).join("");
}

async function pushContract() {
  const scope = document.getElementById("coreScope").value;
  const tag = document.getElementById("coreTag").value.trim();
  const status = document.getElementById("coreStatus");
  status.textContent = "";

  let repos = [];
  if (scope === "selected") {
    repos = Array.from(document.querySelectorAll("#coreTargets input[type=checkbox]"))
      .filter(el => el.checked)
      .map(el => el.getAttribute("data-repo"))
      .filter(Boolean);
    if (!repos.length) { status.textContent = "Select at least one site"; return; }
  } else if (scope === "tag") {
    if (!tag) { status.textContent = "Tag required"; return; }
  }

  try {
    const r = await fetch("/api/core/push", {
      method:"POST",
      headers: {"Content-Type":"application/json"},
      body: JSON.stringify({ scope, tag, repos })
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data?.message || r.statusText);
    status.textContent = `Updated ${data.updated || 0} site(s)`;
    toast("Contract rollout", status.textContent);
  } catch(e) {
    status.textContent = `Error: ${e.message || e}`;
    toast("Rollout error", status.textContent);
  }
}

// --- Simple / Advanced UI mode ---
function getUIMode() {
  return localStorage.getItem("factory_ui_mode") || "simple";
}
function applyUIMode(mode) {
  const m = (mode === "advanced") ? "advanced" : "simple";
  document.body.classList.toggle("simple", m === "simple");
  const btn = document.getElementById("uiModeBtn");
  if (btn) btn.textContent = `Mode: ${m[0].toUpperCase()+m.slice(1)}`;
}
function toggleUIMode() {
  const next = (getUIMode() === "simple") ? "advanced" : "simple";
  localStorage.setItem("factory_ui_mode", next);
  applyUIMode(next);
}

applyUIMode(getUIMode());
updateHiddenCount();
loadJobs();

// --- Event wiring (no inline handlers; works under strict CSP) ---
function wireUI(){
  const byId = (id) => document.getElementById(id);
  const safe = (fn) => async (e) => { try { await fn(e); } catch(err){ console.error(err); toast(String(err?.message||err), true); } };

  const uiModeBtn = byId("uiModeBtn");
  if (uiModeBtn) uiModeBtn.addEventListener("click", safe(()=>toggleUIMode()));

  const refreshSitesBtn = byId("refreshSitesBtn");
  if (refreshSitesBtn) refreshSitesBtn.addEventListener("click", safe(()=>loadSites()));

  const bulkSelectAllBtn = byId("bulkSelectAllBtn");
  if (bulkSelectAllBtn) bulkSelectAllBtn.addEventListener("click", safe(()=>toggleSelectAllSites()));

  const bulkEnqueueBtn = byId("bulkEnqueueBtn");
  if (bulkEnqueueBtn) bulkEnqueueBtn.addEventListener("click", safe(()=>bulkEnqueueSelected()));

  const refreshJobsBtn = byId("refreshJobsBtn");
  if (refreshJobsBtn) refreshJobsBtn.addEventListener("click", safe(()=>loadJobs()));

  const exportCsvBtn = byId("exportCsvBtn");
  if (exportCsvBtn) exportCsvBtn.addEventListener("click", safe(()=>downloadJobsCsv()));

  const processQueueBtn = byId("processQueueBtn");
  if (processQueueBtn) processQueueBtn.addEventListener("click", safe(()=>processQueue()));

  const hiddenToggleBtn = byId("hiddenToggleBtn");
  if (hiddenToggleBtn) hiddenToggleBtn.addEventListener("click", safe(()=>toggleHiddenPanel()));

  const clearHiddenBtn = byId("clearHiddenBtn");
  if (clearHiddenBtn) clearHiddenBtn.addEventListener("click", safe(()=>clearHidden()));

  const writeSiteBtn = byId("writeSiteBtn");
  if (writeSiteBtn) writeSiteBtn.addEventListener("click", safe(()=>configureSite()));

  const loadFileBtn = byId("loadFileBtn");
  if (loadFileBtn) loadFileBtn.addEventListener("click", safe(()=>loadFileIntoTextarea()));

  const importPlanBtn = byId("importPlanBtn");
  if (importPlanBtn) importPlanBtn.addEventListener("click", safe(()=>importPlan()));

  const pushContractBtn = byId("pushContractBtn");
  if (pushContractBtn) pushContractBtn.addEventListener("click", safe(()=>pushContract()));

  const refreshCoverageBtn = byId("refreshCoverageBtn");
  if (refreshCoverageBtn) refreshCoverageBtn.addEventListener("click", safe(()=>loadCoverage()));

  const refreshFailuresBtn = byId("refreshFailuresBtn");
  if (refreshFailuresBtn) refreshFailuresBtn.addEventListener("click", safe(()=>loadFailures()));

  const loadPromptsBtn = byId("loadPromptsBtn");
  if (loadPromptsBtn) loadPromptsBtn.addEventListener("click", safe(()=>loadPrompts()));

  document.addEventListener("click", safe((e)=>{
    const btn = e.target.closest("button[data-action]");
    if (!btn) return;
    const action = btn.dataset.action;
    const id = btn.dataset.id;
    const repo = btn.dataset.repo;
    const pages = btn.dataset.pages ? Number(btn.dataset.pages) : undefined;

    if (action === "hidden-clear") return clearHiddenJob(id);
    if (action === "hidden-unhide") return unhideJob(id);

    if (action === "site-enqueue-default" || action === "site-enqueue-1") return enqueue(repo, pages);

    if (action === "job-hide") return hideJob(id);
    if (action === "job-retry") return retryJob(id);
    if (action === "job-delete") return deleteJob(id);
  }));

  // First loads
  loadSites();
  loadJobs();
  loadCoverage();
  loadFailures();
  loadPrompts();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", wireUI);
} else {
  wireUI();
}
