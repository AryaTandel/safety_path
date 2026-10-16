// js/crypto.js — AES-256-GCM encryption for Safety Path
// Uses browser Web Crypto API — no external libraries needed
// ============================================================

const CRYPTO_APP_SECRET = 'safetypath-v1-2024'; // Hardcoded app salt

// Derive a 256-bit encryption key from userId + app secret
// This is called once on login and cached in memory
async function deriveKey(userId) {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    enc.encode(userId),
    { name: 'PBKDF2' },
    false,
    ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: enc.encode(CRYPTO_APP_SECRET),
      iterations: 100000,
      hash: 'SHA-256'
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

// Encrypt a string — returns base64-encoded "iv:ciphertext"
async function encryptText(plainText, key) {
  if (!plainText) return '';
  const enc = new TextEncoder();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipherBuffer = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    enc.encode(plainText)
  );
  const combined = new Uint8Array(iv.length + cipherBuffer.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(cipherBuffer), iv.length);
  return btoa(String.fromCharCode(...combined));
}

// Decrypt a base64 "iv:ciphertext" back to plain string
async function decryptText(encryptedBase64, key) {
  if (!encryptedBase64) return '';
  try {
    const combined = Uint8Array.from(atob(encryptedBase64), c => c.charCodeAt(0));
    const iv = combined.slice(0, 12);
    const ciphertext = combined.slice(12);
    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      key,
      ciphertext
    );
    return new TextDecoder().decode(decrypted);
  } catch (e) {
    console.error('Decryption failed', e);
    return '';
  }
}

// Encrypt all PII fields in a user profile object
async function encryptUserProfile(profile, key) {
  return {
    ...profile,
    phone:             await encryptText(profile.phone, key),
    email:             await encryptText(profile.email, key),
    name:              await encryptText(profile.name, key),
    emergency_contact: await encryptText(profile.emergency_contact, key),
    emergency_phone:   await encryptText(profile.emergency_phone, key),
    emergency_email:   await encryptText(profile.emergency_email || '', key),
  };
}

// Decrypt all PII fields when reading from DB
async function decryptUserProfile(profile, key) {
  return {
    ...profile,
    phone:             await decryptText(profile.phone, key),
    email:             await decryptText(profile.email, key),
    name:              await decryptText(profile.name, key),
    emergency_contact: await decryptText(profile.emergency_contact, key),
    emergency_phone:   await decryptText(profile.emergency_phone, key),
    emergency_email:   await decryptText(profile.emergency_email || '', key),
  };
}

// Key cache — re-derive on each page load, cache in memory for session
let _cryptoKey = null;

async function getCryptoKey(userId) {
  if (!_cryptoKey) _cryptoKey = await deriveKey(userId);
  return _cryptoKey;
}

function clearCryptoKey() { 
  _cryptoKey = null; // call on sign-out
}