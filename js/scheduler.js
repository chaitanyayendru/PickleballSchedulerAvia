import { sb, currentIdentity } from './supabase-client.js';
import {
  isoWeekStart, addDays, ymd, parseYmd, isSameDay,
  fmtHour12, fmtHourRange, fmtDateLong, DOW_SHORT, groupColor, el, toast,
} from './util.js';
import { bookSlot, cancelBooking, extendSlot, canExtend } from './booking.js';
import { createSwapRequest } from './swap.js';

const HOURS = 24;
const DAYS  = 7;

export class WeekScheduler {
  constructor(container, { onChange } = {}) {
    this.container = container;
    this.weekStart = isoWeekStart(new Date());
    this.bookings = [];
    this.swapRequests = [];
    this.identity = { kind: 'none' };
    this.availableGroups = []; // [{ id, name, slug, role: 'captain' | 'member' }]
    this.now = new Date();
    this.onChange = onChange || (() => {});
    this._modal = null;
  }

  async init() {
    this.identity = await currentIdentity();
    this.availableGroups = this._deriveAvailableGroups(this.identity);
    await this._loadGroupMemberCounts();
    await this.refresh();
    setInterval(() => { this.now = new Date(); this.render(); }, 60_000);
  }

  // Fills availableGroups[i].memberCount so the booking modal can warn
  // when a group has < 4 members.
  async _loadGroupMemberCounts() {
    if (!this.availableGroups.length) return;
    const ids = this.availableGroups.map(g => g.id);
    const { data } = await sb().from('groups_directory').select('id, member_count').in('id', ids);
    const byId = new Map((data || []).map(r => [r.id, r.member_count]));
    for (const g of this.availableGroups) g.memberCount = byId.get(g.id) ?? 0;
  }

  _deriveAvailableGroups(id) {
    if (id.kind === 'group') {
      return [{ id: id.group.id, name: id.group.name, slug: id.group.slug, role: 'captain' }];
    }
    if (id.kind === 'individual') {
      return (id.memberships || []).map(m => ({
        id: m.group_id, name: m.group_name, slug: m.group_slug, role: 'member',
      }));
    }
    return [];
  }

  _isOwnedGroupId(groupId) {
    return this.availableGroups.some(g => g.id === groupId);
  }

  weekEnd() { return addDays(this.weekStart, 6); }

  setWeek(d) { this.weekStart = isoWeekStart(d); return this.refresh(); }

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

    const toolbar = el('div', { class: 'week-toolbar' }, [
      el('div', { class: 'week-label' }, this._weekLabel()),
      el('div', { class: 'week-nav' }, [
        el('button', { class: 'btn btn-ghost btn-sm', onclick: () => this.setWeek(addDays(this.weekStart, -7)) }, '← Prev'),
        el('button', { class: 'btn btn-ghost btn-sm', onclick: () => this.setWeek(new Date()) }, 'Today'),
        el('button', { class: 'btn btn-ghost btn-sm', onclick: () => this.setWeek(addDays(this.weekStart, 7)) }, 'Next →'),
      ]),
    ]);
    c.appendChild(toolbar);

    // Legend
    const legendItems = [];
    if (this.availableGroups.length === 0) {
      if (this.identity.kind === 'individual') {
        legendItems.push(el('span', { class: 'dim' }, [
          'You haven\'t joined any group yet. ',
          el('a', { href: 'groups.html' }, 'Find a group to join'),
          '.',
        ]));
      } else {
        legendItems.push(el('span', { class: 'dim' }, [
          el('a', { href: 'login.html' }, 'Log in'),
          ' or ',
          el('a', { href: 'register.html' }, 'register a group'),
          ' to book a slot.',
        ]));
      }
    } else {
      for (const g of this.availableGroups) {
        const color = groupColor(g.name);
        legendItems.push(el('span', {}, [
          el('span', { class: 'legend-swatch', style: { background: color.bg } }),
          g.name,
          el('span', { class: 'dim' }, ` · ${g.role}`),
        ]));
      }
      legendItems.push(el('span', { class: 'dim' }, 'Click any free slot to book.'));
    }
    c.appendChild(el('div', { class: 'legend' }, legendItems));

    // Grid
    const wrap = el('div', { class: 'grid-wrap' });
    const grid = el('div', { class: 'grid' });
    wrap.appendChild(grid);
    c.appendChild(wrap);

    grid.appendChild(el('div', { class: 'col-header' }, ''));
    for (let d = 0; d < DAYS; d++) {
      const date = addDays(this.weekStart, d);
      const isToday = isSameDay(date, this.now);
      grid.appendChild(el('div', { class: 'col-header' + (isToday ? ' today' : '') }, [
        el('span', {}, DOW_SHORT[d]),
        el('span', { class: 'dow' }, date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })),
      ]));
    }

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
        if (booking && this._isOwnedGroupId(booking.group_id)) classes.push('cell-mine');

        const children = [];
        if (booking) {
          const color = groupColor(booking.group_name);
          children.push(el('span', {
            class: 'cell-tag' + (booking.is_extension ? ' is-extension' : ''),
            style: { background: color.bg, color: color.text },
            title: `${booking.group_name}${booking.is_extension ? ' (extension)' : ''}`,
          }, booking.group_name));
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
    const bStr = b.toLocaleDateString(undefined, sameMonth
      ? { day: 'numeric', year: 'numeric' }
      : { month: 'short', day: 'numeric', year: 'numeric' });
    return `${aStr} – ${bStr}`;
  }

  async _onCellClick(cell, booking, dateStr, hour) {
    if (this.identity.kind === 'none') {
      this._openModal({
        title: 'Log in to book',
        body: 'You need to log in to book or manage slots.',
        buttons: [
          { label: 'Cancel', kind: 'ghost', onClick: () => this._closeModal() },
          { label: 'Go to login', kind: 'primary', onClick: () => location.href = 'login.html' },
        ],
      });
      return;
    }

    if (this.availableGroups.length === 0) {
      // Individual without any group membership
      this._openModal({
        title: 'Join a group first',
        body: 'You\'re signed in but you\'re not in any group yet. Find one to join and request membership.',
        buttons: [
          { label: 'Close', kind: 'ghost', onClick: () => this._closeModal() },
          { label: 'Browse groups', kind: 'primary', onClick: () => location.href = 'groups.html' },
        ],
      });
      return;
    }

    if (!booking) {
      this._openBookModal(dateStr, hour);
      return;
    }

    // Existing booking
    const mine = this._isOwnedGroupId(booking.group_id);
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

      const next = lookupBooking(this.bookings, dateStr, hour + 1);
      if (hour < 23 && !next && canExtend(parseYmd(dateStr), hour, this.now)) {
        actions.push({ label: `Extend to ${fmtHour12((hour+1)%24)}`, kind: 'primary', onClick: async () => {
          try {
            await extendSlot(booking.group_id, dateStr, hour + 1);
            toast('Extension booked.', 'success');
            this._closeModal();
            await this.refresh();
          } catch (e) { toast(e.message || String(e), 'error'); }
        }});
      }
    } else {
      actions.push({ label: 'Request this slot', kind: 'primary', onClick: () => this._openSwapModal(booking) });
    }
    actions.push({ label: 'Close', kind: 'ghost', onClick: () => this._closeModal() });

    const pending = this.swapRequests.filter(s => s.target_booking_id === booking.id);
    this._openModal({
      title: booking.group_name + (booking.is_extension ? ' (extension)' : ''),
      body: el('div', {}, [
        el('p', {}, [fmtDateLong(parseYmd(dateStr)), ' · ', fmtHourRange(hour)]),
        mine ? el('p', { class: 'dim' }, 'This booking belongs to a group you\'re in.') : null,
        pending.length ? el('p', { class: 'tag' }, `${pending.length} pending swap request${pending.length>1?'s':''}`) : null,
      ]),
      buttons: actions,
    });
  }

  _openBookModal(dateStr, hour) {
    let selectedGroupId = this.availableGroups[0].id;
    const findGroup = (id) => this.availableGroups.find(g => g.id === id);

    const bodyChildren = [
      el('p', {}, fmtDateLong(parseYmd(dateStr))),
    ];

    // Member-count warning slot (updated when the group selector changes).
    const memberWarn = el('div', {});
    const updateWarn = () => {
      const g = findGroup(selectedGroupId);
      const count = g ? (g.memberCount ?? 0) : 0;
      memberWarn.innerHTML = '';
      if (count < 4) {
        memberWarn.appendChild(el('div', { class: 'banner banner-error' }, [
          `${g ? g.name : 'This group'} has only ${count} member${count === 1 ? '' : 's'}. Groups need 4 to book.`,
        ]));
        bookBtn && (bookBtn.disabled = true);
      } else {
        bookBtn && (bookBtn.disabled = false);
      }
    };

    if (this.availableGroups.length > 1) {
      const select = document.createElement('select');
      for (const g of this.availableGroups) {
        const opt = document.createElement('option');
        opt.value = g.id;
        const tag = (g.memberCount ?? 0) < 4 ? ` — ${g.memberCount ?? 0}/4 members` : '';
        opt.textContent = `${g.name} (${g.role})${tag}`;
        select.appendChild(opt);
      }
      select.addEventListener('change', () => { selectedGroupId = select.value; updateWarn(); });
      bodyChildren.push(el('div', { class: 'field' }, [
        el('label', {}, 'Book for which group?'),
        select,
      ]));
    } else {
      bodyChildren.push(el('p', { class: 'dim' }, [
        'Booking as ', el('strong', {}, this.availableGroups[0].name), '.',
      ]));
    }

    bodyChildren.push(memberWarn);
    bodyChildren.push(el('p', { class: 'dim' }, [
      `Rules: same hour ≤ 2× this week. ≤ 16 total this week. `,
      this._sameHourCountNote(hour, selectedGroupId),
    ]));

    let bookBtn;
    this._openModal({
      title: `Book ${fmtHourRange(hour)}`,
      body: el('div', {}, bodyChildren),
      buttons: [
        { label: 'Cancel', kind: 'ghost', onClick: () => this._closeModal() },
        { label: 'Book this slot', kind: 'primary', onClick: async () => {
          try {
            await bookSlot(selectedGroupId, dateStr, hour);
            toast('Slot booked.', 'success');
            this._closeModal();
            await this.refresh();
          } catch (e) {
            toast(e.message || String(e), 'error');
          }
        }},
      ],
    });
    bookBtn = this._modal.querySelector('.btn-primary');
    updateWarn();
  }

  _sameHourCountNote(hour, groupId) {
    if (!groupId) return '';
    const start = ymd(this.weekStart), end = ymd(this.weekEnd());
    const n = this.bookings.filter(b =>
      b.group_id === groupId &&
      b.slot_hour === hour &&
      b.slot_date >= start && b.slot_date <= end &&
      !b.is_extension
    ).length;
    return `${n} booking${n === 1 ? '' : 's'} at this hour this week.`;
  }

  _openSwapModal(booking) {
    let message = '';
    // For swap requests, the requesting group must be one I can act for.
    let requestingGroupId = this.availableGroups[0].id;

    const bodyChildren = [
      el('p', { class: 'dim' }, `Sends a request to ${booking.group_name}. They'll accept or decline from their dashboard.`),
    ];

    if (this.availableGroups.length > 1) {
      const select = document.createElement('select');
      for (const g of this.availableGroups) {
        const opt = document.createElement('option');
        opt.value = g.id;
        opt.textContent = `${g.name} (${g.role})`;
        select.appendChild(opt);
      }
      select.addEventListener('change', () => { requestingGroupId = select.value; });
      bodyChildren.push(el('div', { class: 'field' }, [
        el('label', {}, 'Request on behalf of'),
        select,
      ]));
    }

    bodyChildren.push(el('div', { class: 'field' }, [
      el('label', {}, 'Optional message'),
      (() => {
        const ta = el('textarea', { rows: 3, placeholder: 'e.g. Hi! Mind if we take this slot? Happy to swap.' });
        ta.addEventListener('input', () => { message = ta.value; });
        return ta;
      })(),
    ]));

    this._openModal({
      title: `Request ${booking.group_name}'s slot`,
      body: el('div', {}, bodyChildren),
      buttons: [
        { label: 'Cancel', kind: 'ghost', onClick: () => this._closeModal() },
        { label: 'Send request', kind: 'primary', onClick: async () => {
          try {
            await createSwapRequest({
              requesting_group_id: requestingGroupId,
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
    if (this._modal) { this._modal.remove(); this._modal = null; }
  }
}

function lookupBooking(list, dateStr, hour) {
  return list.find(b => b.slot_date === dateStr && b.slot_hour === hour) || null;
}
