import { auth, db } from "./firebase.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.6.0/firebase-auth.js";
import { collection, query, where, onSnapshot } from "https://www.gstatic.com/firebasejs/12.6.0/firebase-firestore.js";

export function startNotifications(role) {   // 'customer' or 'provider'
  let uid = null, unsub = null, list = [];

  const key = k => `evcs_${k}_${role}_${uid}`;
  const load = (k, d) => { try { return JSON.parse(localStorage.getItem(key(k))) ?? d } catch { return d } };
  const save = (k, v) => { try { localStorage.setItem(key(k), JSON.stringify(v)) } catch {} };
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const clean = s => String(s ?? '').replace(/[<>&"']/g, '');
  const btn = 'border:1px solid #d0d5dd;background:#fff;border-radius:8px;padding:5px 9px;font-size:12px;cursor:pointer';

  // ---------- Bell + panel ----------
  const bell = document.createElement('button');
  bell.type = 'button';
  bell.setAttribute('aria-label', 'Notifications');
  bell.style.cssText = 'position:fixed;right:18px;bottom:96px;width:54px;height:54px;border-radius:50%;border:0;background:#0f6b4a;color:#fff;font-size:22px;cursor:pointer;box-shadow:0 6px 18px rgba(0,0,0,.28);z-index:9998;display:none';
  bell.innerHTML = '🔔<span style="position:absolute;top:-3px;right:-3px;min-width:20px;height:20px;padding:0 5px;box-sizing:border-box;border-radius:10px;background:#d92d20;color:#fff;font-size:12px;line-height:20px;display:none"></span>';
  const badge = bell.querySelector('span');

  const panel = document.createElement('div');
  panel.style.cssText = 'position:fixed;right:18px;bottom:160px;width:min(340px,calc(100vw - 36px));max-height:60vh;overflow:auto;background:#fff;color:#1d2939;border-radius:16px;box-shadow:0 12px 36px rgba(0,0,0,.28);z-index:9998;display:none;font-size:14px';

  document.body.append(bell, panel);

  function paint() {
    const unread = list.filter(n => !n.read).length;
    badge.textContent = unread > 99 ? '99+' : unread;
    badge.style.display = unread ? 'block' : 'none';
    const head = `<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;padding:12px 14px;position:sticky;top:0;background:#fff;border-bottom:1px solid #eee"><b>Notifications</b><span>`
      + (('Notification' in window && Notification.permission === 'default') ? `<button data-act="allow" style="${btn}">Enable alerts</button> ` : '')
      + (list.length ? `<button data-act="clear" style="${btn}">Clear</button>` : '')
      + `</span></div>`;
    const body = list.length
      ? list.map(n => `<div style="padding:10px 14px;border-bottom:1px solid #f2f2f2;${n.read ? '' : 'background:#f0faf5'}"><div>${esc(n.text)}</div><div style="font-size:12px;color:#667085;margin-top:3px">${new Date(n.time).toLocaleString()}</div></div>`).join('')
      : '<div style="padding:18px 14px;color:#667085">No notifications yet.</div>';
    panel.innerHTML = head + body;
  }

  bell.addEventListener('click', () => {
    const open = panel.style.display === 'block';
    panel.style.display = open ? 'none' : 'block';
    if (!open) {
      paint();
      list.forEach(n => n.read = true);
      save('list', list);
      badge.style.display = 'none';
    }
  });

  panel.addEventListener('click', async e => {
    const act = e.target.dataset && e.target.dataset.act;
    if (act === 'clear') { list = []; save('list', list); paint(); }
    if (act === 'allow') { try { await Notification.requestPermission() } catch {} paint(); }
  });

  function push(texts) {
    if (!texts.length) return;
    texts.forEach(t => list.unshift({ text: t, time: Date.now(), read: false }));
    list = list.slice(0, 30);
    save('list', list);
    paint();
    const summary = texts.length === 1 ? texts[0] : `You have ${texts.length} new notifications`;
    if (typeof window.toast === 'function') window.toast(summary);
    if ('Notification' in window && Notification.permission === 'granted') {
      try { new Notification('EV Charge Spot', { body: summary }) } catch {}
    }
  }

  // ---------- Watch this user's bookings ----------
  onAuthStateChanged(auth, user => {
    if (unsub) { unsub(); unsub = null }
    if (!user) { uid = null; list = []; bell.style.display = 'none'; panel.style.display = 'none'; return }

    uid = user.uid;
    list = load('list', []);
    bell.style.display = 'block';
    paint();

    const field = role === 'provider' ? 'providerId' : 'userId';
    unsub = onSnapshot(query(collection(db, 'bookings'), where(field, '==', uid)), snap => {
      const known = load('known', {});
      const texts = [];
      const rows = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      rows.sort((a, b) => (a.createdAt?.seconds || 0) - (b.createdAt?.seconds || 0));

      rows.forEach(b => {
        const spot = clean(b.spotName || b.spot || 'charging spot');
        const when = `${clean(b.date)}, ${clean(b.time)}`;

        if (role === 'provider') {
          if (!(b.id in known) && b.status === 'Pending') {
            texts.push(`🔔 New booking request from ${clean(b.customerName || b.customerEmail || 'a customer')} for ${when}`);
          }
        } else if (b.id in known && known[b.id] !== b.status) {
          const m = {
            Confirmed: `✅ Your booking at ${spot} (${when}) was accepted.`,
            Rejected: `❌ Your booking at ${spot} (${when}) was declined.`,
            Completed: `🏁 Your session at ${spot} (${when}) is marked completed.`
          }[b.status];
          if (m) texts.push(m);
        }
        known[b.id] = b.status;
      });

      save('known', known);
      push(texts);
    }, err => console.error('Notifications listener error:', err));
  });
}