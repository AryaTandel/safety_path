// ============================================================
//  SAFETY PATH – Route Rating + Emergency Alert Module
// ============================================================

// NOTE: map is initialized in dashboard.html — do NOT re-initialize here

// ── Save a route rating to Firestore ─────────────────────────
async function saveRouteRating(userId, routeData, rating, comment = '', mood = 0) {
  const hour = new Date().getHours();
  try {
    await db.collection('routeRatings').add({
      userId,
      fromLat: routeData.fromLat,
      fromLng: routeData.fromLng,
      toLat: routeData.toLat,
      toLng: routeData.toLng,
      routePolyline: routeData.polyline || '',
      safetyRating: rating,         // 1–5 stars
      mood: mood,                   // 1–5 emoji mood (0 = not provided)
      timeOfTravel: firebase.firestore.FieldValue.serverTimestamp(),
      timeSlot: getTimeSlot(hour),
      comment: comment
    });
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

// ── Trigger emergency alert ───────────────────────────────────
async function triggerEmergencyAlert(userId, lat, lng) {
  try {
    const ref = await db.collection('emergencyAlerts').add({
      userId,
      triggeredAt: firebase.firestore.FieldValue.serverTimestamp(),
      location: new firebase.firestore.GeoPoint(lat, lng),
      resolvedAt: null,
      resolved: false,
      voiceVerified: false
    });
    return { success: true, alertId: ref.id };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

// ── Resolve emergency alert ───────────────────────────────────
async function resolveEmergencyAlert(alertId) {
  try {
    await db.collection('emergencyAlerts').doc(alertId).update({
      resolved: true,
      resolvedAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

// ── Voice check-in logic ──────────────────────────────────────
// Uses Web Speech API for voice recognition
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
    // First check immediately
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
      // Fallback: show button-based check-in
      this.onTimeout && this.onTimeout(this.checkCount);
      return;
    }
    this.recognition = new SpeechRecognition();
    this.recognition.lang = 'en-IN';
    this.recognition.maxAlternatives = 3;

    let heard = false;
    const timeout = setTimeout(() => {
      if (!heard) {
        this.recognition.stop();
        this.onTimeout && this.onTimeout(this.checkCount);
      }
    }, 10000); // 10s to respond

    this.recognition.onresult = (event) => {
      heard = true;
      clearTimeout(timeout);
      const transcript = Array.from(event.results)
        .map(r => r[0].transcript.toLowerCase())
        .join(' ');
      // Safe keywords: "safe", "ok", "fine", "haan", "yes", "theek"
      const safeWords = ['safe','ok','okay','fine','yes','haan','theek','all good','no problem'];
      const isSafe = safeWords.some(w => transcript.includes(w));
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
