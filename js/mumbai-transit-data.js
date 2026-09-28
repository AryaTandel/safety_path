// ============================================================
//  SAFETY PATH – Mumbai Transit Knowledge Base (used by the chatbot)
//
//  ⚠ Coordinates are approximate (±300 m) and fares are approximate
//  public figures. Edit freely: add a station by adding one line
//  "Name lat lng" to a line below. Interchanges are detected
//  automatically (same name, or different lines within 400 m).
// ============================================================
(function () {
  const parse = t => t.trim().split('\n').map(l => {
    const p = l.trim().split(/\s+/); const lng = +p.pop(), lat = +p.pop();
    return [p.join(' '), lat, lng];
  });

  const LINES = [
    { id: 'WR', type: 'train', name: 'Western Line', kmh: 36, stations: parse(`
      Churchgate 18.9322 72.8264
      Marine Lines 18.9438 72.8228
      Charni Road 18.9522 72.8237
      Grant Road 18.9636 72.8160
      Mumbai Central 18.9696 72.8196
      Mahalaxmi 18.9828 72.8237
      Lower Parel 18.9954 72.8300
      Prabhadevi 19.0072 72.8419
      Dadar 19.0186 72.8436
      Matunga Road 19.0271 72.8459
      Mahim 19.0410 72.8468
      Bandra 19.0544 72.8402
      Khar Road 19.0716 72.8407
      Santacruz 19.0816 72.8415
      Vile Parle 19.0996 72.8443
      Andheri 19.1197 72.8464
      Jogeshwari 19.1361 72.8490
      Ram Mandir 19.1508 72.8493
      Goregaon 19.1646 72.8493
      Malad 19.1864 72.8485
      Kandivali 19.2044 72.8517
      Borivali 19.2307 72.8567
      Dahisar 19.2502 72.8593
      Mira Road 19.2816 72.8560
      Bhayandar 19.3106 72.8524
      Naigaon 19.3506 72.8447
      Vasai Road 19.3826 72.8319
      Nalasopara 19.4172 72.8197
      Virar 19.4559 72.8112`) },
    { id: 'CR', type: 'train', name: 'Central Line', kmh: 36, stations: parse(`
      CSMT 18.9398 72.8355
      Masjid 18.9522 72.8385
      Sandhurst Road 18.9600 72.8420
      Byculla 18.9764 72.8329
      Currey Road 18.9947 72.8326
      Parel 18.9987 72.8407
      Dadar 19.0197 72.8442
      Matunga 19.0270 72.8500
      Sion 19.0390 72.8619
      Kurla 19.0654 72.8790
      Vidyavihar 19.0793 72.8975
      Ghatkopar 19.0860 72.9088
      Vikhroli 19.1108 72.9269
      Kanjurmarg 19.1298 72.9316
      Bhandup 19.1436 72.9376
      Nahur 19.1558 72.9459
      Mulund 19.1725 72.9560
      Thane 19.1860 72.9756
      Kalwa 19.1988 72.9990
      Mumbra 19.1877 73.0208
      Diva 19.1848 73.0435
      Dombivli 19.2183 73.0868
      Kalyan 19.2350 73.1305`) },
    { id: 'HB', type: 'train', name: 'Harbour Line', kmh: 36, stations: parse(`
      CSMT 18.9398 72.8355
      Dockyard Road 18.9553 72.8447
      Reay Road 18.9642 72.8473
      Cotton Green 18.9860 72.8490
      Sewri 18.9989 72.8579
      Wadala Road 19.0166 72.8578
      GTB Nagar 19.0396 72.8664
      Chunabhatti 19.0512 72.8712
      Kurla 19.0654 72.8790
      Tilak Nagar 19.0637 72.8940
      Chembur 19.0625 72.9009
      Govandi 19.0553 72.9160
      Mankhurd 19.0503 72.9320
      Vashi 19.0637 72.9985
      Nerul 19.0330 73.0186
      Belapur 19.0230 73.0400
      Panvel 18.9922 73.1102`) },
    { id: 'HA', type: 'train', name: 'Harbour (Kurla–Bandra link)', kmh: 36, stations: parse(`
      Kurla 19.0654 72.8790
      Bandra 19.0544 72.8402`) },
    { id: 'M1', type: 'metro', name: 'Metro Line 1 (Blue)', kmh: 31, stations: parse(`
      Versova 19.1318 72.8153
      D.N. Nagar 19.1247 72.8313
      Azad Nagar 19.1262 72.8368
      Andheri Metro 19.1201 72.8490
      Western Express Highway 19.1176 72.8556
      Chakala 19.1140 72.8640
      Airport Road 19.1103 72.8690
      Marol Naka 19.1090 72.8790
      Sakinaka 19.1040 72.8890
      Asalpha 19.0960 72.8980
      Jagruti Nagar 19.0910 72.9050
      Ghatkopar Metro 19.0860 72.9100`) },
    { id: 'M2A', type: 'metro', name: 'Metro Line 2A (Yellow)', kmh: 33, stations: parse(`
      Dahisar East 19.2590 72.8650
      Borivali West 19.2306 72.8467
      Kandivali West 19.2049 72.8399
      Malad West 19.1866 72.8365
      Goregaon West 19.1637 72.8360
      Oshiwara 19.1500 72.8340
      D.N. Nagar 19.1247 72.8313`) },
    { id: 'M7', type: 'metro', name: 'Metro Line 7 (Red)', kmh: 33, stations: parse(`
      Dahisar East 19.2590 72.8650
      Magathane 19.2110 72.8620
      Dindoshi 19.1750 72.8630
      Goregaon East 19.1630 72.8640
      Jogeshwari East 19.1400 72.8600
      Gundavali 19.1150 72.8562`) },
    { id: 'M3', type: 'metro', name: 'Metro Line 3 (Aqua)', kmh: 35, stations: parse(`
      Aarey JVLR 19.1450 72.8730
      SEEPZ 19.1287 72.8715
      Marol Naka 19.1090 72.8790
      CSMIA T2 19.0974 72.8743
      Santacruz Metro 19.0850 72.8600
      BKC 19.0674 72.8683
      Dharavi 19.0450 72.8550
      Dadar 19.0186 72.8436
      Siddhivinayak 19.0170 72.8302
      Worli 19.0140 72.8180
      Mahalaxmi 18.9828 72.8237
      Mumbai Central 18.9696 72.8196
      Grant Road 18.9636 72.8160
      CSMT 18.9398 72.8355
      Churchgate 18.9322 72.8264
      Cuffe Parade 18.9150 72.8180`) },
  ];

  // Popular places people ask about (name -> [lat, lng])
  const LANDMARKS = {
    'gateway of india': [18.9220, 72.8347], 'marine drive': [18.9440, 72.8232],
    'juhu beach': [19.0990, 72.8267], 'bandra bandstand': [19.0439, 72.8189],
    'bkc': [19.0674, 72.8683], 'bandra kurla complex': [19.0674, 72.8683],
    'airport t2': [19.0974, 72.8743], 'airport t1': [19.0980, 72.8560],
    'mumbai airport': [19.0974, 72.8743], 'powai': [19.1176, 72.9060],
    'iit bombay': [19.1334, 72.9133], 'siddhivinayak temple': [19.0170, 72.8302],
    'haji ali': [18.9827, 72.8089], 'colaba': [18.9217, 72.8318],
    'phoenix marketcity': [19.0866, 72.8890], 'sanjay gandhi national park': [19.2296, 72.8683],
    'juhu': [19.1075, 72.8263], 'worli sea face': [19.0110, 72.8150],
    'vt': [18.9398, 72.8355], 'cst': [18.9398, 72.8355], 'lokhandwala': [19.1378, 72.8290],
  };

  // ── Fare models (approximate — always verify before travel) ──
  const band = (km, arr) => { for (const [max, f] of arr) if (km <= max) return f; return arr[arr.length - 1][1]; };
  const FARES = {
    train2: km => band(km, [[10, 5], [20, 10], [30, 15], [50, 20], [999, 25]]),
    train1: km => band(km, [[10, 50], [20, 75], [30, 110], [50, 140], [999, 170]]),
    metro: km => band(km, [[3, 10], [12, 20], [18, 30], [24, 40], [30, 50], [999, 60]]),
    // BEST ordinary (non-AC) bus fare stages, revised May 2025: ₹10/₹20/₹30/₹35/₹40/₹45/₹50/₹55/₹60
    // for 5/10/15/20/25/30/35/40/45-50 km. AC buses run slightly higher — treat this as the
    // non-AC baseline and note that AC fares differ.
    bus: km => band(km, [[5, 10], [10, 20], [15, 30], [20, 35], [25, 40], [30, 45], [35, 50], [40, 55], [999, 60]]),
    auto: (km, night) => Math.round((26 + Math.max(0, km - 1.5) * 17.14) * (night ? 1.25 : 1)),
    taxi: (km, night) => Math.round((31 + Math.max(0, km - 1.5) * 20.66) * (night ? 1.25 : 1)),
    cab: (km, peak) => Math.round((60 + km * 15) * (peak ? 1.3 : 1)),
    fuel: km => Math.round(km * 9),
  };

  window.MUM_TRANSIT = { LINES, LANDMARKS, FARES };
})();
