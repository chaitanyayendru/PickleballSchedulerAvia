import { sb } from './supabase-client.js';

export async function createSwapRequest({ requesting_group_id, target_booking_id, message }) {
  const { error } = await sb().from('swap_requests').insert({
    requesting_group_id,
    target_booking_id,
    message: (message || '').trim() || null,
  });
  if (error) throw new Error(error.message || 'Failed to send swap request.');
  // Email notification is an optional Supabase Edge Function — see README.
  // We attempt to invoke it but ignore failures so the request still goes through.
  try {
    await sb().functions.invoke('send-swap-email', {
      body: { requesting_group_id, target_booking_id, message },
    });
  } catch (_) { /* email is best-effort */ }
}

// Incoming requests for slots owned by `groupId`.
export async function listIncomingRequests(groupId) {
  const { data, error } = await sb()
    .from('swap_requests')
    .select(`
      id, message, status, created_at, resolved_at,
      requesting_group:requesting_group_id ( id, name ),
      target_booking:target_booking_id ( id, slot_date, slot_hour, is_extension, group_id )
    `)
    .eq('status', 'pending')
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  // Filter client-side to those targeting our group's bookings.
  return (data || []).filter(r => r.target_booking && r.target_booking.group_id === groupId);
}

// Outgoing requests this group has sent.
export async function listOutgoingRequests(groupId) {
  const { data, error } = await sb()
    .from('swap_requests')
    .select(`
      id, message, status, created_at, resolved_at,
      target_booking:target_booking_id ( id, slot_date, slot_hour, is_extension, group_id )
    `)
    .eq('requesting_group_id', groupId)
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return data || [];
}

// Accept = cancel the target booking and let the requesting group rebook the slot.
// We don't auto-book it for them to keep the rule engine simple (their group may not
// be allowed to take that slot under the weekly limits).
export async function acceptSwap(requestId, targetBookingId) {
  const client = sb();
  // Mark resolved first so we have a clear audit trail.
  const { error: e1 } = await client
    .from('swap_requests')
    .update({ status: 'accepted', resolved_at: new Date().toISOString() })
    .eq('id', requestId);
  if (e1) throw new Error(e1.message);

  const { error: e2 } = await client.from('bookings').delete().eq('id', targetBookingId);
  if (e2) throw new Error('Marked accepted but failed to free the slot: ' + e2.message);
}

export async function declineSwap(requestId) {
  const { error } = await sb()
    .from('swap_requests')
    .update({ status: 'declined', resolved_at: new Date().toISOString() })
    .eq('id', requestId);
  if (error) throw new Error(error.message);
}

export async function cancelOwnSwap(requestId) {
  const { error } = await sb()
    .from('swap_requests')
    .update({ status: 'cancelled', resolved_at: new Date().toISOString() })
    .eq('id', requestId);
  if (error) throw new Error(error.message);
}
