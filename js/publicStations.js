const OCM_API_KEY = "a2dac604-57c6-4a71-9318-dc7515581dee";

// Operators with these words in their name are tagged "Government". Edit freely.
const GOV_WORDS = ["eesl", "ntpc", "powergrid", "power grid", "bescom", "hescom", "gescom", "mescom", "cescom", "kptcl", "kseb", "tangedco", "msedcl", "bpcl", "iocl", "indian oil", "hpcl", "hindustan petroleum", "bharat petroleum", "nhai", "bhel", "convergence", "govt", "government", "municipal", "electricity board", "discom"];

export function startPublicStations() {
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const isGov = name => { const n = String(name || '').toLowerCase(); return GOV_WORDS.some(w => n.includes(w)) };
  const dist = (a, b, c, d) => {
    const r = x => x * Math.PI / 180, dLat = r(c - a), dLng = r(d - b);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(r(a)) * Math.cos(r(c)) * Math.sin(dLng / 2) ** 2;
    return 12742 * Math.asin(Math.sqrt(h));
  };

  const style = document.createElement('style');
  style.textContent = `
    #pubStations{max-width:1100px;margin:48px auto;padding:0 20px}
    #pubStations h2{margin:0 0 6px}
    #pubStations .ps-sub{margin:0 0 16px;color:#667085}
    #pubStations .ps-bar{display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin-bottom:16px}
    #pubStations select,#pubStations .ps-btn,#pubStations .ps-chips button{padding:9px 14px;border:1px solid #d0d5dd;border-radius:10px;background:#fff;color:#1d2939;font:inherit;font-size:14px;cursor:pointer;text-decoration:none}
    #pubStations .ps-btn.main,#pubStations .ps-chips button.on{background:#0f6b4a;border-color:#0f6b4a;color:#fff}
    #pubStations .ps-chips{display:flex;gap:6px}
    #pubStations .ps-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(290px,1fr));gap:14px}
    #pubStations .ps-card{background:#fff;color:#1d2939;border:1px solid #e4e7ec;border-radius:16px;padding:16px;display:grid;gap:6px}
    #pubStations .ps-top{display:flex;justify-content:space-between;gap:8px;align-items:flex-start}
    #pubStations .ps-top h3{margin:0;font-size:16px}
    #pubStations .ps-tag{font-size:12px;padding:3px 9px;border-radius:999px;white-space:nowrap}
    #pubStations .ps-tag.gov{background:#e0f2fe;color:#075985}
    #pubStations .ps-tag.pvt{background:#fef3c7;color:#92400e}
    #pubStations .ps-meta{font-size:14px;color:#475467}
    #pubStations .ps-msg{color:#667085;padding:18px 0}
    #pubStations .ps-credit{margin-top:14px;font-size:12px;color:#667085}
  `;
  document.head.appendChild(style);

  const sec = document.createElement('section');
  sec.id = 'pubStations';
  sec.innerHTML = `
    <h2>Public charging stations near you</h2>
    <p class="ps-sub">Government and private charging stations around your location.</p>
    <div class="ps-bar">
      <button class="ps-btn main" id="psLocate" type="button">📍 Use my location</button>
      <select id="psRadius"><option value="5">Within 5 km</option><option value="10" selected>Within 10 km</option><option value="25">Within 25 km</option><option value="50">Within 50 km</option></select>
      <div class="ps-chips"><button type="button" data-f="all" class="on">All</button><button type="button" data-f="gov">Government</button><button type="button" data-f="private">Private</button></div>
    </div>
    <div id="psList"><p class="ps-msg">Tap “Use my location” to see the nearest stations.</p></div>
    <p class="ps-credit">Station data from <a href="https://openchargemap.org" target="_blank" rel="noopener">Open Charge Map</a> contributors. Details can be out of date, so check before you go.</p>`;
  const footer = document.querySelector('footer');
  footer ? footer.before(sec) : document.body.append(sec);

  let stations = [], filter = 'all', coords = null;
  const listEl = sec.querySelector('#psList');
  const msg = t => { listEl.innerHTML = `<p class="ps-msg">${esc(t)}</p>` };

  const card = s => `
    <article class="ps-card">
      <div class="ps-top"><h3>${esc(s.name)}</h3><span class="ps-tag ${s.gov ? 'gov' : 'pvt'}">${s.gov ? 'Government' : 'Private / network'}</span></div>
      <div class="ps-meta">${esc(s.address)}</div>
      <div class="ps-meta">📏 ${s.distance.toFixed(1)} km away${s.operator ? ' · ' + esc(s.operator) : ''}</div>
      <div class="ps-meta">🔌 ${esc(s.connectors)}</div>
      ${s.cost ? `<div class="ps-meta">💰 ${esc(s.cost)}</div>` : ''}
      <div class="ps-meta">${esc(s.status)}</div>
      <a class="ps-btn" target="_blank" rel="noopener" href="https://www.google.com/maps/dir/?api=1&destination=${s.lat},${s.lng}">Directions</a>
    </article>`;

  function render() {
    const list = stations.filter(s => filter === 'all' || (filter === 'gov' ? s.gov : !s.gov));
    if (!list.length) return msg(stations.length ? 'No stations match this filter. Try “All” or a bigger distance.' : 'No public stations found in this area. Try a larger distance.');
    listEl.innerHTML = `<div class="ps-grid">${list.map(card).join('')}</div>`;
  }

  async function fetchStations(lat, lng, radius) {
    const cacheKey = `evcs_ocm_${lat.toFixed(2)}_${lng.toFixed(2)}_${radius}`;
    try {
      const c = JSON.parse(sessionStorage.getItem(cacheKey));
      if (c && Date.now() - c.t < 10 * 60 * 1000) return c.d;
    } catch {}

    const url = `https://api.openchargemap.io/v3/poi/?output=json&latitude=${lat}&longitude=${lng}&distance=${radius}&distanceunit=KM&maxresults=60&key=${encodeURIComponent(OCM_API_KEY)}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error('Station service returned ' + res.status);
    const raw = await res.json();

    const data = raw.map(p => {
      const a = p.AddressInfo || {};
      const operator = p.OperatorInfo?.Title || '';
      const conns = [...new Set((p.Connections || []).map(c => {
        const t = c.ConnectionType?.Title || 'Connector';
        return c.PowerKW ? `${t} · ${c.PowerKW} kW` : t;
      }))].slice(0, 4);
      return {
        name: a.Title || 'Charging station',
        address: [a.AddressLine1, a.Town, a.StateOrProvince, a.Postcode].filter(Boolean).join(', ') || 'Address not listed',
        lat: Number(a.Latitude), lng: Number(a.Longitude),
        distance: typeof a.Distance === 'number' ? a.Distance : dist(lat, lng, a.Latitude, a.Longitude),
        operator, gov: isGov(operator) || isGov(a.Title),
        connectors: conns.length ? conns.join(', ') : 'Connector details not listed',
        cost: p.UsageCost || '',
        status: p.StatusType?.Title || 'Status unknown'
      };
    }).filter(s => Number.isFinite(s.lat) && Number.isFinite(s.lng)).sort((x, y) => x.distance - y.distance);

    try { sessionStorage.setItem(cacheKey, JSON.stringify({ t: Date.now(), d: data })) } catch {}
    return data;
  }

  async function search() {
    if (OCM_API_KEY.startsWith('PASTE')) return msg('Add your Open Charge Map API key in js/publicStations.js first.');
    msg('Searching for stations…');
    try {
      stations = await fetchStations(coords.lat, coords.lng, Number(sec.querySelector('#psRadius').value));
      render();
    } catch (err) {
      console.error('Public stations error:', err);
      msg('Could not load stations right now. Please try again.');
    }
  }

  sec.querySelector('#psLocate').onclick = () => {
    if (!navigator.geolocation) return msg('Your browser does not support location.');
    msg('Finding your location…');
    navigator.geolocation.getCurrentPosition(
      pos => { coords = { lat: pos.coords.latitude, lng: pos.coords.longitude }; search(); },
      () => msg('Location permission was denied. Allow location access in your browser and try again.'),
      { timeout: 10000 }
    );
  };
  sec.querySelector('#psRadius').onchange = () => { if (coords) search(); };

  const chips = sec.querySelectorAll('.ps-chips button');
  chips.forEach(b => b.onclick = () => {
    filter = b.dataset.f;
    chips.forEach(x => x.classList.toggle('on', x === b));
    render();
  });
}