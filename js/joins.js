import { sb } from './supabase-client.js';

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
