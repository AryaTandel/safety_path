// js/auth-new.js — replaces auth.js
// Handles: Phone OTP, Google Sign-In, Email OTP, Registration
// ============================================================

// ── Phone OTP Auth ──────────────────────────────────────────

async function sendOTP(phoneNumber) {
  // phoneNumber must be in format +91XXXXXXXXXX
  try {
    const { error } = await supabase.auth.signInWithOtp({ phone: phoneNumber });
    if (error) return { success: false, error: friendlyAuthError(error) };
    return { success: true };
  } catch (e) {
    return { success: false, error: friendlyAuthError(e) };
  }
}

// Turn raw Supabase/network errors into something actionable
function friendlyAuthError(err) {
  const m = (err && err.message ? err.message : String(err)).toLowerCase();
  console.error('[auth]', err);
  if (m.includes('failed to fetch') || m.includes('networkerror') || m.includes('load failed'))
    return 'Cannot reach the server. Check your internet, and that the Supabase project is not paused (Supabase dashboard → Restore project).';
  if (m.includes('unsupported phone provider') || m.includes('sms') && m.includes('provider'))
    return 'SMS sign-in is not set up yet. In Supabase: Authentication → Providers → Phone → enable it and add an SMS provider (e.g. Twilio).';
  if (m.includes('rate limit') || m.includes('too many'))
    return 'Too many attempts. Please wait a minute and try again.';
  if (m.includes('invalid') && m.includes('phone'))
    return 'That phone number looks invalid. Enter a 10-digit Indian mobile number.';
  return (err && err.message) || 'Something went wrong. Please try again.';
}

async function verifyOTP(phoneNumber, otp) {
  const { data, error } = await supabase.auth.verifyOtp({
    phone: phoneNumber,
    token: otp,
    type: 'sms'
  });
  if (error) return { success: false, error: 'Invalid OTP. Please try again.' };
  return { success: true, user: data.user };
}

// ── Email OTP Auth ──────────────────────────────────────────

async function sendEmailOTP(email) {
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { shouldCreateUser: true }
  });
  if (error) return { success: false, error: error.message };
  return { success: true };
}

async function verifyEmailOTP(email, otp) {
  const { data, error } = await supabase.auth.verifyOtp({
    email,
    token: otp,
    type: 'email'
  });
  if (error) return { success: false, error: 'Invalid code. Please try again.' };
  return { success: true, user: data.user };
}

// ── Google Sign-In ───────────────────────────────────────────

async function signInWithGoogle() {
  try {
    // Come back to index.html on whatever host/port the app is served from.
    // (This exact URL must be listed in Supabase → Authentication → URL Configuration → Redirect URLs.)
    const redirectTo = new URL('index.html', window.location.href).href;
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo, queryParams: { prompt: 'select_account' } }
    });
    if (error) return { success: false, error: friendlyAuthError(error) };
    // The browser is now navigating to Google — there is no user yet.
    return { success: true, redirecting: true };
  } catch (e) {
    return { success: false, error: friendlyAuthError(e) };
  }
}

// ── Check if user profile exists in public.users ─────────────

async function checkUserExists(authId) {
  const { data, error } = await supabase
    .from('users')
    .select('id')
    .eq('auth_id', authId)
    .single();
  return !!data && !error;
}

// ── Save Registration Data (with encryption) ─────────────────

async function saveUserProfile(authId, formData) {
  try {
    // Derive encryption key from auth ID
    const key = await getCryptoKey(authId);

    // Encrypt PII before storing
    const encryptedProfile = await encryptUserProfile({
      name:              formData.name,
      phone:             formData.phone || '',
      email:             formData.email || '',
      emergency_contact: formData.emergencyContact,
      emergency_phone:   formData.emergencyPhone,
      emergency_email:   formData.emergencyEmail || '',
    }, key);

    const { error } = await supabase
      .from('users')
      .insert({
        auth_id:      authId,
        ...encryptedProfile,          // 🔒 all PII encrypted
        age:          parseInt(formData.age),
        gender:       formData.gender,
        occupation:   formData.occupation,
        auth_method:  formData.authMethod,
        privacy_mode: false,
      });

    if (error) throw error;
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

// ── Get decrypted user profile for display ───────────────────

async function getUserProfile(authId) {
  const { data, error } = await supabase
    .from('users')
    .select('*')
    .eq('auth_id', authId)
    .single();

  if (error || !data) return null;

  // Decrypt PII for display
  const key = await getCryptoKey(authId);
  return await decryptUserProfile(data, key);
}

// ── Auth State Observer ──────────────────────────────────────

function onAuthStateChanged(callback) {
  return supabase.auth.onAuthStateChange((_event, session) => {
    callback(session?.user ?? null);
  });
}

async function getCurrentUser() {
  const { data: { user } } = await supabase.auth.getUser();
  return user;
}

async function signOut() {
  sessionStorage.clear();
  sessionStorage.setItem('signing_out', 'true');
  clearCryptoKey();
  await window.supabase.auth.signOut();
  window.location.href = 'index.html';
}

async function updateLastLogin(authId) {
  await supabase
    .from('users')
    .update({ last_login: new Date().toISOString() })
    .eq('auth_id', authId);
}

// ── Session helpers ──────────────────────────────────────────

async function cacheDecryptedProfile(profile, key) {
  const decrypted = await decryptUserProfile(profile, key);
  sessionStorage.setItem('sp_user_display', JSON.stringify({
    name: decrypted.name,
    authMethod: profile.auth_method,
    privacyMode: profile.privacy_mode
  }));
}

function clearSession() {
  sessionStorage.clear();
  clearCryptoKey();
}