// ============================================================
//  SAFETY PATH – Auth Handler
//  Manages: Phone OTP login, Google Sign-In, Registration
// ============================================================

// ── Phone Auth ──────────────────────────────────────────────

function setupRecaptcha(buttonId) {
  window.recaptchaVerifier = new firebase.auth.RecaptchaVerifier(buttonId, {
    size: 'invisible',
    callback: () => {}
  });
}

async function sendOTP(phoneNumber) {
  // phoneNumber must be in format +91XXXXXXXXXX
  try {
    setupRecaptcha('btn-send-otp');
    const appVerifier = window.recaptchaVerifier;
    const confirmationResult = await auth.signInWithPhoneNumber(phoneNumber, appVerifier);
    window.confirmationResult = confirmationResult;
    return { success: true };
  } catch (error) {
    console.error('OTP Error:', error);
    return { success: false, error: error.message };
  }
}

async function verifyOTP(otp) {
  try {
    const result = await window.confirmationResult.confirm(otp);
    return { success: true, user: result.user };
  } catch (error) {
    return { success: false, error: 'Invalid OTP. Please try again.' };
  }
}

// ── Google Sign-In ───────────────────────────────────────────

async function signInWithGoogle() {
  try {
    const provider = new firebase.auth.GoogleAuthProvider();
    const result = await auth.signInWithPopup(provider);
    return { success: true, user: result.user, isNew: result.additionalUserInfo.isNewUser };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// ── Check if user profile exists ────────────────────────────

async function checkUserExists(uid) {
  const doc = await db.collection('users').doc(uid).get();
  return doc.exists;
}

// ── Save Registration Data ───────────────────────────────────

async function saveUserProfile(uid, formData) {
  try {
    await db.collection('users').doc(uid).set({
      uid,
      name: formData.name,
      age: parseInt(formData.age),
      gender: formData.gender,
      occupation: formData.occupation,
      phone: formData.phone || '',
      email: formData.email || '',
      emergencyContact: formData.emergencyContact,
      emergencyPhone: formData.emergencyPhone,
      authMethod: formData.authMethod,
      privacyMode: false,
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      lastLogin: firebase.firestore.FieldValue.serverTimestamp()
    });
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// ── Update Last Login ────────────────────────────────────────

async function updateLastLogin(uid) {
  await db.collection('users').doc(uid).update({
    lastLogin: firebase.firestore.FieldValue.serverTimestamp()
  });
}

// ── Auth State Observer ──────────────────────────────────────

function onAuthStateChanged(callback) {
  return auth.onAuthStateChanged(callback);
}

async function signOut() {
  await auth.signOut();
  window.location.href = 'register.html';
}
