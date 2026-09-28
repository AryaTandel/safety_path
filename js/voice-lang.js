// ============================================================
//  SAFETY PATH – Voice Check-In Language Config
// ------------------------------------------------------------
//  Google Translate (js/i18n.js) only rewrites the TEXT on the
//  page — it has no effect on the SOS voice check-in, which uses
//  the browser's Web Speech API to LISTEN for a spoken safe-word.
//  This file gives that listener a per-language speech locale
//  (e.g. "hi-IN") plus a list of native-script safe-word phrases
//  to match against, so "I'm safe" is recognised in the user's
//  own language instead of only English.
//
//  IMPORTANT / HONEST LIMITATION:
//  The Web Speech API in Chrome/Android (which is what powers
//  SpeechRecognition here) only understands a subset of Indian
//  languages. For languages it can't transcribe natively, we
//  fall back to English recognition ("en-IN") but still accept
//  a few common romanized native words, and we flag that
//  language as `speechSupported:false` so the UI can tell the
//  user the spoken safe-word must be said in English or Hindi.
// ============================================================

const VOICE_LANG_MAP = {
  en: {
    label: 'English', speech: 'en-IN', speechSupported: true,
    safeWords: ['safe', 'ok', 'okay', 'fine', 'yes', 'all good', 'no problem']
  },
  hi: {
    label: 'हिंदी (Hindi)', speech: 'hi-IN', speechSupported: true,
    safeWords: ['सुरक्षित', 'ठीक', 'ठीक हूँ', 'हाँ', 'सब ठीक है', 'मैं सुरक्षित हूँ', 'theek', 'haan', 'safe']
  },
  bn: {
    label: 'বাংলা (Bengali)', speech: 'bn-IN', speechSupported: true,
    safeWords: ['নিরাপদ', 'ঠিক আছে', 'হ্যাঁ', 'আমি নিরাপদ', 'safe']
  },
  mr: {
    label: 'मराठी (Marathi)', speech: 'mr-IN', speechSupported: true,
    safeWords: ['सुरक्षित', 'ठीक आहे', 'हो', 'मी सुरक्षित आहे', 'safe']
  },
  te: {
    label: 'తెలుగు (Telugu)', speech: 'te-IN', speechSupported: true,
    safeWords: ['సురక్షితం', 'బాగానే ఉన్నాను', 'అవును', 'నేను సురక్షితంగా ఉన్నాను', 'safe']
  },
  ta: {
    label: 'தமிழ் (Tamil)', speech: 'ta-IN', speechSupported: true,
    safeWords: ['பாதுகாப்பாக இருக்கிறேன்', 'சரி', 'ஆம்', 'பாதுகாப்பு', 'safe']
  },
  gu: {
    label: 'ગુજરાતી (Gujarati)', speech: 'gu-IN', speechSupported: true,
    safeWords: ['સુરક્ષિત', 'બરાબર', 'હા', 'હું સુરક્ષિત છું', 'safe']
  },
  kn: {
    label: 'ಕನ್ನಡ (Kannada)', speech: 'kn-IN', speechSupported: true,
    safeWords: ['ಸುರಕ್ಷಿತ', 'ಸರಿ', 'ಹೌದು', 'ನಾನು ಸುರಕ್ಷಿತವಾಗಿದ್ದೇನೆ', 'safe']
  },
  ml: {
    label: 'മലയാളം (Malayalam)', speech: 'ml-IN', speechSupported: true,
    safeWords: ['സുരക്ഷിതം', 'ശരി', 'അതെ', 'ഞാൻ സുരക്ഷിതനാണ്', 'ഞാൻ സുരക്ഷിതയാണ്', 'safe']
  },
  ur: {
    label: 'اردو (Urdu)', speech: 'ur-IN', speechSupported: true,
    safeWords: ['محفوظ', 'ٹھیک ہے', 'ہاں', 'میں محفوظ ہوں', 'safe']
  },
  pa: {
    label: 'ਪੰਜਾਬੀ (Punjabi)', speech: 'pa-Guru-IN', speechSupported: true,
    safeWords: ['ਸੁਰੱਖਿਅਤ', 'ਠੀਕ ਹੈ', 'ਹਾਂ', 'ਮੈਂ ਸੁਰੱਖਿਅਤ ਹਾਂ', 'safe']
  },
  // Browser speech recognition doesn't reliably support these yet — voice
  // check falls back to English recognition, but we still keep the native
  // words in the list in case a romanized/mixed phrase comes through.
  or: {
    label: 'ଓଡ଼ିଆ (Odia)', speech: 'en-IN', speechSupported: false,
    safeWords: ['ସୁରକ୍ଷିତ', 'ଠିକ୍ ଅଛି', 'ହଁ', 'safe', 'ok']
  },
  as: {
    label: 'অসমীয়া (Assamese)', speech: 'en-IN', speechSupported: false,
    safeWords: ['সুৰক্ষিত', 'ঠিক আছে', 'হয়', 'safe', 'ok']
  },
  ne: {
    label: 'नेपाली (Nepali)', speech: 'ne-NP', speechSupported: true,
    safeWords: ['सुरक्षित', 'ठिक छ', 'हो', 'म सुरक्षित छु', 'safe']
  },
  mai: {
    label: 'मैथिली (Maithili)', speech: 'en-IN', speechSupported: false,
    safeWords: ['सुरक्षित', 'ठीक छी', 'safe', 'ok']
  },
  bho: {
    label: 'भोजपुरी (Bhojpuri)', speech: 'en-IN', speechSupported: false,
    safeWords: ['सुरक्षित बानी', 'ठीक बा', 'safe', 'ok']
  },
  gom: {
    label: 'कोंकणी (Konkani)', speech: 'en-IN', speechSupported: false,
    safeWords: ['सुरक्षीत', 'बरें आसा', 'safe', 'ok']
  },
  sd: {
    label: 'سنڌي (Sindhi)', speech: 'en-IN', speechSupported: false,
    safeWords: ['محفوظ', 'ٺيڪ آهي', 'safe', 'ok']
  },
  doi: {
    label: 'डोगरी (Dogri)', speech: 'en-IN', speechSupported: false,
    safeWords: ['सुरक्षित', 'ठीक ऐ', 'safe', 'ok']
  },
  'mni-Mtei': {
    label: 'ꯃꯤꯇꯩꯂꯣꯟ (Manipuri)', speech: 'en-IN', speechSupported: false,
    safeWords: ['ꯅꯤꯡꯃꯤ ꯑꯃꯤꯅꯤ', 'safe', 'ok']
  },
  sa: {
    label: 'संस्कृतम् (Sanskrit)', speech: 'en-IN', speechSupported: false,
    safeWords: ['सुरक्षितः', 'सुरक्षिता', 'सम्यक्', 'आम्', 'safe', 'ok']
  }
};

const VOICE_LANG_FALLBACK = VOICE_LANG_MAP.en;
const VOICE_LANG_STORAGE_KEY = 'sp_voice_lang'; // independent of the UI display language (sp_lang)

// Reads the language the user picked specifically for the SOS voice
// check-in. Falls back to the UI display language, then to English,
// if no explicit voice-language choice has been made.
function getVoiceLangConfig() {
  let lang = null;
  try { lang = localStorage.getItem(VOICE_LANG_STORAGE_KEY); } catch (e) {}
  if (!lang) {
    try { lang = localStorage.getItem('sp_lang'); } catch (e) {}
  }
  return VOICE_LANG_MAP[lang] || VOICE_LANG_FALLBACK;
}

function getVoiceLangCode() {
  let lang = null;
  try { lang = localStorage.getItem(VOICE_LANG_STORAGE_KEY); } catch (e) {}
  if (!lang) {
    try { lang = localStorage.getItem('sp_lang'); } catch (e) {}
  }
  return VOICE_LANG_MAP[lang] ? lang : 'en';
}

function setVoiceLangCode(lang) {
  if (!VOICE_LANG_MAP[lang]) return false;
  try { localStorage.setItem(VOICE_LANG_STORAGE_KEY, lang); } catch (e) {}
  return true;
}

function isSafeTranscript(transcript, langConfig) {
  if (!transcript) return false;
  const cfg = langConfig || getVoiceLangConfig();
  const t = transcript.toLowerCase();
  // Native-script words won't be affected by .toLowerCase(); this still
  // correctly matches the romanized/English entries in each list.
  return cfg.safeWords.some(w => transcript.includes(w) || t.includes(w.toLowerCase()));
}
