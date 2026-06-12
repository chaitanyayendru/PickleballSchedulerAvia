import { sb } from './supabase-client.js';
import { parseYmd } from './util.js';

export async function bookSlot(groupId, dateStr, hour) {
  const { error } = await sb().from('bookings').insert({
    group_id: groupId,
    slot_date: dateStr,
    slot_hour: hour,
    is_extension: false,
  });
  if (error) throw new Error(humanize(error));
}

export async function extendSlot(groupId, dateStr, hour) {
  const { error } = await sb().from('bookings').insert({
    group_id: groupId,
    slot_date: dateStr,
    slot_hour: hour,
    is_extension: true,
  });
  if (error) throw new Error(humanize(error));
}

export async function cancelBooking(bookingId) {
  const { error } = await sb().from('bookings').delete().eq('id', bookingId);
  if (error) throw new Error(humanize(error));
}

// Local pre-check for the extend rule (the server enforces the canonical version).
// Allowed if the current hour's slot is past its halfway mark (start + 30 min).
export function canExtend(date, hour, now = new Date()) {
  const slotStart = new Date(date);
  slotStart.setHours(hour, 0, 0, 0);
  const halfway = new Date(slotStart.getTime() + 30 * 60 * 1000);
  const slotEnd = new Date(slotStart.getTime() + 60 * 60 * 1000);
  return now >= halfway && now < slotEnd;
}

export async function listMyBookings(groupId) {
  const { data, error } = await sb()
    .from('bookings')
    .select('*')
    .eq('group_id', groupId)
    .order('slot_date', { ascending: true })
    .order('slot_hour', { ascending: true });
  if (error) throw new Error(humanize(error));
  return data || [];
}

function humanize(error) {
  // Postgres unique violation on (slot_date, slot_hour)
  if (error.code === '23505') return 'That slot is already booked.';
  // Triggers raise plain exceptions; messages are human-readable.
  return error.message || 'Booking failed.';
}
