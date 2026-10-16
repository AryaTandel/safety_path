// ============================================================
//  SAFETY PATH – Multiple Emergency Contacts
// ------------------------------------------------------------
//  Storage: emergency_contacts table (supabase/migrations/004).
//  name / phone / email are encrypted client-side (crypto.js) —
//  the database only ever sees ciphertext.
//
//  The legacy users.emergency_contact/_phone/_email columns are
//  kept in sync with the PRIMARY contact, and a user who only has
//  the legacy single contact gets it copied into the new table
//  the first time contacts are loaded.
// ============================================================

const MAX_EMERGENCY_CONTACTS = 5;

// ── Validation (shared by the add/edit form) ─────────────────
// Returns { ok, error, value } — phone is normalised to +91XXXXXXXXXX.
function validateEmergencyContact(input) {
  const name  = (input.name  || '').trim();
  let   phone = (input.phone || '').replace(/[\s-]/g, '');
  const email = (input.email || '').trim();

  if (!name) return { ok: false, error: 'Please enter the contact\'s name.' };

  phone = phone.replace(/^\+?91/, '');           // accept +91 / 91 prefix
  if (!/^[6-9]\d{9}$/.test(phone)) return { ok: false, error: 'Enter a valid 10-digit Indian mobile number.' };

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, error: 'Enter a valid email address — alerts are sent by email.' };

  return { ok: true, value: { name, phone: '+91' + phone, email } };
}

async function _decryptContactRow(row, key) {
  return {
    id:         row.id,
    name:       await decryptText(row.name, key),
    phone:      await decryptText(row.phone, key),
    email:      await decryptText(row.email, key),
    is_primary: !!row.is_primary,
  };
}

// ── Keep the legacy users.* columns mirroring the primary contact ──
async function _syncPrimaryToUsers(authId, contacts) {
  const primary = contacts.find(c => c.is_primary) || contacts[0];
  if (!primary) return;
  try {
    const key = await getCryptoKey(authId);
    await supabase.from('users').update({
      emergency_contact: await encryptText(primary.name, key),
      emergency_phone:   await encryptText(primary.phone, key),
      emergency_email:   await encryptText(primary.email || '', key),
    }).eq('auth_id', authId);
  } catch (e) { console.warn('Could not sync primary contact to profile:', e); }
}

// ── List all contacts (decrypted), oldest first, primary on top ──
async function listEmergencyContacts(authId) {
  const key = await getCryptoKey(authId);
  const { data, error } = await supabase
    .from('emergency_contacts')
    .select('id, name, phone, email, is_primary, created_at')
    .eq('auth_id', authId)
    .order('created_at', { ascending: true });
  if (error) throw error;

  let rows = data || [];

  // First time for an existing user: lift their single legacy contact into the new table.
  if (rows.length === 0) {
    const migrated = await _migrateLegacyContact(authId, key);
    if (migrated) rows = [migrated];
  }

  const contacts = await Promise.all(rows.map(r => _decryptContactRow(r, key)));
  contacts.sort((a, b) => (b.is_primary ? 1 : 0) - (a.is_primary ? 1 : 0));
  return contacts;
}

async function _migrateLegacyContact(authId, key) {
  try {
    const { data: u } = await supabase
      .from('users')
      .select('emergency_contact, emergency_phone, emergency_email')
      .eq('auth_id', authId)
      .maybeSingle();
    if (!u || !u.emergency_contact) return null;

    // Legacy values are already encrypted with the same key — copy as-is.
    const { data, error } = await supabase
      .from('emergency_contacts')
      .insert({
        auth_id:    authId,
        name:       u.emergency_contact,
        phone:      u.emergency_phone || '',
        email:      u.emergency_email || '',
        is_primary: true,
      })
      .select()
      .single();
    if (error) throw error;
    return data;
  } catch (e) {
    console.warn('Legacy emergency contact migration skipped:', e);
    return null;
  }
}

// ── Add a contact, or edit one when `id` is given ────────────
async function saveEmergencyContact(authId, input, id = null) {
  const v = validateEmergencyContact(input);
  if (!v.ok) return { success: false, error: v.error };

  try {
    const existing = await listEmergencyContacts(authId);

    // Same number twice would just send duplicate alerts.
    const dup = existing.find(c => c.id !== id && c.phone === v.value.phone);
    if (dup) return { success: false, error: `${dup.name} already uses that number.` };

    if (!id && existing.length >= MAX_EMERGENCY_CONTACTS)
      return { success: false, error: `You can save up to ${MAX_EMERGENCY_CONTACTS} emergency contacts.` };

    const key = await getCryptoKey(authId);
    const enc = {
      name:  await encryptText(v.value.name, key),
      phone: await encryptText(v.value.phone, key),
      email: await encryptText(v.value.email, key),
      updated_at: new Date().toISOString(),
    };

    if (id) {
      const { error } = await supabase.from('emergency_contacts').update(enc).eq('id', id).eq('auth_id', authId);
      if (error) throw error;
    } else {
      // The first contact is automatically the primary one.
      const { error } = await supabase.from('emergency_contacts')
        .insert({ ...enc, auth_id: authId, is_primary: existing.length === 0 });
      if (error) throw error;
    }

    await _syncPrimaryToUsers(authId, await listEmergencyContacts(authId));
    return { success: true };
  } catch (e) {
    console.error('saveEmergencyContact failed:', e);
    return { success: false, error: e.message || 'Could not save the contact.' };
  }
}

async function deleteEmergencyContact(authId, id) {
  try {
    const existing = await listEmergencyContacts(authId);
    if (existing.length <= 1)
      return { success: false, error: 'You need at least one emergency contact. Add another one before removing this.' };

    const target = existing.find(c => c.id === id);
    const { error } = await supabase.from('emergency_contacts').delete().eq('id', id).eq('auth_id', authId);
    if (error) throw error;

    // Removed the primary? Promote the next one.
    if (target && target.is_primary) {
      const next = existing.find(c => c.id !== id);
      if (next) await setPrimaryEmergencyContact(authId, next.id);
    } else {
      await _syncPrimaryToUsers(authId, await listEmergencyContacts(authId));
    }
    return { success: true };
  } catch (e) {
    console.error('deleteEmergencyContact failed:', e);
    return { success: false, error: e.message || 'Could not remove the contact.' };
  }
}

async function setPrimaryEmergencyContact(authId, id) {
  try {
    // Unique index allows one primary — clear first, then set.
    let r = await supabase.from('emergency_contacts').update({ is_primary: false }).eq('auth_id', authId);
    if (r.error) throw r.error;
    r = await supabase.from('emergency_contacts').update({ is_primary: true }).eq('id', id).eq('auth_id', authId);
    if (r.error) throw r.error;
    await _syncPrimaryToUsers(authId, await listEmergencyContacts(authId));
    return { success: true };
  } catch (e) {
    console.error('setPrimaryEmergencyContact failed:', e);
    return { success: false, error: e.message || 'Could not change the primary contact.' };
  }
}

// ════════════════════════════════════════════════════════════
//  UI — modal in dashboard.html (#contactsModal)
// ════════════════════════════════════════════════════════════
let _ecEditingId = null;
let _ecContacts  = [];

function _ecEsc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

async function openContactsModal() {
  if (!curUser) { showToast('Please sign in again.'); return; }
  document.getElementById('contactsModal').classList.add('open');
  _ecResetForm();
  loadProfileForm();
  await _ecReload();
}

// ── Personal details (name, age, gender, occupation, email) ──
async function loadProfileForm() {
  const msg = document.getElementById('pfMsg'); msg.textContent = '';
  try {
    const p = await getUserProfile(curUser.id);
    if (!p) return;
    document.getElementById('pfName').value   = p.name || '';
    document.getElementById('pfAge').value    = p.age || '';
    document.getElementById('pfGender').value = p.gender || 'Prefer not to say';
    document.getElementById('pfOcc').value    = p.occupation || 'Other';
    document.getElementById('pfEmail').value  = p.email || '';
    document.getElementById('pfPhone').value  = p.phone || '—';
  } catch (e) { msg.style.color = 'var(--red)'; msg.textContent = 'Could not load your details.'; }
}

async function saveProfileForm() {
  const msg = document.getElementById('pfMsg'), btn = document.getElementById('pfSaveBtn');
  msg.style.color = 'var(--red)'; msg.textContent = '';
  const name = document.getElementById('pfName').value.trim();
  const age  = parseInt(document.getElementById('pfAge').value, 10);
  const email = document.getElementById('pfEmail').value.trim();
  if (!name) { msg.textContent = 'Please enter your name.'; return; }
  if (!(age >= 10 && age <= 100)) { msg.textContent = 'Please enter a valid age.'; return; }
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { msg.textContent = 'Enter a valid email or leave it blank.'; return; }
  btn.disabled = true;
  try {
    const key = await getCryptoKey(curUser.id);
    const { error } = await supabase.from('users').update({
      name:       await encryptText(name, key),
      email:      await encryptText(email, key),
      age,
      gender:     document.getElementById('pfGender').value,
      occupation: document.getElementById('pfOcc').value,
    }).eq('auth_id', curUser.id);
    if (error) throw error;
    const f = document.getElementById('ufirst'); if (f) f.textContent = name.split(' ')[0];
    msg.style.color = 'var(--teal)'; msg.textContent = '✅ Details saved';
    showToast('✅ Profile updated');
  } catch (e) { msg.textContent = e.message || 'Could not save.'; }
  btn.disabled = false;
}

function closeContactsModal() {
  document.getElementById('contactsModal').classList.remove('open');
}

async function _ecReload() {
  const list = document.getElementById('ecList');
  list.innerHTML = '<div class="ec-empty">Loading…</div>';
  try {
    _ecContacts = await listEmergencyContacts(curUser.id);
  } catch (e) {
    const missing = /emergency_contacts|relation|schema cache/i.test(e.message || '');
    list.innerHTML = `<div class="ec-empty" style="color:var(--red)">${missing
      ? 'The emergency_contacts table doesn\'t exist yet — run supabase/migrations/004_emergency_contacts.sql in the Supabase SQL editor.'
      : 'Could not load your contacts: ' + _ecEsc(e.message)}</div>`;
    return;
  }
  _ecRender();
}

function _ecRender() {
  const list = document.getElementById('ecList');
  if (!_ecContacts.length) {
    list.innerHTML = '<div class="ec-empty">No emergency contacts yet — add one below.</div>';
  } else {
    list.innerHTML = _ecContacts.map(c => `
      <div class="ec-card${c.id === _ecEditingId ? ' editing' : ''}">
        <div class="ec-info">
          <div class="ec-name">${_ecEsc(c.name)}${c.is_primary ? '<span class="ec-badge">Primary</span>' : ''}</div>
          <div class="ec-line">${_ecEsc(c.phone)}</div>
          <div class="ec-line">${_ecEsc(c.email)}</div>
        </div>
        <div class="ec-actions">
          <button onclick="ecStartEdit('${c.id}')">Edit</button>
          ${c.is_primary ? '' : `<button onclick="ecMakePrimary('${c.id}')">Make primary</button>`}
          <button class="ec-del" onclick="ecDelete('${c.id}')">Remove</button>
        </div>
      </div>`).join('');
  }
  const full = _ecContacts.length >= MAX_EMERGENCY_CONTACTS && !_ecEditingId;
  document.getElementById('ecForm').style.display = full ? 'none' : 'block';
  document.getElementById('ecFull').style.display = full ? 'block' : 'none';
  document.getElementById('ecCount').textContent = `${_ecContacts.length} of ${MAX_EMERGENCY_CONTACTS}`;
}

function _ecResetForm() {
  _ecEditingId = null;
  ['ecName', 'ecPhone', 'ecEmail'].forEach(id => { document.getElementById(id).value = ''; });
  document.getElementById('ecFormTitle').textContent = 'Add a contact';
  document.getElementById('ecSaveBtn').textContent = 'Add contact';
  document.getElementById('ecCancelEdit').style.display = 'none';
  document.getElementById('ecMsg').textContent = '';
}

function ecStartEdit(id) {
  const c = _ecContacts.find(x => x.id === id);
  if (!c) return;
  _ecEditingId = id;
  document.getElementById('ecName').value  = c.name;
  document.getElementById('ecPhone').value = (c.phone || '').replace(/^\+91/, '');
  document.getElementById('ecEmail').value = c.email;
  document.getElementById('ecFormTitle').textContent = 'Edit contact';
  document.getElementById('ecSaveBtn').textContent = 'Save changes';
  document.getElementById('ecCancelEdit').style.display = 'inline-flex';
  document.getElementById('ecMsg').textContent = '';
  _ecRender();
  document.getElementById('ecName').focus();
}

function ecCancelEdit() { _ecResetForm(); _ecRender(); }

async function ecSubmit() {
  const msg = document.getElementById('ecMsg');
  const btn = document.getElementById('ecSaveBtn');
  msg.style.color = 'var(--red)';
  msg.textContent = '';
  btn.disabled = true;
  const wasEditing = !!_ecEditingId;

  const r = await saveEmergencyContact(curUser.id, {
    name:  document.getElementById('ecName').value,
    phone: document.getElementById('ecPhone').value,
    email: document.getElementById('ecEmail').value,
  }, _ecEditingId);

  btn.disabled = false;
  if (!r.success) { msg.textContent = r.error; return; }

  showToast(wasEditing ? '✅ Contact updated' : '✅ Contact added');
  _ecResetForm();
  await _ecReload();
}

async function ecDelete(id) {
  const c = _ecContacts.find(x => x.id === id);
  if (!c || !confirm(`Remove ${c.name} from your emergency contacts?`)) return;
  const r = await deleteEmergencyContact(curUser.id, id);
  if (!r.success) { showToast('⚠️ ' + r.error); return; }
  if (_ecEditingId === id) _ecResetForm();
  showToast('Contact removed');
  await _ecReload();
}

async function ecMakePrimary(id) {
  const r = await setPrimaryEmergencyContact(curUser.id, id);
  if (!r.success) { showToast('⚠️ ' + r.error); return; }
  showToast('✅ Primary contact changed');
  await _ecReload();
}
