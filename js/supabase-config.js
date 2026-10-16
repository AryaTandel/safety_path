// js/supabase-config.js — replaces firebase-config.js
// ============================================================

// Your Supabase project URL and anon key (from Project Settings → API)
// These are safe to include in frontend code — they're public keys
const SUPABASE_URL  = 'https://leiqlwfzldwqtsllwtxw.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxlaXFsd2Z6bGR3cXRzbGx3dHh3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgxMzM5MzEsImV4cCI6MjA5MzcwOTkzMX0.IfG7hroBtVI7MgcglPrWRfPoAWzpCJrdQLPH7IvEhZU';

// Load Supabase client from CDN — add to <head> of all HTML files:
// <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>

const { createClient } = supabase; // from CDN global
const _supabase = createClient(SUPABASE_URL, SUPABASE_ANON);

// Export as global — matches how firebase was used throughout the app
window.supabase = _supabase;