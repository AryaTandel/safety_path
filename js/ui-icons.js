/* ============================================================
   SafePath – UI icons
   Replaces emoji characters with consistent line icons so the
   interface reads as one designed system. Purely presentational:
   it never touches inputs, scripts or attribute values, and it
   keeps watching so dynamically rendered text is converted too.
   ============================================================ */
(function () {
  'use strict';

  var P = {
    shield:   '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
    shieldok: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9 12 2 2 4-4"/>',
    check:    '<circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/>',
    pin:      '<path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0z"/><circle cx="12" cy="10" r="3"/>',
    alert:    '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/>',
    info:     '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
    mobile:   '<rect x="6" y="2" width="12" height="20" rx="2"/><path d="M11 18h2"/>',
    lock:     '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
    siren:    '<path d="M7 18v-6a5 5 0 0 1 10 0v6"/><path d="M5 21h14M12 2v2M4.2 6.2l1.4 1.4M19.8 6.2l-1.4 1.4"/>',
    train:    '<rect x="5" y="3" width="14" height="14" rx="3"/><path d="M5 11h14M9 21l2-4M15 21l-2-4"/><path d="M9 14h.01M15 14h.01"/>',
    hospital: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M12 8v6M9 11h6"/>',
    school:   '<path d="M3 21h18M5 21V8l7-5 7 5v13"/><path d="M10 21v-6h4v6"/>',
    cap:      '<path d="M22 9 12 4 2 9l10 5 10-5z"/><path d="M6 11v5c0 1.5 2.7 3 6 3s6-1.5 6-3v-5"/>',
    tree:     '<path d="M12 22v-6"/><path d="M7 16a4 4 0 0 1-1-7.7A5 5 0 0 1 12 3a5 5 0 0 1 6 5.3A4 4 0 0 1 17 16z"/>',
    bank:     '<path d="M3 10 12 4l9 6"/><path d="M5 10v8M9.5 10v8M14.5 10v8M19 10v8M3 21h18"/>',
    umbrella: '<path d="M3 12a9 9 0 0 1 18 0z"/><path d="M12 12v8a2 2 0 0 0 4 0"/>',
    mail:     '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>',
    bed:      '<path d="M2 18V7M2 14h20v4M22 14v-3a3 3 0 0 0-3-3h-9v6"/><circle cx="6" cy="11" r="2"/>',
    pill:     '<path d="m10.5 20.5 10-10a4.95 4.95 0 0 0-7-7l-10 10a4.95 4.95 0 0 0 7 7z"/><path d="m8.5 8.5 7 7"/>',
    card:     '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/>',
    dining:   '<path d="M7 3v8M4 3v5a3 3 0 0 0 6 0V3M7 11v10"/><path d="M17 21V3c-2.5 1.5-3 5-3 8h3"/>',
    walk:     '<circle cx="13" cy="4" r="1.5"/><path d="m9 21 3-7-2-3 3-3 3 3h3M12 14l3 3v4M10 11l-3 2"/>',
    bike:     '<circle cx="6" cy="17" r="3.5"/><circle cx="18" cy="17" r="3.5"/><path d="M6 17 9 8h6l3 9M9 8H7M12 17 9 8"/>',
    car:      '<path d="M4 16v-4l2-5h12l2 5v4z"/><path d="M4 12h16M6 16v3M18 16v3"/>',
    bolt:     '<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>',
    volume:   '<path d="M11 5 6 9H2v6h4l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14"/>',
    mute:     '<path d="M11 5 6 9H2v6h4l5 4z"/><path d="m22 9-6 6M16 9l6 6"/>',
    user:     '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
    users:    '<circle cx="9" cy="8" r="3.5"/><path d="M2 20a7 7 0 0 1 14 0M16 4.5a3.5 3.5 0 0 1 0 7M22 20a6 6 0 0 0-4-5.6"/>',
    brief:    '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M3 13h18"/>',
    globe:    '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
    mic:      '<rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v4"/>',
    sunrise:  '<path d="M17 18a5 5 0 0 0-10 0M12 9V3M4.2 10.2l1.4 1.4M1 18h2M21 18h2M18.4 11.6l1.4-1.4M23 22H1M8 6l4-4 4 4"/>',
    sun:      '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
    sunset:   '<path d="M17 18a5 5 0 0 0-10 0M12 9V2M4.2 10.2l1.4 1.4M1 18h2M21 18h2M18.4 11.6l1.4-1.4M23 22H1M16 5l-4 4-4-4"/>',
    moon:     '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>',
    temple:   '<path d="M12 3 4 9h16zM6 9v10M18 9v10M10 19v-5h4v5M3 21h18"/>',
    cart:     '<circle cx="9" cy="20" r="1.5"/><circle cx="18" cy="20" r="1.5"/><path d="M2 3h3l2.5 12h11l2-8H6"/>',
    flag:     '<path d="M5 22V4M5 4h13l-2 4 2 4H5"/>',
    shuffle:  '<path d="M16 3h5v5M4 20 21 3M21 16v5h-5M15 15l6 6M4 4l5 5"/>',
    flask:    '<path d="M9 3h6M10 3v6L4 19a2 2 0 0 0 2 3h12a2 2 0 0 0 2-3l-6-10V3"/>',
    bus:      '<rect x="4" y="3" width="16" height="15" rx="2"/><path d="M4 11h16M7 21v-3M17 21v-3"/><path d="M8 14.5h.01M16 14.5h.01"/>',
    cake:     '<path d="M4 21h16v-8H4zM4 17c2 1.5 3.5 1.5 5 0s3.5-1.5 5 0 3.5 1.5 6 0M12 13V8M12 4v1"/>',
    phone:    '<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2z"/>',
    chart:    '<path d="M3 21h18M6 21V11M12 21V4M18 21v-7"/>',
    bell:     '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.9 1.9 0 0 0 3.4 0"/>',
    clock:    '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    ruler:    '<path d="M3 17 17 3l4 4L7 21zM8 12l2 2M11 9l2 2M14 6l2 2"/>',
    heart:    '<path d="M12 21s-8-5-8-11a4.5 4.5 0 0 1 8-2.8A4.5 4.5 0 0 1 20 10c0 6-8 11-8 11z"/>',
    refresh:  '<path d="M21 12a9 9 0 0 1-15.5 6.2L3 16M3 12a9 9 0 0 1 15.5-6.2L21 8M3 21v-5h5M21 3v5h-5"/>',
    chat:     '<path d="M21 12a8 8 0 0 1-11.5 7.2L3 21l1.8-5.5A8 8 0 1 1 21 12z"/>',
    bot:      '<rect x="4" y="8" width="16" height="12" rx="3"/><path d="M12 4v4M9 14h.01M15 14h.01"/>',
    send:     '<path d="M22 2 11 13M22 2l-7 20-4-9-9-4z"/>',
    search:   '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>'
  };

  // emoji -> [icon, tone]
  var MAP = {
    '🛡️':['shield'],'🛡':['shield'],'✅':['check','ok'],'📍':['pin'],'⚠️':['alert','warn'],'⚠':['alert','warn'],
    'ℹ️':['info'],'📱':['mobile'],'🔒':['lock'],'🚨':['siren','danger'],'🚉':['train'],'🚆':['train'],'🚇':['train'],
    '🏥':['hospital'],'🏫':['school'],'🎓':['cap'],'🌳':['tree'],'🏦':['bank'],'🏖️':['umbrella'],'🏖':['umbrella'],
    '📮':['mail'],'✉️':['mail'],'✉':['mail'],'🏨':['bed'],'👮':['shield'],'💊':['pill'],'🏧':['card'],
    '🍽️':['dining'],'🍽':['dining'],'🚶':['walk'],'🚲':['bike'],'🚗':['car'],'🚕':['car'],'🛺':['car'],
    '🎉':['check','ok'],'⚡':['bolt'],'🔊':['volume'],'🔇':['mute'],'👤':['user'],'⚧':['user'],'👥':['users'],
    '💼':['brief'],'🌐':['globe'],'🎙️':['mic'],'🎙':['mic'],'🌅':['sunrise'],'☀️':['sun'],'☀':['sun'],
    '🌆':['sunset'],'🌙':['moon'],'🛕':['temple'],'🛒':['cart'],'🚩':['flag'],'🏁':['flag'],'🔀':['shuffle'],
    '🧪':['flask'],'🚌':['bus'],'🎂':['cake'],'📞':['phone'],'📊':['chart'],'🔔':['bell'],'🕐':['clock'],
    '📏':['ruler'],'🙏':['heart'],'🔄':['refresh'],'💬':['chat'],'🤖':['bot'],'➤':['send'],'🔍':['search']
  };

  var keys = Object.keys(MAP).sort(function (a, b) { return b.length - a.length; });
  var RE = new RegExp('(' + keys.map(function (k) { return k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }).join('|') + ')\\uFE0F?', 'g');
  var SKIP = { SCRIPT: 1, STYLE: 1, TEXTAREA: 1, INPUT: 1, OPTION: 1, SELECT: 1, TITLE: 1, NOSCRIPT: 1, SVG: 1, svg: 1 };

  function svg(name, tone) {
    var s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    s.setAttribute('viewBox', '0 0 24 24');
    s.setAttribute('class', 'ui-ico' + (tone ? ' ui-' + tone : ''));
    s.setAttribute('aria-hidden', 'true');
    s.innerHTML = P[name];
    return s;
  }

  function convert(node) {
    var text = node.nodeValue;
    RE.lastIndex = 0;
    if (!RE.test(text)) return;
    RE.lastIndex = 0;
    var frag = document.createDocumentFragment(), last = 0, m;
    while ((m = RE.exec(text))) {
      if (m.index > last) frag.appendChild(document.createTextNode(text.slice(last, m.index)));
      var def = MAP[m[1]];
      frag.appendChild(svg(def[0], def[1]));
      last = m.index + m[0].length;
    }
    if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
    node.parentNode.replaceChild(frag, node);
  }

  function walk(root) {
    if (!root) return;
    if (root.nodeType === 3) { if (root.parentNode && !SKIP[root.parentNode.nodeName]) convert(root); return; }
    if (root.nodeType !== 1 || SKIP[root.nodeName]) return;
    var w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: function (n) {
        var p = n.parentNode;
        return p && !SKIP[p.nodeName] ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
      }
    });
    var list = [], n;
    while ((n = w.nextNode())) list.push(n);
    list.forEach(convert);
  }

  function injectCSS() {
    if (document.getElementById('ui-icons-css')) return;
    var st = document.createElement('style');
    st.id = 'ui-icons-css';
    st.textContent =
      '.ui-ico{width:1.12em;height:1.12em;vertical-align:-0.2em;display:inline-block;flex-shrink:0;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}' +
      '.ui-ok{color:#2e8b64}.ui-warn{color:#c47a1d}.ui-danger{color:#c93c3c}' +
      '.icon .ui-ico,.cat-icon .ui-ico{width:1em;height:1em;vertical-align:middle}';
    document.head.appendChild(st);
  }

  function start() {
    injectCSS();
    walk(document.body);
    new MutationObserver(function (muts) {
      muts.forEach(function (m) {
        if (m.type === 'characterData') walk(m.target);
        else m.addedNodes.forEach(walk);
      });
    }).observe(document.body, { childList: true, subtree: true, characterData: true });
  }

  if (document.body) start(); else document.addEventListener('DOMContentLoaded', start);
})();
