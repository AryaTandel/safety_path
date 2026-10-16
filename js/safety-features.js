// ============================================================
//  SAFETY PATH – Route Rating + Emergency Alert Module
// ============================================================

// NOTE: map is initialized in dashboard.html — do NOT re-initialize here

// ── Save a route rating to Supabase (with encryption) ────────
async function saveRouteRating(userId, routeData, rating, comment = '', mood = 0) {
  try {
    const key = await getCryptoKey(userId);

    const encryptedPolyline = await encryptText(routeData.polyline || '', key);
    const encryptedComment  = await encryptText(comment, key);

    const hour = new Date().getHours();

    const { error } = await supabase
      .from('route_ratings')
      .insert({
        user_id:        userId,
        from_lat:       routeData.fromLat,
        from_lng:       routeData.fromLng,
        to_lat:         routeData.toLat,
        to_lng:         routeData.toLng,
        route_polyline: encryptedPolyline,   // 🔒 encrypted
        safety_rating:  rating,
        mood:           mood,
        time_slot:      getTimeSlot(hour),
        comment:        encryptedComment,    // 🔒 encrypted
      });

    if (error) throw error;
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

// ── Trigger emergency alert ───────────────────────────────────
// Emails EVERY saved emergency contact (see js/emergency-contacts.js).
// Falls back to the legacy single contact on the users row if the
// emergency_contacts table isn't set up yet.
async function triggerEmergencyAlert(authId, lat, lng) {
  try {
    const { data: userData } = await supabase
      .from('users')
      .select('id, emergency_phone, emergency_email, name')
      .eq('auth_id', authId)
      .single();

    if (!userData) throw new Error('User not found');

    // Save alert to database
    const { data, error } = await supabase
      .from('emergency_alerts')
      .insert({
        user_id:        userData.id,
        lat,
        lng,
        resolved:       false,
        voice_verified: false,
      })
      .select()
      .single();

    if (error) throw error;

    const key      = await getCryptoKey(authId);
    const userName = await decryptText(userData.name, key);

    // Collect recipients: all saved contacts, else the legacy single one.
    let recipients = [];
    try {
      if (typeof listEmergencyContacts === 'function') {
        recipients = (await listEmergencyContacts(authId)).filter(c => c.email);
      }
    } catch (e) { console.warn('[SOS] Could not load contact list, using legacy contact:', e); }

    if (!recipients.length) {
      const email = await decryptText(userData.emergency_email || '', key);
      if (email) recipients = [{ name: '', email }];
    }
    if (!recipients.length) throw new Error('No emergency contact with an email address found — add one under Emergency Contacts');

    const mapsLink = `https://www.google.com/maps?q=${lat},${lng}&z=17`;
    const timeStr  = new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });

    const btn = document.getElementById('whatsapp-alert-btn');
    if (btn) btn.style.display = 'none';

    // Send to everyone; one failure must not stop the others.
    const results = await Promise.allSettled(recipients.map(c =>
      emailjs.send('service_ke75bcc', 'template_uffum8a', {
        to_email:  c.email,
        user_name: userName,
        time:      timeStr,
        maps_link: mapsLink,
      })
    ));
    const sent = results.filter(r => r.status === 'fulfilled').length;
    results.forEach((r, i) => { if (r.status === 'rejected') console.warn('[EMAIL] Failed for contact #' + (i + 1), r.reason); });
    if (sent === 0) throw new Error('Alert saved, but the emails could not be sent — check your connection.');

    return { success: true, alertId: data.id, sent, total: recipients.length };
  } catch (e) {
    console.error('Emergency alert error:', e);
    return { success: false, error: e.message };
  }
}

// ── Resolve emergency alert ───────────────────────────────────
async function resolveEmergencyAlert(alertId) {
  const { error } = await supabase
    .from('emergency_alerts')
    .update({
      resolved: true,
      resolved_at: new Date().toISOString()
    })
    .eq('id', alertId);
  return { success: !error };
}

// ── Time slot helper ──────────────────────────────────────────
function getTimeSlot(hour) {
  if (hour >= 5  && hour < 12) return 'morning';
  if (hour >= 12 && hour < 17) return 'afternoon';
  if (hour >= 17 && hour < 21) return 'evening';
  return 'night';
}

// ── Voice check-in logic ──────────────────────────────────────
class VoiceCheckIn {
  constructor(onSafe, onUnsafe, onTimeout) {
    this.onSafe    = onSafe;
    this.onUnsafe  = onUnsafe;
    this.onTimeout = onTimeout;
    this.recognition = null;
    this.interval = null;
    this.active = false;
    this.checkCount = 0;
  }

  start(intervalMinutes = 5) {
    this.active = true;
    this.checkCount = 0;
    this._doCheckIn();
    this.interval = setInterval(() => {
      if (this.active) this._doCheckIn();
    }, intervalMinutes * 60 * 1000);
  }

  stop() {
    this.active = false;
    if (this.interval) clearInterval(this.interval);
    if (this.recognition) this.recognition.stop();
  }

  _doCheckIn() {
    this.checkCount++;
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      this.onTimeout && this.onTimeout(this.checkCount);
      return;
    }
    this.recognition = new SpeechRecognition();
    const langCfg = (typeof getVoiceLangConfig === 'function') ? getVoiceLangConfig() : null;
    this.recognition.lang = langCfg ? langCfg.speech : 'en-IN';
    this.recognition.maxAlternatives = 3;

    let heard = false;
    const timeout = setTimeout(() => {
      if (!heard) {
        this.recognition.stop();
        this.onTimeout && this.onTimeout(this.checkCount);
      }
    }, 10000);

    this.recognition.onresult = (event) => {
      heard = true;
      clearTimeout(timeout);
      const transcript = Array.from(event.results)
        .map(r => r[0].transcript.toLowerCase())
        .join(' ');
      const isSafe = (typeof isSafeTranscript === 'function')
        ? isSafeTranscript(transcript, langCfg)
        : ['safe','ok','okay','fine','yes','haan','theek','all good','no problem'].some(w => transcript.includes(w));
      if (isSafe) this.onSafe && this.onSafe(transcript, this.checkCount);
      else        this.onUnsafe && this.onUnsafe(transcript, this.checkCount);
    };

    this.recognition.onerror = () => {
      clearTimeout(timeout);
      this.onTimeout && this.onTimeout(this.checkCount);
    };

    this.recognition.start();
  }
}

// ── Voice-VERIFIED check-in — replaces tap-to-confirm ─────────
// One listening window per SOS countdown cycle:
//   1. The mic is recorded in the background WHILE speech recognition listens.
//   2. Recognition keeps restarting until the safe word is heard or the window
//      ends (browsers stop it after every pause / "no-speech" — the old code
//      listened once and then gave up for the rest of the 15 s).
//   3. When the safe word is heard, the recording of that same utterance is
//      matched against the enrolled voiceprint (js/voice-auth.js). The countdown
//      only resets when BOTH the word and the voice match.
//   4. If the browser won't share the mic between recogniser and recorder
//      (some Android builds), it falls back to a short "say it once more" clip.
class VoiceVerifiedCheckIn {
  constructor(authId, callbacks = {}) {
    this.authId       = authId;
    this.onVerified   = callbacks.onVerified   || function(){}; // (transcript, score)
    this.onMismatch   = callbacks.onMismatch   || function(){}; // (transcript, score) — word heard, voice didn't match
    this.onNoProfile  = callbacks.onNoProfile  || function(){}; // (transcript, reason) — no usable voiceprint, word-only fallback
    this.onNoSpeech   = callbacks.onNoSpeech   || function(){}; // window ended without the safe word
    this.onHeard      = callbacks.onHeard      || function(){}; // (text) — something was heard but it wasn't the safe word
    this.onPrompt     = callbacks.onPrompt     || function(){}; // (message) — asking the user to repeat for verification
    this.onUnsupported= callbacks.onUnsupported|| function(){}; // (reason) — voice can't work here (no API / mic blocked)
    this.recognition  = null;
    this.bgRecorder   = null;
    this.busy         = false;
    this.verifying    = false;   // true while matching the voice — the SOS timer waits for it
    this._session     = 0;       // bumped by every listenOnce()/stop() so a superseded run can't touch a newer one
    this._sequential  = false;   // remembered once the browser refuses recorder + recogniser together
  }

  async listenOnce(timeoutMs = 8000) {
    if (this.busy) return;
    this.busy = true;
    const sess  = ++this._session;
    const stale = () => sess !== this._session;

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) { this.busy = false; this.onUnsupported('no_speech_api'); return; }

    const deadline = Date.now() + timeoutMs;
    const langCfg  = (typeof getVoiceLangConfig === 'function') ? getVoiceLangConfig() : null;
    let heardSafe = null;   // array of alternative transcripts

    try {
      if (!this._sequential) {
        const rec = await startBackgroundVoiceRecorder();
        if (stale()) { if (rec) rec.discard(); return; }   // stopped while the mic was opening
        this.bgRecorder = rec;
      }

      while (!stale() && Date.now() < deadline && !heardSafe) {
        const r = await this._listenWindow(SpeechRecognition, langCfg, deadline - Date.now());
        if (stale()) break;

        if (r.safe)            { heardSafe = r.alts; break; }
        if (r.alts && r.alts.length) this.onHeard(r.alts[0]);

        if (r.error === 'not-allowed' || r.error === 'service-not-allowed') {
          this._cleanup(); this.busy = false; this.onUnsupported('mic_blocked'); return;
        }
        if (r.error === 'audio-capture' && this.bgRecorder) {
          // The recogniser couldn't get the mic while the recorder holds it.
          console.warn('[VOICE] recorder and recogniser conflict — switching to sequential mode');
          this.bgRecorder.discard(); this.bgRecorder = null; this._sequential = true;
        }
        if (r.error === 'network') { await _vcSleep(600); }   // speech service hiccup — retry
        else                       { await _vcSleep(120); }
      }
    } catch (e) {
      console.warn('[VOICE] listen loop error:', e);
    }

    if (stale()) return;   // stop() already cleaned up
    if (!heardSafe)    { this._cleanup(); this.busy = false; this.onNoSpeech('timeout'); return; }

    // ── Safe word heard → verify the voice ──
    const transcript = heardSafe[0];
    this.verifying = true;
    try {
      const enrolled = await hasVoiceProfile(this.authId);
      if (!enrolled) { this._finish(); this.onNoProfile(transcript, 'no_profile'); return; }

      // Grab the recording of the utterance (short post-roll so the tail isn't cut off).
      let buf = null;
      if (this.bgRecorder) { await _vcSleep(350); buf = await this.bgRecorder.finish(); this.bgRecorder = null; }

      let result = await verifyVoiceSample(this.authId, buf || undefined);
      console.log('[VOICE] match result:', result);

      // Nothing usable in the background clip (silent track, muted, decode failure)
      // → ask the user to say it once more and record that instead.
      if (!buf || result.reason === 'no_audio') {
        if (stale()) return;
        this.onPrompt('Say "I\'m safe" once more to verify your voice…');
        await _vcSleep(300);
        result = await verifyVoiceSample(this.authId);
        console.log('[VOICE] sequential match result:', result);
      } else if (!result.matched && result.reason === 'ok') {
        // One noisy sample can dip a genuine match just under the threshold —
        // give a single fresh attempt before calling it a real mismatch.
        if (!stale()) {
          this.onPrompt('Not sure that was you — say "I\'m safe" once more…');
          await _vcSleep(300);
          const retry = await verifyVoiceSample(this.authId);
          console.log('[VOICE] retry match result:', retry);
          if (retry.matched || retry.score > result.score) result = retry;
        }
      }

      if (stale()) return;
      this._finish();
      if (result.reason === 'no_profile' || result.reason === 'outdated_profile') this.onNoProfile(transcript, result.reason);
      else if (result.reason === 'no_audio')                                      this.onMismatch(transcript, 0);
      else if (result.matched)                                                    this.onVerified(transcript, result.score);
      else                                                                        this.onMismatch(transcript, result.score);
    } catch (e) {
      console.warn('[VOICE] verification error:', e);
      if (stale()) return;
      this._finish();
      // Fail safe: a mic that can't be used is "couldn't verify", never a silent reset
      this.onMismatch(transcript, 0);
    }
  }

  // One recognition session. Resolves when it ends (result, error or timeout).
  // Resolves EARLY — mid-sentence, from interim results — as soon as the safe word shows up.
  _listenWindow(SpeechRecognition, langCfg, remainingMs) {
    return new Promise(resolve => {
      const recognition = new SpeechRecognition();
      this.recognition = recognition;
      recognition.lang = langCfg ? langCfg.speech : 'en-IN';
      recognition.maxAlternatives = 5;
      recognition.interimResults = true;
      recognition.continuous = false;

      let done = false, lastAlts = [];
      const finish = (out) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        try { recognition.onresult = recognition.onerror = recognition.onend = null; recognition.stop(); } catch (e) {}
        resolve(out);
      };
      const timer = setTimeout(() => finish({ alts: lastAlts, error: 'timeout' }), Math.max(300, remainingMs));

      recognition.onresult = (event) => {
        const res = event.results[event.results.length - 1];
        const alts = Array.from(res).map(a => a.transcript.toLowerCase().trim()).filter(Boolean);
        if (alts.length) lastAlts = alts;
        console.log('[VOICE] heard', res.isFinal ? '(final)' : '(interim)', alts);
        const safe = (typeof isSafeTranscript === 'function')
          ? isSafeTranscript(alts, langCfg)
          : alts.some(t => /\b(safe|ok|okay|fine)\b/.test(t) && !/\b(not|unsafe|help)\b/.test(t));
        if (safe) finish({ safe: true, alts });
        else if (res.isFinal) finish({ alts });
      };
      recognition.onerror = (event) => {
        console.warn('[VOICE] recognition error:', event.error);
        finish({ alts: lastAlts, error: event.error });
      };
      recognition.onend = () => finish({ alts: lastAlts });

      try { recognition.start(); }
      catch (e) { console.warn('[VOICE] recognition.start() threw:', e); finish({ alts: [], error: 'start-failed' }); }
    });
  }

  _cleanup() {
    if (this.recognition) { try { this.recognition.onresult = this.recognition.onerror = this.recognition.onend = null; this.recognition.stop(); } catch (e) {} this.recognition = null; }
    if (this.bgRecorder)  { this.bgRecorder.discard(); this.bgRecorder = null; }
  }

  _finish() { this._cleanup(); this.verifying = false; this.busy = false; }

  stop() {
    this._session++;
    this._cleanup();
    this.verifying = false;
    this.busy = false;
  }
}

function _vcSleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── Fetch dynamic risk adjustments from user ratings ──────────
async function getRatingAdjustments() {
  try {
    const { data, error } = await supabase
      .rpc('get_area_risk_adjustments');
    if (error) throw error;
    return data || [];
  } catch(e) {
    console.warn('Could not fetch rating adjustments:', e);
    return [];
  }
}
