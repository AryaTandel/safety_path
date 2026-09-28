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
async function triggerEmergencyAlert(authId, lat, lng) {
  try {
    // Get user profile including emergency contact
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

    // Decrypt emergency contact details
    const key            = await getCryptoKey(authId);
    const emergencyPhone = await decryptText(userData.emergency_phone, key);
    const emergencyEmail = await decryptText(userData.emergency_email || '', key);
    const userName       = await decryptText(userData.name, key);

    // 🔍 Debug: log decrypted values (remove after testing)
    console.log('[SOS] Decrypted emergency phone:', emergencyPhone);
    console.log('[SOS] Decrypted emergency email:', emergencyEmail);
    console.log('[SOS] Decrypted user name:', userName);

    if (!emergencyPhone && !emergencyEmail) throw new Error('No emergency contact details found — please update your profile');

    // Build location details
    const mapsLink = `https://www.google.com/maps?q=${lat},${lng}&z=17`;
    const timeStr  = new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });

    // Hide the WhatsApp button — not needed
    const btn = document.getElementById('whatsapp-alert-btn');
    if (btn) btn.style.display = 'none';

    // ✅ Send email automatically via EmailJS
    emailjs.send(
      'service_ke75bcc',
      'template_uffum8a',
      {
        to_email:  emergencyEmail,
        user_name: userName,
        time:      timeStr,
        maps_link: mapsLink,
      }
    ).then(() => {
      console.log('[EMAIL] Sent successfully to:', emergencyEmail);
    }).catch(e => {
      console.warn('[EMAIL] Failed:', e);
    });

    return { success: true, alertId: data.id };
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
// Sequence per check-in: listen for the safe word → if heard,
// immediately record a short clip and compare it against the
// user's enrolled voiceprint (see js/voice-auth.js). The countdown
// only resets when BOTH the word and the voice match.
class VoiceVerifiedCheckIn {
  constructor(authId, callbacks = {}) {
    this.authId     = authId;
    this.onVerified  = callbacks.onVerified  || function(){}; // (transcript, score)
    this.onMismatch  = callbacks.onMismatch  || function(){}; // (transcript, score) — word heard, voice didn't match
    this.onNoProfile = callbacks.onNoProfile || function(){}; // (transcript) — no voice enrolled, word-only fallback
    this.onNoSpeech  = callbacks.onNoSpeech  || function(){}; // nothing heard in time
    this.recognition = null;
    this.busy = false;
  }

  // Listens once. Call again for the next check-in cycle.
  async listenOnce(timeoutMs = 8000) {
    if (this.busy) return;
    this.busy = true;

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) { this.busy = false; this.onNoSpeech('no_speech_api'); return; }

    const transcript = await this._captureTranscript(SpeechRecognition, timeoutMs);
    console.log('[VOICE] transcript heard:', transcript);
    if (!transcript) { this.busy = false; this.onNoSpeech('timeout'); return; }

    const langCfg = (typeof getVoiceLangConfig === 'function') ? getVoiceLangConfig() : null;
    const saidSafe = (typeof isSafeTranscript === 'function')
      ? isSafeTranscript(transcript, langCfg)
      : ['safe','ok','okay','fine','yes','haan','theek','all good','no problem'].some(w => transcript.includes(w));
    console.log('[VOICE] contains safe word?', saidSafe);
    if (!saidSafe) { this.busy = false; this.onNoSpeech('no_safe_word'); return; }

    try {
      const enrolled = await hasVoiceProfile(this.authId);
      console.log('[VOICE] has enrolled profile?', enrolled);
      if (!enrolled) { this.busy = false; this.onNoProfile(transcript); return; }

      let result = await verifyVoiceSample(this.authId);
      console.log('[VOICE] match result:', result);
      // A single noisy sample (traffic, wind, a shaky hand on the phone) can dip a
      // genuine match just under the threshold. Give it one immediate second try
      // before treating it as a real mismatch — the safe word was already heard,
      // so this doesn't cost an extra "who's there" prompt, just one retry.
      if (!result.matched && result.reason === 'ok') {
        console.log('[VOICE] first attempt did not match — retrying once');
        const retry = await verifyVoiceSample(this.authId);
        console.log('[VOICE] retry match result:', retry);
        if (retry.matched || retry.score > result.score) result = retry;
      }
      this.busy = false;
      if (result.matched) this.onVerified(transcript, result.score);
      else                 this.onMismatch(transcript, result.score);
    } catch (e) {
      console.warn('[VOICE] verification error:', e);
      this.busy = false;
      // Fail safe: treat as mismatch rather than silently letting the timer reset
      this.onMismatch(transcript, 0);
    }
  }

  _captureTranscript(SpeechRecognition, timeoutMs) {
    return new Promise(resolve => {
      const recognition = new SpeechRecognition();
      this.recognition = recognition;
      const langCfg = (typeof getVoiceLangConfig === 'function') ? getVoiceLangConfig() : null;
      recognition.lang = langCfg ? langCfg.speech : 'en-US';
      recognition.maxAlternatives = 3;

      let done = false;
      const timer = setTimeout(() => {
        if (!done) { done = true; console.log('[VOICE] recognition timed out with no result'); try { recognition.stop(); } catch(e){} resolve(null); }
      }, timeoutMs);

      recognition.onresult = (event) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        console.log('[VOICE] raw results:', JSON.stringify(
          Array.from(event.results).map(r => ({ transcript: r[0].transcript, confidence: r[0].confidence, isFinal: r.isFinal }))
        ));
        const text = Array.from(event.results).map(r => r[0].transcript.toLowerCase()).join(' ');
        resolve(text);
      };
      recognition.onerror = (event) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        console.warn('[VOICE] recognition error:', event.error);
        resolve(null);
      };

      try { recognition.start(); console.log('[VOICE] recognition.start() called'); } catch (e) { console.warn('[VOICE] recognition.start() threw:', e); clearTimeout(timer); resolve(null); }
    });
  }

  stop() {
    if (this.recognition) { try { this.recognition.stop(); } catch(e){} }
  }
}

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
