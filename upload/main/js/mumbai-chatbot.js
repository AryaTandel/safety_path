// ============================================================
//  SAFETY PATH – Mumbai Travel & Safety Assistant
//
//  • Trip questions -> ONE recommended option. Safest by default;
//    fastest / cheapest / shortest only if the user asks.
//  • "to Dadar" (no start) -> starts from the user's live location.
//  • A place name alone -> safety data for that place (now, or the
//    time the user mentions).
//  • Uses the dashboard's crime model (crimeZones, buildZoneCache,
//    scorePoint, riskLabel), window.ORS_API_KEY, pickPlace/findRoutes.
//  • Optional: window.SP_CHAT_ENDPOINT = LLM proxy (supabase/functions/sp-chat).
// ============================================================
(function () {
  'use strict';
  const { LINES, LANDMARKS, FARES } = window.MUM_TRANSIT;
  const $ = s => document.querySelector(s);
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const title = s => s.replace(/\b\w/g, c => c.toUpperCase());
  const hav = (a, b) => {
    const R = 6371000, r = Math.PI / 180, dLa = (b.lat - a.lat) * r, dLn = (b.lng - a.lng) * r;
    const x = Math.sin(dLa / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLn / 2) ** 2;
    return 2 * R * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
  };
  const mid = (a, b) => ({ lat: (a.lat + b.lat) / 2, lng: (a.lng + b.lng) / 2 });
  const line = (a, b, n) => Array.from({ length: n + 1 }, (_, i) => ({ lat: a.lat + (b.lat - a.lat) * i / n, lng: a.lng + (b.lng - a.lng) * i / n }));
  const fmtMin = m => m >= 60 ? Math.floor(m / 60) + ' h ' + Math.round(m % 60) + ' min' : Math.max(1, Math.round(m)) + ' min';
  const fmtHour = h => (h % 12 || 12) + ' ' + (h < 12 ? 'AM' : 'PM');
  const isNight = h => h >= 22 || h < 5;
  const slotOf = h => h >= 5 && h < 12 ? 'morning' : h >= 12 && h < 17 ? 'afternoon' : h >= 17 && h < 21 ? 'evening' : 'night';
  const isPeak = h => (h >= 8 && h < 11) || (h >= 17 && h < 21);
  const inMumbai = (la, ln) => la > 18.85 && la < 19.5 && ln > 72.7 && ln < 73.25;
  const S = { ctx: null, hist: [], last: null, lastPlace: null };

  // ───────────── Rail / metro graph ─────────────
  const NODES = [], ADJ = [];
  LINES.forEach(L => L.stations.forEach(s => NODES.push({ id: NODES.length, line: L, type: L.type, name: s[0], lat: s[1], lng: s[2] })));
  NODES.forEach(() => ADJ.push([]));
  let off = 0;
  LINES.forEach(L => {
    for (let i = 0; i < L.stations.length - 1; i++) {
      const a = NODES[off + i], b = NODES[off + i + 1], km = hav(a, b) * 1.08 / 1000, w = km / L.kmh * 60;
      ADJ[a.id].push({ to: b.id, w, km, line: L.id }); ADJ[b.id].push({ to: a.id, w, km, line: L.id });
    }
    off += L.stations.length;
  });
  for (const a of NODES) for (const b of NODES) {
    if (a.id >= b.id || a.line.id === b.line.id) continue;
    const same = a.name === b.name;
    if (same || hav(a, b) < 400) {
      const w = same && a.type === b.type ? 7 : 11;
      ADJ[a.id].push({ to: b.id, w, km: 0, tr: true }); ADJ[b.id].push({ to: a.id, w, km: 0, tr: true });
    }
  }

  // ───────────── Safety (reuses the dashboard's crime model) ─────────────
  function riskOf(pts, hour) {
    try {
      if (typeof buildZoneCache !== 'function' || typeof crimeZones === 'undefined' || !crimeZones.length) return null;
      const c = buildZoneCache(hour), s = pts.map(p => scorePoint(p.lat, p.lng, c));
      return Math.min(10, (s.reduce((a, b) => a + b, 0) / s.length) * 0.6 + Math.max(...s) * 0.4);
    } catch (e) { return null; }
  }
  function riskChip(score) {
    if (score == null) return '';
    let r = { label: score < 4.5 ? 'Mostly Safe' : score < 6 ? 'Moderate Risk' : 'High Risk', color: '#f59e0b' };
    try { r = riskLabel(score); } catch (e) {}
    return `<span class="spc-risk" style="color:${r.color};border-color:${r.color}55">${esc(r.label)} · ${score.toFixed(1)}/10</span>`;
  }

  // ───────────── Places & live location ─────────────
  const ALIAS = { vt: 'CSMT', cst: 'CSMT', 'victoria terminus': 'CSMT', 'chhatrapati shivaji terminus': 'CSMT', 'bombay central': 'Mumbai Central', 'kings circle': 'Matunga' };
  let _loc = null, _locT = 0;
  function myLoc() { // silent live-location lookup (cached 60 s)
    if (_loc && Date.now() - _locT < 60000) return Promise.resolve(_loc);
    return new Promise(res => {
      const fb = () => res(typeof fromCoords !== 'undefined' && fromCoords ? { name: 'Your location', lat: fromCoords[0], lng: fromCoords[1] } : null);
      if (!navigator.geolocation) return fb();
      navigator.geolocation.getCurrentPosition(p => { _loc = { name: 'Your location', lat: p.coords.latitude, lng: p.coords.longitude }; _locT = Date.now(); res(_loc); }, fb, { timeout: 8000, maximumAge: 60000, enableHighAccuracy: true });
    });
  }
  const _geo = new Map();
  async function geocode(q) {
    if (_geo.has(q)) return _geo.get(q);
    let out = null;
    const get = async u => { const c = new AbortController(), t = setTimeout(() => c.abort(), 6000); try { const r = await fetch(u, { signal: c.signal, headers: { 'Accept-Language': 'en' } }); return r.ok ? r.json() : null; } catch (e) { return null; } finally { clearTimeout(t); } };
    const p = await get(`https://photon.komoot.io/api/?q=${encodeURIComponent(q + ' Mumbai')}&limit=6&lat=19.076&lon=72.877&lang=en`);
    for (const f of (p && p.features) || []) {
      const [ln, la] = f.geometry.coordinates;
      if (inMumbai(la, ln)) { out = { name: f.properties.name || q, lat: la, lng: ln }; break; }
    }
    if (!out) {
      const n = await get(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q + ' Mumbai')}&format=json&limit=5&countrycodes=in`);
      const h = (n || []).find(x => inMumbai(+x.lat, +x.lon));
      if (h) out = { name: h.name || h.display_name.split(',')[0], lat: +h.lat, lng: +h.lon };
    }
    _geo.set(q, out); return out;
  }
  // Small Levenshtein distance, for tolerating typos in place names ("androwski" -> "Andheri").
  function lev(a, b) {
    if (a === b) return 0;
    const m = a.length, n = b.length; if (!m) return n; if (!n) return m;
    let prev = Array.from({ length: n + 1 }, (_, j) => j);
    for (let i = 1; i <= m; i++) {
      const cur = [i];
      for (let j = 1; j <= n; j++) cur[j] = a[i - 1] === b[j - 1] ? prev[j - 1] : 1 + Math.min(prev[j], cur[j - 1], prev[j - 1]);
      prev = cur;
    }
    return prev[n];
  }
  function fuzzyMatch(k, names) { // best match within ~25% edit distance, needs a real margin over 2nd-best
    let best = null, bestD = Infinity, second = Infinity;
    for (const name of names) {
      const d = lev(k, name.toLowerCase());
      if (d < bestD) { second = bestD; bestD = d; best = name; } else if (d < second) second = d;
    }
    const tol = Math.max(1, Math.floor(k.length * 0.25));
    return best && bestD <= tol && bestD < second ? best : null;
  }
  const disp = P => (P.stn && !/station|metro/i.test(P.name) ? P.name + " Station" : P.name);
  const ME_RX = /^(me|here|myself|my (current )?(location|position|place|area)|current (location|position|area)|where i am|this area|nearby)$/;
  async function resolve(raw) {
    const k0 = raw.toLowerCase().replace(/\s+/g, ' ').trim();
    if (ME_RX.test(k0)) return myLoc();
    const k = (ALIAS[k0] ? ALIAS[k0].toLowerCase() : k0).replace(/\s+(railway |rly |metro |local )?station$/, '').trim();
    if (!k) return null;
    let n = NODES.find(x => x.name.toLowerCase() === k);
    if (n) return { name: n.name, lat: n.lat, lng: n.lng, stn: true };
    const lm = Object.keys(LANDMARKS).filter(x => k === x || k.includes(x)).sort((a, b) => b.length - a.length)[0];
    if (lm) return { name: title(lm), lat: LANDMARKS[lm][0], lng: LANDMARKS[lm][1] };
    n = NODES.filter(x => k.length >= 4 && (k.includes(x.name.toLowerCase()) || x.name.toLowerCase().startsWith(k))).sort((a, b) => b.name.length - a.name.length)[0];
    if (n) return { name: title(k), lat: n.lat, lng: n.lng };
    if (k.length >= 4) { // typo tolerance: try station names, then landmarks, before hitting the network
      const sm = fuzzyMatch(k, [...new Set(NODES.map(x => x.name.toLowerCase()))]);
      if (sm) { const st = NODES.find(x => x.name.toLowerCase() === sm); return { name: st.name, lat: st.lat, lng: st.lng, stn: true }; }
      const lmk = fuzzyMatch(k, Object.keys(LANDMARKS));
      if (lmk) return { name: title(lmk), lat: LANDMARKS[lmk][0], lng: LANDMARKS[lmk][1] };
    }
    return geocode(k0).then(g => g && { name: title(g.name), lat: g.lat, lng: g.lng });
  }

  // ───────────── Services (ORS roads, Overpass/OpenStreetMap) ─────────────
  async function ors(profile, a, b) {
    const key = window.ORS_API_KEY; if (!key || key === 'YOUR_ORS_API_KEY') return null;
    const c = new AbortController(), t = setTimeout(() => c.abort(), 7000);
    try {
      const r = await fetch('https://api.openrouteservice.org/v2/directions/' + profile + '/geojson', { method: 'POST', signal: c.signal, headers: { 'Content-Type': 'application/json', Authorization: key }, body: JSON.stringify({ coordinates: [[a.lng, a.lat], [b.lng, b.lat]], instructions: false }) });
      if (!r.ok) return null;
      const f = (await r.json()).features[0], s = f.properties.summary, g = f.geometry.coordinates, step = Math.max(1, Math.floor(g.length / 40));
      return { km: s.distance / 1000, min: s.duration / 60, pts: g.filter((_, i) => i % step === 0).map(p => ({ lat: p[1], lng: p[0] })) };
    } catch (e) { return null; } finally { clearTimeout(t); }
  }
  const _ovpCache = new Map(); // query text -> { data, t } — short-lived, avoids re-hitting the
                                // network for the same police/bus/station lookup within a session
  async function overpass(q) {
    const hit = _ovpCache.get(q);
    if (hit && Date.now() - hit.t < 5 * 60 * 1000) return hit.data;
    // Race every mirror at once rather than trying one after another — on a slow
    // connection that halved a ~30s+ worst case down to a few seconds, since we no
    // longer wait for a dead-slow mirror to time out before even starting the next
    // one, and a shorter per-mirror timeout fails through to a working mirror faster.
    const attempt = async m => {
      const c = new AbortController(), t = setTimeout(() => c.abort(), 6000);
      try {
        const r = await fetch(m, { method: 'POST', body: 'data=' + encodeURIComponent(q), signal: c.signal });
        if (!r.ok) throw new Error('bad status');
        return (await r.json()).elements || [];
      } finally { clearTimeout(t); }
    };
    const mirrors = [
      'https://overpass-api.de/api/interpreter',
      'https://overpass.kumi.systems/api/interpreter',
      'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
      'https://overpass.private.coffee/api/interpreter',
    ];
    try {
      const data = await Promise.any(mirrors.map(attempt));
      _ovpCache.set(q, { data, t: Date.now() });
      return data;
    } catch (e) { return null; } // every mirror failed or timed out
  }
  const autoOK = P => P.lat > 19.045; // autos are not permitted in the island city
  const roadFare = (km, P, night) => autoOK(P) ? FARES.auto(km, night) : FARES.taxi(km, night);
  function access(d, P, night) { // d = metres to a station/stop
    const km = d * 1.3 / 1000;
    return km <= 1.2 ? { km, min: km / 5 * 60, cost: 0, how: 'Walk' } : { km, min: km / 20 * 60 + 4, cost: roadFare(km, P, night), how: autoOK(P) ? 'Auto' : 'Taxi' };
  }

  // Nearest NAMED bus stop to a point — used both for "nearest bus stop" lookups and to
  // backfill a real stop name whenever busRoutes() found a route number but the specific
  // boarding/alighting node it matched didn't itself carry a `name` tag in OpenStreetMap.
  async function nearestBusStop(P) {
    const els = await overpass(`[out:json][timeout:15];node(around:1000,${P.lat},${P.lng})[highway=bus_stop][name];out 30;`);
    if (!els || !els.length) return null;
    let best = null, bestD = Infinity;
    els.forEach(e => { if (!e.tags || !e.tags.name) return; const d = hav(P, { lat: e.lat, lng: e.lon }); if (d < bestD) { bestD = d; best = { name: e.tags.name, d }; } });
    return best;
  }

  // ───────────── Rail / metro planner ─────────────
  function transit(A, B, mode, hour) {
    const ok = n => mode === 'all' || n.type === mode, night = isNight(hour);
    const cand = P => NODES.filter(ok).map(n => ({ n, d: hav(P, n) })).filter(x => x.d <= 2500).sort((a, b) => a.d - b.d).slice(0, 8);
    const src = cand(A), dst = cand(B);
    if (!src.length || !dst.length) return null;
    const N = NODES.length, dist = Array(N).fill(Infinity), prev = Array(N).fill(-1), done = Array(N).fill(false), pe = Array(N).fill(null), start = {};
    src.forEach(x => { const t = access(x.d, A, night).min + 5; if (t < dist[x.n.id]) { dist[x.n.id] = t; start[x.n.id] = x; } });
    for (;;) {
      let u = -1; for (let i = 0; i < N; i++) if (!done[i] && dist[i] < Infinity && (u < 0 || dist[i] < dist[u])) u = i;
      if (u < 0) break; done[u] = true;
      for (const e of ADJ[u]) if (ok(NODES[e.to]) && dist[u] + e.w < dist[e.to]) { dist[e.to] = dist[u] + e.w; prev[e.to] = u; pe[e.to] = e; }
    }
    let best = null;
    dst.forEach(x => { const a = access(x.d, B, night), t = dist[x.n.id] + a.min; if (t < (best ? best.t : Infinity)) best = { t, id: x.n.id, x, a }; });
    if (!best || best.t === Infinity) return null;
    const path = []; for (let i = best.id; i >= 0; i = prev[i]) path.unshift(i);
    const acc = access(start[path[0]].d, A, night), legs = [];
    for (let i = 1; i < path.length; i++) {
      const e = pe[path[i]], to = NODES[path[i]], last = legs[legs.length - 1];
      if (e.tr) { legs.push({ tr: true, at: to.name }); continue; }
      if (last && !last.tr && last.line === e.line) { last.to = to.name; last.km += e.km; }
      else legs.push({ line: e.line, type: to.type, name: LINES.find(l => l.id === e.line).name, from: NODES[path[i - 1]].name, to: to.name, km: e.km });
    }
    const rides = legs.filter(l => !l.tr);
    if (!rides.length) return null;
    let cost = acc.cost + best.a.cost, tKm = 0;
    rides.concat([{}]).forEach(l => { if (l.type === 'train') tKm += l.km; else { if (tKm) { cost += FARES.train2(tKm); tKm = 0; } if (l.type === 'metro') cost += FARES.metro(l.km); } });
    const stn = path.map(i => NODES[i]), steps = [];
    // Always state the first/last leg explicitly — a destination just metres from the
    // station must still say so, or the journey looks like it silently ends at the station.
    steps.push(acc.km > 0.1 ? `${acc.how} ${fmtMin(acc.min)} (${acc.km.toFixed(1)} km) to ${esc(stn[0].name)} station` : `You start right at ${esc(stn[0].name)} station`);
    legs.forEach(l => steps.push(l.tr ? `Change at ${esc(l.at)}` : `${esc(l.name)}: ${esc(l.from)} to ${esc(l.to)}`));
    steps.push(best.a.km > 0.1 ? `${best.a.how} ${fmtMin(best.a.min)} (${best.a.km.toFixed(1)} km) to destination` : `Get off at ${esc(stn[stn.length - 1].name)} station — you have arrived`);
    const first = stn[0], lastN = stn[stn.length - 1], types = new Set(rides.map(r => r.type));
    const hasAcc = acc.km > 0.1, hasEg = best.a.km > 0.1, chain = [];
    if (hasAcc && acc.how !== 'Walk') chain.push(acc.how);
    rides.forEach(r => chain.push(r.name));
    if (hasEg && best.a.how !== 'Walk') chain.push(best.a.how);
    return {
      id: 'tr-' + mode, icon: types.has('metro') ? '🚇' : '🚆',
      name: types.size > 1 ? 'Metro + Local train' : types.has('metro') ? 'Metro' : 'Local train',
      min: best.t, km: acc.km + best.a.km + rides.reduce((s, r) => s + r.km, 0), cost, steps,
      sig: rides.map(r => r.line + r.from + r.to).join('|'), pts: [A, mid(A, first), ...stn, mid(lastN, B), B],
      // Review-worthy stops only: where you board, any actual change of train/line, and where you get off —
      // not every station the train happens to pass through without you leaving it.
      waypoints: (() => {
        const names = [A.name, rides[0].from, ...legs.filter(l => l.tr).map(l => l.at), rides[rides.length - 1].to, B.name];
        const pos = { [A.name]: A, [B.name]: B };
        stn.forEach(s => { if (!(s.name in pos)) pos[s.name] = s; });
        return [...new Set(names)].map(n => pos[n] ? { name: n, lat: pos[n].lat, lng: pos[n].lng } : null).filter(Boolean);
      })(),
      note: '',
      chain, first, last: lastN, hasAcc, hasEg, acc, eg: best.a
    };
  }

  // ───────────── BEST bus: numbers + boarding / get-off stops (OpenStreetMap) ─────────────
  // Includes routes that stop within 450 m of the start and within 900 m of the destination
  // (so a bus that gets you CLOSE counts). Returns [] if none, null if the lookup failed.
  const _bus = new Map();
  async function busRoutes(A, B, _wide) {
    // Only ever cache under the plain (non-"wide") key, and only once we know the final
    // outcome — i.e. either the narrow pass found something, or we're now in the wide
    // pass either way. Previously a narrow-radius miss was cached as a permanent failure
    // for this route before even trying the wider radius, so a bus number found on the
    // *next* real lookup for that same trip (via the wide fallback) never got reused —
    // every later ask for the same A→B trip was a guaranteed "no bus found", which is
    // exactly the "still not showing proper bus no and fare" symptom.
    const baseKey = [A.lat, A.lng, B.lat, B.lng].map(v => v.toFixed(3)).join();
    if (!_wide && _bus.has(baseKey)) return _bus.get(baseKey);
    // Widened from 450/900 m, then again from 900/1500 — the tighter radius too often
    // missed a real route whose nearest matching stop was just past the old cutoff,
    // leaving the bus card with no number at all. A second, wider pass (_wide) is tried
    // if the first comes back empty.
    const RA = _wide ? 1200 : 600, RB = _wide ? 2000 : 1100;
    const q = `[out:json][timeout:25];node(around:${RA},${A.lat},${A.lng})->.a;node(around:${RB},${B.lat},${B.lng})->.b;` +
      `rel(bn.a)["route"="bus"]->.ra;rel(bn.b)["route"="bus"]->.rb;rel.ra.rb->.r;.r out geom 40;node(r.r)->.mn;way(r.r)->.mw;` +
      `(node.mn(around:${RA},${A.lat},${A.lng});node.mn(around:${RB},${B.lat},${B.lng});` +
      `way.mw[public_transport](around:${RA},${A.lat},${A.lng});way.mw[public_transport](around:${RB},${B.lat},${B.lng}););out tags;`;
    const els = await overpass(q);
    let out = null;
    if (els) {
      const names = new Map();
      els.filter(e => e.type !== 'relation').forEach(e => { const n = e.tags && (e.tags.name || e.tags['name:en']); if (n) names.set(e.type + e.id, n); });
      const seen = new Map();
      for (const r of els.filter(e => e.type === 'relation')) {
        const tg = r.tags || {}, ref = tg.ref || tg.route_ref; if (!ref) continue;
        let pts = [];
        (r.members || []).forEach(m => {
          let pos = null;
          if (m.type === 'node' && m.lat != null) pos = { lat: m.lat, lng: m.lon };
          else if (m.type === 'way' && m.geometry && m.geometry.length && /^(stop|platform)/.test(m.role || '')) { const g = m.geometry[Math.floor(m.geometry.length / 2)]; pos = { lat: g.lat, lng: g.lon }; }
          if (pos) pts.push({ ...pos, role: m.role || '', name: names.get(m.type + m.ref) || null });
        });
        const stopLike = pts.filter(p => /^(stop|platform)/.test(p.role)); if (stopLike.length) pts = stopLike;
        let board = null, alight = null, best = Infinity;
        pts.forEach((p, i) => { const da = hav(p, A); if (da > RA) return;
          pts.forEach((q2, j) => { if (j <= i) return; const db = hav(q2, B); if (db > RB) return;
            if (da + db < best) { best = da + db; board = { name: p.name, m: Math.round(da) }; alight = { name: q2.name, m: Math.round(db) }; } }); });
        if (!board) continue; // doesn't run from the start towards the destination
        const prevR = seen.get(ref); if (!prevR || best < prevR.score) seen.set(ref, { ref: String(ref), to: tg.to || '', board, alight, score: best });
      }
      out = [...seen.values()].sort((a, b) => a.score - b.score).slice(0, 3);
    }
    if ((!out || !out.length) && !_wide) return busRoutes(A, B, true); // try the wider radius before giving up
    _bus.set(baseKey, out);
    return out;
  }
  const stopTxt = (s, place, verb) => (s.name ? `<b>${esc(s.name)}</b>` : `the stop nearest ${esc(place)}`) + (s.m > 40 ? ` (${s.m} m ${verb})` : '');

  // A rail/metro trip where a long first/last leg (over 1.2 km) is done by a numbered BEST bus
  // instead of an auto/taxi -> a genuine multi-mode journey (Bus > Local train > Metro ...).
  async function feederVariant(t, A, B, peak) {
    const needA = t.hasAcc && t.acc.km > 1.2, needB = t.hasEg && t.eg.km > 1.2;
    if (!needA && !needB) return null;
    const [ba, bb] = await Promise.all([needA ? busRoutes(A, t.first) : null, needB ? busRoutes(t.last, B) : null]);
    const ra = ba && ba[0], rb = bb && bb[0]; if (!ra && !rb) return null;
    const spd = peak ? 11 : 14, steps = [...t.steps], chain = [...t.chain]; let min = t.min, cost = t.cost;
    if (ra) {
      min += t.acc.km / spd * 60 + 8 - t.acc.min; cost += FARES.bus(t.acc.km) - t.acc.cost; chain[0] = 'Bus ' + ra.ref;
      steps[0] = `Bus ${esc(ra.ref)}: board at ${stopTxt(ra.board, 'your start', 'from start')}, get off at ${stopTxt(ra.alight, t.first.name + ' station', 'from the station')}`;
    }
    if (rb) {
      min += t.eg.km / spd * 60 + 8 - t.eg.min; cost += FARES.bus(t.eg.km) - t.eg.cost; chain[chain.length - 1] = 'Bus ' + rb.ref;
      steps[steps.length - 1] = `Bus ${esc(rb.ref)}: board at ${stopTxt(rb.board, t.last.name + ' station', 'from the station')}, get off at ${stopTxt(rb.alight, 'the destination', 'from destination')}`;
    }
    return { ...t, id: 'bt-' + t.id.slice(3), icon: '🚌', name: 'Bus + ' + t.name, min, cost, steps, chain, note: 'Confirm bus route and timings in the Chalo / BEST app.' };
  }

  // ───────────── Building the options for a trip ─────────────
  async function buildOptions(A, B, hour) {
    const night = isNight(hour), peak = isPeak(hour), straight = hav(A, B) / 1000;
    const [drv, wlk, buses, fromStop, toStop] = await Promise.all([
      ors('driving-car', A, B),
      straight <= 6 ? ors('foot-walking', A, B) : null,
      straight >= 1.2 ? busRoutes(A, B) : null,
      // Fetched alongside everything else (not after) so looking up real bus-stop
      // names never adds an extra sequential wait — same wall-clock time either way.
      straight >= 1.2 ? nearestBusStop(A) : null,
      straight >= 1.2 ? nearestBusStop(B) : null,
    ]);
    // busRoutes() sometimes matches a real numbered route whose boarding/alighting node
    // just doesn't itself carry a `name` tag in OpenStreetMap — backfill with the nearest
    // actual named bus stop we already fetched above, so the bus card can always show a
    // stop name alongside the route number, not just "the stop nearest your start".
    if (buses && buses.length) {
      buses.forEach(b => {
        if (!b.board.name && fromStop) b.board.name = fromStop.name;
        if (!b.alight.name && toStop) b.alight.name = toStop.name;
      });
    }
    const roadKm = drv ? drv.km : straight * 1.35, driveMin = (drv ? drv.min : roadKm / 28 * 60) * (peak ? 1.6 : 1.2);
    const rpts = drv ? drv.pts : line(A, B, 12), o = [], wKm = wlk ? wlk.km : straight * 1.3;
    // Without a routing key configured, road distance/fare/time are a straight-line estimate
    // rather than an actual driven route — flag that on the road-based options so the fares
    // shown read as approximate, not as a precise quote.
    const estNote = drv ? '' : ' (estimated distance — a routing key isn\'t configured, so this is a straight-line approximation)';
    if (wKm <= 8) o.push({ id: 'walk', icon: '🚶', name: 'Walk', km: wKm, min: wlk ? wlk.min : wKm / 5 * 60, cost: 0, pts: wlk ? wlk.pts : line(A, B, 12), steps: [], note: wlk ? '' : estNote.trim() });
    if (autoOK(A) && autoOK(B) && roadKm <= 25) o.push({ id: 'auto', icon: '🛺', name: 'Auto-rickshaw', km: roadKm, min: driveMin, cost: FARES.auto(roadKm, night), pts: rpts, steps: [], note: (night ? 'Includes the ~25% midnight to 5 AM surcharge.' : '') + estNote });
    o.push({ id: 'taxi', icon: '🚕', name: 'Taxi', km: roadKm, min: driveMin, cost: FARES.taxi(roadKm, night), pts: rpts, steps: [], note: (night ? 'Includes the ~25% midnight to 5 AM surcharge.' : '') + estNote });
    o.push({ id: 'cab', icon: '📱', name: 'App cab (Uber/Ola)', km: roadKm, min: driveMin + 4, cost: FARES.cab(roadKm, peak), pts: rpts, steps: [], note: 'Estimate; surge pricing may apply.' + estNote });
    if (roadKm >= 1.2) { // offer a bus for any trip long enough to need one, even if a number couldn't be looked up
      const walkM = buses && buses[0] ? buses[0].board.m + buses[0].alight.m : 0;
      const noRouteNote = (fromStop || toStop)
        ? `Exact route number unavailable, but the nearest stops are ${fromStop ? esc(fromStop.name) : 'near your start'} (board) and ${toStop ? esc(toStop.name) : 'near your destination'} (alight). Confirm the number in the Chalo / BEST app.`
        : (buses ? 'No exact route number found nearby — check the Chalo / BEST app for the number.' : 'Couldn\'t look up bus numbers right now — check the Chalo / BEST app for the route.');
      o.push({
        id: 'bus', icon: '🚌', name: 'BEST bus', km: roadKm, min: roadKm / (peak ? 11 : 14) * 60 + 8 + walkM / 80, cost: FARES.bus(roadKm),
        pts: [A, ...line(A, B, 10).slice(1, -1), B], steps: [], buses: buses && buses.length ? buses : null, fromName: A.name, toName: B.name,
        note: (buses && buses.length ? 'Non-AC fare shown; AC buses cost a bit more. Confirm route and timings in the Chalo / BEST app.' : noRouteNote) + estNote
      });
    }
    const seen = new Set(), trs = [];
    for (const m of ['train', 'metro', 'all']) { const t = transit(A, B, m, hour); if (t && !seen.has(t.sig)) { seen.add(t.sig); o.push(t); trs.push(t); } }
    (await Promise.all(trs.slice(0, 2).map(t => feederVariant(t, A, B, peak)))).forEach(v => v && o.push(v));
    o.forEach(x => { if (!x.waypoints) x.waypoints = [{ name: A.name, lat: A.lat, lng: A.lng }, { name: B.name, lat: B.lat, lng: B.lng }]; x.risk = riskOf(x.pts, hour); });
    return { opts: o, straight };
  }

  // ───────────── Choosing ONE option ─────────────
  const MODE_IDS = { walk: ['walk'], taxi: ['auto', 'taxi', 'cab'], metro: ['tr-metro', 'tr-all'], train: ['tr-train', 'tr-all'], bus: ['bus'] };
  function pick(opts, sort, modes, hour) {
    let pool = opts, missing = false, explicit = false;
    if (modes.length) { let ids = modes.flatMap(m => MODE_IDS[m] || []); if (modes.includes('bus') && (modes.includes('train') || modes.includes('metro'))) { const mix = ['bt-train', 'bt-metro', 'bt-all']; if (opts.some(x => mix.includes(x.id))) ids = mix; } const f = opts.filter(x => ids.includes(x.id)); if (f.length) { pool = f; explicit = true; } else missing = true; }
    const fastest = Math.min(...opts.map(x => x.min)); // cap relative to the OVERALL fastest, not just the filtered pool
    const cap = sort === 'cost' ? Math.max(fastest * 2.5, fastest + 30) : Math.max(fastest * 1.7, fastest + 15);
    // A mode the user explicitly asked for is never excluded just for being slower — the cap only trims unasked-for choices.
    let cand = explicit ? pool : pool.filter(x => x.min <= cap);
    if (isNight(hour)) { const nw = cand.filter(x => !(x.id === 'walk' && x.km > 1.5)); if (nw.length) cand = nw; } // avoid long night walks
    let basis = ['time', 'cost', 'dist'].includes(sort) ? sort : 'safety', x;
    if (basis === 'safety' && cand.every(c => c.risk == null)) basis = 'time';
    if (basis === 'time') x = cand.reduce((a, b) => (b.min < a.min ? b : a));
    else if (basis === 'cost') x = cand.reduce((a, b) => (b.cost < a.cost || (b.cost === a.cost && b.min < a.min) ? b : a));
    else if (basis === 'dist') x = cand.reduce((a, b) => (b.km < a.km ? b : a));
    else { // safety: lowest risk; walking at night carries extra exposure; near-ties go to the quicker option
      const adj = c => (c.risk ?? 10) + (isNight(hour) && c.id === 'walk' ? Math.min(2, c.km * 0.7) : 0), lo = Math.min(...cand.map(adj));
      x = cand.filter(c => adj(c) <= lo + 0.3).reduce((a, b) => (b.min < a.min ? b : a));
    }
    return { x, basis, missing };
  }

  // ───────────── Rendering ─────────────
  function card(x) {
    const bus = x.buses && x.buses.length ? `<ul class="spc-buslist">${x.buses.map(b => `<li><span class="spc-badge">Bus ${esc(b.ref)}</span> Board at ${stopTxt(b.board, x.fromName, 'from start')}, get off at ${stopTxt(b.alight, x.toName, 'from destination')}${b.to ? `<span class="spc-note"> towards ${esc(b.to)}</span>` : ''}</li>`).join('')}</ul>` : '';
    return `<div class="spc-opt"><div class="spc-oh"><span class="spc-oi">${x.icon}</span><b>${esc(x.name)}</b></div>
      <div class="spc-om">${fmtMin(x.min)} · ${x.km.toFixed(1)} km · ${x.cost ? '≈ ₹' + x.cost : 'Free'}</div>
      ${x.chain && x.chain.length > 1 ? `<div class="spc-om">${x.chain.length - 1} change${x.chain.length > 2 ? 's' : ''}: ${x.chain.map(esc).join(' › ')}</div>` : ''}
      <div>${riskChip(x.risk)}</div>${bus}
      ${x.steps.length ? `<ol class="spc-steps">${x.steps.map(s => `<li>${s}</li>`).join('')}</ol>` : ''}
      ${x.note ? `<div class="spc-note">${esc(x.note)}</div>` : ''}</div>`;
  }
  const BASIS = { safety: h => `Safest option at ${fmtHour(h)}`, time: () => 'Fastest option', cost: () => 'Cheapest option', dist: () => 'Shortest option' };

  async function answerRoute(o) {
    let A, B, hour, opts;
    if (o.reuse && S.ctx) { ({ A, B, opts } = S.ctx); hour = o.hour != null ? o.hour : S.ctx.hour; if (hour !== S.ctx.hour) opts = null; }
    else if (o.reuse && !o.to && S.lastPlace) {
      // A follow-up like "fastest" typed right after asking about a specific place
      // (e.g. "Mahavir Nagar" then "fastest") — no fresh A/B route context exists yet
      // because that first message was a plain safety/nearest/police lookup, not a
      // route. Reuse that same place as the destination instead of asking the person
      // to start over, so the answer stays about the place they were just asking about.
      A = await resolve('me');
      if (!A) return { html: 'I couldn\'t get your location. Allow location access, or tell me where you\'re starting, e.g. "from Andheri to Dadar".' };
      B = S.lastPlace;
      hour = o.hour != null ? o.hour : new Date().getHours();
    } else {
      // Resolving "from" and "to" at the same time (rather than one after another)
      // roughly halves the wait when either needs a live geocoding lookup — this is
      // the main reason a fresh route search could feel slow to answer.
      const [resolvedA, resolvedB] = await Promise.all([resolve(o.from || 'me'), resolve(o.to)]);
      A = resolvedA; B = resolvedB;
      if (!A) return { html: o.from ? `I couldn't locate <b>${esc(o.from)}</b>. Try a station or landmark name.` : 'I couldn\'t get your location. Allow location access, or tell me where you\'re starting, e.g. “from Andheri to Dadar”.' };
      if (!B) return { html: `I couldn't locate <b>${esc(o.to)}</b>. Try a station or landmark name, or add the area, e.g. “Hiranandani, Powai”.` };
      hour = o.hour != null ? o.hour : new Date().getHours();
    }
    if (!opts) opts = (await buildOptions(A, B, hour)).opts;
    S.ctx = { A, B, hour, opts }; S.last = { A, B }; S.lastPlace = B;
    const { x, basis, missing } = pick(opts, o.sort, o.modes || [], hour);
    S.ctx.chosen = x;
    try { window.SP_LAST_TRIP_WAYPOINTS = x.waypoints; } catch (e) {}
    const others = ['safety', 'time', 'cost'].filter(b => b !== basis).map(b => ({ safety: 'Safest option', time: 'Fastest option', cost: 'Cheapest option' }[b]));
    // Surface a materially cheaper alternative whenever one exists — not just when walking
    // was the pick (walking is free, so on its own that's not useful to know) — since e.g.
    // the metro can quietly be the cheapest option even when time/safety picked something
    // else, and that's worth knowing about. Named with its actual boarding/alighting
    // stations when it's a transit option, not just "Metro at ₹X".
    let cheapNote = '';
    const paidOpts = opts.filter(c => c.cost > 0);
    if (paidOpts.length) {
      const cheapest = paidOpts.reduce((a, b) => (b.cost < a.cost || (b.cost === a.cost && b.min < a.min) ? b : a));
      const meaningfullyCheaper = cheapest.id !== x.id && cheapest.cost < (x.cost || 0) - 2; // ignore trivial ₹1-2 differences
      const worthMentioning = x.id === 'walk' || meaningfullyCheaper;
      if (worthMentioning && cheapest.id !== x.id) {
        const stopBit = (cheapest.id.startsWith('tr-') || cheapest.id.startsWith('bt-')) && cheapest.first && cheapest.last
          ? ` (board at ${esc(cheapest.first.name)}, get off at ${esc(cheapest.last.name)})`
          : '';
        const lead = x.id === 'walk'
          ? 'Walking costs nothing. If you\'d rather not walk the whole way, the'
          : 'There\'s also a cheaper option worth knowing about — the';
        cheapNote = `<div class="spc-note">${lead} next cheapest option is ${cheapest.icon} <b>${esc(cheapest.name)}</b>${stopBit} at ≈ ₹${cheapest.cost} (${fmtMin(cheapest.min)}).</div>`;
      }
    }
    return {
      html: `<div class="spc-title">${A.name === 'Your location' ? 'To ' + esc(disp(B)) : esc(disp(A)) + ' to ' + esc(disp(B))}</div><div class="spc-sub">${BASIS[basis](hour)}</div>
        ${missing ? `<div class="spc-note">No ${o.modes.join('/')} option found for this trip, so this is the best alternative.</div>` : ''}${card(x)}${cheapNote}
        <button class="spc-act" data-map="1">Set as my route →</button>`,
      chips: [...others, `Is ${disp(B)} safe now?`]
    };
  }

  function nearestList(P, type, n) {
    const seen = new Set();
    return NODES.filter(x => x.type === type).map(x => ({ x, d: hav(P, x) })).sort((a, b) => a.d - b.d).filter(r => !seen.has(r.x.name) && seen.add(r.x.name)).slice(0, n);
  }
  const destBtn = (lat, lng, name) => `<button class="spc-act" data-dest="${lat},${lng},${esc(name)}">Set as destination</button>`;
  async function answerNearest(o) {
    const P = await resolve(o.place || 'me');
    if (!P) return { html: o.place && !ME_RX.test(o.place) ? `I couldn't locate <b>${esc(o.place)}</b>.` : 'I need your location for that. Please allow location access, or name a place.' };
    const hour = o.hour != null ? o.hour : new Date().getHours(), night = isNight(hour), types = o.types.length ? o.types : ['train', 'metro', 'bus'], rows = [];
    for (const t of types) {
      if (t === 'bus') {
        const bq = r => `[out:json][timeout:15];node(around:${r},${P.lat},${P.lng})[highway=bus_stop][name];out 60;`;
        const bBackup = (typeof spFallbackPlaces === 'function') ? spFallbackPlaces('bus stop', P.lat, P.lng, 10).catch(() => []) : Promise.resolve([]);
        let els = null;
        for (const p of [700, 1800, 4500].map(r => overpass(bq(r)))) { const e = await p; if (e && e.length) { els = e; break; } }
        if (!els) els = await bBackup;
        const n = (els || []).filter(e => e.tags && e.tags.name).map(e => ({ name: e.tags.name, lat: e.lat, lng: e.lon, d: hav(P, { lat: e.lat, lng: e.lon }) })).sort((a, b) => a.d - b.d)[0];
        if (n) rows.push({ label: 'Bus stop', name: n.name, sub: '', d: n.d, lat: n.lat, lng: n.lng });
      } else { const r = nearestList(P, t, 1)[0]; if (r) rows.push({ label: t === 'metro' ? 'Metro' : 'Local train', name: r.x.name, sub: r.x.line.name, d: r.d, lat: r.x.lat, lng: r.x.lng }); }
    }
    if (!rows.length) return { html: 'I couldn\'t find a station or stop nearby.' };
    // When more than one type was fetched (e.g. a "train station" search that also pulled
    // in the nearest metro), rank by a mix of distance and safety rather than just the
    // fixed train/metro/bus order — so the actually-better option is shown first.
    rows.forEach(r => { r.risk = riskOf(line(P, r, 6), hour); });
    if (rows.length > 1) rows.sort((a, b) => (a.d / 1000 + (a.risk ?? 5) * 0.4) - (b.d / 1000 + (b.risk ?? 5) * 0.4));
    const html = rows.map(r => { const a = access(r.d, P, night);
      return `<div class="spc-opt"><div class="spc-oh"><b>${esc(r.name)}</b><span class="spc-sub" style="margin:0">${r.label}${r.sub ? ' · ' + esc(r.sub) : ''}</span></div>
        <div class="spc-om">${(r.d / 1000).toFixed(2)} km · ${a.how} ${fmtMin(a.min)}${a.cost ? ' · ≈ ₹' + a.cost : ''}</div>
        <div>${riskChip(r.risk)}</div>${destBtn(r.lat, r.lng, r.name)}</div>`; }).join('');
    S.last = { A: P, B: P }; S.lastPlace = P;
    return { html: `<div class="spc-title">Nearest to ${P.name === 'Your location' ? 'you' : esc(P.name)}</div>${html}` };
  }
  // Nearest hospital / clinic / pharmacy / ATM. Rings of growing size are queried IN PARALLEL
  // and the smallest ring with results wins — so the closest places come back quickly, rather
  // than one big query that returns an arbitrary handful (Overpass doesn't order by distance)
  // or one that takes ages. Everything is then sorted by real distance.
  const AMENITY = {
    hospital: { label: 'hospitals', filter: '[amenity=hospital]', icon: '🏥' },
    clinic:   { label: 'clinics', filter: '[amenity~"clinic|doctors"]', icon: '🩺' },
    pharmacy: { label: 'pharmacies', filter: '[amenity=pharmacy]', icon: '💊' },
    atm:      { label: 'ATMs', filter: '[amenity=atm]', icon: '🏧' },
    bank:     { label: 'banks', filter: '[amenity=bank]', icon: '🏦' },
    park:     { label: 'parks', filter: '[leisure=park]', icon: '🌳' },
    restaurant: { label: 'restaurants', filter: '[amenity~"restaurant|cafe|fast_food"]', icon: '🍽️' },
    hotel:    { label: 'hotels', filter: '[tourism~"hotel|guest_house"]', icon: '🏨' },
    mall:     { label: 'malls', filter: '[shop~"mall|supermarket"]', icon: '🛒' },
    beach:    { label: 'beaches', filter: '[natural=beach]', icon: '🏖️' },
    'post office': { label: 'post offices', filter: '[amenity=post_office]', icon: '📮' },
  };
  async function answerAmenity(o) {
    const cfg = AMENITY[o.kind] || AMENITY.hospital;
    const P = await resolve(o.place || 'me');
    if (!P) return { html: 'I need your location for that. Please allow location access, or name a place.' };
    S.lastPlace = P;
    const q = r => `[out:json][timeout:15];(node${cfg.filter}(around:${r},${P.lat},${P.lng});way${cfg.filter}(around:${r},${P.lat},${P.lng}););out center 60;`;
    // Backup source (Photon/Nominatim) runs alongside the main map query, so a slow or down
    // Overpass server never leaves the person without an answer.
    const backup = (typeof spFallbackPlaces === 'function') ? spFallbackPlaces(o.kind, P.lat, P.lng, 30).catch(() => []) : Promise.resolve([]);
    const rings = [1500, 4000, 10000].map(r => overpass(q(r)));
    let els = null;
    for (const p of rings) { const e = await p; if (e && e.length) { els = e; break; } }
    if (!els) { // nothing close from the main server — merge backup + a wide ring; nearest wins after the sort
      const [bk, wide] = await Promise.all([backup, overpass(q(25000))]);
      els = [...(wide || []), ...bk];
    }
    const night = isNight(new Date().getHours());
    const seen = [];
    (els || []).forEach(e => {
      const lat = e.lat ?? (e.center && e.center.lat), lng = e.lon ?? (e.center && e.center.lon); if (lat == null) return;
      const name = (e.tags && (e.tags.name || e.tags['name:en'])) || null; if (!name && o.kind !== 'atm') return; // unnamed hospital entries aren't useful
      const c = { name: name || 'ATM', lat, lng, d: hav(P, { lat, lng }), phone: e.tags && (e.tags.phone || e.tags['contact:phone']) };
      if (!seen.find(k => hav(k, c) < 120 && k.name.toLowerCase() === c.name.toLowerCase())) seen.push(c);
    });
    seen.sort((a, b) => a.d - b.d);
    const list = seen.slice(0, 3);
    if (!list.length) return { html: 'No ' + cfg.label + ' found within 25 km of ' + (P.name === 'Your location' ? 'you' : esc(P.name)) + '.' };
    const far = list[0].d > 5000 ? '<div class="spc-note">Nothing very close by — this is the nearest one I could find.</div>' : '';
    return { html: `<div class="spc-title">Nearest ${cfg.label} to ${P.name === 'Your location' ? 'you' : esc(P.name)}</div>${far}` + list.map(r => { const a = access(r.d, P, night);
      return `<div class="spc-opt"><div class="spc-oh"><b>${cfg.icon} ${esc(r.name)}</b></div><div class="spc-om">${(r.d / 1000).toFixed(2)} km · ${a.how} ${fmtMin(a.min)}${a.cost ? ' · ≈ ₹' + a.cost : ''}${r.phone ? ' · ' + esc(r.phone) : ''}</div>${destBtn(r.lat, r.lng, r.name)}</div>`; }).join('') };
  }
  async function answerPolice(o) {
    const P = await resolve(o.place || 'me');
    if (!P) return { html: 'I need your location for that. Please allow location access, or name a place.' };
    S.lastPlace = P;
    // Widen the search ring until a station actually turns up — a fixed 3 km radius
    // means sparser areas (or a flaky single query) too often come back empty and fall
    // straight through to "just call the emergency number", which isn't the answer to
    // "where is my nearest police station". We keep going out to 20 km if we truly have to.
    const RADII = [2000, 5000, 12000, 20000];
    const pq = radius => `[out:json][timeout:20];(node(around:${radius},${P.lat},${P.lng})[amenity=police];way(around:${radius},${P.lat},${P.lng})[amenity=police];relation(around:${radius},${P.lat},${P.lng})[amenity=police];);out center 60;`;
    // All rings fire at once; the smallest ring that has results wins (fast AND nearest).
    const ringPromises = RADII.map(r => overpass(pq(r)));
    const policeBackup = (typeof spFallbackPlaces === 'function') ? spFallbackPlaces('police', P.lat, P.lng, 30).catch(() => []) : Promise.resolve([]);
    let els = null, usedRadius = RADII[0];
    for (let i = 0; i < RADII.length; i++) { const e = await ringPromises[i]; usedRadius = RADII[i]; if (e && e.length) { els = e; break; } if (e && !els) els = e; }
    if (!els || !els.length) { const bk = await policeBackup; els = [...(els || []), ...bk]; }
    let list = (els || []).map(e => { const lat = e.lat ?? (e.center && e.center.lat), lng = e.lon ?? (e.center && e.center.lon); return lat == null ? null : { name: (e.tags && e.tags.name) || 'Police station', phone: e.tags && (e.tags.phone || e.tags['contact:phone']), lat, lng, d: hav(P, { lat, lng }) }; })
      .filter(Boolean).sort((a, b) => a.d - b.d), night = isNight(new Date().getHours());
    // OSM often lists the same station more than once (a node plus its building, or a name variant) — keep one per location
    const uniq = [];
    for (const c of list) {
      const dup = uniq.find(k => hav(k, c) < 250 || k.name.toLowerCase() === c.name.toLowerCase());
      if (!dup) uniq.push(c);
      else if (dup.name === 'Police station' && c.name !== 'Police station') { dup.name = c.name; dup.phone = dup.phone || c.phone; }
      else dup.phone = dup.phone || c.phone;
    }
    list = uniq.slice(0, 3);
    if (!list.length) return { html: (els ? `No police station found even within ${(usedRadius / 1000).toFixed(0)} km — that\'s unusual, please retry in a moment.` : 'I couldn\'t load police stations right now — the map data service may be slow. Please try again.') + ' In an emergency dial <b>112</b>.' };
    const farNote = list[0].d > 5000 ? `<div class="spc-note">Nothing very close by — this is the nearest one we could find.</div>` : '';
    return { html: `<div class="spc-title">Nearest police stations</div>${farNote}` + list.map(r => { const a = access(r.d, P, night);
      return `<div class="spc-opt"><div class="spc-oh"><b>${esc(r.name)}</b></div><div class="spc-om">${(r.d / 1000).toFixed(2)} km · ${a.how} ${fmtMin(a.min)}${r.phone ? ' · ' + esc(r.phone) : ''}</div>${destBtn(r.lat, r.lng, r.name)}</div>`; }).join('') + '<div class="spc-note">In an emergency dial 112.</div>' };
  }
  async function answerSafety(o) {
    const P = await resolve(o.place);
    if (!P) return { html: o.place && !ME_RX.test(o.place) ? `I couldn't locate <b>${esc(o.place)}</b>. Try a neighbourhood, station or landmark name.` : 'I need your location for that. Please allow location access, or name a place.' };
    const cur = o.hour != null ? o.hour : new Date().getHours();
    const ring = [P, ...[[.002, 0], [-.002, 0], [0, .002], [0, -.002]].map(d => ({ lat: P.lat + d[0], lng: P.lng + d[1] }))];
    const slots = { Morning: 8, Afternoon: 13, Evening: 18, Night: 22 }, sc = Object.entries(slots).map(([k, h]) => [k, riskOf(ring, h)]);
    if (sc[0][1] == null) return { html: 'Safety data is still loading. Please try again in a moment.' };
    const nowRisk = riskOf(ring, cur);
    let zones = []; try { zones = crimeZones.filter(z => hav(P, z) <= (z.radius || 200) + 300).sort((a, b) => b.baseRisk - a.baseRisk).slice(0, 2); } catch (e) {}
    const col = v => { try { return riskLabel(v).color; } catch (e) { return '#f59e0b'; } };
    const bars = sc.map(([k, v]) => `<div class="spc-bar"><span>${k}</span><i style="width:${v * 10}%;background:${col(v)}"></i><em>${v.toFixed(1)}</em></div>`).join('');
    const concerns = zones.length ? `<div class="spc-note">Recorded concerns nearby: ${zones.map(z => `<b>${esc(z.name)}</b>${z.types && z.types.length ? ' (' + esc(z.types.slice(0, 3).join(', ')) + ')' : ''}`).join('; ')}</div>` : '';
    const here = P.name === 'Your location';
    S.lastPlace = P; // lets a bare follow-up like "fastest" mean "fastest route here"
    return {
      html: `<div class="spc-title">Safety ${here ? 'here' : 'around ' + esc(disp(P))}</div><div class="spc-sub">At ${fmtHour(cur)} ${riskChip(nowRisk)}</div>${bars}${concerns}
        ${isNight(cur) || nowRisk > 5 ? '<div class="spc-note">Prefer main roads, keep your phone charged, and share your live location with a trusted contact.</div>' : ''}`,
      chips: here ? ['Nearest police station from here'] : [`Go to ${disp(P)} from here`]
    };
  }

  // ───────────── Feeling unsafe: act first, then calm down ─────────────
  function answerCalm(o) {
    const tips = o.follow
      ? ['Do not go home or into a quiet lane. Head to a crowded, well-lit place: a shop, petrol pump, station or police station.', 'Change direction or cross the road once. If they are still behind you, call 112 straight away.', 'Stay on the phone with someone you trust and tell them exactly where you are.']
      : ['Move towards a well-lit, busy place: a shop, petrol pump, station, or anywhere with other people.', 'Call or message someone you trust and share your live location.', 'Keep your phone in your hand and trust your instincts.'];
    return {
      html: `<b>You're right to act on this feeling. Let's take it one step at a time.</b><ul class="spc-tips">${tips.map(t => `<li>${t}</li>`).join('')}</ul>
        <div class="spc-note">If you are in danger right now, call 112.</div>
        <button class="spc-act" data-sos="1">Send SOS alert</button> <button class="spc-act" data-breathe="1">Breathe with me</button>`,
      chips: ['Nearest police station from here', 'Emergency helpline numbers']
    };
  }

  // ───────────── Static answers ─────────────
  // Route-preference chips ("Fastest option" etc.) are rendered specially: tapping one
  // updates the SAME answer bubble in place (see box.addEventListener below) rather than
  // sending a whole new chat message, since the user is just changing which basis to sort
  // the same trip by — not asking a new question.
  const PREF_CHIP_SORT = { 'Safest option': 'safety', 'Fastest option': 'time', 'Cheapest option': 'cost' };
  const chipsHTML = list => `<div class="spc-chips">${list.map(q => PREF_CHIP_SORT[q]
    ? `<button data-pref="${PREF_CHIP_SORT[q]}">${esc(q)}</button>`
    : `<button data-q="${esc(q)}">${esc(q)}</button>`).join('')}</div>`;
  const START_CHIPS = ['Nearest police station from here', 'Is it safe here now?', 'Cheapest and fastest way to my nearest station', 'I feel unsafe', 'Emergency helpline numbers'];
  const WELCOME = { html: '', chips: START_CHIPS };
  const HELP = { html: '<b>Emergency numbers</b><ul class="spc-tips"><li><b>112</b> emergency (police, fire, ambulance)</li><li><b>100</b> Mumbai Police · <b>1091</b> women helpline</li><li><b>139</b> railways · <b>108</b> ambulance</li></ul>In danger now? Tap the red SOS button to alert your emergency contact with your live location.' };
  const TIMINGS = { html: '<b>Approximate service hours</b><ul class="spc-tips"><li>Local trains: about 4:00 AM to 1:00 AM (varies by station and direction)</li><li>Metro: about 5:30 AM to 11:30 PM (varies by line)</li></ul><div class="spc-note">Confirm in M-Indicator, Mumbai1 or Chalo.</div>' };
  const SAFETY_TIPS = { html: '<b>Travelling alone</b><ul class="spc-tips"><li>Local train: use the ladies\' compartment; late at night pick the one near the guard/RPF.</li><li>Cab/auto: check the plate, share trip status, avoid shared rides at night.</li><li>Walking: stay on main, well-lit roads and move to a busy place if unsure.</li></ul>', chips: ['Emergency helpline numbers'] };

  // ───────────── Understanding the question ─────────────
  function getHour(l) {
    let m = l.match(/(\d{1,2})(?::\d{2})?\s*(am|pm)\b/);
    if (m) { let h = +m[1] % 12; if (m[2] === 'pm') h += 12; return h; }
    if ((m = l.match(/\b([01]?\d|2[0-3]):[0-5]\d\b/))) return +m[1];
    if (/midnight|late night|after midnight/.test(l)) return 23;
    if (/tonight|night/.test(l)) return 22;
    if (/evening|after work/.test(l)) return 18;
    if (/afternoon/.test(l)) return 13;
    if (/morning/.test(l)) return 8;
    return null;
  }
  const MODE_RX = { walk: /\b(walk(ing)?|on foot)\b/, taxi: /\b(taxi|cab|uber|ola|auto|autos|rickshaw|drive|driving|by car)\b/, metro: /\bmetro\b/, train: /\b(local|locals|train|trains|railway)\b/, bus: /\b(bus|buses)\b/ };
  const TAIL = /\s+(?:by|via|using|on foot|at|in|during|around|after|before|when|if|for|tonight|right now|now|today|late night|midnight|please)\b.*$/;
  const cleanPlace = p => p.replace(TAIL, '').replace(/\s+(safe|safely|unsafe|tonight|now|today)$/, '').replace(/^(the|a|an)\s+/, '').replace(/[?!.,]+$/, '').trim();
  const cleanFrom = p => cleanPlace(p.replace(/^.*\b(?:go|get|travel|reach|commute|cost|costs|take|takes|far|long|much|distance|time|safe|safest|cheapest|fastest|quickest|way|route|options?|me)\s+(?:is\s+|it\s+|from\s+)?/, '').replace(/^(is|it)\s+/, ''));
  const NOISE = new Set('cheapest fastest safest quickest best shortest way route option options mode transport how what which why when who is the to go get reach travel take me i want need can do show tell directions direction navigate a an'.split(' '));
  const FILLER = { test: t => !t.split(' ').some(w => w && !NOISE.has(w)) };
  function parse(raw) {
    const l = raw.toLowerCase().replace(/\s+/g, ' ').trim().replace(/[?!]+$/, '');
    const o = { hour: getHour(l), modes: Object.keys(MODE_RX).filter(k => MODE_RX[k].test(l)), sort: /\b(cheap|cheapest|cost|fare|price|budget|how much|afford)/.test(l) ? 'cost' : /\b(safest|safe|safety|secure|unsafe|danger)/.test(l) ? 'safety' : /\b(far|distance|km|shortest)\b/.test(l) ? 'dist' : /\b(fast|fastest|quick|quickest|how long|duration|time)\b/.test(l) ? 'time' : null };
    if (/\b(helpline|emergency|police number|women helpline|sos number)\b/.test(l)) return { intent: 'help' };
    if (/(i'?m|i am|i feel|feeling|feel)\s+(so |very |really )?(unsafe|scared|afraid|anxious|nervous|uneasy|panick\w*|worried|frightened|threatened|uncomfortable)|follow(ing|ed)? me|being followed|stalk|harass|panic|calm (me|down)|not safe here|i need help/.test(l)) return { intent: 'calm', follow: /follow|stalk/.test(l) };
    // "nearest hospital / pharmacy / clinic / ATM" — previously nothing handled these, so
    // they fell through to a generic place lookup and came back far away or empty.
    {
      const AM = [['pharmacy', /\b(pharmacy|pharmacies|chemist|medical store)\b/], ['clinic', /\b(clinic|clinics)\b/], ['hospital', /\b(hospital|hospitals)\b/],
        ['atm', /\b(atms?)\b/], ['bank', /\b(banks?)\b/], ['park', /\b(parks?|garden)\b/], ['restaurant', /\b(restaurants?|cafes?|food)\b/],
        ['hotel', /\b(hotels?)\b/], ['mall', /\b(malls?|supermarkets?)\b/], ['beach', /\b(beach|beaches)\b/], ['post office', /\b(post office)\b/]];
      const hit = AM.find(([, rx]) => rx.test(l));
      if (hit && /\b(nearest|closest|nearby|near me|near|find|where)\b/.test(l) && !/\bfrom\b.+\bto\b/.test(l)) {
        const m2 = l.match(/(?:to|from|of|near|around|at)\s+(?!me\b|here\b)(.+)$/);
        return { intent: 'amenity', kind: hit[0], place: cleanPlace((m2 && m2[1]) || '') };
      }
    }
    if (/\b(police|chowki)\b/.test(l)) { const m = l.match(/(?:near(?:est)?|closest)\s+(?:police\s*(?:station|chowki)?)\s*(?:to|from|of|near|around|at)?\s*(.*)$/); return { intent: 'police', place: cleanPlace((m && m[1]) || '') }; }
    if (/\b(last|first)\s+(train|metro|local|bus)|timings?|schedule|service hours/.test(l)) return { intent: 'timings' };
    if (/(safety )?tips|advice|how (do i|to) stay safe|travel(l)?ing alone|precautions/.test(l)) return { intent: 'tips' };
    if (/^(hi|hello|hey|namaste|help|start|menu)\b/.test(l)) return { intent: 'welcome' };
    let m;
    if (/\b(nearest|closest|nearby|near)\b/.test(l) && /\b(station|stations|metro|railway|local|train|bus stop|bus stand)\b/.test(l) && (m = l.match(/(?:near(?:est)?|closest)\s+(?:(?:metro|railway|local|train|bus)\s*)*(?:stations?|stops?|stands?)?\s*(?:to|from|of|near|around|at)?\s*(.*)$/))) {
      const types = ['metro', 'train', 'bus'].filter(t => MODE_RX[t].test(l));
      // A "train/railway station" search should also surface the nearest metro as an
      // alternative — riders often want whichever rail option is nearest/safest, not
      // strictly suburban rail, and metro can be the better pick by both measures.
      if (types.includes('train') && !types.includes('metro') && !types.includes('bus')) types.push('metro');
      return { intent: 'nearest', ...o, place: cleanPlace(m[1].replace(/^(my|the)\s+(nearest\s+)?(station|stop)?\s*/, '') || ''), types };
    }
    const r2 = l.match(/(?:reach|get to|go to|going to|travel to|commute to)\s+(.+?)\s+from\s+(.+)$/), r1 = l.match(/\bfrom\s+(.+?)\s+(?:to|till|until)\s+(.+)$/), r3 = l.match(/^(.+?)\s+(?:to|→|->)\s+(.+)$/), r4 = l.match(/\b(?:is|to|reach|get to)\s+(.+?)\s+from\s+(.+)$/);
    let from, to;
    if (r2 || (r4 && !r1)) { const m2 = r2 || r4; to = cleanPlace(m2[1]); from = cleanPlace(m2[2]); }
    else if (r1) { from = cleanPlace(r1[1]); to = cleanPlace(r1[2]); }
    else if (r3 && !/^(how|what|which|why|when|who)$/.test(r3[1])) { from = cleanFrom(r3[1]); to = cleanPlace(r3[2]); if (!from || FILLER.test(from)) from = null; }
    else if ((m = l.match(/(?:^|\s)(?:reach|get to|go to|going to|travel to|commute to|directions? to|route to|way to|take me to|navigate to|towards)\s+(.+)$/)) || (m = l.match(/^to\s+(.+)$/))) to = cleanPlace(m[1]);
    if (to) return { intent: 'route', ...o, from: from || null, to }; // no start given -> live location
    if ((m = l.match(/^(?:starting |starts? )?from\s+(.+)$/))) return { intent: 'needDest', place: cleanPlace(m[1]) };
    if (/\b(safe|safety|unsafe|dangerous|secure|crime)\b/.test(l)) {
      const bad = /^(it|this|that|there|night|the night|evening|morning|afternoon|day|late night|midnight|to travel|travel|now|right now|\d.*)$/;
      const cands = [/\bis\s+(.+?)\s+(?:safe|unsafe|dangerous|secure)/, /(?:safety|safe|unsafe|crime|dangerous)\s+(?:in|at|around|near|of|for|on)\s+(.+)$/, /(?:in|at|around|near)\s+(.+?)\s+(?:safe|unsafe|safety)/, /\b(?:in|at|around|near)\s+(.+)$/];
      for (const rx of cands) { const x = l.match(rx); if (x) { const p = cleanPlace(x[1]); if (p && !bad.test(p)) return { intent: 'safety', ...o, place: p }; } }
      if (/\b(my|here|current|this area|me)\b/.test(l) || !S.ctx) return { intent: 'safety', ...o, place: 'me' };
    }
    if (o.sort || o.modes.length || o.hour != null) return (S.ctx || S.lastPlace) ? { intent: 'followup', ...o } : { intent: 'needDest' };
    if (l.split(' ').length <= 5 && /[a-z]/.test(l)) return { intent: 'place', ...o, place: cleanPlace(l) }; // a bare place name -> its safety data
    return { intent: 'unknown' };
  }

  async function llm(text) {
    const u = window.SP_CHAT_ENDPOINT; if (!u) return null;
    try {
      const anon = typeof SUPABASE_ANON !== 'undefined' ? SUPABASE_ANON : '';
      const r = await fetch(u, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + anon, apikey: anon }, body: JSON.stringify({ message: text, history: S.hist.slice(-6), hour: new Date().getHours() }) });
      if (!r.ok) return null; const d = await r.json(); return d.reply || null;
    } catch (e) { return null; }
  }
  async function handle(text) {
    const o = parse(text);
    switch (o.intent) {
      case 'help': return HELP;
      case 'calm': return answerCalm(o);
      case 'timings': return TIMINGS;
      case 'tips': return SAFETY_TIPS;
      case 'welcome': return WELCOME;
      case 'police': return answerPolice(o);
      case 'amenity': return answerAmenity(o);
      case 'nearest': return answerNearest(o);
      case 'safety': case 'place': return answerSafety(o);
      case 'route': return answerRoute(o);
      case 'followup': return answerRoute({ reuse: true, ...o });
      case 'needDest': return o.place
        ? { html: `Do you want to travel from <b>${esc(title(o.place))}</b> to a specific place, or see the safety of ${esc(title(o.place))}? Type a destination, or pick one.`, chips: [`Is ${title(o.place)} safe now?`] }
        : { html: 'Where would you like to go? Type a destination and I\'ll start from your current location.' };
    }
    const ai = await llm(text);
    if (ai) return { html: esc(ai).replace(/\n/g, '<br>') };
    return { html: 'Sorry, I didn\'t get that. Tell me where you want to go (e.g. “to Dadar”) or a place to check its safety.', chips: START_CHIPS };
  }

  // ───────────── UI ─────────────
  function build() {
    const css = document.createElement('style');
    css.textContent = `
#spc-fab{position:fixed;top:calc(68px + env(safe-area-inset-top));right:12px;z-index:950;width:48px;height:48px;border-radius:50%;border:none;background:var(--grad);color:#fff;font-size:1.35rem;cursor:pointer;box-shadow:0 4px 18px var(--teal-glow),0 4px 14px var(--shadow);display:flex;align-items:center;justify-content:center;transition:transform .2s}
#spc-fab:hover{transform:scale(1.08)}
#spc-box{position:fixed;right:12px;bottom:12px;z-index:1200;width:390px;max-width:calc(100vw - 24px);height:min(620px,calc(100dvh - 90px));background:var(--panel-bg,var(--card));border:1px solid var(--border);border-radius:18px;box-shadow:0 12px 40px var(--shadow);display:none;flex-direction:column;overflow:hidden;font-family:var(--font-b);color:var(--fg)}
#spc-box.open{display:flex}
.spc-h{display:flex;align-items:center;gap:.6rem;padding:.7rem .9rem;background:var(--grad-soft);border-bottom:1px solid var(--border)}
.spc-h b{font-family:var(--font-h);font-size:.98rem;flex:1}
.spc-h button{background:none;border:none;color:var(--muted);font-size:1.1rem;cursor:pointer;padding:.2rem .4rem}
#spc-msgs{flex:1;overflow-y:auto;padding:.8rem;display:flex;flex-direction:column;gap:.55rem;font-size:.82rem;line-height:1.45}
.spc-m{max-width:94%;padding:.5rem .72rem;border-radius:14px;word-wrap:break-word}
.spc-m.u{align-self:flex-end;background:var(--grad);color:#fff;border-bottom-right-radius:4px}
.spc-m.b{align-self:flex-start;background:var(--card2);border:1px solid var(--border);border-bottom-left-radius:4px;width:94%}
.spc-title{font-family:var(--font-h);font-weight:700;font-size:.92rem}.spc-sub{font-size:.72rem;color:var(--muted);margin:.15rem 0 .35rem}
.spc-opt{background:var(--card);border:1px solid var(--border);border-radius:11px;padding:.5rem .6rem;margin:.35rem 0}
.spc-oh{display:flex;align-items:center;gap:.4rem;flex-wrap:wrap}.spc-oi{font-size:1.05rem}
.spc-badge{font-size:.66rem;font-weight:700;background:var(--teal-glow);color:var(--teal);border-radius:20px;padding:.1rem .5rem;white-space:nowrap}
.spc-om{font-size:.76rem;margin:.25rem 0;color:var(--fg2)}
.spc-risk{display:inline-block;font-size:.68rem;font-weight:700;border:1px solid;border-radius:20px;padding:.05rem .5rem}
.spc-buslist{list-style:none;margin:.4rem 0 0;padding:0;font-size:.74rem;color:var(--fg2)}.spc-buslist li{margin:.3rem 0;line-height:1.7}
.spc-steps{margin:.4rem 0 0 1.1rem;font-size:.72rem;color:var(--fg2)}.spc-note{font-size:.68rem;color:var(--muted);margin-top:.3rem}
.spc-tips{margin:.3rem 0 .4rem 1.1rem;font-size:.74rem;color:var(--fg2)}.spc-tips li{margin:.15rem 0}
.spc-act{background:var(--teal-glow);color:var(--teal);border:1px solid var(--border);border-radius:9px;padding:.32rem .7rem;font-size:.72rem;font-weight:700;cursor:pointer;margin-top:.4rem;font-family:inherit}
.spc-bar{display:flex;align-items:center;gap:.4rem;font-size:.7rem;margin:.2rem 0}.spc-bar span{width:4.6rem}.spc-bar i{display:block;height:7px;border-radius:5px}.spc-bar em{font-style:normal;color:var(--muted)}
.spc-chips{display:flex;flex-wrap:wrap;gap:.3rem;margin-top:.5rem}
.spc-chips button{background:var(--card);color:var(--teal);border:1px solid var(--border);border-radius:20px;padding:.28rem .65rem;font-size:.7rem;cursor:pointer;font-family:inherit;text-align:left}
.spc-chips button:hover{background:var(--teal-glow)}
.spc-breath{display:flex;flex-direction:column;align-items:center;gap:.7rem;padding:.8rem 0}.spc-bc{width:64px;height:64px;border-radius:50%;background:var(--grad);animation:spc-breathe 16s ease-in-out 4}.spc-bl{font-weight:700;color:var(--teal)}@keyframes spc-breathe{0%{transform:scale(1)}25%,50%{transform:scale(1.6)}75%,100%{transform:scale(1)}}
.spc-typing{align-self:flex-start;color:var(--muted);font-size:.75rem}
.spc-in{display:flex;gap:.4rem;padding:.6rem;border-top:1px solid var(--border)}
.spc-in input{flex:1;background:var(--input-bg);border:1px solid var(--border);border-radius:20px;padding:.5rem .85rem;color:var(--fg);font-size:.82rem;font-family:inherit;outline:none}
.spc-in input:focus{border-color:var(--teal)}
.spc-in button{background:var(--grad);border:none;color:#fff;border-radius:50%;width:38px;height:38px;cursor:pointer;font-size:1rem}
@media(max-width:640px){#spc-box{right:0;left:0;bottom:0;width:100%;max-width:100%;height:82dvh;border-radius:18px 18px 0 0}}`;
    document.head.appendChild(css);

    const fab = document.createElement('button');
    fab.id = 'spc-fab'; fab.title = 'Travel & safety assistant'; fab.setAttribute('aria-label', 'Open travel and safety assistant'); fab.textContent = '💬';
    const box = document.createElement('div');
    box.id = 'spc-box'; box.setAttribute('role', 'dialog'); box.setAttribute('aria-label', 'Mumbai travel and safety assistant');
    box.innerHTML = `<div class="spc-h"><span style="font-size:1.3rem">🤖</span><b>Travel &amp; Safety Assistant</b><button data-x="close" aria-label="Close">✕</button></div>
      <div id="spc-msgs"></div><div class="spc-in"><input id="spc-input" type="text" placeholder="Where to? Or type a place to check safety" autocomplete="off" maxlength="200"/><button id="spc-send" aria-label="Send">➤</button></div>`;
    document.body.append(fab, box);
    const msgs = $('#spc-msgs'), input = $('#spc-input');

    const add = (cls, html) => { const d = document.createElement('div'); d.className = 'spc-m ' + cls; d.innerHTML = html; msgs.appendChild(d); msgs.scrollTop = msgs.scrollHeight; return d; };
    const botSay = r => add('b', r.html + (r.chips ? chipsHTML(r.chips) : ''));
    async function send(text) {
      text = text.trim(); if (!text) return;
      add('u', esc(text)); input.value = ''; S.hist.push({ role: 'user', content: text });
      const t = add('spc-typing', 'Thinking…');
      try { const r = await handle(text); t.remove(); botSay(r); S.hist.push({ role: 'assistant', content: r.html.replace(/<[^>]+>/g, ' ').slice(0, 400) }); }
      catch (e) { console.error('[chatbot]', e); t.remove(); botSay({ html: 'Sorry, something went wrong. Please try again.' }); }
    }
    function breathe() { // 4-4-4-4 box breathing, ~1 minute
      const d = add('b', `<div class="spc-breath"><div class="spc-bc"></div><div class="spc-bl">Breathe in</div></div><div class="spc-note">In for 4, hold 4, out for 4, hold 4. Only while you are in a safe spot.</div><button class="spc-act" data-bstop="1">Stop</button>`);
      const lab = d.querySelector('.spc-bl'), ph = ['Breathe in', 'Hold', 'Breathe out', 'Hold']; let i = 0;
      d._t = setInterval(() => { i++; if (i >= 16) { clearInterval(d._t); lab.textContent = 'Well done. Repeat any time you need.'; d.querySelector('.spc-bc').style.animation = 'none'; return; } lab.textContent = ph[i % 4]; }, 4000);
    }
    const toggle = open => { box.classList.toggle('open', open); fab.style.display = open ? 'none' : 'flex'; if (open) { if (!msgs.children.length) { botSay(WELCOME); myLoc(); } input.focus(); } };
    fab.onclick = () => toggle(true);
    box.addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.x === 'close') toggle(false);
      else if (b.dataset.pref) {
        // Change the sort basis of the SAME trip, updating this same bubble in place —
        // not a new question, so no new user/bot message pair is added.
        const w = b.closest('.spc-m'); if (!w) return;
        b.disabled = true; b.textContent = '…';
        answerRoute({ reuse: true, sort: b.dataset.pref, modes: [], hour: null })
          .then(r => { w.innerHTML = r.html + (r.chips ? chipsHTML(r.chips) : ''); })
          .catch(() => { b.disabled = false; });
      }
      else if (b.dataset.q) send(b.dataset.q);
      else if (b.dataset.breathe) breathe();
      else if (b.dataset.bstop) { const w = b.closest('.spc-m'); clearInterval(w._t); w.remove(); }
      else if (b.dataset.sos) { if (typeof openSOS === 'function') { toggle(false); openSOS(); } else botSay({ html: 'Please tap the red SOS button on the map, or call <b>112</b> now.' }); }
      else if (b.dataset.dest && typeof pickPlace === 'function') {
        const [la, ln, ...n] = b.dataset.dest.split(',');
        pickPlace('to', la, ln, n.join(','), '📍');
        // Setting a destination here should behave exactly like tapping "Find Safest Route":
        // fill in a start point (current location, unless one is already on the map) and run it.
        (async () => {
          if (typeof fromCoords === 'undefined' || !fromCoords) { const me = await myLoc(); if (me) pickPlace('from', me.lat, me.lng, 'Your location', '📍'); }
          toggle(false);
          if (typeof findRoutes === 'function') findRoutes();
        })();
      }
      else if (b.dataset.map && S.last && typeof pickPlace === 'function') {
        pickPlace('from', S.last.A.lat, S.last.A.lng, S.last.A.name + ', Mumbai', '📍');
        pickPlace('to', S.last.B.lat, S.last.B.lng, S.last.B.name + ', Mumbai', '📍');
        toggle(false); if (typeof findRoutes === 'function') findRoutes();
      }
    });
    $('#spc-send').onclick = () => send(input.value);
    input.addEventListener('keydown', e => { if (e.key === 'Enter') send(input.value); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && box.classList.contains('open')) toggle(false); });
  }

  window.SPChatEngine = { parse, handle, transit, resolve, buildOptions, pick, NODES };
  if (typeof document !== 'undefined' && document.body) build();
})();
