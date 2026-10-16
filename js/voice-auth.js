// ============================================================
//  SAFETY PATH – Voice Identity Verification Module
// ------------------------------------------------------------
//  Purpose: let the SOS check-in timer reset ONLY when it hears
//  the enrolled user's own voice — not just anyone saying "safe".
//
//  HOW IT WORKS (honest summary):
//  This is a lightweight, fully client-side "voiceprint" — a
//  spectral fingerprint (frequency shape + pitch) of how someone
//  sounds, extracted with plain Web Audio math. It is NOT the
//  same as commercial speaker-verification (which uses trained
//  neural models on a server). It's good enough to stop a casual
//  "different person says the safe word" bypass, but a very good
//  recording/impression of the real user could still fool it.
//  For production use, swap verifyVoiceSample() for a call to a
//  real speaker-verification API (Azure Speaker Recognition,
//  Picovoice Eagle, etc.) — everything else (DB schema, UI,
//  SOS wiring) stays the same.
// ============================================================

const VOICE_SAMPLE_MS   = 2500;   // length of each ENROLLMENT recording (speech is picked out of it, so a late start is fine)
const VOICE_VERIFY_MS   = 2500;   // length of the fallback "say it once more" verification recording
const VOICE_SEGMENT_SEC = 1.6;    // loudest slice of any recording that is actually analysed (same for enrol + verify)
const VOICE_PROFILE_VERSION = 2;  // bump when the feature maths changes — older voiceprints must be re-recorded
const VOICE_SPECTRAL_THRESHOLD = 0.68; // cosine similarity on spectral shape, 0-1 (loosened — 0.80 was
                                        // rejecting genuine users too often; mic/room/background noise
                                        // shifts a lightweight spectral fingerprint more than that)
const VOICE_PITCH_TOLERANCE    = 0.22; // normalized pitch gate — widened from 0.15 for the same reason
const VOICE_FEATURE_BINS = 24;    // spectral envelope resolution

// Same mic settings for enrolment and verification so the two recordings are comparable.
const VOICE_AUDIO_CONSTRAINTS = { audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: true } };

function _voiceSleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── Decode a recorded Blob into an AudioBuffer ──
async function decodeVoiceBlob(blob) {
  const arrayBuffer = await blob.arrayBuffer();
  const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  try {
    // callback form: older Safari doesn't return a promise from decodeAudioData
    return await new Promise((resolve, reject) => audioCtx.decodeAudioData(arrayBuffer, resolve, reject));
  } finally { try { audioCtx.close(); } catch (e) {} }
}

// ── Low-level: record N ms of audio from the mic, return AudioBuffer ──
// onStart() fires the moment recording has really begun (after the permission
// prompt and mic warm-up), so the UI can say "speak now" at the right time
// instead of while the first second is still being thrown away.
async function recordVoiceClip(durationMs = VOICE_SAMPLE_MS, onStart) {
  const stream = await navigator.mediaDevices.getUserMedia(VOICE_AUDIO_CONSTRAINTS);
  return new Promise((resolve, reject) => {
    try {
      const chunks = [];
      const mime = (window.MediaRecorder && MediaRecorder.isTypeSupported('audio/webm')) ? 'audio/webm' : '';
      const recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);

      recorder.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data); };
      recorder.onstop = async () => {
        stream.getTracks().forEach(t => t.stop()); // release mic immediately
        try { resolve(await decodeVoiceBlob(new Blob(chunks, { type: recorder.mimeType || mime || 'audio/webm' }))); }
        catch (err) { reject(err); }
      };
      recorder.onerror = e => { stream.getTracks().forEach(t => t.stop()); reject(e.error || e); };

      recorder.start();
      if (onStart) { try { onStart(); } catch (e) {} }
      setTimeout(() => { if (recorder.state !== 'inactive') recorder.stop(); }, durationMs);
    } catch (err) {
      stream.getTracks().forEach(t => t.stop());
      reject(err);
    }
  });
}

// ── Background recorder: keeps the mic open WHILE speech recognition is
// listening, so the very same utterance ("I'm safe") that is transcribed is
// also what gets voice-matched. Returns null if the browser won't allow it
// (then the caller falls back to a separate "say it once more" recording).
async function startBackgroundVoiceRecorder() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || !window.MediaRecorder) return null;
  let stream;
  try { stream = await navigator.mediaDevices.getUserMedia(VOICE_AUDIO_CONSTRAINTS); }
  catch (e) { console.warn('[VOICE] background recorder: mic unavailable', e); return null; }

  const chunks = [];
  const mime = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : '';
  let recorder;
  try {
    recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    recorder.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data); };
    recorder.start(250);
  } catch (e) { stream.getTracks().forEach(t => t.stop()); return null; }

  const release = () => stream.getTracks().forEach(t => t.stop());
  return {
    // Stops recording and resolves with the decoded AudioBuffer (or null).
    async finish() {
      await new Promise(res => {
        if (recorder.state === 'inactive') return res();
        recorder.onstop = () => res();
        try { recorder.stop(); } catch (e) { res(); }
      });
      release();
      if (!chunks.length) return null;
      try { return await decodeVoiceBlob(new Blob(chunks, { type: recorder.mimeType || mime || 'audio/webm' })); }
      catch (e) { console.warn('[VOICE] could not decode background recording', e); return null; }
    },
    discard() {
      try { if (recorder.state !== 'inactive') recorder.stop(); } catch (e) {}
      release();
    }
  };
}

// ── Minimal in-place iterative radix-2 FFT ─────────────────────
function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wRe = Math.cos(ang), wIm = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let curRe = 1, curIm = 0;
      for (let k = 0; k < len / 2; k++) {
        const uRe = re[i + k],        uIm = im[i + k];
        const vRe = re[i + k + len/2] * curRe - im[i + k + len/2] * curIm;
        const vIm = re[i + k + len/2] * curIm + im[i + k + len/2] * curRe;
        re[i + k] = uRe + vRe;         im[i + k] = uIm + vIm;
        re[i + k + len/2] = uRe - vRe; im[i + k + len/2] = uIm - vIm;
        const nextRe = curRe * wRe - curIm * wIm;
        const nextIm = curRe * wIm + curIm * wRe;
        curRe = nextRe; curIm = nextIm;
      }
    }
  }
}

function nextPow2(n) { return 1 << Math.ceil(Math.log2(n)); }

// Picks the loudest VOICE_SEGMENT_SEC of a (possibly 15 s long, mostly silent)
// recording — that's where the user actually spoke. Averaging the whole clip,
// as before, blended silence/room noise into the "voiceprint" and made genuine
// matches fail at random.
function extractSpeechSegment(raw, sampleRate) {
  const segLen = Math.floor(VOICE_SEGMENT_SEC * sampleRate);
  if (raw.length <= segLen) return raw;
  const step = Math.max(1, Math.floor(sampleRate * 0.02));
  const n = Math.floor(raw.length / step);
  const energy = new Float64Array(n + 1); // prefix sums of per-20ms energy
  for (let i = 0; i < n; i++) {
    let e = 0;
    for (let j = i * step, end = j + step; j < end; j++) e += raw[j] * raw[j];
    energy[i + 1] = energy[i] + e;
  }
  const win = Math.floor(segLen / step);
  let best = 0, bestE = -1;
  for (let i = 0; i + win <= n; i++) {
    const e = energy[i + win] - energy[i];
    if (e > bestE) { bestE = e; best = i; }
  }
  return raw.subarray(best * step, best * step + segLen);
}

// ── Extract a compact spectral-envelope + pitch feature vector ──
// Only frames that actually contain speech contribute. Returns null when the
// recording has no usable speech in it (silence / mic muted / too quiet).
function computeVoiceFeatures(audioBuffer) {
  const sampleRate = audioBuffer.sampleRate;
  const raw = extractSpeechSegment(audioBuffer.getChannelData(0), sampleRate);

  const frameSize = 2048;
  const hop = 1024;

  // Pass 1: loudness of every frame, to tell speech from background.
  const frames = [];
  for (let start = 0; start + frameSize <= raw.length; start += hop) {
    let e = 0;
    for (let i = 0; i < frameSize; i++) e += raw[start + i] * raw[start + i];
    frames.push({ start, rms: Math.sqrt(e / frameSize) });
  }
  if (frames.length < 3) return null;
  const sortedRms = frames.map(f => f.rms).sort((a, b) => a - b);
  const ref = sortedRms[Math.floor(sortedRms.length * 0.9)];
  if (ref < 0.0015) return null;                       // basically silence
  const voiced = frames.filter(f => f.rms >= ref * 0.4);
  if (voiced.length < 3) return null;

  // Pass 2: spectral envelope over voiced frames only.
  const bins = new Float32Array(VOICE_FEATURE_BINS);
  for (const fr of voiced) {
    const re = new Float32Array(frameSize);
    const im = new Float32Array(frameSize);
    for (let i = 0; i < frameSize; i++) {
      // Hann window to reduce spectral leakage
      const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (frameSize - 1));
      re[i] = raw[fr.start + i] * w;
    }
    fft(re, im);

    const half = frameSize / 2;
    const magnitude = new Float32Array(half);
    for (let i = 0; i < half; i++) magnitude[i] = Math.hypot(re[i], im[i]);

    // Log-spaced binning (rough mel approximation) from ~80Hz to ~4000Hz
    const minHz = 80, maxHz = 4000;
    for (let b = 0; b < VOICE_FEATURE_BINS; b++) {
      const f0 = minHz * Math.pow(maxHz / minHz, b / VOICE_FEATURE_BINS);
      const f1 = minHz * Math.pow(maxHz / minHz, (b + 1) / VOICE_FEATURE_BINS);
      const i0 = Math.max(1, Math.floor((f0 / sampleRate) * frameSize));
      const i1 = Math.min(half - 1, Math.max(i0, Math.ceil((f1 / sampleRate) * frameSize)));
      let sum = 0, count = 0;
      for (let i = i0; i <= i1; i++) { sum += magnitude[i]; count++; }
      bins[b] += count ? sum / count : 0;
    }
  }
  for (let b = 0; b < VOICE_FEATURE_BINS; b++) bins[b] /= voiced.length;

  // L2-normalise the spectral envelope so loudness doesn't affect matching
  let norm = 0;
  for (let b = 0; b < VOICE_FEATURE_BINS; b++) norm += bins[b] * bins[b];
  norm = Math.sqrt(norm) || 1;
  const spectral = Array.from(bins, v => v / norm);

  // Rough pitch estimate (helps separate different speakers — pitch is one of
  // the most distinctive differences between two people's voices)
  const pitchHz = estimatePitch(raw, sampleRate);
  const pitchNorm = Math.max(0, Math.min(1, (pitchHz - 70) / (400 - 70)));

  return { spectral, pitchNorm, voicedFrames: voiced.length };
}

// Normalised-autocorrelation pitch tracker, median over voiced frames.
// The frame must span at least two periods of the lowest pitch we look for
// (70 Hz) — the old 1024-sample frame was too short at 44.1/48 kHz, so low
// voices got random pitches and tripped the pitch gate.
function estimatePitch(samples, sampleRate) {
  const minLag = Math.floor(sampleRate / 400);
  const maxLag = Math.floor(sampleRate / 70);
  const N   = Math.max(maxLag * 2, Math.round(sampleRate * 0.04));
  const hop = Math.round(N / 2);
  const pitches = [];

  for (let start = 0; start + N <= samples.length; start += hop) {
    const x = new Float32Array(N);
    let mean = 0;
    for (let i = 0; i < N; i++) mean += samples[start + i];
    mean /= N;
    for (let i = 0; i < N; i++) x[i] = samples[start + i] - mean;

    const sq = new Float64Array(N + 1);           // prefix sums of x² for O(1) segment energy
    for (let i = 0; i < N; i++) sq[i + 1] = sq[i] + x[i] * x[i];
    if (sq[N] / N < 1e-6) continue;               // near-silence

    const nacf = new Float32Array(maxLag + 2);
    let best = 0;
    for (let lag = minLag; lag <= maxLag; lag++) {
      let corr = 0;
      for (let i = 0; i < N - lag; i++) corr += x[i] * x[i + lag];
      const eA = sq[N - lag], eB = sq[N] - sq[lag];
      const v = corr / (Math.sqrt(eA * eB) || 1);
      nacf[lag] = v;
      if (v > best) best = v;
    }
    if (best < 0.45) continue;                    // unvoiced / noisy frame

    // Take the SHORTEST lag that is a local peak close to the best one —
    // avoids locking onto a sub-harmonic (octave-down error).
    let pick = -1;
    for (let lag = minLag + 1; lag < maxLag; lag++) {
      if (nacf[lag] >= best * 0.9 && nacf[lag] >= nacf[lag - 1] && nacf[lag] >= nacf[lag + 1]) { pick = lag; break; }
    }
    if (pick > 0) pitches.push(sampleRate / pick);
  }

  if (pitches.length === 0) return 150;           // no voiced frames — neutral mid-range default
  pitches.sort((a, b) => a - b);
  return pitches[Math.floor(pitches.length / 2)];
}

function cosineSimilarity(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  if (!na || !nb) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

// ── Enrollment: record 3 samples of the user saying their phrase ──
// Stores all 3 spectral vectors individually (not averaged) so verification
// can compare against the closest match, plus their pitch values for gating.
// onProgress(step, total, phase): phase is 'speak' once the mic is really
// recording, or 'retry' when a sample was too quiet and is being redone.
async function enrollUserVoice(authId, onProgress) {
  const TOTAL = 3;
  const spectralVectors = [];
  const pitchValues = [];

  for (let i = 0; i < TOTAL; i++) {
    let feat = null;
    for (let attempt = 0; attempt < 3 && !feat; attempt++) {
      if (attempt > 0) { onProgress && onProgress(i + 1, TOTAL, 'retry'); await _voiceSleep(900); }
      const buf = await recordVoiceClip(VOICE_SAMPLE_MS, () => onProgress && onProgress(i + 1, TOTAL, 'speak'));
      feat = computeVoiceFeatures(buf);
    }
    if (!feat) throw new Error('We couldn\'t hear you clearly — move somewhere quieter, hold the phone closer and try again.');
    spectralVectors.push(feat.spectral);
    pitchValues.push(feat.pitchNorm);
    await _voiceSleep(500);
  }

  const profile = { v: VOICE_PROFILE_VERSION, spectralVectors, pitchValues };
  const key = await getCryptoKey(authId);
  const encryptedProfile = await encryptText(JSON.stringify(profile), key);

  const { error } = await supabase
    .from('voice_profiles')
    .upsert({
      auth_id: authId,
      voiceprint: encryptedProfile,
      sample_count: TOTAL,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'auth_id' });

  if (error) throw error;
  return { success: true };
}

async function hasVoiceProfile(authId) {
  const { data, error } = await supabase
    .from('voice_profiles')
    .select('auth_id')
    .eq('auth_id', authId)
    .maybeSingle();
  if (error) { console.warn('hasVoiceProfile error:', error); return false; }
  return !!data;
}

// ── Verification: record a short clip and compare to the stored voiceprint ──
// Two checks must BOTH pass: spectral shape similarity (best match among the
// 3 enrolled samples) AND the pitch must be close to the enrolled average —
// pitch alone is a strong signal for telling two different people apart.
// `audioBuffer` is optional: when the caller already captured the utterance
// (VoiceVerifiedCheckIn records it while speech recognition listens), it is
// used directly; otherwise a fresh clip is recorded from the mic.
async function verifyVoiceSample(authId, audioBuffer) {
  const { data, error } = await supabase
    .from('voice_profiles')
    .select('voiceprint')
    .eq('auth_id', authId)
    .maybeSingle();

  if (error || !data) return { matched: null, score: 0, reason: 'no_profile' };

  const key = await getCryptoKey(authId);
  const storedJson = await decryptText(data.voiceprint, key);
  let stored;
  try { stored = JSON.parse(storedJson); } catch (e) { return { matched: null, score: 0, reason: 'outdated_profile' }; }
  // Voiceprints recorded before the v2 feature maths aren't comparable — ask for a re-record.
  if (!stored || stored.v !== VOICE_PROFILE_VERSION || !stored.spectralVectors) return { matched: null, score: 0, reason: 'outdated_profile' };

  const buf = audioBuffer || await recordVoiceClip(VOICE_VERIFY_MS);
  const sample = computeVoiceFeatures(buf);
  if (!sample) return { matched: null, score: 0, reason: 'no_audio' };

  // Best (max) spectral similarity against any of the 3 enrolled samples, averaged
  // with the second-best match. Using only the single best match makes the gate
  // brittle — one lucky enrolled sample could pass while normal mic/background
  // variation on every other attempt fails; averaging the top 2 is more stable
  // while still requiring the sample to genuinely resemble more than one enrollment.
  const scores = stored.spectralVectors.map(v => cosineSimilarity(v, sample.spectral)).sort((a, b) => b - a);
  const spectralScore = scores.length > 1 ? (scores[0] + scores[1]) / 2 : scores[0];

  const pitchMean = stored.pitchValues.reduce((a, b) => a + b, 0) / stored.pitchValues.length;
  const pitchDiff = Math.abs(sample.pitchNorm - pitchMean);
  const pitchOk = pitchDiff <= VOICE_PITCH_TOLERANCE;

  const matched = spectralScore >= VOICE_SPECTRAL_THRESHOLD && pitchOk;
  return {
    matched, score: spectralScore, pitchDiff, pitchOk,
    enrolledPitchHz: Math.round(70 + pitchMean * 330),
    samplePitchHz: Math.round(70 + sample.pitchNorm * 330),
    reason: 'ok'
  };
}
