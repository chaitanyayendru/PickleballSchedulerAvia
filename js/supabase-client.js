// Lazy-loaded Supabase client. The supabase-js UMD build is included via <script> in HTML.
// This module just wires up the singleton and exposes a few helpers.

function readConfig() {
  if (!window.PB_CONFIG) {
    throw new Error('config.js is missing. Copy js/config.example.js to js/config.js and fill in your Supabase URL + anon key.');
  }
  const { SUPABASE_URL, SUPABASE_ANON_KEY } = window.PB_CONFIG;
  if (!SUPABASE_URL || SUPABASE_URL.includes('YOUR-PROJECT-REF') ||
      !SUPABASE_ANON_KEY || SUPABASE_ANON_KEY.startsWith('YOUR')) {
    throw new Error('config.js still has placeholder values. Fill in your Supabase URL and anon key.');
  }
  return window.PB_CONFIG;
}

let _client = null;

export function sb() {
  if (_client) return _client;
  if (!window.supabase || !window.supabase.createClient) {
    throw new Error('supabase-js failed to load.');
  }
  const cfg = readConfig();
  _client = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, storageKey: 'pb-auth' },
  });
  return _client;
}

export async function currentSession() {
  const { data } = await sb().auth.getSession();
  return data.session || null;
}

// Returns { session, group } or { session: null, group: null }.
export async function currentUserGroup() {
  const session = await currentSession();
  if (!session) return { session: null, group: null };
  const { data: group, error } = await sb()
    .from('groups')
    .select('id, name, slug, leader_email')
    .eq('auth_user_id', session.user.id)
    .maybeSingle();
  if (error) throw error;
  return { session, group };
}
