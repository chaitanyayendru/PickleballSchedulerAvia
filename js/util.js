// Small helpers shared across pages.
// All times are interpreted in the user's local timezone — the assumption is
// that the court and players share one timezone.

export const HOURS_PER_DAY = 24;
export const DAYS_PER_WEEK = 7;

export const DOW_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export function slugify(s) {
  return String(s).toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

// ISO week starts Monday. Returns local Date at 00:00.
export function isoWeekStart(d = new Date()) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dow = (x.getDay() + 6) % 7; // 0=Mon..6=Sun
  x.setDate(x.getDate() - dow);
  return x;
}

export function addDays(d, n) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

export function isSameDay(a, b) {
  return a.getFullYear() === b.getFullYear()
      && a.getMonth() === b.getMonth()
      && a.getDate() === b.getDate();
}

// 'YYYY-MM-DD' in local time
export function ymd(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function parseYmd(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function fmtHour12(h) {
  const suffix = h < 12 ? 'AM' : 'PM';
  const hh = ((h + 11) % 12) + 1;
  return `${hh} ${suffix}`;
}

export function fmtHourRange(h) {
  return `${fmtHour12(h)} – ${fmtHour12((h + 1) % 24)}`;
}

export function fmtDateShort(d) {
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function fmtDateLong(d) {
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

// Deterministic pastel hue from a string (for color-coding groups in the grid).
export function hueFromString(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) >>> 0;
  }
  return h % 360;
}

export function groupColor(name) {
  const h = hueFromString(name || 'x');
  return {
    bg:   `hsl(${h}, 70%, 88%)`,
    bgDark: `hsl(${h}, 35%, 28%)`,
    text: `hsl(${h}, 50%, 22%)`,
    textDark: `hsl(${h}, 70%, 86%)`,
  };
}

export function emailOf(slug) {
  // Synthetic email used as Supabase Auth identity for a group login.
  // The PIN is the password. Slug is unique per group.
  // We use a real ICANN TLD (.app) because Supabase rejects reserved TLDs
  // like .local/.test/.invalid in its email validator.
  return `${slug}@pickleball-scheduler.app`;
}

export function validatePin(pin) {
  if (typeof pin !== 'string') return 'PIN required';
  if (!/^\d{4,8}$/.test(pin)) return 'PIN must be 4–8 digits';
  return null;
}

export function validateEmail(s) {
  if (!s) return 'Email required';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) return 'Email looks invalid';
  return null;
}

export function el(tag, attrs = {}, children = []) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(e.style, v);
    else if (k === 'dataset') Object.assign(e.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v);
  }
  for (const c of [].concat(children)) {
    if (c == null || c === false) continue;
    e.append(c.nodeType ? c : document.createTextNode(c));
  }
  return e;
}

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

export function toast(msg, kind = 'info') {
  let box = document.getElementById('toast-box');
  if (!box) {
    box = document.createElement('div');
    box.id = 'toast-box';
    Object.assign(box.style, {
      position: 'fixed', bottom: '24px', right: '24px',
      display: 'flex', flexDirection: 'column', gap: '8px',
      zIndex: 999, maxWidth: '320px',
    });
    document.body.appendChild(box);
  }
  const t = el('div', { class: `banner banner-${kind}` }, msg);
  t.style.boxShadow = 'var(--shadow-lg)';
  box.appendChild(t);
  setTimeout(() => t.remove(), 4500);
}
