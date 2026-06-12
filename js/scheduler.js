import { sb, currentUserGroup } from './supabase-client.js';
import {
  isoWeekStart, addDays, ymd, parseYmd, isSameDay,
  fmtHour12, fmtHourRange, fmtDateLong, DOW_SHORT, groupColor, el, toast, escapeHtml,
} from './util.js';
import { bookSlot, cancelBooking, extendSlot, canExtend } from './booking.js';
import { createSwapRequest } from './swap.js';

const HOURS = 24;
const DAYS  = 7;

export class WeekScheduler {
  constructor(container, { onChange } = {}) {
    this.container = container;
    this.weekStart = isoWeekStart(new Date());
    this.bookings = [];          // bookings_view rows for current week
    this.swapRequests = [];      // swap_requests for current week's bookings
    this.group = null;
    this.now = new Date();
    this.onChange = onChange || (() => {});
    this._modal = null;
  }

  async init() {
    const { group } = await currentUserGroup();
    this.group = group;
    await this.refresh();
    // Re-render the "now" indicator every minute.
    setInterval(() => {
      this.now = new Date();
      this.render();
    }, 60_000);
  }

  weekEnd() { return addDays(this.weekStart, 6); }

  setWeek(d) {
    this.weekStart = isoWeekStart(d);
    return this.refresh();
  }

  async refresh() {
    const start = ymd(this.weekStart);
    const end   = ymd(this.weekEnd());
    const { data, error } = await sb()
      .from('bookings_view')
      .select('*')
      .gte('slot_date', start)
      .lte('slot_date', end)
      .order('slot_date', { ascending: true })
      .order('slot_hour', { ascending: true });
    if (error) { toast('Failed to load schedule: ' + error.message, 'error'); return; }
    this.bookings = data || [];

    // Pull pending swap requests targeting any of these bookings.
    if (this.bookings.length) {
      const ids = this.bookings.map(b => b.id);
      const { data: swaps } = await sb()
        .from('swap_requests')
        .select('*')
        .in('target_booking_id', ids)
        .eq('status', 'pending');
      this.swapRequests = swaps || [];
    } else {
      this.swapRequests = [];
    }

    this.render();
    this.onChange();
  }

  render() {
    const c = this.container;
    c.innerHTML = '';

    // Toolbar
    const toolbar = el('div', { class: 'week-toolbar' }, [
      el('div', { class: 'week-label' }, this._weekLabel()),
      el('div', { class: 'week-nav' }, [
        el('button', { class: 'btn btn-ghost btn-sm', onclick: () => this.setWeek(addDays(this.weekStart, -7)) }, '← Prev'),
        el('button', { class: 'btn btn-ghost btn-sm', onclick: () => this.setWeek(new Date()) }, 'Today'),
        el('button', { class: 'btn btn-ghost btn-sm', onclick: () => this.setWeek(addDays(this.weekStart, 7)) }, 'Next →'),
      ]),
    ]);
    c.appendChild(toolbar);

    // Legend with this group's color (if logged in)
    if (this.group) {
      const color = groupColor(this.group.name);
      const legend = el('div', { class: 'legend' }, [
        el('span', {}, [
          el('span', { class: 'legend-swatch', style: { background: color.bg } }),
          'Your group: ', el('strong', {}, this.group.name),
        ]),
        el('span', { class: 'dim' }, 'Click any free slot to book. Past slots are locked.'),
      ]);
      c.appendChild(legend);
    } else {
      const legend = el('div', { class: 'legend' }, [
        el('span', { class: 'dim' }, 'Log in or register a group to book a slot.'),
      ]);
      c.appendChild(legend);
    }

    // Grid
    const wrap = el('div', { class: 'grid-wrap' });
    const grid = el('div', { class: 'grid' });
    wrap.appendChild(grid);
    c.appendChild(wrap);

    // Header row
    grid.appendChild(el('div', { class: 'col-header' }, '')); // corner
    for (let d = 0; d < DAYS; d++) {
      const date = addDays(this.weekStart, d);
      const isToday = isSameDay(date, this.now);
      grid.appendChild(el('div', { class: 'col-header' + (isToday ? ' today' : '') }, [
        el('span', {}, DOW_SHORT[d]),
        el('span', { class: 'dow' }, date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })),
      ]));
    }

    // Index bookings by (date, hour) for fast lookup.
    const bookingByKey = new Map();
    for (const b of this.bookings) bookingByKey.set(`${b.slot_date}|${b.slot_hour}`, b);

    for (let h = 0; h < HOURS; h++) {
      grid.appendChild(el('div', { class: 'hour-label' }, fmtHour12(h)));
      for (let d = 0; d < DAYS; d++) {
        const date = addDays(this.weekStart, d);
        const key = `${ymd(date)}|${h}`;
        const booking = bookingByKey.get(key);
        const slotStart = new Date(date); slotStart.setHours(h, 0, 0, 0);
        const isPast = slotStart.getTime() + 60 * 60 * 1000 <= this.now.getTime();
        const isNow  = this.now >= slotStart && this.now < new Date(slotStart.getTime() + 60 * 60 * 1000);

        const classes = ['cell'];
        if (isPast) classes.push('past');
        if (isNow)  classes.push('now');
        if (booking && this.group && booking.group_id === this.group.id) classes.push('cell-mine');

        const children = [];
        if (booking) {
          const color = groupColor(booking.group_name);
          const tag = el('span', {
            class: 'cell-tag' + (booking.is_extension ? ' is-extension' : ''),
            style: {
              background: color.bg,
              color: color.text,
            },
            title: `${booking.group_name}${booking.is_extension ? ' (extension)' : ''}`,
          }, booking.group_name);
          // Dark-mode color override via CSS variable trick — we use a data attribute so prefers-color-scheme rules can pick it up.
          children.push(tag);
        }

        const cell = el('div', { class: classes.join(' ') }, children);
        cell.dataset.date = ymd(date);
        cell.dataset.hour = String(h);
        if (!isPast) {
          cell.addEventListener('click', () => this._onCellClick(cell, booking, ymd(date), h));
        }
        grid.appendChild(cell);
      }
    }
  }

  _weekLabel() {
    const a = this.weekStart;
    const b = this.weekEnd();
    const sameMonth = a.getMonth() === b.getMonth();
    const aStr = a.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    const bStr = b.toLocaleDateString(undefined, sameMonth ? { day: 'numeric', year: 'numeric' } : { month: 'short', day: 'numeric', year: 'numeric' });
    return `${aStr} – ${bStr}`;
  }

  async _onCellClick(cell, booking, dateStr, hour) {
    if (!this.group) {
      this._openModal({
        title: 'Log in to book',
        body: 'You need to be logged in as a group to book or manage slots.',
        buttons: [
          { label: 'Cancel', kind: 'ghost', onClick: () => this._closeModal() },
          { label: 'Go to login', kind: 'primary', onClick: () => location.href = 'login.html' },
        ],
      });
      return;
    }

    if (!booking) {
      // Free slot — offer to book.
      this._openModal({
        title: `Book ${fmtHourRange(hour)}`,
        body: el('div', {}, [
          el('p', {}, fmtDateLong(parseYmd(dateStr))),
          el('p', { class: 'dim' }, [
            `Rules: same hour ≤ 2× this week. ≤ 16 total this week. `,
            this._sameHourCountNote(hour),
          ]),
        ]),
        buttons: [
          { label: 'Cancel', kind: 'ghost', onClick: () => this._closeModal() },
          { label: 'Book this slot', kind: 'primary', onClick: async () => {
            try {
              await bookSlot(this.group.id, dateStr, hour);
              toast('Slot booked.', 'success');
              this._closeModal();
              await this.refresh();
            } catch (e) {
              toast(e.message || String(e), 'error');
            }
          }},
        ],
      });
      return;
    }

    // Existing booking — show details + actions.
    const mine = booking.group_id === this.group.id;
    const isExtensionCandidate = !mine; // can't extend someone else's
    const actions = [];

    if (mine) {
      actions.push({ label: 'Cancel booking', kind: 'danger', onClick: async () => {
        if (!confirm('Cancel this booking?')) return;
        try {
          await cancelBooking(booking.id);
          toast('Booking cancelled.', 'success');
          this._closeModal();
          await this.refresh();
        } catch (e) { toast(e.message || String(e), 'error'); }
      }});

      // Offer extension if next-hour cell is free and current cell is past half-time.
      const next = bookingByKey(this.bookings, dateStr, hour + 1);
      if (hour < 23 && !next && canExtend(parseYmd(dateStr), hour, this.now)) {
        actions.push({ label: `Extend to ${fmtHour12((hour+1)%24)}`, kind: 'primary', onClick: async () => {
          try {
            await extendSlot(this.group.id, dateStr, hour + 1);
            toast('Extension booked.', 'success');
            this._closeModal();
            await this.refresh();
          } catch (e) { toast(e.message || String(e), 'error'); }
        }});
      }
    } else {
      // Request a swap (i.e. ask them to give up the slot).
      actions.push({ label: 'Request this slot', kind: 'primary', onClick: () => this._openSwapModal(booking) });
    }
    actions.push({ label: 'Close', kind: 'ghost', onClick: () => this._closeModal() });

    const pending = this.swapRequests.filter(s => s.target_booking_id === booking.id);
    this._openModal({
      title: booking.group_name + (booking.is_extension ? ' (extension)' : ''),
      body: el('div', {}, [
        el('p', {}, [fmtDateLong(parseYmd(dateStr)), ' · ', fmtHourRange(hour)]),
        mine ? el('p', { class: 'dim' }, 'This is your group\'s booking.') : null,
        pending.length ? el('p', { class: 'tag' }, `${pending.length} pending swap request${pending.length>1?'s':''}`) : null,
      ]),
      buttons: actions,
    });
  }

  _sameHourCountNote(hour) {
    if (!this.group) return '';
    const start = ymd(this.weekStart), end = ymd(this.weekEnd());
    const n = this.bookings.filter(b =>
      b.group_id === this.group.id &&
      b.slot_hour === hour &&
      b.slot_date >= start && b.slot_date <= end &&
      !b.is_extension
    ).length;
    return `You have ${n} booking${n === 1 ? '' : 's'} at this hour this week.`;
  }

  _openSwapModal(booking) {
    let message = '';
    this._openModal({
      title: `Request ${booking.group_name}'s slot`,
      body: el('div', {}, [
        el('p', { class: 'dim' }, `We'll send a swap request to ${booking.group_name}. They'll see it in their dashboard.`),
        el('div', { class: 'field' }, [
          el('label', {}, 'Optional message'),
          (() => {
            const ta = el('textarea', { rows: 3, placeholder: 'e.g. Hi! Mind if our group takes this slot? We can play another time.' });
            ta.addEventListener('input', () => { message = ta.value; });
            return ta;
          })(),
        ]),
      ]),
      buttons: [
        { label: 'Cancel', kind: 'ghost', onClick: () => this._closeModal() },
        { label: 'Send request', kind: 'primary', onClick: async () => {
          try {
            await createSwapRequest({
              requesting_group_id: this.group.id,
              target_booking_id: booking.id,
              message,
            });
            toast('Swap request sent.', 'success');
            this._closeModal();
            await this.refresh();
          } catch (e) { toast(e.message || String(e), 'error'); }
        }},
      ],
    });
  }

  _openModal({ title, body, buttons }) {
    this._closeModal();
    const backdrop = el('div', { class: 'modal-backdrop', onclick: (e) => { if (e.target === backdrop) this._closeModal(); } });
    const modal = el('div', { class: 'modal' }, [
      el('h2', {}, title),
      body,
      el('div', { class: 'actions' }, buttons.map(b => el('button', {
        class: 'btn ' + (b.kind === 'primary' ? 'btn-primary' : b.kind === 'danger' ? 'btn-danger' : 'btn-ghost'),
        onclick: b.onClick,
      }, b.label))),
    ]);
    backdrop.appendChild(modal);
    document.body.appendChild(backdrop);
    this._modal = backdrop;
  }

  _closeModal() {
    if (this._modal) {
      this._modal.remove();
      this._modal = null;
    }
  }
}

// Helper: look up a booking in a list by date+hour.
function bookingByKey(list, dateStr, hour) {
  return list.find(b => b.slot_date === dateStr && b.slot_hour === hour) || null;
}
