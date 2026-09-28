// ============================================================
//  Backup source for "nearest X" lookups.
//  The Overpass map servers are free/public and sometimes slow or
//  down; when that happens the nearby-places list and the chatbot
//  used to come back empty. This queries two OTHER free services
//  (Photon and Nominatim, both OpenStreetMap-based) so places are
//  still found. Results are returned in the same shape Overpass
//  uses ({lat, lon, tags:{name,...}}) so callers can mix them.
// ============================================================
(function () {
  // key -> { term: search word, tags: Photon osm_tag filters (each queried separately) }
  const KINDS = {
    'station':     { term: 'station',     tags: ['railway:station', 'station:subway', 'railway:halt'] },
    'hospital':    { term: 'hospital',    tags: ['amenity:hospital'] },
    'clinic':      { term: 'clinic',      tags: ['amenity:clinic', 'amenity:doctors'] },
    'pharmacy':    { term: 'pharmacy',    tags: ['amenity:pharmacy'] },
    'atm':         { term: 'atm',         tags: ['amenity:atm'] },
    'park':        { term: 'park',        tags: ['leisure:park'] },
    'bank':        { term: 'bank',        tags: ['amenity:bank'] },
    'beach':       { term: 'beach',       tags: ['natural:beach'] },
    'post office': { term: 'post office', tags: ['amenity:post_office'] },
    'mall':        { term: 'mall',        tags: ['shop:mall'] },
    'hotel':       { term: 'hotel',       tags: ['tourism:hotel'] },
    'police':      { term: 'police',      tags: ['amenity:police'] },
    'bus stop':    { term: 'bus stop',    tags: ['highway:bus_stop'] },
    'restaurant':  { term: 'restaurant',  tags: ['amenity:restaurant', 'amenity:cafe'] },
  };

  async function getJSON(url, ms) {
    const c = new AbortController(), t = setTimeout(() => c.abort(), ms);
    try { const r = await fetch(url, { signal: c.signal }); return r.ok ? await r.json() : null; }
    catch (e) { return null; } finally { clearTimeout(t); }
  }

  const rad = d => d * Math.PI / 180;
  function distM(aLat, aLng, bLat, bLng) {
    const R = 6371000, dLa = rad(bLat - aLat), dLo = rad(bLng - aLng);
    const h = Math.sin(dLa / 2) ** 2 + Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLo / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }

  async function photon(kind, lat, lng) {
    const jobs = kind.tags.map(tag => getJSON(
      `https://photon.komoot.io/api/?q=${encodeURIComponent(kind.term)}&lat=${lat}&lon=${lng}&limit=40&lang=en&location_bias_scale=0.8&osm_tag=${encodeURIComponent(tag)}`, 7000));
    const out = [];
    (await Promise.all(jobs)).forEach(d => ((d && d.features) || []).forEach(f => {
      const c = f.geometry && f.geometry.coordinates; if (!c) return;
      const p = f.properties || {};
      out.push({ lat: c[1], lon: c[0], tags: { name: p.name || '', 'addr:street': p.street || '', 'addr:suburb': p.district || p.suburb || '', 'addr:city': p.city || '' } });
    }));
    return out;
  }

  async function nominatim(kind, lat, lng) {
    // Expanding bounded boxes (~5, 15, 30 km) so the closest ring with results wins.
    for (const d of [0.02, 0.045, 0.09, 0.18, 0.27]) { // ~2, 5, 10, 20, 30 km
      const vb = `${lng - d},${lat + d},${lng + d},${lat - d}`;
      const data = await getJSON(`https://nominatim.openstreetmap.org/search?format=jsonv2&q=${encodeURIComponent(kind.term)}&viewbox=${vb}&bounded=1&limit=40&addressdetails=1`, 8000);
      if (data && data.length) return data.map(x => ({ lat: parseFloat(x.lat), lon: parseFloat(x.lon), tags: { name: x.name || (x.display_name || '').split(',')[0], 'addr:suburb': (x.address && (x.address.suburb || x.address.neighbourhood)) || '', 'addr:city': (x.address && (x.address.city || x.address.town)) || '' } }));
    }
    return [];
  }

  // Returns Overpass-shaped elements, nearest first, or [] if neither service had anything.
  window.spFallbackPlaces = async function (kindKey, lat, lng, maxKm) {
    const kind = KINDS[kindKey]; if (!kind) return [];
    maxKm = maxKm || 30;
    const keep = els => els.filter(e => e.tags && e.tags.name && isFinite(e.lat) && isFinite(e.lon) && distM(lat, lng, e.lat, e.lon) <= maxKm * 1000)
      .sort((a, b) => distM(lat, lng, a.lat, a.lon) - distM(lat, lng, b.lat, b.lon));
    // Both run at once; use whichever has results (Photon first, as it's biased to your location).
    const [ph, nm] = await Promise.all([photon(kind, lat, lng).catch(() => []), nominatim(kind, lat, lng).catch(() => [])]);
    return keep([...ph, ...nm]); // merged, nearest first — never let a far Photon hit outrank a close Nominatim one
  };
})();
