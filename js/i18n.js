/* ============================================================
   SAFETY PATH – Regional Language Switcher (i18n.js)
   Adds a language picker covering India's major state/official
   languages, powered by the Google Website Translator.
   Works across index.html, register.html and dashboard.html —
   the chosen language persists (localStorage + cookie) as the
   user moves between pages.
   ============================================================ */

(function () {
  // Code -> label shown in the picker. Codes match Google Translate's
  // supported set so every entry below actually works.
  const LANGUAGES = [
    { code: 'en',       label: 'English' },
    { code: 'hi',       label: 'हिंदी (Hindi)' },
    { code: 'bn',       label: 'বাংলা (Bengali)' },
    { code: 'mr',       label: 'मराठी (Marathi)' },
    { code: 'te',       label: 'తెలుగు (Telugu)' },
    { code: 'ta',       label: 'தமிழ் (Tamil)' },
    { code: 'gu',       label: 'ગુજરાતી (Gujarati)' },
    { code: 'ur',       label: 'اردو (Urdu)' },
    { code: 'kn',       label: 'ಕನ್ನಡ (Kannada)' },
    { code: 'or',       label: 'ଓଡ଼ିଆ (Odia)' },
    { code: 'ml',       label: 'മലയാളം (Malayalam)' },
    { code: 'pa',       label: 'ਪੰਜਾਬੀ (Punjabi)' },
    { code: 'as',       label: 'অসমীয়া (Assamese)' },
    { code: 'mai',      label: 'मैथिली (Maithili)' },
    { code: 'bho',      label: 'भोजपुरी (Bhojpuri)' },
    { code: 'gom',      label: 'कोंकणी (Konkani)' },
    { code: 'ne',       label: 'नेपाली (Nepali)' },
    { code: 'sd',       label: 'سنڌي (Sindhi)' },
    { code: 'doi',      label: 'डोगरी (Dogri)' },
    { code: 'mni-Mtei', label: 'ꯃꯤꯇꯩꯂꯣꯟ (Manipuri)' },
    { code: 'sa',       label: 'संस्कृतम् (Sanskrit)' },
  ];

  const STORAGE_KEY = 'sp_lang';
  const included = LANGUAGES.filter(l => l.code !== 'en').map(l => l.code).join(',');

  function getSavedLang() {
    try { return localStorage.getItem(STORAGE_KEY) || 'en'; }
    catch (e) { return 'en'; }
  }

  function setCookie(lang) {
    const value = lang === 'en' ? '' : `/en/${lang}`;
    const host = window.location.hostname;
    // Clear + set on both bare path and hostname so Google's widget reads it
    // no matter which one it looks for.
    document.cookie = `googtrans=; path=/; expires=Thu, 01 Jan 1970 00:00:00 UTC`;
    if (lang !== 'en') {
      document.cookie = `googtrans=${value}; path=/`;
      if (host) document.cookie = `googtrans=${value}; path=/; domain=${host}`;
    }
  }

  function applyLanguage(lang, reload) {
    try { localStorage.setItem(STORAGE_KEY, lang); } catch (e) {}
    setCookie(lang);
    if (reload) window.location.reload();
  }

  function injectStyles() {
    if (document.getElementById('sp-i18n-style')) return;
    const style = document.createElement('style');
    style.id = 'sp-i18n-style';
    style.textContent = `
      /* Hide Google's default UI chrome — we drive it with our own dropdown */
      .goog-te-banner-frame.skiptranslate,
      iframe.goog-te-banner-frame,
      #goog-te-banner-frame,
      #goog-gt-tt, .goog-te-balloon-frame,
      .goog-tooltip, .goog-tooltip:hover,
      .goog-text-highlight { display: none !important; visibility: hidden !important; height: 0 !important; background: none !important; box-shadow: none !important; }
      body { top: 0px !important; }
      #google_translate_element { display: none !important; }

      .lang-switch { position: relative; display: inline-block; }
      .lang-switch .lang-btn {
        display: flex; align-items: center; gap: 0.35rem;
        background: var(--input-bg, rgba(45,212,191,0.06));
        border: 1px solid var(--border, #1e2d45);
        color: var(--fg, var(--white, #f0f4ff));
        font-family: var(--font-b, var(--font-body, sans-serif));
        font-size: 0.78rem; font-weight: 600;
        padding: 0.45rem 0.7rem; border-radius: 8px;
        cursor: pointer; white-space: nowrap;
      }
      .lang-switch .lang-btn:hover { border-color: var(--teal, #2dd4bf); }
      .lang-switch .lang-menu {
        display: none; position: absolute; top: calc(100% + 6px); right: 0;
        min-width: 210px; max-height: 320px; overflow-y: auto;
        background: var(--card, #161d2e); border: 1px solid var(--border, #1e2d45);
        border-radius: 10px; box-shadow: 0 12px 32px rgba(0,0,0,0.5);
        z-index: 9999; padding: 0.35rem;
      }
      .lang-switch .lang-menu.open { display: block; }
      .lang-switch .lang-opt {
        padding: 0.5rem 0.65rem; border-radius: 6px; cursor: pointer;
        font-size: 0.85rem; color: var(--fg, var(--white, #f0f4ff));
        font-family: var(--font-b, var(--font-body, sans-serif));
      }
      .lang-switch .lang-opt:hover { background: var(--teal-glow, rgba(0,201,167,0.15)); }
      .lang-switch .lang-opt.active { color: var(--teal, #2dd4bf); font-weight: 700; }
      .lang-switch.floating {
        position: fixed; top: 1rem; right: 1rem; z-index: 9998;
      }
    `;
    document.head.appendChild(style);
  }

  // Google's own script sets `body.style.top = "40px"` and injects a banner <iframe>
  // the moment a language is applied. The CSS above already hides it in the vast
  // majority of cases; this JS pass is just a backstop for browsers/timing where the
  // stylesheet doesn't win the race. Note: this only ever HIDES the element (style
  // changes) — it must never remove() it from the DOM. The banner iframe is part of
  // how Google's widget tracks its own translation state; actually deleting it (an
  // earlier version of this file did) stopped the underlying translation from working
  // at all, not just its banner.
  function killGoogleBanner() {
    if (document.body && document.body.style.top && document.body.style.top !== '0px') {
      document.body.style.top = '0px';
    }
    document.querySelectorAll('iframe.goog-te-banner-frame, .goog-te-banner-frame, #goog-te-banner-frame').forEach(hideEl);
    document.querySelectorAll('iframe').forEach(el => {
      if (el.src && el.src.indexOf('translate.google') !== -1) hideEl(el);
    });
  }
  function hideEl(el) {
    el.style.display = 'none';
    el.style.visibility = 'hidden';
    el.style.height = '0';
  }

  function watchForGoogleBanner() {
    killGoogleBanner();
    const observer = new MutationObserver(killGoogleBanner);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['style'],
      subtree: true,
      childList: true
    });
    // Belt-and-braces fallback in case the observer misses a timing window.
    setInterval(killGoogleBanner, 250);
  }

  // ── Keep dynamically-added text translated (lightly) ──────────
  // Google's widget only translates the text nodes that exist in the DOM at the
  // moment it finishes its first pass, so content this app renders after that
  // (SOS status, chat replies, toasts, etc.) stays in English. The standard way to
  // programmatically re-run Google's translation is to set the hidden
  // <select class="goog-te-combo"> it creates to the active language and dispatch
  // a change event. An earlier version of this file did that continuously, on
  // every DOM mutation — that turned out to destabilize the widget over a longer
  // session (translation would eventually stop working at all). This version only
  // does it a couple of times shortly after the page loads, which is enough to
  // pick up content rendered just after the widget boots, without repeatedly
  // poking Google's translation state for as long as the tab stays open.
  function triggerTranslate() {
    const lang = getSavedLang();
    if (lang === 'en') return;
    const combo = document.querySelector('select.goog-te-combo');
    if (!combo) return;
    if (combo.value !== lang) combo.value = lang;
    combo.dispatchEvent(new Event('change'));
  }

  function buildSwitcher(container, floating) {
    const wrap = document.createElement('div');
    wrap.className = 'lang-switch' + (floating ? ' floating' : '');

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'lang-btn';
    btn.setAttribute('aria-label', 'Change language / भाषा बदलें');
    btn.id = 'sp-lang-btn';

    const menu = document.createElement('div');
    menu.className = 'lang-menu';
    menu.id = 'sp-lang-menu';

    const current = getSavedLang();

    function labelFor(code) {
      const found = LANGUAGES.find(l => l.code === code);
      return found ? found.label : 'English';
    }

    btn.innerHTML = `🌐 <span id="sp-lang-current">${labelFor(current)}</span>`;

    LANGUAGES.forEach(l => {
      const opt = document.createElement('div');
      opt.className = 'lang-opt' + (l.code === current ? ' active' : '');
      opt.textContent = l.label;
      opt.dataset.code = l.code;
      opt.addEventListener('click', () => {
        menu.classList.remove('open');
        // applyLanguage() reloads the page immediately, and init() loads Google's widget
        // fresh on that reload — starting it here too would just be a wasted, cancelled
        // network request, so there's nothing else to do before applyLanguage().
        if (l.code !== current) applyLanguage(l.code, true);
      });
      menu.appendChild(opt);
    });

    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      menu.classList.toggle('open');
    });
    document.addEventListener('click', () => menu.classList.remove('open'));

    wrap.appendChild(btn);
    wrap.appendChild(menu);
    container.appendChild(wrap);
  }

  function loadGoogleTranslate() {
    if (window.google && window.google.translate) return;
    if (document.getElementById('sp-gt-script')) return;

    const holder = document.createElement('div');
    holder.id = 'google_translate_element';
    document.body.appendChild(holder);

    window.googleTranslateElementInit = function () {
      new google.translate.TranslateElement({
        pageLanguage: 'en',
        includedLanguages: included,
        autoDisplay: false,
        layout: google.translate.TranslateElement.InlineLayout.SIMPLE
      }, 'google_translate_element');
    };

    const script = document.createElement('script');
    script.id = 'sp-gt-script';
    script.src = 'https://translate.google.com/translate_a/element.js?cb=googleTranslateElementInit';
    document.body.appendChild(script);
  }

  function init() {
    injectStyles();

    // Apply the previously saved language before the widget boots.
    const saved = getSavedLang();
    if (saved !== 'en') setCookie(saved);

    // Only load Google's translate script/banner when a non-English language is
    // actually in use — an English-language visit never touches it, so there is
    // nothing that can appear over the page's own controls.
    if (saved !== 'en') {
      loadGoogleTranslate();
      watchForGoogleBanner();
      // A couple of delayed passes to catch content rendered just after the widget
      // boots — see the comment on triggerTranslate() above for why this is no
      // longer a continuous/repeating loop.
      setTimeout(triggerTranslate, 1500);
      setTimeout(triggerTranslate, 4000);
    }

    const target = document.getElementById('lang-switcher-root');
    if (target) {
      buildSwitcher(target, false);
    } else {
      buildSwitcher(document.body, true);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
