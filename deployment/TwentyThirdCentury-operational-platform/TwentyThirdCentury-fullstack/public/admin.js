const statusEl = document.querySelector("#status");
const reportsEl = document.querySelector("#reports");
const token = sessionStorage.getItem("ttc_token") || "";
const esc = value => String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
async function request(url, options={}) {
  const response = await fetch(url, { ...options, headers: { "Content-Type":"application/json", Authorization:`Bearer ${token}`, ...(options.headers||{}) } });
  const data = await response.json().catch(()=>({}));
  if (!response.ok) throw new Error(data.error || "Request failed.");
  return data;
}
function render(report) {
  const article = document.createElement("article"); article.className="report"; article.dataset.id=report.id;
  article.innerHTML = `<div class="report-meta">REPORT #${report.id} · ${esc(report.status)} · ${esc(report.created_at)}</div><h2>${esc(report.reason)} · post by @${esc(report.author)}</h2><p>${esc(report.post_body)}</p><div class="report-meta">Reported by @${esc(report.reporter)}${report.details ? ` · ${esc(report.details)}` : ""}</div><div class="report-actions"><button class="hide" data-action="hide">Hide post & resolve</button><button data-action="dismiss">Dismiss report</button></div>`;
  return article;
}
async function load() {
  if (!token) throw new Error("Sign in with your administrator account first.");
  const me = await request("/api/me");
  if (!me.isAdmin) throw new Error("This account is not configured as an administrator.");
  const data = await request("/api/admin/reports");
  reportsEl.replaceChildren();
  const open = data.reports.filter(r => r.status === "open");
  if (!open.length) { reportsEl.innerHTML = '<div class="empty">No open reports. The community is clear for now.</div>'; }
  else open.forEach(r => reportsEl.append(render(r)));
  statusEl.textContent = `${open.length} open report${open.length===1?"":"s"}.`;
}
reportsEl.addEventListener("click", async event => {
  const button=event.target.closest("button[data-action]"); if(!button) return;
  const card=button.closest(".report"); button.disabled=true;
  try { await request(`/api/admin/reports/${card.dataset.id}/resolve`, {method:"POST",body:JSON.stringify({action:button.dataset.action})}); await load(); }
  catch(error) { statusEl.textContent=error.message; button.disabled=false; }
});
load().catch(error => { statusEl.textContent=error.message; reportsEl.innerHTML='<div class="empty">No moderation data available for this account.</div>'; });
