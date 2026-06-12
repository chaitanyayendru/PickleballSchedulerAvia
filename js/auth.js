import { sb, currentUserGroup } from './supabase-client.js';
import { slugify, emailOf, validatePin, validateEmail, toast } from './util.js';

// Register a brand-new group. Wraps Supabase Auth signUp + groups/members inserts.
export async function registerGroup({ name, pin, leaderEmail, members }) {
  const errs = [];
  if (!name || name.trim().length < 2) errs.push('Group name must be at least 2 characters');
  const pinErr = validatePin(pin); if (pinErr) errs.push(pinErr);
  const emailErr = validateEmail(leaderEmail); if (emailErr) errs.push(emailErr);
  // Members: 3 minimum, 6 maximum. Trim and drop blanks.
  const cleanMembers = Array.isArray(members) ? members.map(m => (m || '').trim()).filter(Boolean) : [];
  if (cleanMembers.length < 3) errs.push('At least 3 member names required');
  if (cleanMembers.length > 6) errs.push('No more than 6 member names allowed');
  if (errs.length) throw new Error(errs.join('. '));

  const slug = slugify(name);
  if (!slug) throw new Error('Group name contains no usable characters');

  const client = sb();

  // 1. Sign up with synthetic email + PIN as password.
  const { data: signUp, error: signErr } = await client.auth.signUp({
    email: emailOf(slug),
    password: pin,
  });
  if (signErr) {
    if (signErr.message && /already registered/i.test(signErr.message)) {
      throw new Error('A group with this name already exists. Pick another name.');
    }
    throw signErr;
  }
  if (!signUp.session) {
    // Email confirmations enabled — sign in immediately if the project allows it.
    const { error: signInErr } = await client.auth.signInWithPassword({
      email: emailOf(slug),
      password: pin,
    });
    if (signInErr) throw new Error('Account created but auto sign-in failed: ' + signInErr.message);
  }

  // 2. Create the group row tied to the new auth user.
  const session = (await client.auth.getSession()).data.session;
  if (!session) throw new Error('Could not establish session after signup.');

  const { data: group, error: gErr } = await client
    .from('groups')
    .insert({
      name: name.trim(),
      slug,
      leader_email: leaderEmail.trim(),
      auth_user_id: session.user.id,
    })
    .select()
    .single();
  if (gErr) {
    // Roll back the auth user on failure — best effort; user may need to retry.
    throw new Error('Could not create group: ' + gErr.message);
  }

  // 3. Insert members.
  const memberRows = cleanMembers.map((n, i) => ({
    group_id: group.id,
    name: n,
    ordinal: i + 1,
  }));
  const { error: mErr } = await client.from('members').insert(memberRows);
  if (mErr) throw new Error('Group created but adding members failed: ' + mErr.message);

  return group;
}

export async function loginGroup({ name, pin }) {
  if (!name) throw new Error('Group name required');
  const pinErr = validatePin(pin); if (pinErr) throw new Error(pinErr);
  const slug = slugify(name);
  const { error } = await sb().auth.signInWithPassword({
    email: emailOf(slug),
    password: pin,
  });
  if (error) {
    if (/invalid login/i.test(error.message)) throw new Error('Group name or PIN is incorrect.');
    throw error;
  }
  return true;
}

export async function logout() {
  await sb().auth.signOut();
}

// Mount the standard nav menu and reflect login state.
// Pass `activePage` so the link to the current page is highlighted.
export async function mountNav(activePage) {
  const nav = document.querySelector('.nav-links');
  const right = document.querySelector('.nav-right');
  if (!nav) return;

  const links = [
    { id: 'home', label: 'Schedule', href: 'index.html' },
    { id: 'dashboard', label: 'My Group', href: 'dashboard.html' },
    { id: 'about', label: 'Rules', href: 'about.html' },
  ];
  nav.innerHTML = '';
  for (const l of links) {
    const a = document.createElement('a');
    a.href = l.href;
    a.textContent = l.label;
    if (l.id === activePage) a.className = 'active';
    nav.appendChild(a);
  }

  if (!right) return;
  right.innerHTML = '';
  try {
    const { group } = await currentUserGroup();
    if (group) {
      const span = document.createElement('span');
      span.className = 'nav-user';
      span.textContent = group.name;
      const out = document.createElement('button');
      out.className = 'btn btn-ghost btn-sm';
      out.textContent = 'Log out';
      out.onclick = async () => {
        await logout();
        location.href = 'index.html';
      };
      right.append(span, out);
    } else {
      const login = document.createElement('a');
      login.href = 'login.html';
      login.className = 'btn btn-ghost btn-sm';
      login.textContent = 'Log in';
      const reg = document.createElement('a');
      reg.href = 'register.html';
      reg.className = 'btn btn-primary btn-sm';
      reg.textContent = 'Register group';
      right.append(login, reg);
    }
  } catch (e) {
    // Config not set up yet — show registration links anyway so the user can read instructions.
    const note = document.createElement('span');
    note.className = 'nav-user';
    note.textContent = 'config.js not set';
    right.append(note);
  }
}
