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
window.MUMBAI_CRIME_ZONES = [
  // ── High Risk ──────────────────────────────────────────────
  { name: "Dharavi",         lat: 19.0400, lng: 72.8530, radius: 800,  baseRisk: 7.5, types: ["theft","assault"] },
  { name: "Kurla West",      lat: 19.0728, lng: 72.8826, radius: 600,  baseRisk: 7.0, types: ["theft","harassment"], nightOverride: 9.0 },
  { name: "Mankhurd",        lat: 19.0488, lng: 72.9329, radius: 700,  baseRisk: 7.2, types: ["assault","theft"] },
  { name: "Govandi",         lat: 19.0628, lng: 72.9249, radius: 650,  baseRisk: 7.0, types: ["theft","assault"] },
  { name: "Nalasopara East", lat: 19.4207, lng: 72.7986, radius: 800,  baseRisk: 7.5, types: ["harassment","theft"] },
  { name: "Nalasopara West", lat: 19.4195, lng: 72.7820, radius: 700,  baseRisk: 7.0, types: ["harassment","theft"] },
  { name: "Grant Road",      lat: 18.9642, lng: 72.8160, radius: 400,  baseRisk: 6.8, types: ["harassment","theft"], nightOverride: 8.5 },
  { name: "Kamathipura",     lat: 18.9665, lng: 72.8200, radius: 350,  baseRisk: 7.0, types: ["harassment"], nightOverride: 9.0 },
  { name: "Dockyard Road",   lat: 18.9611, lng: 72.8443, radius: 400,  baseRisk: 6.5, types: ["theft","assault"], nightOverride: 8.0 },
  { name: "Vikhroli East",   lat: 19.1072, lng: 72.9250, radius: 600,  baseRisk: 6.8, types: ["theft","assault"] },
  { name: "Bhandup West",    lat: 19.1463, lng: 72.9290, radius: 550,  baseRisk: 6.5, types: ["theft"] },
  { name: "Tilaknagar",      lat: 19.0520, lng: 72.9070, radius: 500,  baseRisk: 6.5, types: ["theft","harassment"] },

  // ── Medium Risk ─────────────────────────────────────────────
  { name: "Andheri East",    lat: 19.1136, lng: 72.8697, radius: 700,  baseRisk: 4.5, types: ["pickpocket","theft"] },
  { name: "Ghatkopar East",  lat: 19.0866, lng: 72.9086, radius: 600,  baseRisk: 4.8, types: ["theft","assault"] },
  { name: "Byculla",         lat: 18.9757, lng: 72.8356, radius: 500,  baseRisk: 5.2, types: ["theft","harassment"], nightOverride: 7.0 },
  { name: "Worli Naka",      lat: 19.0140, lng: 72.8177, radius: 400,  baseRisk: 4.0, types: ["theft"] },
  { name: "Chembur",         lat: 19.0620, lng: 72.8998, radius: 600,  baseRisk: 4.5, types: ["theft","assault"] },
  { name: "Thane Station",   lat: 19.1853, lng: 72.9740, radius: 500,  baseRisk: 4.8, types: ["pickpocket","theft"] },
  { name: "Vashi",           lat: 19.0771, lng: 72.9988, radius: 500,  baseRisk: 3.8, types: ["theft"], nightOverride: 5.5 },
  { name: "Panvel",          lat: 18.9894, lng: 73.1175, radius: 600,  baseRisk: 4.0, types: ["theft"] },
  { name: "Powai",           lat: 19.1174, lng: 72.9058, radius: 700,  baseRisk: 2.2, types: ["theft"] },
  { name: "Colaba",          lat: 18.9067, lng: 72.8147, radius: 500,  baseRisk: 2.8, types: ["pickpocket","theft"] },

  // ═══════════════════════════════════════════════════════════════
  //  GRANULAR AREA ZONES — v3 (14 areas added)
  //  Methodology: OSM road classification + neighbourhood type
  //  (slum/informal settlement vs residential vs commercial) +
  //  environmental factors (lighting, isolation, crowd density) +
  //  Mumbai Police marked unsafe areas + published news reports
  //  Source tags: osm | inferred | news | mumbai-police
  // ═══════════════════════════════════════════════════════════════

  // ──────────────────────────────────────────────
//  15. DAHISAR (East + West) — NEW (v4)
// ──────────────────────────────────────────────

// HIGH RISK
{ name: "DAH – Rawalpada Slum Belt", lat: 19.2485, lng: 72.8725, radius: 400,
  baseRisk: 6.5, types: ["theft","assault"], nightOverride: 8.2,
  source: "osm+inferred", area: "Dahisar East" },

{ name: "DAH – Dahisar East Station Area", lat: 19.2505, lng: 72.8640, radius: 250,
  baseRisk: 5.5, types: ["pickpocket","chain snatching"], nightOverride: 6.5,
  source: "inferred", area: "Dahisar East" },

{ name: "DAH – Anand Nagar Internal Lanes", lat: 19.2525, lng: 72.8755, radius: 300,
  baseRisk: 5.8, types: ["theft","harassment"], nightOverride: 7.5,
  source: "osm+inferred", area: "Dahisar East" },

{ name: "DAH – Western Express Highway Stretch (Night)", lat: 19.2470, lng: 72.8655, radius: 400,
  baseRisk: 4.5, types: ["chain snatching"], nightOverride: 6.5,
  source: "osm", area: "Dahisar East" },

// WEST SIDE
{ name: "DAH – Dahisar West Station Exit", lat: 19.2485, lng: 72.8420, radius: 250,
  baseRisk: 5.8, types: ["pickpocket","theft"], nightOverride: 6.8,
  source: "inferred", area: "Dahisar West" },

{ name: "DAH – Ganpat Patil Nagar Slum", lat: 19.2460, lng: 72.8385, radius: 350,
  baseRisk: 6.8, types: ["assault","theft"], nightOverride: 8.5,
  source: "osm+inferred", area: "Dahisar West" },

{ name: "DAH – Kanderpada / Nallah Belt", lat: 19.2445, lng: 72.8440, radius: 350,
  baseRisk: 6.0, types: ["theft","harassment"], nightOverride: 7.8,
  source: "osm+inferred", area: "Dahisar West" },

{ name: "DAH – Dahisar Beach (Night)", lat: 19.2528, lng: 72.8335, radius: 400,
  baseRisk: 5.2, types: ["harassment"], nightOverride: 7.5,
  source: "inferred", area: "Dahisar West" },

// LOW RISK
{ name: "DAH – Dahisar Residential West", lat: 19.2495, lng: 72.8455, radius: 300,
  baseRisk: 2.0, types: ["pickpocket"], nightOverride: 3.0,
  source: "inferred", area: "Dahisar West" },

  // ──────────────────────────────────────────────────────────────
  //  1. BORIVALI (East + West)
  // ──────────────────────────────────────────────────────────────
  { name: "BOR – Poisar Nallah Slum Belt",    lat: 19.2355, lng: 72.8610, radius: 350,
    baseRisk: 6.2, types: ["theft","assault"], nightOverride: 8.0, source: "osm+inferred", area: "Borivali" },
  { name: "BOR – Kasturba Rd Back Lanes",     lat: 19.2290, lng: 72.8555, radius: 200,
    baseRisk: 5.0, types: ["theft","harassment"], nightOverride: 6.5, source: "inferred", area: "Borivali" },
  { name: "BOR – Station East Slum Pocket",   lat: 19.2315, lng: 72.8640, radius: 250,
    baseRisk: 5.5, types: ["theft","pickpocket"], nightOverride: 7.0, source: "osm+inferred", area: "Borivali" },
  { name: "BOR – Aarey Colony Road (Night)",  lat: 19.2180, lng: 72.8720, radius: 400,
    baseRisk: 4.5, types: ["harassment","assault"], nightOverride: 7.5, source: "mumbai-police", area: "Borivali",
    note: "Mumbai Police officially marked Aarey Colony as unsafe for women at night" },
  { name: "BOR – IC Colony (Night Lanes)",    lat: 19.2265, lng: 72.8490, radius: 300,
    baseRisk: 3.0, types: ["theft"], nightOverride: 4.5, source: "inferred", area: "Borivali" },
  { name: "BOR – Dahanukar Wadi",             lat: 19.2350, lng: 72.8530, radius: 250,
    baseRisk: 2.5, types: ["pickpocket"], source: "inferred", area: "Borivali" },
  { name: "BOR – Mandapeshwar / Eksar",       lat: 19.2410, lng: 72.8575, radius: 300,
    baseRisk: 2.8, types: ["theft"], nightOverride: 4.0, source: "inferred", area: "Borivali" },
  { name: "BOR – SV Road Borivali (Main)",    lat: 19.2330, lng: 72.8510, radius: 350,
    baseRisk: 2.2, types: ["pickpocket"], source: "osm", area: "Borivali" },
  { name: "BOR – Borivali Station Foot Overbridge", lat: 19.2298, lng: 72.8515, radius: 180,
    baseRisk: 5.2, types: ["pickpocket"], nightOverride: 6.5, source: "inferred", area: "Borivali" },

{ name: "BOR – WEH Borivali Flyover (Night)", lat: 19.2300, lng: 72.8605, radius: 300,
  baseRisk: 4.0, types: ["snatching"], nightOverride: 6.0, source: "osm", area: "Borivali" },

  // ──────────────────────────────────────────────────────────────
  //  2. KANDIVALI (East + West)
  // ──────────────────────────────────────────────────────────────
  { name: "KAN – Charkop Sector 1–3 Lanes",  lat: 19.2085, lng: 72.8358, radius: 300,
    baseRisk: 3.8, types: ["theft","harassment"], nightOverride: 5.5, source: "inferred", area: "Kandivali" },
  { name: "KAN – Kandivali East Slum Belt",   lat: 19.2050, lng: 72.8680, radius: 400,
    baseRisk: 5.8, types: ["theft","assault"], nightOverride: 7.5, source: "osm+inferred", area: "Kandivali" },
  { name: "KAN – Thakur Complex Back Roads",  lat: 19.2130, lng: 72.8720, radius: 280,
    baseRisk: 3.2, types: ["theft"], nightOverride: 4.5, source: "inferred", area: "Kandivali" },
  { name: "KAN – Akurli Road Isolated Stretch",lat:19.2010, lng: 72.8650, radius: 220,
    baseRisk: 4.0, types: ["harassment","theft"], nightOverride: 6.0, source: "osm", area: "Kandivali" },
  { name: "KAN – Kandivali Station West Exit", lat: 19.2055, lng: 72.8520, radius: 200,
    baseRisk: 4.2, types: ["pickpocket","chain snatching"], nightOverride: 5.0, source: "inferred", area: "Kandivali" },
  { name: "KAN – Poisar River Nallah Area",   lat: 19.2100, lng: 72.8600, radius: 300,
    baseRisk: 5.0, types: ["theft","assault"], nightOverride: 7.0, source: "osm+inferred", area: "Kandivali" },
  { name: "KAN – Mahavir Nagar (Safe Zone)",  lat: 19.2020, lng: 72.8490, radius: 280,
    baseRisk: 2.0, types: ["pickpocket"], source: "inferred", area: "Kandivali" },

  // ──────────────────────────────────────────────────────────────
  //  3. MALAD (East + West)
  // ──────────────────────────────────────────────────────────────
  { name: "MAL – Malvani Slum Colony",        lat: 19.1870, lng: 72.8190, radius: 500,
    baseRisk: 7.0, types: ["theft","assault","harassment"], nightOverride: 9.0, source: "osm+inferred", area: "Malad" },
  { name: "MAL – Malad East Slum Pocket",     lat: 19.1880, lng: 72.8700, radius: 400,
    baseRisk: 6.0, types: ["theft","assault"], nightOverride: 8.0, source: "osm+inferred", area: "Malad" },
  { name: "MAL – Kurar Village Lanes",        lat: 19.1930, lng: 72.8660, radius: 300,
    baseRisk: 5.5, types: ["theft","harassment"], nightOverride: 7.5, source: "inferred", area: "Malad" },
  { name: "MAL – Orlem Back Lanes",           lat: 19.1790, lng: 72.8370, radius: 250,
    baseRisk: 3.5, types: ["theft"], nightOverride: 5.0, source: "inferred", area: "Malad" },
  { name: "MAL – Malad Station (Both Sides)", lat: 19.1873, lng: 72.8487, radius: 250,
    baseRisk: 4.5, types: ["pickpocket","chain snatching"], nightOverride: 5.5, source: "inferred", area: "Malad" },
  { name: "MAL – Mindspace / Inorbit Area",   lat: 19.1740, lng: 72.8393, radius: 350,
    baseRisk: 1.8, types: ["pickpocket"], nightOverride: 2.5, source: "inferred", area: "Malad" },
  { name: "MAL – Marve Road (Night)",         lat: 19.1960, lng: 72.8250, radius: 300,
    baseRisk: 4.2, types: ["harassment","theft"], nightOverride: 6.5, source: "osm", area: "Malad" },
  { name: "MAL – Chincholi Bunder Road",      lat: 19.1810, lng: 72.8280, radius: 280,
    baseRisk: 3.8, types: ["theft"], nightOverride: 5.5, source: "osm+inferred", area: "Malad" },
    { name: "MAL – Malad Subway (Night)", lat: 19.1865, lng: 72.8480, radius: 200,
  baseRisk: 5.8, types: ["harassment","theft"], nightOverride: 8.0, source: "osm+inferred", area: "Malad" },
  { name: "MAL – Malvani Link Road Stretch", lat: 19.1900, lng: 72.8230, radius: 300,
    baseRisk: 6.5, types: ["assault"], nightOverride: 8.5, source: "inferred", area: "Malad" },

  // ──────────────────────────────────────────────────────────────
  //  4. GOREGAON (East + West)
  // ──────────────────────────────────────────────────────────────
  { name: "GOR – Aarey Colony (Night Stretch)",lat:19.1580, lng: 72.8820, radius: 600,
    baseRisk: 5.5, types: ["assault","harassment"], nightOverride: 8.5, source: "mumbai-police",
    note: "Officially marked unsafe for women at night by Mumbai Police", area: "Goregaon" },
  { name: "GOR – Jawahar Nagar Slum",         lat: 19.1650, lng: 72.8490, radius: 300,
    baseRisk: 6.0, types: ["theft","assault"], nightOverride: 8.0, source: "osm+inferred", area: "Goregaon" },
  { name: "GOR – Goregaon East Station Area", lat: 19.1622, lng: 72.8660, radius: 280,
    baseRisk: 4.8, types: ["pickpocket","theft"], nightOverride: 6.0, source: "inferred", area: "Goregaon" },
  { name: "GOR – Motilal Nagar Lanes",        lat: 19.1595, lng: 72.8445, radius: 250,
    baseRisk: 4.5, types: ["theft","harassment"], nightOverride: 6.5, source: "inferred", area: "Goregaon" },
  { name: "GOR – Film City Road (After Dark)", lat: 19.1685, lng: 72.8750, radius: 400,
    baseRisk: 4.0, types: ["harassment"], nightOverride: 6.5, source: "osm", area: "Goregaon" },
  { name: "GOR – Oberoi Mall / Goregaon West", lat: 19.1540, lng: 72.8430, radius: 300,
    baseRisk: 1.8, types: ["pickpocket"], source: "inferred", area: "Goregaon" },
  { name: "GOR – Hub Mall Area (Safe Zone)",  lat: 19.1530, lng: 72.8393, radius: 280,
    baseRisk: 1.5, types: [], source: "inferred", area: "Goregaon" },

  // Ram Mandir East/West zones moved to expanded section below ↓

  // ──────────────────────────────────────────────────────────────
  //  6. JOGESHWARI (East + West)
  // ──────────────────────────────────────────────────────────────
  { name: "JOG – Jogeshwari Caves Area (Night)",lat:19.1410, lng: 72.8450, radius: 350,
    baseRisk: 5.5, types: ["harassment","assault"], nightOverride: 7.5, source: "osm+inferred", area: "Jogeshwari" },
  { name: "JOG – Behram Baug Slum Lanes",     lat: 19.1380, lng: 72.8395, radius: 300,
    baseRisk: 6.0, types: ["theft","assault"], nightOverride: 8.0, source: "osm+inferred", area: "Jogeshwari" },
  { name: "JOG – Jogeshwari East Slum Belt",  lat: 19.1350, lng: 72.8580, radius: 400,
    baseRisk: 6.5, types: ["theft","assault","harassment"], nightOverride: 8.5, source: "osm+inferred", area: "Jogeshwari" },
  { name: "JOG – Azad Nagar Back Roads",      lat: 19.1295, lng: 72.8415, radius: 250,
    baseRisk: 4.5, types: ["theft","harassment"], nightOverride: 6.0, source: "inferred", area: "Jogeshwari" },
  { name: "JOG – Piramal Nagar (Safe Zone)",  lat: 19.1330, lng: 72.8360, radius: 280,
    baseRisk: 2.5, types: ["pickpocket"], source: "inferred", area: "Jogeshwari" },
  { name: "JOG – Western Express Hwy (Night)",lat: 19.1370, lng: 72.8490, radius: 300,
    baseRisk: 3.5, types: ["chain snatching"], nightOverride: 5.5, source: "inferred", area: "Jogeshwari" },

  // ──────────────────────────────────────────────────────────────
  //  7. ANDHERI (East + West)
  // ──────────────────────────────────────────────────────────────
  { name: "AND – Andheri East Slum Pocket",   lat: 19.1155, lng: 72.8790, radius: 400,
    baseRisk: 6.0, types: ["theft","assault"], nightOverride: 8.0, source: "osm+inferred", area: "Andheri" },
  { name: "AND – Marol Naka Back Lanes",      lat: 19.1100, lng: 72.8820, radius: 300,
    baseRisk: 5.5, types: ["theft","harassment"], nightOverride: 7.5, source: "inferred", area: "Andheri" },
  { name: "AND – Chakala Signal Area (Night)",lat: 19.1140, lng: 72.8870, radius: 250,
    baseRisk: 4.5, types: ["chain snatching","theft"], nightOverride: 6.0, source: "news", area: "Andheri" },
  { name: "AND – Andheri Station Underpass",  lat: 19.1192, lng: 72.8475, radius: 200,
    baseRisk: 5.0, types: ["harassment","theft"], nightOverride: 7.0, source: "inferred", area: "Andheri" },
  { name: "AND – DN Nagar / Four Bungalows",  lat: 19.1240, lng: 72.8390, radius: 300,
    baseRisk: 2.8, types: ["pickpocket"], nightOverride: 3.5, source: "inferred", area: "Andheri" },
  { name: "AND – Versova Koliwada Lanes",     lat: 19.1318, lng: 72.8150, radius: 280,
    baseRisk: 4.0, types: ["harassment","theft"], nightOverride: 6.0, source: "osm+inferred", area: "Andheri" },
  { name: "AND – MIDC Andheri (Night)",       lat: 19.1090, lng: 72.8700, radius: 400,
    baseRisk: 4.8, types: ["assault","theft"], nightOverride: 6.5, source: "inferred", area: "Andheri" },
  { name: "AND – Lokhandwala Complex (Safe)", lat: 19.1334, lng: 72.8270, radius: 350,
    baseRisk: 1.8, types: ["pickpocket"], source: "inferred", area: "Andheri" },
  { name: "AND – Oshiwara (Safe Zone)",       lat: 19.1380, lng: 72.8300, radius: 300,
    baseRisk: 1.5, types: [], source: "inferred", area: "Andheri" },
  { name: "AND – Andheri Subway (Night)", lat: 19.1195, lng: 72.8485, radius: 200,
  baseRisk: 6.2, types: ["harassment","theft"], nightOverride: 8.5, source: "osm+inferred", area: "Andheri" },
   { name: "AND – WEH Andheri Flyover", lat: 19.1160, lng: 72.8585, radius: 300,
  baseRisk: 4.2, types: ["snatching"], nightOverride: 6.2, source: "osm", area: "Andheri" },

  // ──────────────────────────────────────────────────────────────
  //  8. VILE PARLE (East + West)
  // ──────────────────────────────────────────────────────────────
  { name: "VP – Vile Parle East Slum Lanes",  lat: 19.1030, lng: 72.8590, radius: 300,
    baseRisk: 5.0, types: ["theft","harassment"], nightOverride: 7.0, source: "osm+inferred", area: "Vile Parle" },
  { name: "VP – Nehru Road Isolated Stretch", lat: 19.0980, lng: 72.8530, radius: 250,
    baseRisk: 4.2, types: ["theft","harassment"], nightOverride: 5.5, source: "inferred", area: "Vile Parle" },
  { name: "VP – Airport Boundary (Night)",    lat: 19.0940, lng: 72.8660, radius: 350,
    baseRisk: 4.8, types: ["harassment","theft"], nightOverride: 6.5, source: "osm", area: "Vile Parle",
    note: "Isolated boundary road, poor lighting, no pedestrian activity at night" },
  { name: "VP – VP West Linking Road (Safe)", lat: 19.1008, lng: 72.8373, radius: 300,
    baseRisk: 2.0, types: ["pickpocket"], source: "inferred", area: "Vile Parle" },
  { name: "VP – Irla Area (Safe Zone)",       lat: 19.1015, lng: 72.8430, radius: 280,
    baseRisk: 1.8, types: [], source: "inferred", area: "Vile Parle" },
  { name: "VP – Sahar Road (Night)",          lat: 19.0990, lng: 72.8640, radius: 300,
    baseRisk: 4.0, types: ["chain snatching"], nightOverride: 5.5, source: "inferred", area: "Vile Parle" },

  // ──────────────────────────────────────────────────────────────
  //  9. SANTACRUZ EAST — Expanded granular zones (v3)
  //  Note: Santacruz East lies between Western Railway line (W)
  //  and the airport / BKC. Has significant slum pockets around
  //  Vakola, Kalina and near the airport boundary.
  // ──────────────────────────────────────────────────────────────
  // HIGH RISK
  { name: "SCE – Vakola Slum (Internal Lanes)",  lat: 19.0810, lng: 72.8555, radius: 280,
    baseRisk: 6.2, types: ["theft","assault","harassment"], nightOverride: 8.0,
    source: "osm+inferred", area: "Santacruz East",
    note: "Dense slum pocket around Vakola nallah, very poorly lit, isolated gullies" },
  { name: "SCE – Vakola Nallah Stretch",          lat: 19.0790, lng: 72.8540, radius: 250,
    baseRisk: 5.8, types: ["theft","harassment"], nightOverride: 7.5,
    source: "osm", area: "Santacruz East" },
  { name: "SCE – Airport Boundary Road (Night)",  lat: 19.0870, lng: 72.8640, radius: 350,
    baseRisk: 5.0, types: ["harassment","assault"], nightOverride: 7.0,
    source: "osm", area: "Santacruz East",
    note: "Isolated boundary road, no shops, poor lighting, no pedestrians at night" },
  { name: "SCE – Santacruz East Slum Belt",       lat: 19.0828, lng: 72.8490, radius: 300,
    baseRisk: 5.8, types: ["theft","assault"], nightOverride: 7.5,
    source: "osm+inferred", area: "Santacruz East" },
  // MEDIUM RISK
  { name: "SCE – Santacruz East Station Area",    lat: 19.0818, lng: 72.8470, radius: 200,
    baseRisk: 4.8, types: ["pickpocket","chain snatching"], nightOverride: 5.5,
    source: "inferred", area: "Santacruz East" },
  { name: "SCE – Kalina Village Lanes",           lat: 19.0860, lng: 72.8600, radius: 280,
    baseRisk: 4.5, types: ["theft","harassment"], nightOverride: 6.0,
    source: "inferred", area: "Santacruz East" },
  { name: "SCE – Kalina University Road (Night)", lat: 19.0900, lng: 72.8630, radius: 280,
    baseRisk: 4.0, types: ["harassment"], nightOverride: 6.5,
    source: "osm+inferred", area: "Santacruz East",
    note: "Isolated stretch after midnight when university area empties" },
  { name: "SCE – Nehru Nagar Slum Approach",      lat: 19.0780, lng: 72.8580, radius: 250,
    baseRisk: 5.2, types: ["theft","assault"], nightOverride: 7.0,
    source: "osm+inferred", area: "Santacruz East" },
  { name: "SCE – Mithi River Bank Path",          lat: 19.0850, lng: 72.8680, radius: 300,
    baseRisk: 5.5, types: ["assault","harassment"], nightOverride: 7.5,
    source: "osm", area: "Santacruz East",
    note: "River bank path, completely unlit, isolated, avoid day and night" },
  // LOW RISK
  { name: "SCE – BKC Main Zone (Safe)",           lat: 19.0633, lng: 72.8659, radius: 400,
    baseRisk: 1.5, types: [], nightOverride: 2.5,
    source: "inferred", area: "Santacruz East",
    note: "BKC is heavily patrolled, CCTV-covered, safe even at night" },
  { name: "SCE – BKC Boundary / MMRDA Grounds",   lat: 19.0680, lng: 72.8640, radius: 250,
    baseRisk: 2.2, types: ["theft"], nightOverride: 3.5,
    source: "osm", area: "Santacruz East" },
  { name: "SCE – Guru Nanak Road (Residential)",  lat: 19.0840, lng: 72.8445, radius: 220,
    baseRisk: 2.0, types: ["pickpocket"], source: "inferred", area: "Santacruz East" },

  // ──────────────────────────────────────────────────────────────
  //  RAM MANDIR — East & West clarification (v3)
  //  GEOGRAPHY NOTE: "Ram Mandir" is a Western Railway station in
  //  Goregaon West. There is no official "Ram Mandir East" ward.
  //  However, the station area has roads going both east (towards
  //  WEH / Bangur Nagar East) and west (towards SV Road).
  //  These zones cover both sides of the Ram Mandir station.
  // ──────────────────────────────────────────────────────────────
  // WEST SIDE (SV Road side — existing zones kept, adding more)
  { name: "RAM-W – Ram Mandir Station Lanes",     lat: 19.1510, lng: 72.8384, radius: 200,
    baseRisk: 4.8, types: ["theft","harassment"], nightOverride: 6.5,
    source: "inferred", area: "Ram Mandir West" },
  { name: "RAM-W – Bangur Nagar West Lanes",      lat: 19.1475, lng: 72.8360, radius: 220,
    baseRisk: 4.2, types: ["theft"], nightOverride: 5.5,
    source: "inferred", area: "Ram Mandir West" },
  { name: "RAM-W – Ram Mandir Road Main",         lat: 19.1490, lng: 72.8410, radius: 200,
    baseRisk: 3.0, types: ["pickpocket"], nightOverride: 4.0,
    source: "osm", area: "Ram Mandir West" },
  { name: "RAM-W – Kandarpada Nallah (West)",     lat: 19.1535, lng: 72.8370, radius: 180,
    baseRisk: 5.0, types: ["theft","assault"], nightOverride: 7.0,
    source: "osm+inferred", area: "Ram Mandir West" },
  { name: "RAM-W – SV Road near Ram Mandir",      lat: 19.1500, lng: 72.8430, radius: 220,
    baseRisk: 2.5, types: ["pickpocket"], nightOverride: 3.5,
    source: "osm", area: "Ram Mandir West" },
  // EAST SIDE (WEH / Goregaon East side of station)
  { name: "RAM-E – Bangur Nagar East Lanes",      lat: 19.1490, lng: 72.8480, radius: 250,
    baseRisk: 4.5, types: ["theft","harassment"], nightOverride: 6.0,
    source: "inferred", area: "Ram Mandir East",
    note: "Back lanes connecting station to WEH, poorly lit, isolated at night" },
  { name: "RAM-E – WEH Underpass (Ram Mandir)",   lat: 19.1515, lng: 72.8520, radius: 180,
    baseRisk: 5.2, types: ["assault","theft"], nightOverride: 7.2,
    source: "osm+inferred", area: "Ram Mandir East",
    note: "WEH underpasses are known crime spots across Mumbai" },
  { name: "RAM-E – Dindoshi Approach Lanes",      lat: 19.1560, lng: 72.8560, radius: 280,
    baseRisk: 4.8, types: ["theft","harassment"], nightOverride: 6.5,
    source: "osm+inferred", area: "Ram Mandir East" },
  { name: "RAM-E – Nallah Crossing East Side",    lat: 19.1540, lng: 72.8490, radius: 200,
    baseRisk: 5.5, types: ["assault","theft"], nightOverride: 7.5,
    source: "osm+inferred", area: "Ram Mandir East",
    note: "Nallah-side roads are consistently high risk across all Mumbai suburbs" },
  { name: "RAM-E – Goregaon East Residential",    lat: 19.1470, lng: 72.8530, radius: 280,
    baseRisk: 2.8, types: ["pickpocket"], nightOverride: 3.5,
    source: "inferred", area: "Ram Mandir East" },

  // ──────────────────────────────────────────────────────────────
  //  MAHIM EAST — Added (v3)
  //  GEOGRAPHY NOTE: Mahim has only one railway station (Mahim Jn)
  //  on the Western line. "Mahim East" locally refers to the
  //  eastern side of Mahim — bordering Dharavi to the north and
  //  Sion to the east. This area includes Dharavi's southern tip,
  //  Shahu Nagar, and the Mahim–Sion connector roads.
  //  It is significantly more dangerous than Mahim West.
  // ──────────────────────────────────────────────────────────────
  // HIGH RISK
  { name: "MAH-E – Shahu Nagar (Dharavi South)", lat: 19.0422, lng: 72.8495, radius: 300,
    baseRisk: 7.2, types: ["theft","assault","harassment"], nightOverride: 9.0,
    source: "osm+inferred", area: "Mahim East",
    note: "Dharavi southern fringe / Shahu Nagar — dense informal settlement, very high risk" },
  { name: "MAH-E – Dharavi–Mahim East Road",     lat: 19.0405, lng: 72.8470, radius: 280,
    baseRisk: 6.8, types: ["theft","assault"], nightOverride: 8.5,
    source: "osm+inferred", area: "Mahim East" },
  { name: "MAH-E – Jasmine Mill Road (Kapda Bazar)",lat:19.0380, lng: 72.8510, radius: 250,
    baseRisk: 5.8, types: ["theft","harassment"], nightOverride: 7.5,
    source: "osm+inferred", area: "Mahim East",
    note: "Textile market area, busy day, deserted and risky at night" },
  { name: "MAH-E – Sion–Mahim Connector Lanes",  lat: 19.0360, lng: 72.8555, radius: 300,
    baseRisk: 5.5, types: ["theft","assault"], nightOverride: 7.2,
    source: "osm", area: "Mahim East" },
  // MEDIUM RISK
  { name: "MAH-E – Mahim Junction Station (E)",  lat: 19.0415, lng: 72.8445, radius: 200,
    baseRisk: 4.5, types: ["pickpocket","chain snatching"], nightOverride: 5.8,
    source: "inferred", area: "Mahim East" },
  { name: "MAH-E – Ramabai Nagar Area",          lat: 19.0400, lng: 72.8530, radius: 220,
    baseRisk: 5.0, types: ["theft","harassment"], nightOverride: 6.8,
    source: "inferred", area: "Mahim East" },
  // LOW/MEDIUM
  { name: "MAH-E – LJ Road (Mahim East, Safe)",  lat: 19.0440, lng: 72.8480, radius: 200,
    baseRisk: 3.0, types: ["pickpocket"], nightOverride: 4.5,
    source: "inferred", area: "Mahim East" },

  // ──────────────────────────────────────────────────────────────
  //  MAHIM WEST — Expanded (v3)
  //  (5 zones already existed — adding more granular streets)
  // ──────────────────────────────────────────────────────────────
  { name: "MAH-W – Mahim Beach (Night)",          lat: 19.0395, lng: 72.8387, radius: 280,
    baseRisk: 5.0, types: ["harassment","theft"], nightOverride: 7.5,
    source: "news+inferred", area: "Mahim West",
    note: "Beach anti-social elements after dark, news-reported" },
  { name: "MAH-W – Mahim Dargah Approach",        lat: 19.0430, lng: 72.8370, radius: 200,
    baseRisk: 3.5, types: ["pickpocket"], nightOverride: 5.0,
    source: "inferred", area: "Mahim West" },
  { name: "MAH-W – Mahim Causeway / Sea Link Rd", lat: 19.0415, lng: 72.8415, radius: 250,
    baseRisk: 4.5, types: ["theft","harassment"], nightOverride: 6.5,
    source: "inferred", area: "Mahim West" },
  { name: "MAH-W – Lady Jamshedji Rd (Safe)",     lat: 19.0452, lng: 72.8395, radius: 250,
    baseRisk: 2.0, types: ["pickpocket"], source: "inferred", area: "Mahim West" },
  { name: "MAH-W – Sitladevi Temple Area",        lat: 19.0468, lng: 72.8378, radius: 200,
    baseRisk: 2.5, types: ["pickpocket"], nightOverride: 3.5,
    source: "inferred", area: "Mahim West" },
  { name: "MAH-W – Dharavi–Mahim Jn (West)",      lat: 19.0395, lng: 72.8480, radius: 300,
    baseRisk: 6.5, types: ["theft","assault"], nightOverride: 8.5,
    source: "osm+inferred", area: "Mahim West" },

  // ──────────────────────────────────────────────────────────────
  //  10. KHAR (East + West)
  // ──────────────────────────────────────────────────────────────
  { name: "KHR – Khar Danda Koliwada",        lat: 19.0715, lng: 72.8235, radius: 250,
    baseRisk: 4.5, types: ["harassment","theft"], nightOverride: 6.5, source: "osm+inferred", area: "Khar" },
  { name: "KHR – Khar East Slum Lanes",       lat: 19.0700, lng: 72.8395, radius: 300,
    baseRisk: 5.2, types: ["theft","assault"], nightOverride: 7.0, source: "osm+inferred", area: "Khar" },
  { name: "KHR – 16th Road / 17th Road (Safe)",lat:19.0720, lng: 72.8300, radius: 300,
    baseRisk: 1.8, types: ["pickpocket"], source: "inferred", area: "Khar" },
  { name: "KHR – Khar Station Area",          lat: 19.0710, lng: 72.8360, radius: 200,
    baseRisk: 3.8, types: ["pickpocket","chain snatching"], nightOverride: 5.0, source: "inferred", area: "Khar" },
  { name: "KHR – SV Road Khar (Main)",        lat: 19.0710, lng: 72.8420, radius: 280,
    baseRisk: 2.5, types: ["pickpocket"], nightOverride: 3.5, source: "osm", area: "Khar" },

  // ──────────────────────────────────────────────────────────────
  //  11. BANDRA (East + West) — replaces old broad zone
  // ──────────────────────────────────────────────────────────────
  { name: "BAN – Bandra East Slum / Khar Slum",lat:19.0545, lng: 72.8430, radius: 400,
    baseRisk: 6.5, types: ["theft","assault","harassment"], nightOverride: 8.5, source: "osm+inferred", area: "Bandra" },
  { name: "BAN – Bandra Kurla BKC Boundary",  lat: 19.0600, lng: 72.8580, radius: 300,
    baseRisk: 2.8, types: ["theft"], nightOverride: 4.5, source: "inferred", area: "Bandra" },
  { name: "BAN – Dharavi – Bandra Connector", lat: 19.0490, lng: 72.8450, radius: 350,
    baseRisk: 6.0, types: ["theft","assault"], nightOverride: 8.0, source: "osm+inferred", area: "Bandra" },
  { name: "BAN – Pali Hill (Safe Zone)",      lat: 19.0643, lng: 72.8230, radius: 300,
    baseRisk: 1.2, types: [], source: "inferred", area: "Bandra" },
  { name: "BAN – Carter Road Promenade",      lat: 19.0665, lng: 72.8185, radius: 300,
    baseRisk: 1.5, types: ["pickpocket"], nightOverride: 2.0, source: "inferred", area: "Bandra" },
  { name: "BAN – Bandra Station West (Crowd)",lat: 19.0562, lng: 72.8348, radius: 220,
    baseRisk: 4.0, types: ["pickpocket","chain snatching"], nightOverride: 5.0, source: "inferred", area: "Bandra" },
  { name: "BAN – Mount Mary / Chapel Road",   lat: 19.0620, lng: 72.8165, radius: 280,
    baseRisk: 1.3, types: [], source: "inferred", area: "Bandra" },
  { name: "BAN – Turner Road / Linking (Safe)",lat:19.0606, lng: 72.8295, radius: 350,
    baseRisk: 1.8, types: ["pickpocket"], source: "inferred", area: "Bandra" },
  { name: "BAN – Bandra Skywalk", lat: 19.0558, lng: 72.8370, radius: 200,
    baseRisk: 4.8, types: ["pickpocket"], nightOverride: 6.0, source: "inferred", area: "Bandra" },

  // Mahim East/West zones moved to expanded section below ↓

  // ──────────────────────────────────────────────────────────────
  //  13. MATUNGA (East + West)
  // ──────────────────────────────────────────────────────────────
  { name: "MAT – Dharavi–Matunga Border",     lat: 19.0355, lng: 72.8530, radius: 350,
    baseRisk: 6.5, types: ["theft","assault"], nightOverride: 8.5, source: "osm+inferred", area: "Matunga" },
  { name: "MAT – Matunga East Slum Pocket",   lat: 19.0310, lng: 72.8600, radius: 300,
    baseRisk: 5.5, types: ["theft","harassment"], nightOverride: 7.5, source: "osm+inferred", area: "Matunga" },
  { name: "MAT – Matunga Labour Camp Lanes",  lat: 19.0330, lng: 72.8550, radius: 250,
    baseRisk: 5.8, types: ["theft","assault"], nightOverride: 7.8, source: "inferred", area: "Matunga" },
  { name: "MAT – Hindmata / Five Gardens",    lat: 19.0278, lng: 72.8435, radius: 280,
    baseRisk: 2.0, types: ["pickpocket"], source: "inferred", area: "Matunga" },
  { name: "MAT – Matunga West (Tamil Colony)",lat: 19.0298, lng: 72.8415, radius: 300,
    baseRisk: 1.5, types: [], source: "inferred", area: "Matunga",
    note: "Well-maintained residential Tamil Brahmin colony, historically very low crime" },
  { name: "MAT – King's Circle (Safe Zone)",  lat: 19.0298, lng: 72.8480, radius: 250,
    baseRisk: 1.8, types: ["pickpocket"], source: "inferred", area: "Matunga" },

  // ──────────────────────────────────────────────────────────────
  //  14. DADAR (East + West)
  // ──────────────────────────────────────────────────────────────
  { name: "DAD – Dadar East Slum / Naigaon",  lat: 19.0215, lng: 72.8520, radius: 350,
    baseRisk: 6.2, types: ["theft","assault","harassment"], nightOverride: 8.0, source: "osm+inferred", area: "Dadar" },
  { name: "DAD – Dharavi–Dadar Connector",    lat: 19.0260, lng: 72.8505, radius: 300,
    baseRisk: 6.5, types: ["theft","assault"], nightOverride: 8.5, source: "osm+inferred", area: "Dadar" },
  { name: "DAD – Dadar Station (Both Sides)", lat: 19.0204, lng: 72.8430, radius: 300,
    baseRisk: 5.0, types: ["pickpocket","chain snatching"], nightOverride: 6.0, source: "inferred+news", area: "Dadar",
    note: "One of Mumbai's busiest stations, high pickpocket reports" },
  { name: "DAD – Dadar TT Circle",            lat: 19.0195, lng: 72.8445, radius: 200,
    baseRisk: 4.5, types: ["pickpocket","harassment"], nightOverride: 5.5, source: "inferred", area: "Dadar" },
  { name: "DAD – Dadar Market (Day Crowds)",  lat: 19.0185, lng: 72.8420, radius: 250,
    baseRisk: 4.0, types: ["pickpocket"], nightOverride: 3.0, source: "inferred", area: "Dadar" },
  { name: "DAD – Dadar Beach (Night)",        lat: 19.0155, lng: 72.8320, radius: 300,
    baseRisk: 5.5, types: ["harassment","assault"], nightOverride: 7.5, source: "news+inferred", area: "Dadar",
    note: "Dadar beach anti-social elements after dark, news-reported" },
  { name: "DAD – Shivaji Park (Safe Day)",    lat: 19.0200, lng: 72.8370, radius: 350,
    baseRisk: 1.5, types: [], nightOverride: 3.5, source: "inferred", area: "Dadar" },
  { name: "DAD – Portuguese Church Area",     lat: 19.0168, lng: 72.8395, radius: 220,
    baseRisk: 1.8, types: ["pickpocket"], source: "inferred", area: "Dadar" },
  { name: "DAD – Cadell Road (Safe Zone)",    lat: 19.0218, lng: 72.8358, radius: 280,
    baseRisk: 1.5, types: [], source: "inferred", area: "Dadar" },
  { name: "DAD – Parel TT / Senapati Road",   lat: 19.0170, lng: 72.8455, radius: 280,
    baseRisk: 3.5, types: ["theft"], nightOverride: 5.0, source: "inferred", area: "Dadar" },
    { name: "DAD – Dadar Subway (Night)", lat: 19.0200, lng: 72.8450, radius: 180,
  baseRisk: 6.0, types: ["harassment","theft"], nightOverride: 8.5, source: "osm+inferred", area: "Dadar" },
  { name: "DAD – Elphinstone Bridge Crowd Zone", lat: 19.0150, lng: 72.8435, radius: 250,
  baseRisk: 5.5, types: ["pickpocket"], nightOverride: 6.5, source: "inferred", area: "Dadar" },

  // ───────────── PRABHADEVI (10+ zones) ─────────────

// EAST (dense + temple + station)
{ name: "PRB-E – Station Entry Road", lat: 19.0165, lng: 72.8295, radius: 150, baseRisk: 5.8, types: ["theft"], nightOverride: 6.8, source: "inferred", area: "Prabhadevi East" },
{ name: "PRB-E – Station FOB", lat: 19.0168, lng: 72.8302, radius: 120, baseRisk: 6.2, types: ["pickpocket"], nightOverride: 7.5, source: "inferred", area: "Prabhadevi East" },
{ name: "PRB-E – Siddhivinayak Queue Lane", lat: 19.0176, lng: 72.8302, radius: 150, baseRisk: 6.8, types: ["crowd"], nightOverride: 7.8, source: "inferred", area: "Prabhadevi East" },
{ name: "PRB-E – Temple Back Lane", lat: 19.0185, lng: 72.8310, radius: 120, baseRisk: 6.2, types: ["theft"], nightOverride: 7.5, source: "inferred", area: "Prabhadevi East" },
{ name: "PRB-E – Market Street", lat: 19.0155, lng: 72.8315, radius: 150, baseRisk: 6.0, types: ["pickpocket"], nightOverride: 7.2, source: "inferred", area: "Prabhadevi East" },

// WEST (coastal + quieter)
{ name: "PRB-W – Worli Sea Face Entry", lat: 19.0125, lng: 72.8175, radius: 200, baseRisk: 4.5, types: ["harassment"], nightOverride: 6.5, source: "inferred", area: "Prabhadevi West" },
{ name: "PRB-W – Coastal Walk Lane", lat: 19.0115, lng: 72.8168, radius: 150, baseRisk: 4.2, types: ["isolation"], nightOverride: 6.8, source: "inferred", area: "Prabhadevi West" },
{ name: "PRB-W – Internal Residential Lane", lat: 19.0135, lng: 72.8205, radius: 120, baseRisk: 3.0, types: ["low risk"], nightOverride: 4.5, source: "inferred", area: "Prabhadevi West" },
{ name: "PRB-W – Signal Junction Road", lat: 19.0140, lng: 72.8225, radius: 150, baseRisk: 5.0, types: ["snatching"], nightOverride: 6.5, source: "inferred", area: "Prabhadevi West" },
{ name: "PRB-W – Sea Face Dark Stretch", lat: 19.0100, lng: 72.8155, radius: 200, baseRisk: 5.2, types: ["harassment"], nightOverride: 7.5, source: "inferred", area: "Prabhadevi West" },

// ───────────── LOWER PAREL ─────────────

// EAST
{ name: "LP-E – Station Entry Road", lat: 18.9955, lng: 72.8320, radius: 120, baseRisk: 6.2, types: ["theft"], nightOverride: 7.5, source: "inferred", area: "Lower Parel East" },
{ name: "LP-E – Station FOB", lat: 18.9958, lng: 72.8328, radius: 120, baseRisk: 6.5, types: ["pickpocket"], nightOverride: 7.8, source: "inferred", area: "Lower Parel East" },
{ name: "LP-E – Industrial Lane 1", lat: 18.9965, lng: 72.8340, radius: 150, baseRisk: 6.8, types: ["assault"], nightOverride: 8.5, source: "inferred", area: "Lower Parel East" },
{ name: "LP-E – Industrial Lane 2", lat: 18.9972, lng: 72.8350, radius: 150, baseRisk: 6.5, types: ["theft"], nightOverride: 8.0, source: "inferred", area: "Lower Parel East" },
{ name: "LP-E – Back Alley Zone", lat: 18.9948, lng: 72.8335, radius: 120, baseRisk: 6.8, types: ["harassment"], nightOverride: 8.5, source: "inferred", area: "Lower Parel East" },

// WEST
{ name: "LP-W – Kamala Mills Entry", lat: 18.9945, lng: 72.8280, radius: 150, baseRisk: 7.0, types: ["crowd"], nightOverride: 9.0, source: "inferred", area: "Lower Parel West" },
{ name: "LP-W – Kamala Mills Inner Lane", lat: 18.9940, lng: 72.8275, radius: 120, baseRisk: 7.2, types: ["assault"], nightOverride: 9.2, source: "inferred", area: "Lower Parel West" },
{ name: "LP-W – Phoenix Mall Entrance", lat: 18.9940, lng: 72.8265, radius: 150, baseRisk: 5.5, types: ["theft"], nightOverride: 6.5, source: "inferred", area: "Lower Parel West" },
{ name: "LP-W – Mall Parking Exit", lat: 18.9935, lng: 72.8255, radius: 120, baseRisk: 5.8, types: ["snatching"], nightOverride: 7.2, source: "inferred", area: "Lower Parel West" },
{ name: "LP-W – Internal Commercial Lane", lat: 18.9952, lng: 72.8270, radius: 120, baseRisk: 6.0, types: ["theft"], nightOverride: 7.5, source: "inferred", area: "Lower Parel West" },

// ───────────── MUMBAI CENTRAL ─────────────

// EAST
{ name: "MC-E – Station Exit East", lat: 18.9695, lng: 72.8235, radius: 120, baseRisk: 6.8, types: ["crowd"], nightOverride: 8.5, source: "inferred", area: "Mumbai Central East" },
{ name: "MC-E – Market Street", lat: 18.9702, lng: 72.8245, radius: 150, baseRisk: 6.5, types: ["pickpocket"], nightOverride: 8.2, source: "inferred", area: "Mumbai Central East" },
{ name: "MC-E – Internal Lane 1", lat: 18.9710, lng: 72.8255, radius: 120, baseRisk: 6.2, types: ["theft"], nightOverride: 7.8, source: "inferred", area: "Mumbai Central East" },
{ name: "MC-E – Internal Lane 2", lat: 18.9685, lng: 72.8240, radius: 120, baseRisk: 6.0, types: ["harassment"], nightOverride: 7.5, source: "inferred", area: "Mumbai Central East" },
{ name: "MC-E – Dense Alley", lat: 18.9690, lng: 72.8250, radius: 120, baseRisk: 6.5, types: ["theft"], nightOverride: 8.0, source: "inferred", area: "Mumbai Central East" },

// WEST
{ name: "MC-W – Bus Depot Entry", lat: 18.9690, lng: 72.8175, radius: 150, baseRisk: 6.5, types: ["theft"], nightOverride: 8.0, source: "inferred", area: "Mumbai Central West" },
{ name: "MC-W – Depot Internal Road", lat: 18.9682, lng: 72.8165, radius: 150, baseRisk: 6.2, types: ["harassment"], nightOverride: 7.8, source: "inferred", area: "Mumbai Central West" },
{ name: "MC-W – Footpath Zone", lat: 18.9700, lng: 72.8185, radius: 120, baseRisk: 5.8, types: ["snatching"], nightOverride: 7.0, source: "inferred", area: "Mumbai Central West" },
{ name: "MC-W – Signal Junction", lat: 18.9675, lng: 72.8195, radius: 150, baseRisk: 5.5, types: ["snatching"], nightOverride: 7.0, source: "inferred", area: "Mumbai Central West" },
{ name: "MC-W – Night Dark Patch", lat: 18.9668, lng: 72.8158, radius: 150, baseRisk: 5.8, types: ["harassment"], nightOverride: 7.5, source: "inferred", area: "Mumbai Central West" },

// ───────────── GRANT ROAD ─────────────

// EAST (dense + market side)
{ name: "GR-E – Station Exit East", lat: 18.9640, lng: 72.8215, radius: 120, baseRisk: 6.5, types: ["crowd"], nightOverride: 8.2, source: "inferred", area: "Grant Road East" },
{ name: "GR-E – Market Street 1", lat: 18.9650, lng: 72.8225, radius: 150, baseRisk: 6.8, types: ["pickpocket"], nightOverride: 8.5, source: "inferred", area: "Grant Road East" },
{ name: "GR-E – Market Street 2", lat: 18.9635, lng: 72.8230, radius: 150, baseRisk: 6.5, types: ["theft"], nightOverride: 8.0, source: "inferred", area: "Grant Road East" },
{ name: "GR-E – Internal Lane 1", lat: 18.9648, lng: 72.8240, radius: 120, baseRisk: 6.2, types: ["harassment"], nightOverride: 7.8, source: "inferred", area: "Grant Road East" },
{ name: "GR-E – Dense Alley", lat: 18.9630, lng: 72.8220, radius: 120, baseRisk: 6.5, types: ["theft"], nightOverride: 8.2, source: "inferred", area: "Grant Road East" },

// WEST (residential + quieter but night risk)
{ name: "GR-W – Station Exit West", lat: 18.9630, lng: 72.8165, radius: 120, baseRisk: 5.8, types: ["theft"], nightOverride: 7.5, source: "inferred", area: "Grant Road West" },
{ name: "GR-W – Residential Lane 1", lat: 18.9620, lng: 72.8155, radius: 150, baseRisk: 5.2, types: ["theft"], nightOverride: 7.0, source: "inferred", area: "Grant Road West" },
{ name: "GR-W – Residential Lane 2", lat: 18.9615, lng: 72.8145, radius: 150, baseRisk: 5.0, types: ["harassment"], nightOverride: 6.8, source: "inferred", area: "Grant Road West" },
{ name: "GR-W – Junction Signal", lat: 18.9625, lng: 72.8175, radius: 120, baseRisk: 5.5, types: ["snatching"], nightOverride: 7.0, source: "inferred", area: "Grant Road West" },
{ name: "GR-W – Night Dark Patch", lat: 18.9605, lng: 72.8135, radius: 150, baseRisk: 5.8, types: ["harassment"], nightOverride: 7.5, source: "inferred", area: "Grant Road West" },

// ───────────── CHARNI ROAD ─────────────

// EAST (market + dense)
{ name: "CR-E – Station Exit East", lat: 18.9575, lng: 72.8205, radius: 120, baseRisk: 6.2, types: ["pickpocket"], nightOverride: 7.8, source: "inferred", area: "Charni Road East" },
{ name: "CR-E – Market Lane 1", lat: 18.9585, lng: 72.8215, radius: 150, baseRisk: 6.5, types: ["theft"], nightOverride: 8.0, source: "inferred", area: "Charni Road East" },
{ name: "CR-E – Market Lane 2", lat: 18.9565, lng: 72.8220, radius: 150, baseRisk: 6.8, types: ["pickpocket"], nightOverride: 8.2, source: "inferred", area: "Charni Road East" },
{ name: "CR-E – Dense Alley", lat: 18.9570, lng: 72.8230, radius: 120, baseRisk: 6.5, types: ["theft"], nightOverride: 8.0, source: "inferred", area: "Charni Road East" },
{ name: "CR-E – Internal Lane", lat: 18.9580, lng: 72.8240, radius: 120, baseRisk: 6.0, types: ["harassment"], nightOverride: 7.5, source: "inferred", area: "Charni Road East" },

// WEST (coastal + tourist)
{ name: "CR-W – Chowpatty Entry", lat: 18.9540, lng: 72.8155, radius: 200, baseRisk: 5.0, types: ["crowd"], nightOverride: 7.5, source: "inferred", area: "Charni Road West" },
{ name: "CR-W – Beach Internal Zone", lat: 18.9530, lng: 72.8145, radius: 200, baseRisk: 5.2, types: ["harassment"], nightOverride: 7.8, source: "inferred", area: "Charni Road West" },
{ name: "CR-W – Coastal Walk Lane", lat: 18.9525, lng: 72.8135, radius: 150, baseRisk: 4.8, types: ["isolation"], nightOverride: 7.2, source: "inferred", area: "Charni Road West" },
{ name: "CR-W – Signal Junction", lat: 18.9555, lng: 72.8165, radius: 120, baseRisk: 5.5, types: ["snatching"], nightOverride: 7.0, source: "inferred", area: "Charni Road West" },
{ name: "CR-W – Night Isolated Patch", lat: 18.9515, lng: 72.8125, radius: 200, baseRisk: 5.8, types: ["harassment"], nightOverride: 7.8, source: "inferred", area: "Charni Road West" },

// ───────────── MARINE LINES ─────────────

// EAST (station + offices)
{ name: "ML-E – Station Exit East", lat: 18.9445, lng: 72.8255, radius: 120, baseRisk: 5.5, types: ["pickpocket"], nightOverride: 7.0, source: "inferred", area: "Marine Lines East" },
{ name: "ML-E – Office Lane 1", lat: 18.9455, lng: 72.8265, radius: 150, baseRisk: 5.8, types: ["theft"], nightOverride: 7.2, source: "inferred", area: "Marine Lines East" },
{ name: "ML-E – Office Lane 2", lat: 18.9435, lng: 72.8275, radius: 150, baseRisk: 5.5, types: ["harassment"], nightOverride: 7.0, source: "inferred", area: "Marine Lines East" },
{ name: "ML-E – Internal Alley", lat: 18.9440, lng: 72.8285, radius: 120, baseRisk: 5.8, types: ["theft"], nightOverride: 7.2, source: "inferred", area: "Marine Lines East" },
{ name: "ML-E – Dense Road Junction", lat: 18.9450, lng: 72.8270, radius: 120, baseRisk: 5.5, types: ["snatching"], nightOverride: 7.0, source: "inferred", area: "Marine Lines East" },

// WEST (Marine Drive)
{ name: "ML-W – Marine Drive Entry", lat: 18.9430, lng: 72.8220, radius: 200, baseRisk: 4.8, types: ["crowd"], nightOverride: 7.5, source: "inferred", area: "Marine Lines West" },
{ name: "ML-W – Promenade Walk Lane", lat: 18.9420, lng: 72.8210, radius: 200, baseRisk: 4.5, types: ["harassment"], nightOverride: 7.2, source: "inferred", area: "Marine Lines West" },
{ name: "ML-W – Coastal Bench Area", lat: 18.9410, lng: 72.8200, radius: 200, baseRisk: 4.2, types: ["isolation"], nightOverride: 7.0, source: "inferred", area: "Marine Lines West" },
{ name: "ML-W – Signal Junction", lat: 18.9440, lng: 72.8230, radius: 120, baseRisk: 5.0, types: ["snatching"], nightOverride: 6.8, source: "inferred", area: "Marine Lines West" },
{ name: "ML-W – Night Dark Stretch", lat: 18.9405, lng: 72.8190, radius: 200, baseRisk: 5.2, types: ["harassment"], nightOverride: 7.8, source: "inferred", area: "Marine Lines West" },

// ───────────── CHURCHGATE ─────────────

// EAST (station + offices)
{ name: "CHG-E – Station Exit East", lat: 18.9335, lng: 72.8290, radius: 120, baseRisk: 6.8, types: ["crowd"], nightOverride: 8.5, source: "inferred", area: "Churchgate East" },
{ name: "CHG-E – Office Lane 1", lat: 18.9325, lng: 72.8305, radius: 150, baseRisk: 6.2, types: ["theft"], nightOverride: 7.8, source: "inferred", area: "Churchgate East" },
{ name: "CHG-E – Office Lane 2", lat: 18.9315, lng: 72.8315, radius: 150, baseRisk: 6.0, types: ["harassment"], nightOverride: 7.5, source: "inferred", area: "Churchgate East" },
{ name: "CHG-E – Internal Alley", lat: 18.9330, lng: 72.8320, radius: 120, baseRisk: 6.5, types: ["theft"], nightOverride: 8.0, source: "inferred", area: "Churchgate East" },
{ name: "CHG-E – Signal Junction", lat: 18.9340, lng: 72.8300, radius: 120, baseRisk: 6.2, types: ["snatching"], nightOverride: 7.8, source: "inferred", area: "Churchgate East" },

// WEST (Nariman Point + coastal)
{ name: "CHG-W – Nariman Point Entry", lat: 18.9250, lng: 72.8240, radius: 300, baseRisk: 4.5, types: ["theft"], nightOverride: 6.5, source: "inferred", area: "Churchgate West" },
{ name: "CHG-W – Coastal Walk Lane", lat: 18.9240, lng: 72.8230, radius: 250, baseRisk: 4.2, types: ["isolation"], nightOverride: 6.8, source: "inferred", area: "Churchgate West" },
{ name: "CHG-W – Marine Drive End Stretch", lat: 18.9265, lng: 72.8250, radius: 250, baseRisk: 4.8, types: ["harassment"], nightOverride: 7.2, source: "inferred", area: "Churchgate West" },
{ name: "CHG-W – Business District Road", lat: 18.9275, lng: 72.8260, radius: 200, baseRisk: 5.2, types: ["theft"], nightOverride: 7.0, source: "inferred", area: "Churchgate West" },
{ name: "CHG-W – Night Isolated Patch", lat: 18.9230, lng: 72.8220, radius: 250, baseRisk: 5.5, types: ["harassment"], nightOverride: 7.8, source: "inferred", area: "Churchgate West" },

  // ── SANTACRUZ WEST – Granular Street-Level Zones (v2) ────────
  // Methodology: OSM road type + neighbourhood classification +
  // environmental risk factors (lighting, isolation, slum proximity)
  // Each zone radius is tightly bounded to the actual street/area size
  // Source tags: osm = OpenStreetMap derived, inferred = area characteristics

  // ── Santacruz West – HIGH RISK zones ────────────────────────
  // Khotwadi: dense informal settlement, narrow unlit lanes,
  // poorly lit at night, isolated internal gullies [osm + inferred]
  { name: "SCW – Khotwadi (Internal Lanes)", lat: 19.0798, lng: 72.8368, radius: 220,
    baseRisk: 5.8, types: ["theft","harassment"], nightOverride: 7.5,
    source: "osm+inferred", area: "Santacruz West" },

  // Bhimwada: mixed slum-residential pocket, poor street lighting,
  // narrow access lanes, low crowd density after 9pm [osm + inferred]
  { name: "SCW – Bhimwada Lanes",           lat: 19.0812, lng: 72.8355, radius: 180,
    baseRisk: 5.5, types: ["theft","harassment"], nightOverride: 7.2,
    source: "osm+inferred", area: "Santacruz West" },

  // Hasnabad Lane area: narrow lane, connects to Khotwadi,
  // poorly lit, used as shortcut, isolated at night [osm]
  { name: "SCW – Hasnabad Lane",            lat: 19.0788, lng: 72.8375, radius: 150,
    baseRisk: 5.2, types: ["theft","chain snatching"], nightOverride: 7.0,
    source: "osm", area: "Santacruz West" },

  // Santacruz Station area (west exit): crowded during peak hours,
  // pickpocketing hotspot, chain snatching reported near exit [inferred]
  { name: "SCW – Station West Exit Area",   lat: 19.0826, lng: 72.8397, radius: 200,
    baseRisk: 4.8, types: ["pickpocket","chain snatching"], nightOverride: 5.5,
    source: "inferred", area: "Santacruz West" },

  // ── Santacruz West – MEDIUM RISK zones ──────────────────────
  // SV Road (Santacruz stretch): busy commercial road, chain snatching
  // on moving vehicles reported, heavy traffic makes escape easy [inferred]
  { name: "SCW – SV Road Stretch",          lat: 19.0820, lng: 72.8420, radius: 350,
    baseRisk: 3.8, types: ["chain snatching","theft"], nightOverride: 5.0,
    source: "inferred", area: "Santacruz West" },

  // Linking Road (Santacruz section): busy shopping street,
  // pickpocketing in crowds, bag snatching from bikes [inferred]
  { name: "SCW – Linking Road Commercial",  lat: 19.0808, lng: 72.8350, radius: 300,
    baseRisk: 3.5, types: ["pickpocket","bag snatching"], nightOverride: 4.2,
    source: "inferred", area: "Santacruz West" },

  // Juhu Tara Road (after 10pm): less crowded after night,
  // isolated stretches near SNDT campus area, poor lighting patches [osm]
  { name: "SCW – Juhu Tara Road (Night)",   lat: 19.0840, lng: 72.8305, radius: 280,
    baseRisk: 3.2, types: ["harassment","theft"], nightOverride: 5.5,
    source: "osm+inferred", area: "Santacruz West" },

  // Juhu Koliwada: fishing village pocket, dense lanes,
  // outsiders feel unsafe at night, poor lighting in inner lanes [osm+inferred]
  { name: "SCW – Juhu Koliwada Lanes",      lat: 19.0865, lng: 72.8280, radius: 200,
    baseRisk: 3.8, types: ["harassment","theft"], nightOverride: 5.8,
    source: "osm+inferred", area: "Santacruz West" },

  // Khira Nagar: lower income residential pocket adjacent to Khotwadi,
  // isolated service lanes, moderate risk [inferred]
  { name: "SCW – Khira Nagar",              lat: 19.0775, lng: 72.8358, radius: 180,
    baseRisk: 3.5, types: ["theft"], nightOverride: 5.0,
    source: "inferred", area: "Santacruz West" },

  // Shastri Nagar – back lanes: residential but has isolated service
  // roads running behind buildings, poorly lit at night [osm]
  { name: "SCW – Shastri Nagar Back Lanes", lat: 19.0835, lng: 72.8360, radius: 180,
    baseRisk: 3.2, types: ["theft"], nightOverride: 4.5,
    source: "osm", area: "Santacruz West" },

  // Milan Subway area: underpass below railway, poorly lit,
  // isolated at night, known for harassment [osm + inferred]
  { name: "SCW – Milan Subway Underpass",   lat: 19.0822, lng: 72.8404, radius: 120,
    baseRisk: 4.5, types: ["harassment","theft"], nightOverride: 6.5,
    source: "osm+inferred", area: "Santacruz West" },

  // Santacruz bus depot area: chaotic at night after last buses,
  // isolated once buses stop, auto-rickshaw touts [inferred]
  { name: "SCW – Bus Depot Area (Night)",   lat: 19.0832, lng: 72.8392, radius: 150,
    baseRisk: 3.5, types: ["harassment"], nightOverride: 5.0,
    source: "inferred", area: "Santacruz West" },

  // ── Santacruz West – LOW RISK zones ─────────────────────────
  // Main Linking Road (daytime): well-lit, very busy, CCTV presence,
  // police patrolling, high footfall during day [osm + inferred]
  { name: "SCW – Linking Road (Day, Main)", lat: 19.0810, lng: 72.8330, radius: 300,
    baseRisk: 1.8, types: ["pickpocket"], nightOverride: 3.0,
    source: "osm+inferred", area: "Santacruz West" },

  // Rizvi Nagar: upscale housing, wide roads, good lighting,
  // private security in many buildings, low crime [inferred]
  { name: "SCW – Rizvi Nagar",              lat: 19.0785, lng: 72.8332, radius: 200,
    baseRisk: 1.5, types: [], nightOverride: 2.2,
    source: "inferred", area: "Santacruz West" },

  // Podar School area / 64th Road: wide well-lit residential roads,
  // security guards, high-profile residents, very safe [inferred]
  { name: "SCW – Podar School / 64th Road", lat: 19.0858, lng: 72.8298, radius: 250,
    baseRisk: 1.3, types: [], nightOverride: 2.0,
    source: "inferred", area: "Santacruz West" },

  // Juhu Road (Santacruz section): wide road, well-lit, cafes/restaurants
  // open late, footfall throughout evening [osm + inferred]
  { name: "SCW – Juhu Road",                lat: 19.0852, lng: 72.8315, radius: 280,
    baseRisk: 1.8, types: ["pickpocket"], nightOverride: 2.5,
    source: "osm+inferred", area: "Santacruz West" },

  // Church Avenue / Convent Avenue: quiet Catholic neighbourhood,
  // tree-lined, well-maintained, very low crime historically [inferred]
  { name: "SCW – Church & Convent Avenue",  lat: 19.0800, lng: 72.8310, radius: 200,
    baseRisk: 1.2, types: [], nightOverride: 2.0,
    source: "inferred", area: "Santacruz West" },

  // RBI Quarters / Vithaldas Nagar: gated government colony,
  // internal security, very safe at all hours [inferred]
  { name: "SCW – RBI Quarters",             lat: 19.0845, lng: 72.8345, radius: 180,
    baseRisk: 1.0, types: [], nightOverride: 1.5,
    source: "inferred", area: "Santacruz West" },

  // SNDT campus area (Juhu Tara Road): campus security, well-lit
  // internally, moderate pedestrian activity [osm + inferred]
  { name: "SCW – SNDT Campus Area",         lat: 19.0830, lng: 72.8288, radius: 220,
    baseRisk: 1.5, types: [], nightOverride: 2.5,
    source: "osm+inferred", area: "Santacruz West" },

  // Santacruz Police Station vicinity: immediate area around police
  // station, very low risk due to constant police presence [inferred]
  { name: "SCW – Police Station Area",      lat: 19.0820, lng: 72.8385, radius: 120,
    baseRisk: 0.8, types: [], nightOverride: 1.0,
    source: "inferred", area: "Santacruz West" },
  { name: "Versova",         lat: 19.1318, lng: 72.8150, radius: 500,  baseRisk: 2.5, types: ["pickpocket"] },
  { name: "Hiranandani",     lat: 19.1175, lng: 72.9068, radius: 600,  baseRisk: 1.5, types: [] },
  { name: "Lower Parel",     lat: 18.9956, lng: 72.8261, radius: 500,  baseRisk: 2.8, types: ["theft"], nightOverride: 3.5 },
  { name: "BKC",             lat: 19.0633, lng: 72.8659, radius: 700,  baseRisk: 1.8, types: [] },
  { name: "Lokhandwala",     lat: 19.1334, lng: 72.8270, radius: 500,  baseRisk: 2.0, types: ["pickpocket"] },
  { name: "Goregaon West",   lat: 19.1622, lng: 72.8511, radius: 600,  baseRisk: 2.5, types: ["theft"] },
];

// ── Get all crime zones (ready to swap for Firestore later) ──
async function getCrimeZones() {
  // FUTURE: const snap = await db.collection('crimeData').get();
  // return snap.docs.map(d => d.data());
  return MUMBAI_CRIME_ZONES;
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
