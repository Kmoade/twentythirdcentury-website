const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const state = { token: sessionStorage.getItem("ttc_token") || "", user: null, agent: "nova", mood: "", authMode: "login", chatBusy: false };
const agentInfo = {
  nova: { name: "Nova", icon: "✳", ready: "Nova is ready", greeting: "Hey, I'm Nova. What's an idea you've been carrying around? We can give it a shape together." },
  byte: { name: "Byte", icon: "⌘", ready: "Byte is ready", greeting: "Hey, I'm Byte. Tell me what you'd like to learn or build, and we'll work through it step by step." },
  sol: { name: "Sol", icon: "☼", ready: "Sol is here with you", greeting: "Hi, I'm Sol. We can pause for a moment. You don't have to have the perfect words—what's on your mind?" }
};
function toast(message) { const el = $("#toast"); el.textContent = message; el.classList.add("show"); clearTimeout(toast.timer); toast.timer = setTimeout(() => el.classList.remove("show"), 2800); }
function escapeHtml(value) { return String(value ?? "").replace(/[&<>"']/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c])); }
function formatDate(value) { const d = new Date(value.includes("Z") ? value : value.replace(" ", "T") + "Z"); return Number.isNaN(+d) ? "recently" : d.toLocaleDateString(undefined, { month:"short", day:"numeric" }); }
async function api(url, options = {}) {
  const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
  if (state.token) headers.Authorization = `Bearer ${state.token}`;
  const response = await fetch(url, { ...options, headers });
  let data = {};
  try { data = await response.json(); } catch {}
  if (!response.ok) { if (response.status === 401 && state.token) signOut(false); throw new Error(data.error || "Request failed. Please try again."); }
  return data;
}
function setSignedIn(data) {
  state.token = data.token; state.user = data.user;
  sessionStorage.setItem("ttc_token", state.token);
  updateAccount(); $("#authDialog").close(); $("#authFeedback").textContent = "";
  toast(`Welcome${state.user?.username ? ", " + state.user.username : ""}!`);
  loadPosts();
  loadCheckins();
}
function updateAccount() {
  $("#accountLabel").textContent = state.user ? `@${state.user.username}` : "Guest mode";
  $("#authOpen").textContent = state.user ? "Sign out" : "Sign in";
  $("#writePostBtn").textContent = state.user ? "＋ Share something" : "＋ Sign in to post";
}
function signOut(showToast = true) {
  state.token = ""; state.user = null; sessionStorage.removeItem("ttc_token"); updateAccount();
  if (showToast) toast("You've signed out.");
  loadPosts();
  loadCheckins();
}
function addMessage(text, who) {
  const wrapper = document.createElement("div"); wrapper.className = `message ${who}`;
  const avatar = document.createElement("span"); avatar.className = "message-avatar"; avatar.textContent = who === "user" ? "◎" : agentInfo[state.agent].icon;
  const bubble = document.createElement("div"); bubble.className = "bubble"; bubble.textContent = text;
  wrapper.append(avatar, bubble); $("#chatMessages").append(wrapper); $("#chatMessages").scrollTop = $("#chatMessages").scrollHeight;
  return bubble;
}
function selectAgent(agent) {
  state.agent = agent; $$(".agent").forEach(el => el.classList.toggle("active", el.dataset.agent === agent));
  $("#chatAgentName").textContent = agentInfo[agent].ready; $("#chatMessages").innerHTML = "";
  addMessage(agentInfo[agent].greeting, "assistant");
}
async function sendChat(message) {
  if (state.chatBusy || !message.trim()) return;
  state.chatBusy = true; addMessage(message.trim(), "user"); $("#chatInput").value = "";
  const bubble = addMessage("Thinking through it…", "assistant"); $("#chatForm").querySelector("button").disabled = true;
  try {
    const result = await api("/api/chat", { method: "POST", body: JSON.stringify({ message: message.trim(), agent: state.agent }) });
    bubble.textContent = result.reply; $("#chatMode").textContent = result.mode === "ai" ? "AI CONNECTED" : "GUIDED MODE";
  } catch (error) { bubble.textContent = error.message; }
  finally { state.chatBusy = false; $("#chatForm").querySelector("button").disabled = false; }
}
function renderPost(post) {
  const article = document.createElement("article"); article.className = "post-card"; article.dataset.id = post.id;
  const comments = (post.commentsList || []).map(c => `<div class="comment"><strong>${escapeHtml(c.username)}</strong>${escapeHtml(c.body)}</div>`).join("");
  article.innerHTML = `<div class="post-author"><span class="post-avatar">${escapeHtml((post.username || "?").slice(0,2).toUpperCase())}</span><div><strong>${escapeHtml(post.username)}</strong><time>${escapeHtml(formatDate(post.created_at))}</time></div></div>
    <p class="post-body">${escapeHtml(post.body)}</p>
    <div class="post-actions"><button class="like-btn ${post.liked ? "liked" : ""}" data-action="like" aria-label="Like post">♡ ${Number(post.likes) || 0} ${Number(post.likes) === 1 ? "like" : "likes"}</button><button data-action="comment-toggle">↳ ${Number(post.comments) || 0} comments</button><button data-action="report" aria-label="Report post">⚑ Report</button></div>
    <div class="comments ${comments ? "" : "hidden"}"><div class="comments-list">${comments}</div><form class="comment-form"><input name="comment" maxlength="500" placeholder="${state.user ? "Write a kind reply…" : "Sign in to reply"}" ${state.user ? "" : "disabled"} required><button ${state.user ? "" : "disabled"}>Reply</button></form></div>`;
  return article;
}
async function loadPosts() {
  const feed = $("#feed"); feed.innerHTML = '<div class="loading-line">Loading the community…</div>';
  try {
    const data = await api("/api/posts" + (state.user ? `?viewerId=${state.user.id}` : ""));
    feed.innerHTML = "";
    data.posts.forEach(post => feed.append(renderPost(post)));
    if (!data.posts.length) feed.innerHTML = '<div class="empty-state">No posts yet. You could be the first to share something kind.</div>';
    $("#postCount").textContent = data.posts.length;
  } catch (e) { feed.innerHTML = `<div class="empty-state">${escapeHtml(e.message)}</div>`; }
}
function openAuth(mode = "login") {
  state.authMode = mode; updateAuthMode(); $("#authDialog").showModal();
}
function updateAuthMode() {
  const register = state.authMode === "register";
  $("#authTitle").textContent = register ? "Start your next chapter." : "Welcome back.";
  $("#authSubtitle").textContent = register ? "Create an account to share and connect." : "Sign in to join the conversation.";
  $("#usernameField").classList.toggle("hidden", !register);
  $("#authUsername").required = register;
  $("#authPassword").autocomplete = register ? "new-password" : "current-password";
  $("#authSubmit").textContent = register ? "Create account" : "Sign in";
  $$(".auth-tabs button").forEach(b => b.classList.toggle("active", b.dataset.authMode === state.authMode));
  $("#authFeedback").textContent = "";
}
$("#year").textContent = new Date().getFullYear();
updateAccount();
selectAgent("nova");
$("#authOpen").addEventListener("click", () => state.user ? signOut() : openAuth("login"));
$("#authDialog").addEventListener("click", e => { if (e.target === $("#authDialog")) $("#authDialog").close(); });
$$(".auth-tabs button").forEach(b => b.addEventListener("click", () => { state.authMode = b.dataset.authMode; updateAuthMode(); }));
$("#authForm").addEventListener("submit", async e => {
  e.preventDefault(); const register = state.authMode === "register"; const button = $("#authSubmit");
  button.disabled = true; $("#authFeedback").textContent = "One moment…";
  try {
    const body = { email: $("#authEmail").value, password: $("#authPassword").value };
    if (register) body.username = $("#authUsername").value;
    setSignedIn(await api(register ? "/api/auth/register" : "/api/auth/login", { method:"POST", body:JSON.stringify(body) }));
    $("#authForm").reset();
  } catch (error) { $("#authFeedback").textContent = error.message; }
  finally { button.disabled = false; }
});
$$(".agent").forEach(b => b.addEventListener("click", () => selectAgent(b.dataset.agent)));
$$(".prompt-chips button").forEach(b => b.addEventListener("click", () => sendChat(b.dataset.prompt)));
$("#chatForm").addEventListener("submit", e => { e.preventDefault(); sendChat($("#chatInput").value); });
$("#writePostBtn").addEventListener("click", () => {
  if (!state.user) { openAuth("login"); toast("Sign in or create an account to post."); return; }
  $("#postForm").classList.toggle("hidden"); $("#postBody").focus();
});
$("#postForm").addEventListener("submit", async e => {
  e.preventDefault(); const button = $("#postForm button"); button.disabled = true;
  try { await api("/api/posts", { method:"POST", body:JSON.stringify({ body:$("#postBody").value }) }); $("#postBody").value = ""; $("#postForm").classList.add("hidden"); toast("Your post is live."); await loadPosts(); }
  catch (error) { toast(error.message); } finally { button.disabled = false; }
});
$("#loadPosts").addEventListener("click", loadPosts);
$("#feed").addEventListener("click", async e => {
  const button = e.target.closest("button[data-action]"); if (!button) return;
  const card = button.closest(".post-card"); const id = card.dataset.id;
  if (button.dataset.action === "like") {
    if (!state.user) { openAuth("login"); toast("Sign in to like a post."); return; }
    try { const data = await api(`/api/posts/${id}/like`, { method:"POST", body:"{}" }); button.classList.toggle("liked", data.liked); button.innerHTML = `♡ ${data.likes} ${data.likes === 1 ? "like" : "likes"}`; }
    catch (error) { toast(error.message); }
  }
  if (button.dataset.action === "comment-toggle") card.querySelector(".comments").classList.toggle("hidden");
  if (button.dataset.action === "report") {
    if (!state.user) { openAuth("login"); toast("Sign in to report a post."); return; }
    const reason = window.prompt("Report reason: spam, harassment, hate, misinformation, or other", "other");
    if (!reason) return;
    const details = window.prompt("Optional details (up to 300 characters):", "") || "";
    try { const data = await api(`/api/posts/${id}/report`, { method:"POST", body:JSON.stringify({ reason:reason.trim().toLowerCase(), details }) }); toast(data.message); }
    catch (error) { toast(error.message); }
  }
});
$("#feed").addEventListener("submit", async e => {
  if (!e.target.matches(".comment-form")) return;
  e.preventDefault(); const card = e.target.closest(".post-card"); const input = e.target.elements.comment;
  try { await api(`/api/posts/${card.dataset.id}/comments`, { method:"POST", body:JSON.stringify({ body:input.value }) }); await loadPosts(); toast("Reply added."); }
  catch (error) { toast(error.message); }
});
$("#moodOptions").addEventListener("click", e => {
  const button = e.target.closest("button[data-mood]"); if (!button) return;
  state.mood = button.dataset.mood; $$("#moodOptions button").forEach(b => b.classList.toggle("selected", b === button));
  $("#moodFeedback").textContent = `You chose: ${button.querySelector("small").textContent}.`;
});
$("#saveMood").addEventListener("click", async () => {
  if (!state.mood) { $("#moodFeedback").textContent = "Choose the mood that feels closest."; return; }
  if (!state.user) { openAuth("login"); $("#moodFeedback").textContent = "Sign in to save a private check-in to your account."; return; }
  try { const data = await api("/api/checkins", { method:"POST", body:JSON.stringify({ mood:state.mood, note:$("#moodNote").value }) }); $("#moodFeedback").textContent = data.message; $("#moodNote").value = ""; toast("Check-in saved."); await loadCheckins(); }
  catch (error) { $("#moodFeedback").textContent = error.message; }
});

async function loadCheckins() {
  const history = $("#checkinHistory");
  if (!state.user) { history.innerHTML = ""; history.classList.add("hidden"); return; }
  history.classList.remove("hidden");
  history.innerHTML = '<div class="loading-line">Loading your private check-ins…</div>';
  try {
    const data = await api("/api/checkins");
    const entries = data.checkins || [];
    if (!entries.length) { history.innerHTML = '<p class="checkin-history-empty">Your saved check-ins will appear here.</p>'; return; }
    const labels = {great:"Great",good:"Good",okay:"Okay",low:"Low",rough:"Rough"};
    history.innerHTML = '<h4>Your recent check-ins</h4><div class="checkin-history-list">' + entries.map(item =>
      '<article class="checkin-history-item"><div><strong>' + escapeHtml(labels[item.mood] || item.mood) + '</strong><time>' + escapeHtml(formatDate(item.created_at || "")) + '</time></div>' +
      (item.note ? '<p>' + escapeHtml(item.note) + '</p>' : '') + '</article>'
    ).join("") + '</div>';
  } catch (error) {
    history.innerHTML = '<p class="checkin-history-empty">' + escapeHtml(error.message) + '</p>';
  }
}
let game = { running:false, score:0, left:20, interval:null };
function moveTarget() {
  const target = $("#gameTarget"); const x = Math.round(Math.random()*90 - 45); const y = Math.round(Math.random()*34 - 17);
  target.style.transform = `translate(${x}px,${y}px) rotate(${Math.round(Math.random()*24-12)}deg)`;
  target.textContent = ["✦","✧","✳","⋆"][Math.floor(Math.random()*4)];
}
$("#gameTarget").addEventListener("click", () => {
  if (!game.running) { $("#gameMessage").textContent = "Start a round to catch sparks."; return; }
  game.score++; $("#score").textContent = game.score; moveTarget();
});
$("#startGame").addEventListener("click", () => {
  clearInterval(game.interval); game.running = true; game.score = 0; game.left = 20;
  $("#score").textContent = "0"; $("#timeLeft").textContent = "20"; $("#gameMessage").textContent = "Catch as many as you can!";
  $("#startGame").disabled = true; $("#startGame").textContent = "Round in progress…"; moveTarget();
  game.interval = setInterval(() => {
    game.left--; $("#timeLeft").textContent = game.left;
    if (game.left <= 0) { clearInterval(game.interval); game.running = false; $("#gameMessage").textContent = `You caught ${game.score} spark${game.score === 1 ? "" : "s"}. Nice reset.`; $("#startGame").disabled = false; $("#startGame").textContent = "Play another round"; $("#gameTarget").style.transform = ""; }
  }, 1000);
});
(async function init() {
  if (state.token) {
    try { const data = await api("/api/me"); state.user = data.user; updateAccount(); }
    catch { signOut(false); }
  }
  await loadPosts();
  if (state.user) await loadCheckins();
})();
