// ============================================================
//  SAFETY PATH – Mumbai Crime Data Module
//
//  Data sources & methodology:
//  - Mumbai city-wide crime totals: OpenCity / Mumbai Police 2023
//  - Santacruz West zones: OSM road classification + neighbourhood
//    type (slum pocket vs residential vs commercial) + known
//    environmental risk factors (lighting, isolation, crowd density)
//  - All other Mumbai zones: publicly known risk profiles
//
//  Data tags per zone:
//    "verified"  — backed by Mumbai Police / OpenCity statistics
//    "osm"       — derived from OpenStreetMap road/area type
//    "inferred"  — based on neighbourhood characteristics & local knowledge
//
//  TO REPLACE WITH REAL DATA:
//  1. Load actual crime records into Firestore 'crimeData' collection
//  2. Replace getCrimeZones() to query Firestore instead of returning
//     the static array below.
//  3. The rest of the scoring logic (getRiskScore, getTimeSlot) stays
//     the same — no other files need to change.
//
//  LAST UPDATED: 2025 — Santacruz West granular zones added (v2)
// ============================================================

// Time slot classification
function getTimeSlot(hour) {
  if (hour >= 5  && hour < 11) return 'morning';
  if (hour >= 11 && hour < 17) return 'afternoon';
  if (hour >= 17 && hour < 21) return 'evening';
  return 'night';
}

// Risk multiplier per time slot
const TIME_MULTIPLIERS = {
  morning:   0.5,   // Relatively safe
  afternoon: 0.6,
  evening:   1.2,   // Rising risk
  night:     2.0    // Highest risk
};

// ── Mock Mumbai crime zones ────────────────────────────────────
// Each zone has: name, lat, lng, radius (metres), base risk (0-10),
// crime types, and per-slot overrides (optional)

// ============================================================
// Replace the old getCrimeZones() in js/crime-data.js with this.
// Delete window.MUMBAI_CRIME_ZONES entirely once migrated —
// it's now in Supabase.
//
// Speed strategy:
// - Zones don't change every second, so we cache in memory for
//   the page session AND in sessionStorage so a reload within
//   the same tab session doesn't re-fetch.
// - Fetch is a single flat query (fast even at tens of thousands
//   of rows) rather than one query per street.
// - Cache TTL below controls how "fresh" data is vs how many
//   reads you burn on Supabase's free tier.
// ============================================================

const ZONE_CACHE_KEY = 'sp_crime_zones_cache_v1';
const ZONE_CACHE_TTL_MS = 15 * 60 * 1000; // 15 min

let _zoneMemoryCache = null;

async function getCrimeZones() {
  // 1. In-memory (fastest, survives across calls in same page load)
  if (_zoneMemoryCache) return _zoneMemoryCache;

  // 2. sessionStorage (survives reloads in same tab)
  try {
    const cached = sessionStorage.getItem(ZONE_CACHE_KEY);
    if (cached) {
      const { ts, zones } = JSON.parse(cached);
      if (Date.now() - ts < ZONE_CACHE_TTL_MS) {
        _zoneMemoryCache = zones;
        return zones;
      }
    }
  } catch (e) { /* sessionStorage unavailable — ignore, fall through */ }

  // 3. Fetch from Supabase
  const { data, error } = await window.supabase
    .from('crime_zones')
    .select('name, area, lat, lng, radius, base_risk, night_override, types, source, is_safe_zone');

  if (error) {
    console.error('Failed to load crime zones from Supabase:', error);
    return _zoneMemoryCache || []; // fail soft with whatever we last had
  }

  // Map DB column names -> the field names the rest of the app expects
  const zones = data.map(r => ({
    name: r.name,
    area: r.area,
    lat: r.lat,
    lng: r.lng,
    radius: r.radius,
    baseRisk: r.base_risk,
    nightOverride: r.night_override,
    types: r.types,
    source: r.source
  }));

  _zoneMemoryCache = zones;
  try {
    sessionStorage.setItem(ZONE_CACHE_KEY, JSON.stringify({ ts: Date.now(), zones }));
  } catch (e) { /* storage full or disabled — non-fatal */ }

  return zones;
}

// Call this after inserting a new street via your admin/report UI
// so the change shows up without waiting for the TTL to expire.
function invalidateZoneCache() {
  _zoneMemoryCache = null;
  try { sessionStorage.removeItem(ZONE_CACHE_KEY); } catch (e) {}
}

// Example: adding a new street becomes a DB insert, not a code edit
async function addStreetZone({ name, area, lat, lng, radius, baseRisk, nightOverride, types, source }) {
  const { error } = await window.supabase.from('crime_zones').insert([{
    name, area, lat, lng,
    radius: radius || 200,
    base_risk: baseRisk,
    night_override: nightOverride || null,
    types: types || [],
    source: source || 'inferred'
  }]);
  if (error) throw error;
  invalidateZoneCache();
}


// ── Point-in-zone check (Haversine) ──────────────────────────
function haversineDistance(lat1, lng1, lat2, lng2) {
  const R = 6371000; // metres
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat/2)**2 +
            Math.cos(lat1*Math.PI/180) * Math.cos(lat2*Math.PI/180) *
            Math.sin(dLng/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

// ── Get risk score for a lat/lng point at a given hour ────────
function getRiskScore(lat, lng, hour, zones) {
  const slot = getTimeSlot(hour);
  const mult = TIME_MULTIPLIERS[slot];
  let maxRisk = 1.0;
  // Pre-compute cosine of latitude once for fast lng threshold
  const cosLat = Math.cos(lat * Math.PI / 180);

  for (const zone of zones) {
    const r = zone.radius || 200;
    // Bbox pre-filter: skip zones whose centre is clearly out of range
    // 1 deg lat ≈ 111,000 m; use 90,000 for safety margin
    if (Math.abs(zone.lat - lat) > r / 90000) continue;
    if (Math.abs(zone.lng - lng) > r / (90000 * cosLat + 0.0001)) continue;

    const dist = haversineDistance(lat, lng, zone.lat, zone.lng);
    if (dist <= r) {
      let base = zone.baseRisk;
      if ((slot === 'night' || slot === 'evening') && zone.nightOverride) {
        base = zone.nightOverride;
      }
      const proximity = 1 - (dist / r) * 0.4;
      const risk = base * proximity * mult;
      if (risk > maxRisk) maxRisk = risk;
    }
  }
  return Math.min(maxRisk, 10);
}

// ── Score a full route (array of points) ─────────────────────
// Accepts both Leaflet {lat, lng} objects and Google LatLng-style
// objects with .lat() / .lng() methods
function scoreRoute(pathPoints, hour, zones) {
  if (!pathPoints || pathPoints.length === 0) return 10;
  let total = 0;
  for (const pt of pathPoints) {
    const lat = typeof pt.lat === 'function' ? pt.lat() : pt.lat;
    const lng = typeof pt.lng === 'function' ? pt.lng() : pt.lng;
    total += getRiskScore(lat, lng, hour, zones);
  }
  return total / pathPoints.length;
}

// ── Risk label + colour ────────────────────────────────────────
function riskLabel(score) {
  if (score < 2.5) return { label: 'Very Safe',    color: '#00c9a7', bg: 'rgba(0,201,167,0.12)',  dot: '#00c9a7' };
  if (score < 4.5) return { label: 'Mostly Safe',  color: '#86efac', bg: 'rgba(134,239,172,0.10)', dot: '#86efac' };
  if (score < 6.0) return { label: 'Moderate Risk',color: '#f59e0b', bg: 'rgba(245,158,11,0.12)', dot: '#f59e0b' };
  if (score < 7.5) return { label: 'High Risk',    color: '#f97316', bg: 'rgba(249,115,22,0.12)', dot: '#f97316' };
  return               { label: 'Danger Zone',  color: '#ef4444', bg: 'rgba(239,68,68,0.12)',  dot: '#ef4444' };
}

// ── Heatmap data for Google Maps Visualization API ───────────
// Returns array of {location: google.maps.LatLng, weight: number}
function getHeatmapData(hour, zones) {
  const slot = getTimeSlot(hour);
  const mult = TIME_MULTIPLIERS[slot];
  return zones.map(zone => {
    let base = zone.baseRisk;
    if ((slot === 'night' || slot === 'evening') && zone.nightOverride) base = zone.nightOverride;
    return {
      location: new google.maps.LatLng(zone.lat, zone.lng),
      weight: Math.min(base * mult, 10)
    };
  });
}
