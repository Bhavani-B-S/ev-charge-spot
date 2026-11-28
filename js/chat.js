// js/chat.js
// Real-time chat between customers and charger owners (Firestore).
// Load it on BOTH customer/index.html and owner/index.html:
//   <script type="module" src="../js/chat.js"></script>
//
// Data model
//   chats/{providerUid}_{customerUid}            -> who is talking, last message
//   chats/{providerUid}_{customerUid}/messages   -> senderId, text, createdAt

import { auth, db } from "./firebase.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.6.0/firebase-auth.js";
import {
  collection, doc, setDoc, addDoc, getDocs,
  query, where, orderBy, onSnapshot, serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.6.0/firebase-firestore.js";

const IS_OWNER = location.pathname.includes("/owner");

let me = null;            // signed-in user
let activeChat = null;    // chat currently open
let unsubMessages = null; // message listener
let unsubList = null;     // owner's chat-list listener

/* ---------- Styles (same green palette as the site) ---------- */
const css = `
#evcsChatBtn{position:fixed;left:20px;bottom:20px;z-index:900;padding:12px 18px;border:0;border-radius:999px;background:#087a58;color:#fff;font-family:inherit;font-size:15px;font-weight:700;cursor:pointer;box-shadow:0 8px 24px rgba(7,62,52,.35)}
#evcsChatBtn:hover{background:#073e34}
#evcsChatPanel{position:fixed;left:20px;bottom:78px;z-index:900;display:none;flex-direction:column;width:340px;max-width:calc(100vw - 40px);height:470px;max-height:calc(100vh - 110px);overflow:hidden;background:#fff;color:#172b25;border:1px solid #e4ebe6;border-radius:16px;box-shadow:0 16px 40px rgba(7,62,52,.28);font-family:inherit}
#evcsChatPanel.open{display:flex}
#evcsChatPanel .evcsHead{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:12px 14px;background:#073e34;color:#fff}
#evcsChatPanel .evcsHead strong{font-size:15px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#evcsChatPanel .evcsHead button{border:0;background:transparent;color:#fff;font-size:18px;line-height:1;cursor:pointer}
#evcsChatPanel .evcsPick{padding:10px 12px;border-bottom:1px solid #e4ebe6;background:#f7f9f7;max-height:150px;overflow-y:auto;font-size:13px;color:#718078}
#evcsChatPanel .evcsPick select{width:100%;padding:9px 10px;border:1px solid #e4ebe6;border-radius:10px;background:#fff;color:#172b25;font-family:inherit;font-size:14px}
#evcsChatPanel .evcsItem{display:block;width:100%;margin:0 0 6px;padding:8px 10px;text-align:left;border:1px solid #e4ebe6;border-radius:10px;background:#fff;color:#172b25;font-family:inherit;cursor:pointer}
#evcsChatPanel .evcsItem.on{border-color:#087a58;background:#eaf5ee}
#evcsChatPanel .evcsItem b{display:block;font-size:14px}
#evcsChatPanel .evcsItem span{display:block;font-size:12px;color:#718078;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#evcsChatPanel .evcsMsgs{flex:1;overflow-y:auto;padding:12px;display:flex;flex-direction:column;gap:8px;background:#fff}
#evcsChatPanel .evcsNote{margin:auto;max-width:230px;text-align:center;color:#718078;font-size:13px;line-height:1.5}
#evcsChatPanel .evcsMsg{max-width:80%;padding:8px 12px;border-radius:14px;font-size:14px;line-height:1.4;overflow-wrap:anywhere}
#evcsChatPanel .evcsMsg.mine{align-self:flex-end;background:#087a58;color:#fff;border-bottom-right-radius:4px}
#evcsChatPanel .evcsMsg.theirs{align-self:flex-start;background:#eaf5ee;border-bottom-left-radius:4px}
#evcsChatPanel .evcsForm{display:none;gap:8px;padding:10px 12px;border-top:1px solid #e4ebe6}
#evcsChatPanel .evcsForm.on{display:flex}
#evcsChatPanel .evcsForm input{flex:1;min-width:0;padding:10px 12px;border:1px solid #e4ebe6;border-radius:10px;font-family:inherit;font-size:14px}
#evcsChatPanel .evcsForm button{padding:10px 16px;border:0;border-radius:10px;background:#087a58;color:#fff;font-family:inherit;font-weight:700;cursor:pointer}
#evcsChatBtn:focus-visible,#evcsChatPanel button:focus-visible,#evcsChatPanel input:focus-visible,#evcsChatPanel select:focus-visible{outline:2px solid #f5b400;outline-offset:2px}
`;
const styleEl = document.createElement("style");
styleEl.textContent = css;
document.head.appendChild(styleEl);

/* ---------- Page elements ---------- */
const btn = document.createElement("button");
btn.id = "evcsChatBtn";
btn.type = "button";
btn.hidden = true;
btn.textContent = IS_OWNER ? "Messages" : "Chat with owners";

const panel = document.createElement("div");
panel.id = "evcsChatPanel";
panel.setAttribute("role", "dialog");
panel.setAttribute("aria-label", IS_OWNER ? "Customer messages" : "Chat with charger owners");
panel.innerHTML = `
  <div class="evcsHead"><strong id="evcsTitle"></strong><button type="button" id="evcsClose" aria-label="Close chat">✕</button></div>
  <div class="evcsPick" id="evcsPick"></div>
  <div class="evcsMsgs" id="evcsMsgs" aria-live="polite"></div>
  <form class="evcsForm" id="evcsForm">
    <input id="evcsInput" type="text" maxlength="500" placeholder="Type a message" autocomplete="off" aria-label="Message">
    <button type="submit">Send</button>
  </form>`;
document.body.append(btn, panel);

const $ = id => panel.querySelector("#" + id);

btn.addEventListener("click", () => panel.classList.toggle("open"));
$("evcsClose").addEventListener("click", () => panel.classList.remove("open"));
document.addEventListener("keydown", e => {
  if (e.key === "Escape") panel.classList.remove("open");
});

/* ---------- Helpers ---------- */
function showNote(text) {
  const box = $("evcsMsgs");
  box.replaceChildren();
  const p = document.createElement("p");
  p.className = "evcsNote";
  p.textContent = text;
  box.appendChild(p);
}

function myName() {
  try {
    const saved = JSON.parse(localStorage.getItem("evcsCurrentUser") || "{}");
    if (saved.name) return saved.name;
  } catch (_) { /* ignore */ }
  return (me && me.displayName) || (me && me.email ? me.email.split("@")[0] : "Customer");
}

/* ---------- Open a conversation and listen for messages ---------- */
function openChat(chat) {
  activeChat = chat;
  $("evcsTitle").textContent = chat.title;
  $("evcsForm").classList.add("on");
  if (unsubMessages) unsubMessages();
  showNote("Loading messages…");

  const q = query(collection(db, "chats", chat.id, "messages"), orderBy("createdAt"));
  unsubMessages = onSnapshot(q, snap => {
    const box = $("evcsMsgs");
    box.replaceChildren();
    if (snap.empty) {
      showNote(IS_OWNER
        ? "No messages in this chat yet."
        : "No messages yet. Say hello to start the chat.");
      return;
    }
    snap.docs.forEach(d => {
      const m = d.data();
      const row = document.createElement("div");
      row.className = "evcsMsg " + (m.senderId === me.uid ? "mine" : "theirs");
      row.textContent = m.text;
      box.appendChild(row);
    });
    box.scrollTop = box.scrollHeight;
  }, err => {
    console.error("Chat messages error:", err);
    showNote("Could not load messages. Check your connection and try again.");
  });

  $("evcsInput").focus();
}

function startChatWith(providerId, providerName) {
  openChat({
    id: providerId + "_" + me.uid,
    providerId,
    customerId: me.uid,
    customerName: myName(),
    providerName: providerName || "Charger owner",
    title: providerName || "Charger owner"
  });
}

/* ---------- Customer side: choose an owner ---------- */
async function setupCustomerPicker() {
  const pick = $("evcsPick");
  pick.innerHTML = '<select id="evcsSelect" aria-label="Choose a charger owner"><option value="">Choose a charger owner</option></select>';
  const sel = pick.querySelector("select");

  try {
    const snap = await getDocs(collection(db, "providers"));
    let count = 0;
    snap.docs.forEach(d => {
      const p = d.data();
      if (d.id === me.uid) return; // you can't chat with yourself
      if (p.role !== "provider" || p.profileComplete !== true || p.hasCharger !== true) return;
      const opt = document.createElement("option");
      opt.value = d.id;
      opt.dataset.owner = p.name || "Charger owner";
      opt.textContent = (p.spotName || (p.name ? p.name + "'s charging spot" : "Home charging spot")) +
        " (" + (p.name || "Owner") + ")";
      sel.appendChild(opt);
      count++;
    });
    if (!activeChat) {
      showNote(count
        ? "Choose an owner above to ask about their charging spot."
        : "No charger owners are listed yet.");
    }
  } catch (err) {
    console.error("Could not load owners:", err);
    if (!activeChat) showNote("Could not load charger owners. Please try again.");
  }

  sel.addEventListener("change", () => {
    const opt = sel.selectedOptions[0];
    if (opt && opt.value) startChatWith(opt.value, opt.dataset.owner);
  });
}

/* ---------- Owner side: list of customers who wrote ---------- */
function setupOwnerList() {
  const pick = $("evcsPick");
  pick.textContent = "Loading chats…";
  const ts = c => (c.updatedAt ? c.updatedAt.seconds : Number.MAX_SAFE_INTEGER);

  unsubList = onSnapshot(
    query(collection(db, "chats"), where("providerId", "==", me.uid)),
    snap => {
      pick.replaceChildren();
      const chats = snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => ts(b) - ts(a));
      if (!chats.length) {
        pick.textContent = "No customer messages yet.";
        return;
      }
      chats.forEach(c => {
        const item = document.createElement("button");
        item.type = "button";
        item.className = "evcsItem" + (activeChat && activeChat.id === c.id ? " on" : "");
        const name = document.createElement("b");
        name.textContent = c.customerName || "Customer";
        const last = document.createElement("span");
        last.textContent = c.lastMessage || "";
        item.append(name, last);
        item.addEventListener("click", () => {
          pick.querySelectorAll(".evcsItem").forEach(i => i.classList.remove("on"));
          item.classList.add("on");
          openChat({
            id: c.id,
            providerId: c.providerId,
            customerId: c.customerId,
            customerName: c.customerName,
            providerName: c.providerName,
            title: c.customerName || "Customer"
          });
        });
        pick.appendChild(item);
      });
    },
    err => {
      console.error("Chat list error:", err);
      pick.textContent = "Could not load chats. Please reload the page.";
    }
  );
}

/* ---------- Send a message ---------- */
$("evcsForm").addEventListener("submit", async e => {
  e.preventDefault();
  const input = $("evcsInput");
  const text = input.value.trim();
  if (!text || !activeChat || !me) return;
  input.value = "";

  try {
    await setDoc(doc(db, "chats", activeChat.id), {
      customerId: activeChat.customerId,
      providerId: activeChat.providerId,
      customerName: activeChat.customerName || "Customer",
      providerName: activeChat.providerName || "Charger owner",
      lastMessage: text.slice(0, 120),
      updatedAt: serverTimestamp()
    }, { merge: true });

    await addDoc(collection(db, "chats", activeChat.id, "messages"), {
      senderId: me.uid,
      text,
      createdAt: serverTimestamp()
    });
  } catch (err) {
    console.error("Send failed:", err);
    input.value = text;
    alert("Message not sent (" + (err.code || err.message) + "). Check your connection and try again.");
  }
});

/* ---------- Optional: a "Chat" button on a spot card can call this ---------- */
window.openChatWith = (providerId, providerName) => {
  if (!me) { alert("Log in to chat with a charger owner."); return; }
  if (IS_OWNER || !providerId || providerId === me.uid) return;
  panel.classList.add("open");
  startChatWith(providerId, providerName);
};

/* ---------- Show the chat only when someone is logged in ---------- */
onAuthStateChanged(auth, user => {
  me = user;
  if (unsubMessages) { unsubMessages(); unsubMessages = null; }
  if (unsubList) { unsubList(); unsubList = null; }
  activeChat = null;
  $("evcsForm").classList.remove("on");

  if (!user) {
    btn.hidden = true;
    panel.classList.remove("open");
    return;
  }

  btn.hidden = false;
  $("evcsTitle").textContent = IS_OWNER ? "Customer messages" : "Chat with owners";
  if (IS_OWNER) {
    showNote("Choose a customer to read and reply.");
    setupOwnerList();
  } else {
    showNote("Loading charger owners…");
    setupCustomerPicker();
  }
});