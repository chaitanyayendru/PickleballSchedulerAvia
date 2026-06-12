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

// Group session: the auth user owns a row in `groups` (synthetic email + PIN).
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

// Returns one of:
//   { kind: 'none' }
//   { kind: 'group',      session, group }
//   { kind: 'individual', session, profile, memberships: [{group_id, group_name}] }
//
// Session type is determined by what data belongs to the auth.uid():
// a row in `groups` ⇒ group session; otherwise we fall back to profile +
// memberships. (Email pattern can't be used because group auth now uses the
// leader's real email, same shape as an individual.)
export async function currentIdentity() {
  const session = await currentSession();
  if (!session) return { kind: 'none' };

  const { data: group, error: gErr } = await sb()
    .from('groups')
    .select('id, name, slug, leader_email')
    .eq('auth_user_id', session.user.id)
    .maybeSingle();
  if (gErr) throw gErr;
  if (group) return { kind: 'group', session, group };

  const [{ data: profile }, { data: memberships }] = await Promise.all([
    sb().from('profiles')
      .select('id, display_name, email')
      .eq('id', session.user.id)
      .maybeSingle(),
    sb().from('members')
      .select('group_id, name, group:group_id ( id, name, slug )')
      .eq('auth_user_id', session.user.id),
  ]);

  if (!profile && (!memberships || memberships.length === 0)) {
    // Signed in but no profile/memberships — half-finished signup.
    return { kind: 'none', session };
  }

  return {
    kind: 'individual',
    session,
    profile: profile || null,
    memberships: (memberships || []).map(m => ({
      group_id: m.group_id,
      group_name: m.group ? m.group.name : '(unknown)',
      group_slug: m.group ? m.group.slug : '',
      seat_name:  m.name,
    })),
  };
}
