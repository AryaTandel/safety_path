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

const VOICE_SAMPLE_MS   = 2200;   // length of each recording — a longer clip gives the spectral/pitch
                                   // estimate more real speech to average over
// NOTE: there used to be two fixed constants here (VOICE_SPECTRAL_THRESHOLD /
// VOICE_PITCH_TOLERANCE) applied the same way for every user. That kept being
// wrong in one direction or the other — strict enough to reject an impostor
// was also strict enough to reject the real user on an off day, and loose
// enough to reliably recognise the real user was loose enough to accept
// someone else. verifyVoiceSample() below now derives per-user thresholds
// from how consistent THAT user's own enrollment samples were with each
// other (see scoreAgainst()), which adapts to each person's actual mic/room
// instead of guessing one number for everyone.
const VOICE_FEATURE_BINS = 24;    // spectral envelope resolution

// ── Low-level: record N ms of audio from the mic, return AudioBuffer ──
async function recordVoiceClip(durationMs = VOICE_SAMPLE_MS) {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  return new Promise((resolve, reject) => {
    try {
      const chunks = [];
      const mime = MediaRecorder.isTypeSupported('audio/webm')
        ? 'audio/webm' : '';
      const recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);

      recorder.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data); };
      recorder.onstop = async () => {
        stream.getTracks().forEach(t => t.stop()); // release mic immediately
        try {
          const blob = new Blob(chunks, { type: mime || 'audio/webm' });
          const arrayBuffer = await blob.arrayBuffer();
          const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
          const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
          audioCtx.close();
          resolve(audioBuffer);
        } catch (err) { reject(err); }
      };
      recorder.onerror = e => { stream.getTracks().forEach(t => t.stop()); reject(e.error || e); };

      recorder.start();
      setTimeout(() => { if (recorder.state !== 'inactive') recorder.stop(); }, durationMs);
    } catch (err) {
      stream.getTracks().forEach(t => t.stop());
      reject(err);
    }
  });
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

// ── Extract a compact spectral-envelope + pitch feature vector ──
function computeVoiceFeatures(audioBuffer) {
  const raw = audioBuffer.getChannelData(0);
  const sampleRate = audioBuffer.sampleRate;

  const frameSize = 2048;
  const hop = 1024;
  const bins = new Float32Array(VOICE_FEATURE_BINS);
  let frameCount = 0;

  for (let start = 0; start + frameSize <= raw.length; start += hop) {
    const re = new Float32Array(frameSize);
    const im = new Float32Array(frameSize);
    for (let i = 0; i < frameSize; i++) {
      // Hann window to reduce spectral leakage
      const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (frameSize - 1));
      re[i] = raw[start + i] * w;
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
      const i1 = Math.min(half - 1, Math.ceil((f1 / sampleRate) * frameSize));
      let sum = 0, count = 0;
      for (let i = i0; i <= i1; i++) { sum += magnitude[i]; count++; }
      bins[b] += count ? sum / count : 0;
    }
    frameCount++;
  }

  if (frameCount === 0) return null;
  for (let b = 0; b < VOICE_FEATURE_BINS; b++) bins[b] /= frameCount;

  // L2-normalise the spectral envelope so loudness doesn't affect matching
  let norm = 0;
  for (let b = 0; b < VOICE_FEATURE_BINS; b++) norm += bins[b] * bins[b];
  norm = Math.sqrt(norm) || 1;
  const spectral = Array.from(bins, v => v / norm);

  // Rough pitch estimate via autocorrelation (helps separate different speakers —
  // pitch is one of the most distinctive differences between two people's voices)
  const pitchHz = estimatePitch(raw, sampleRate);
  const pitchNorm = Math.max(0, Math.min(1, (pitchHz - 70) / (400 - 70)));

  return { spectral, pitchNorm };
}

function estimatePitch(samples, sampleRate) {
  const minHz = 70, maxHz = 400;
  const maxLag = Math.floor(sampleRate / minHz);
  const minLag = Math.floor(sampleRate / maxHz);

  // Frame-based pitch estimation with a voicing-confidence gate, then take
  // the MEDIAN across frames. This is far more stable than one big
  // autocorrelation over the whole clip, which easily locks onto the wrong
  // harmonic (octave errors) when noise, silence, or breathiness is mixed in.
  const frameSize = 1024;
  const hop = 512;
  const pitches = [];

  for (let start = 0; start + frameSize <= samples.length; start += hop) {
    const frame = samples.subarray(start, start + frameSize);

    let energy = 0;
    for (let i = 0; i < frame.length; i++) energy += frame[i] * frame[i];
    if (energy < 1e-5) continue; // skip near-silence

    let bestLag = -1, bestCorr = 0;
    for (let lag = minLag; lag <= maxLag && lag < frame.length; lag++) {
      let corr = 0;
      for (let i = 0; i < frame.length - lag; i++) corr += frame[i] * frame[i + lag];
      if (corr > bestCorr) { bestCorr = corr; bestLag = lag; }
    }
    if (bestLag <= 0) continue;

    // Normalized confidence: how strong is this periodicity vs raw energy?
    const confidence = bestCorr / energy;
    if (confidence < 0.35) continue; // likely unvoiced/noisy — discard

    pitches.push(sampleRate / bestLag);
  }

  if (pitches.length === 0) return 150; // fallback mid-range default
  pitches.sort((a, b) => a - b);
  return pitches[Math.floor(pitches.length / 2)]; // median — robust to octave outliers
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
// Also measures how consistent THIS user's 3 samples are with each other
// (selfSim / pitchSpread) — see the big comment on scoreAgainst() below for
// why that's used instead of one fixed threshold for everyone.
// onProgress(stepIndex, totalSteps) lets the UI show "Sample 2 of 3…"
//
// Writes to TWO slots (see supabase/migrations/003_voice_profiles.sql):
//   - `latest`       — always overwritten, this is what SOS checks first.
//   - `registration` — written ONCE, the very first time this user ever
//                      enrolls, and never touched again afterwards. That's
//                      the permanent fallback SOS falls back to as a second
//                      chance if the latest enrollment doesn't match.
async function enrollUserVoice(authId, onProgress) {
  const TOTAL = 3;
  const spectralVectors = [];
  const pitchValues = [];

  for (let i = 0; i < TOTAL; i++) {
    onProgress && onProgress(i + 1, TOTAL);
    const buf = await recordVoiceClip(VOICE_SAMPLE_MS);
    const feat = computeVoiceFeatures(buf);
    if (!feat) throw new Error('Could not process recording — please try again in a quieter spot.');
    spectralVectors.push(feat.spectral);
    pitchValues.push(feat.pitchNorm);
  }

  // How similar are this person's own 3 samples to EACH OTHER? A clean mic/quiet
  // room gives a high, consistent selfSim (e.g. 0.90+); a noisy environment or a
  // phone that moved between samples gives a lower one. Verification later uses
  // this per-user baseline instead of one fixed number for everyone — see
  // scoreAgainst() for why a single global threshold kept being either too
  // strict (rejecting the real user) or too loose (accepting someone else).
  let simSum = 0, simCount = 0;
  for (let i = 0; i < spectralVectors.length; i++) {
    for (let j = i + 1; j < spectralVectors.length; j++) {
      simSum += cosineSimilarity(spectralVectors[i], spectralVectors[j]); simCount++;
    }
  }
  const selfSim = simCount ? simSum / simCount : 0.82;
  const pitchSpread = Math.max(...pitchValues) - Math.min(...pitchValues);

  const profile = { spectralVectors, pitchValues, selfSim, pitchSpread };
  const key = await getCryptoKey(authId);
  const encryptedProfile = await encryptText(JSON.stringify(profile), key);
  // Store which language the user was speaking during enrollment (see js/voice-lang.js)
  // so a later SOS check-in — even from a different device/browser where localStorage
  // hasn't been set — can still listen in the right language. See getVoiceProfileLanguage().
  const lang = (typeof getVoiceLangCode === 'function') ? getVoiceLangCode() : 'en';

  // Is this the very first time this user has ever enrolled? If so, this same
  // recording becomes the permanent "registration" profile too.
  const { data: existing } = await supabase
    .from('voice_profiles')
    .select('auth_id, registration_voiceprint')
    .eq('auth_id', authId)
    .maybeSingle();

  const row = {
    auth_id: authId,
    latest_voiceprint: encryptedProfile,
    latest_language: lang,
    sample_count: TOTAL,
    updated_at: new Date().toISOString(),
  };
  if (!existing || !existing.registration_voiceprint) {
    row.registration_voiceprint = encryptedProfile;
    row.registration_language = lang;
  }

  const { error } = await supabase
    .from('voice_profiles')
    .upsert(row, { onConflict: 'auth_id' });

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

// Reads back the language the user's MOST RECENT voice enrollment was done in
// (not the original registration one), so SOS check-ins listen in whatever
// language they most recently (re-)enrolled with — even on a different
// device/browser where localStorage hasn't been set.
async function getVoiceProfileLanguage(authId) {
  const { data, error } = await supabase
    .from('voice_profiles')
    .select('latest_language')
    .eq('auth_id', authId)
    .maybeSingle();
  if (error || !data) return null;
  return data.latest_language || null;
}

// ── Verification: record a short clip and compare to the stored voiceprint(s) ──
// Two checks must BOTH pass: spectral shape similarity (best match among the
// enrolled samples) AND the pitch must be close to the enrolled average —
// pitch alone is a strong signal for telling two different people apart.
//
// Checked against the LATEST enrollment first (whatever the user most recently
// (re-)recorded); if that doesn't match, the permanent REGISTRATION profile is
// tried as a second, independent chance — the original voice recorded at
// sign-up is always kept and always available as this fallback, exactly as
// requested, rather than being discarded the moment someone re-enrolls.
async function verifyVoiceSample(authId) {
  const { data, error } = await supabase
    .from('voice_profiles')
    .select('latest_voiceprint, registration_voiceprint')
    .eq('auth_id', authId)
    .maybeSingle();

  if (error || !data) return { matched: null, score: 0, reason: 'no_profile' };

  const key = await getCryptoKey(authId);
  const buf = await recordVoiceClip(VOICE_SAMPLE_MS);
  const sample = computeVoiceFeatures(buf);
  if (!sample) return { matched: null, score: 0, reason: 'no_audio' };

  const scoreAgainst = async (encrypted) => {
    if (!encrypted) return null;
    const stored = JSON.parse(await decryptText(encrypted, key));
    // Best (max) spectral similarity against any of the enrolled samples, averaged
    // with the second-best match — using only the single best match makes the gate
    // brittle (one lucky enrolled sample could pass while normal mic/background
    // variation on every other attempt fails).
    const scores = stored.spectralVectors.map(v => cosineSimilarity(v, sample.spectral)).sort((a, b) => b - a);
    const spectralScore = scores.length > 1 ? (scores[0] + scores[1]) / 2 : scores[0];
    const pitchMean = stored.pitchValues.reduce((a, b) => a + b, 0) / stored.pitchValues.length;
    const pitchDiff = Math.abs(sample.pitchNorm - pitchMean);

    // ADAPTIVE thresholds, calibrated per-user from how consistent THEIR OWN 3
    // enrollment samples were with each other (selfSim/pitchSpread — computed in
    // enrollUserVoice() above). A single fixed number for every user kept being
    // wrong in one direction or the other: strict enough to reliably reject an
    // impostor was also strict enough to reject the real user on a noisier mic/
    // room than their enrollment, and loose enough to reliably recognise the real
    // user under those conditions was loose enough to let a different person's
    // voice through too. Requiring the live sample to be almost as consistent
    // with the enrollment as the enrollment recordings were with EACH OTHER
    // adapts to each person's actual recording conditions instead of guessing
    // one number for everyone. Profiles enrolled before this used a fixed
    // fallback baseline (selfSim/pitchSpread absent) — reasonably strict, but not
    // the extremes this file swung between round to round.
    const selfSim = stored.selfSim != null ? stored.selfSim : 0.82;
    const pitchSpread = stored.pitchSpread != null ? stored.pitchSpread : 0.05;
    const spectralThreshold = Math.min(0.82, Math.max(0.62, selfSim - 0.12));
    const pitchTolerance    = Math.min(0.26, Math.max(0.12, pitchSpread * 1.6 + 0.07));
    const pitchOk = pitchDiff <= pitchTolerance;

    return {
      matched: spectralScore >= spectralThreshold && pitchOk,
      score: spectralScore, pitchDiff, pitchOk, spectralThreshold, pitchTolerance,
      enrolledPitchHz: Math.round(70 + pitchMean * 330),
      samplePitchHz: Math.round(70 + sample.pitchNorm * 330),
    };
  };

  const latestResult = await scoreAgainst(data.latest_voiceprint);
  let result = latestResult ? { ...latestResult, source: 'latest' } : null;

  // Only bother checking the registration profile separately if it's actually a
  // different recording — most users never re-enroll, so latest === registration.
  if ((!result || !result.matched) && data.registration_voiceprint && data.registration_voiceprint !== data.latest_voiceprint) {
    const regResult = await scoreAgainst(data.registration_voiceprint);
    if (regResult && (!result || regResult.score > result.score)) {
      // Keep whichever is the better/matching result, but don't let a plain higher
      // score on a *non*-matching registration attempt override a latest result
      // that was already closer to passing — only swap in the registration result
      // if it actually matched, or if there was no usable latest result at all.
      if (regResult.matched || !result) result = { ...regResult, source: 'registration' };
    }
  }

  if (!result) return { matched: null, score: 0, reason: 'no_profile' };
  return { ...result, reason: 'ok' };
}
