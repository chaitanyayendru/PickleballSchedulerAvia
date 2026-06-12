import { sb } from './supabase-client.js';

// ============================================================
// Create a group — called by a logged-in individual.
// The captain (the current user) is automatically added as the
// first member, linked to their auth account.
// ============================================================
export async function createGroup({ name, additionalMembers = [] }) {
  if (!name || name.trim().length < 2) throw new Error('Group name must be at least 2 characters');

  const client = sb();
  const session = (await client.auth.getSession()).data.session;
  if (!session) throw new Error('Log in first.');

  // Fetch profile for the captain's name + email.
  const { data: profile, error: pErr } = await client
    .from('profiles')
    .select('display_name, email')
    .eq('id', session.user.id)
    .maybeSingle();
  if (pErr) throw new Error('Could not load your profile: ' + pErr.message);
  if (!profile) throw new Error('Finish signing up first — no profile found.');

  // Slug from name (lowercase, hyphenated). The groups table has a unique
  // constraint on slug + on name, so duplicates will surface a clear error.
  const slug = name.toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  if (!slug) throw new Error('Group name contains no usable characters');

  const { data: group, error: gErr } = await client
    .from('groups')
    .insert({
      name: name.trim(),
      slug,
      leader_email: profile.email,
      auth_user_id: session.user.id,
    })
    .select()
    .single();
  if (gErr) {
    if (gErr.code === '23505') throw new Error('A group with that name already exists.');
    throw new Error('Could not create group: ' + gErr.message);
  }

  // Insert captain as the first member.
  const memberRows = [{
    group_id: group.id,
    name: profile.display_name,
    ordinal: 1,
    auth_user_id: session.user.id,
  }];

  // Any additional named members the captain adds at creation time get
  // PIN-style seats (no auth_user_id) — they can join later via a join
  // request which will fill in their auth link.
  let ordinal = 2;
  for (const n of additionalMembers) {
    const trimmed = (n || '').trim();
    if (!trimmed) continue;
    if (ordinal > 6) break;
    memberRows.push({ group_id: group.id, name: trimmed, ordinal: ordinal++ });
  }

  const { error: mErr } = await client.from('members').insert(memberRows);
  if (mErr) throw new Error('Group created but members insert failed: ' + mErr.message);

  return group;
}

export async function listGroupsDirectory() {
  const { data, error } = await sb()
    .from('groups_directory')
    .select('*')
    .order('name', { ascending: true });
  if (error) throw new Error(error.message);
  return data || [];
}

export async function requestJoin({ group_id, message }) {
  const session = (await sb().auth.getSession()).data.session;
  if (!session) throw new Error('Log in as an individual first.');
  const { error } = await sb().from('join_requests').insert({
    individual_id: session.user.id,
    group_id,
    message: (message || '').trim() || null,
  });
  if (error) {
    if (error.code === '23505') throw new Error('You already have a pending request for this group.');
    throw new Error(error.message);
  }
}

// All join_requests touching me — either I sent them, or I captain the target group.
export async function listMyJoinRequests() {
  const { data, error } = await sb()
    .from('join_requests')
    .select(`
      id, message, status, created_at, resolved_at,
      individual_id, group_id,
      group:group_id ( id, name, slug, auth_user_id ),
      profile:individual_id ( id, display_name, email )
    `)
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return data || [];
}

export async function acceptJoinRequest(req) {
  const client = sb();
  // 1. Insert a members row tying the individual to the group.
  const { data: existingMembers } = await client
    .from('members')
    .select('ordinal')
    .eq('group_id', req.group_id)
    .order('ordinal', { ascending: false })
    .limit(1);
  const nextOrdinal = (existingMembers && existingMembers[0] ? existingMembers[0].ordinal : 0) + 1;
  if (nextOrdinal > 6) throw new Error('Group is already at 6 members.');

  const displayName = req.profile?.display_name || req.profile?.email || 'New member';
  const { error: mErr } = await client.from('members').insert({
    group_id: req.group_id,
    name: displayName,
    ordinal: nextOrdinal,
    auth_user_id: req.individual_id,
  });
  if (mErr) {
    if (mErr.code === '23505') throw new Error('That person is already a member.');
    throw new Error('Could not add member: ' + mErr.message);
  }

  // 2. Mark the request accepted.
  const { error: rErr } = await client
    .from('join_requests')
    .update({ status: 'accepted', resolved_at: new Date().toISOString() })
    .eq('id', req.id);
  if (rErr) throw new Error('Member added but failed to update request: ' + rErr.message);
}

export async function declineJoinRequest(reqId) {
  const { error } = await sb()
    .from('join_requests')
    .update({ status: 'declined', resolved_at: new Date().toISOString() })
    .eq('id', reqId);
  if (error) throw new Error(error.message);
}

export async function cancelJoinRequest(reqId) {
  const { error } = await sb()
    .from('join_requests')
    .update({ status: 'cancelled', resolved_at: new Date().toISOString() })
    .eq('id', reqId);
  if (error) throw new Error(error.message);
}

// Remove yourself (or as captain, anyone) from a group.
export async function leaveGroup(memberId) {
  const { error } = await sb().from('members').delete().eq('id', memberId);
  if (error) throw new Error(error.message);
}
