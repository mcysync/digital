// HackMySenpai — standalone chat app (vanilla JS)
// Calls the Lovable-hosted /api/public/senpai-chat endpoint so the Gemini key stays server-side.

const API_URL = (() => {
  const override = window.HACKMYSENPAI_API_URL;
  return override || "https://hack-your-senpai.lovable.app/api/public/senpai-chat";
})();

const STORAGE_KEY = "hackmysenpai.threads.v1";
const ACTIVE_KEY = "hackmysenpai.active.v1";

/** @typedef {{id:string,title:string,createdAt:number,messages:{role:'user'|'assistant',content:string}[]}} Thread */

// ---------- storage ----------
function loadThreads() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]"); }
  catch { return []; }
}
function saveThreads(threads) { localStorage.setItem(STORAGE_KEY, JSON.stringify(threads)); }
function loadActive() { return localStorage.getItem(ACTIVE_KEY); }
function saveActive(id) { if (id) localStorage.setItem(ACTIVE_KEY, id); else localStorage.removeItem(ACTIVE_KEY); }

// ---------- state ----------
let threads = loadThreads();
let activeId = loadActive();
if (activeId && !threads.find(t => t.id === activeId)) activeId = null;

function currentThread() { return threads.find(t => t.id === activeId) || null; }

function newThread() {
  const t = { id: "t_" + Math.random().toString(36).slice(2, 10), title: "New chat", createdAt: Date.now(), messages: [] };
  threads.unshift(t);
  activeId = t.id;
  saveThreads(threads); saveActive(activeId);
  renderThreads(); renderMessages();
  input.focus();
}

function deleteThread(id) {
  threads = threads.filter(t => t.id !== id);
  if (activeId === id) activeId = threads[0]?.id || null;
  saveThreads(threads); saveActive(activeId);
  renderThreads(); renderMessages();
}

function selectThread(id) {
  activeId = id; saveActive(id);
  renderThreads(); renderMessages();
  if (window.innerWidth <= 800) sidebar.classList.remove("open");
}

// ---------- DOM ----------
const sidebar = document.getElementById("sidebar");
const threadsList = document.getElementById("threadsList");
const messagesEl = document.getElementById("messages");
const input = document.getElementById("input");
const sendBtn = document.getElementById("sendBtn");
const form = document.getElementById("composer");
const newBtn = document.getElementById("newThreadBtn");
const menuBtn = document.getElementById("menuBtn");

newBtn.addEventListener("click", newThread);
menuBtn.addEventListener("click", () => sidebar.classList.toggle("open"));

// autosize textarea
input.addEventListener("input", () => {
  input.style.height = "auto";
  input.style.height = Math.min(input.scrollHeight, 200) + "px";
});
input.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); form.requestSubmit(); }
});

form.addEventListener("submit", (e) => { e.preventDefault(); send(); });

// suggestion chips
document.addEventListener("click", (e) => {
  const chip = e.target.closest(".chip");
  if (chip) { input.value = chip.textContent; input.dispatchEvent(new Event("input")); input.focus(); }
});

// ---------- rendering ----------
function renderThreads() {
  threadsList.innerHTML = "";
  if (!threads.length) {
    threadsList.innerHTML = `<div style="color:var(--text-dim);font-size:12px;padding:8px 12px;">No chats yet. Say hi to senpai~</div>`;
    return;
  }
  for (const t of threads) {
    const el = document.createElement("div");
    el.className = "thread-item" + (t.id === activeId ? " active" : "");
    el.innerHTML = `<span class="thread-title">${escapeHtml(t.title)}</span><button class="thread-del" title="Delete">✕</button>`;
    el.addEventListener("click", (e) => {
      if (e.target.classList.contains("thread-del")) { e.stopPropagation(); deleteThread(t.id); }
      else selectThread(t.id);
    });
    threadsList.appendChild(el);
  }
}

function renderMessages() {
  const t = currentThread();
  messagesEl.innerHTML = "";
  if (!t || !t.messages.length) {
    messagesEl.innerHTML = `
      <div class="empty-state">
        <div class="hero-glyph">咲</div>
        <h1 class="hero-title">Yo, kouhai~</h1>
        <p class="hero-sub">Ask me anything. Senpai's got you covered.</p>
        <div class="chips">
          <button class="chip">Write a cyberpunk short story</button>
          <button class="chip">Debug my Python code</button>
          <button class="chip">Explain quantum entanglement</button>
          <button class="chip">Roast my startup idea</button>
        </div>
      </div>`;
    return;
  }
  for (const m of t.messages) messagesEl.appendChild(renderMessage(m.role, m.content));
  scrollToBottom();
}

function renderMessage(role, content) {
  const wrap = document.createElement("div");
  wrap.className = "msg " + role;
  const avatar = role === "user" ? "君" : "咲";
  wrap.innerHTML = `<div class="avatar">${avatar}</div><div class="bubble"></div>`;
  wrap.querySelector(".bubble").innerHTML = renderMarkdown(content);
  return wrap;
}

function scrollToBottom() { messagesEl.scrollTop = messagesEl.scrollHeight; }

// ---------- sending ----------
let sending = false;
async function send() {
  const text = input.value.trim();
  if (!text || sending) return;

  if (!currentThread()) newThread();
  const t = currentThread();

  t.messages.push({ role: "user", content: text });
  if (t.title === "New chat") t.title = text.slice(0, 40) + (text.length > 40 ? "…" : "");
  saveThreads(threads); renderThreads(); renderMessages();

  input.value = ""; input.style.height = "auto";
  sending = true; sendBtn.disabled = true;

  // append streaming assistant bubble
  const assistantMsg = { role: "assistant", content: "" };
  t.messages.push(assistantMsg);
  const bubble = renderMessage("assistant", "");
  bubble.querySelector(".bubble").innerHTML = `<div class="typing"><span></span><span></span><span></span></div>`;
  // remove empty-state if present
  const empty = messagesEl.querySelector(".empty-state"); if (empty) empty.remove();
  messagesEl.appendChild(bubble);
  scrollToBottom();

  try {
    const res = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: t.messages.slice(0, -1).map(m => ({ role: m.role, content: m.content })),
      }),
    });
    if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    const bubbleContent = bubble.querySelector(".bubble");
    bubbleContent.innerHTML = "";
    let acc = "";
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      acc += decoder.decode(value, { stream: true });
      assistantMsg.content = acc;
      bubbleContent.innerHTML = renderMarkdown(acc);
      scrollToBottom();
    }
    saveThreads(threads);
  } catch (err) {
    assistantMsg.content = `⚠️ Senpai couldn't reach the gateway: ${err.message}`;
    bubble.querySelector(".bubble").innerHTML = renderMarkdown(assistantMsg.content);
    saveThreads(threads);
  } finally {
    sending = false; sendBtn.disabled = false; input.focus();
  }
}

// ---------- tiny markdown ----------
function escapeHtml(s) {
  return s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function renderMarkdown(src) {
  if (!src) return "";
  let s = escapeHtml(src);
  // code fences
  s = s.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => `<pre><code>${code}</code></pre>`);
  // inline code
  s = s.replace(/`([^`\n]+)`/g, "<code>$1</code>");
  // bold / italic
  s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/\*([^*]+)\*/g, "<em>$1</em>");
  // headers
  s = s.replace(/^### (.*)$/gm, "<h3>$1</h3>");
  s = s.replace(/^## (.*)$/gm, "<h2>$1</h2>");
  s = s.replace(/^# (.*)$/gm, "<h1>$1</h1>");
  // links
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  // lists
  s = s.replace(/(?:^|\n)((?:- .+\n?)+)/g, (m) => {
    const items = m.trim().split("\n").map(l => `<li>${l.replace(/^- /, "")}</li>`).join("");
    return `\n<ul>${items}</ul>`;
  });
  // paragraphs
  s = s.split(/\n{2,}/).map(block => {
    if (/^<(h\d|ul|ol|pre)/.test(block.trim())) return block;
    return `<p>${block.replace(/\n/g, "<br/>")}</p>`;
  }).join("");
  return s;
}

// ---------- boot ----------
renderThreads();
renderMessages();
