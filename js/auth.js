import { sb, currentIdentity } from './supabase-client.js';
import { slugify, emailOf, validatePin, validateEmail, toast } from './util.js';

// ============================================================
// Group registration (PIN flow) — synthetic email + PIN as password
// ============================================================

export async function registerGroup({ name, pin, leaderEmail, members }) {
  const errs = [];
  if (!name || name.trim().length < 2) errs.push('Group name must be at least 2 characters');
  const pinErr = validatePin(pin); if (pinErr) errs.push(pinErr);
  const emailErr = validateEmail(leaderEmail); if (emailErr) errs.push(emailErr);
  const cleanMembers = Array.isArray(members) ? members.map(m => (m || '').trim()).filter(Boolean) : [];
  if (cleanMembers.length < 3) errs.push('At least 3 member names required');
  if (cleanMembers.length > 6) errs.push('No more than 6 member names allowed');
  if (errs.length) throw new Error(errs.join('. '));

  const slug = slugify(name);
  if (!slug) throw new Error('Group name contains no usable characters');

  const client = sb();

  const { data: signUp, error: signErr } = await client.auth.signUp({
    email: emailOf(slug),
    password: pin,
  });
  if (signErr) {
    if (/already registered/i.test(signErr.message || '')) {
      throw new Error('A group with this name already exists. Pick another name.');
    }
    throw signErr;
  }
  if (!signUp.session) {
    const { error: signInErr } = await client.auth.signInWithPassword({
      email: emailOf(slug),
      password: pin,
    });
    if (signInErr) throw new Error('Account created but auto sign-in failed: ' + signInErr.message);
  }

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
  if (gErr) throw new Error('Could not create group: ' + gErr.message);

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

// ============================================================
// Individual registration (real email + password)
// ============================================================

export async function registerIndividual({ displayName, email, password }) {
  const errs = [];
  if (!displayName || displayName.trim().length < 2) errs.push('Display name must be at least 2 characters');
  const emailErr = validateEmail(email); if (emailErr) errs.push(emailErr);
  if (!password || password.length < 8) errs.push('Password must be at least 8 characters');
  if (errs.length) throw new Error(errs.join('. '));

  const client = sb();

  const { data: signUp, error: signErr } = await client.auth.signUp({
    email: email.trim(),
    password,
  });
  if (signErr) {
    if (/already registered/i.test(signErr.message || '')) {
      throw new Error('That email is already registered. Try logging in.');
    }
    throw signErr;
  }
  if (!signUp.session) {
    const { error: signInErr } = await client.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    if (signInErr) {
      // Likely email confirmation is enabled on the Supabase project.
      throw new Error('Account created — check your email to confirm, then log in.');
    }
  }

  const session = (await client.auth.getSession()).data.session;
  if (!session) throw new Error('Could not establish session after signup.');

  const { error: pErr } = await client.from('profiles').insert({
    id: session.user.id,
    display_name: displayName.trim(),
    email: email.trim(),
  });
  if (pErr && pErr.code !== '23505') throw new Error('Could not save profile: ' + pErr.message);

  return { id: session.user.id, display_name: displayName.trim(), email: email.trim() };
}

export async function loginIndividual({ email, password }) {
  if (!email || !password) throw new Error('Email and password required');
  const { error } = await sb().auth.signInWithPassword({
    email: email.trim(),
    password,
  });
  if (error) {
    if (/invalid login/i.test(error.message)) throw new Error('Email or password is incorrect.');
    throw error;
  }
  return true;
}

export async function logout() {
  await sb().auth.signOut();
}

// ============================================================
// Nav
// ============================================================

export async function mountNav(activePage) {
  const nav = document.querySelector('.nav-links');
  const right = document.querySelector('.nav-right');
  if (!nav) return;

  const links = [
    { id: 'home',      label: 'Schedule', href: 'index.html' },
    { id: 'groups',    label: 'Groups',   href: 'groups.html' },
    { id: 'dashboard', label: 'Dashboard', href: 'dashboard.html' },
    { id: 'about',     label: 'Rules',    href: 'about.html' },
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
    const id = await currentIdentity();
    if (id.kind === 'group') {
      const span = document.createElement('span');
      span.className = 'nav-user';
      span.textContent = id.group.name;
      const out = mkLogoutButton();
      right.append(span, out);
    } else if (id.kind === 'individual') {
      const span = document.createElement('span');
      span.className = 'nav-user';
      span.textContent = (id.profile && id.profile.display_name) || id.session.user.email || 'You';
      const out = mkLogoutButton();
      right.append(span, out);
    } else {
      const login = document.createElement('a');
      login.href = 'login.html';
      login.className = 'btn btn-ghost btn-sm';
      login.textContent = 'Log in';
      const reg = document.createElement('a');
      reg.href = 'register.html';
      reg.className = 'btn btn-primary btn-sm';
      reg.textContent = 'Sign up';
      right.append(login, reg);
    }
  } catch (e) {
    const note = document.createElement('span');
    note.className = 'nav-user';
    note.textContent = 'config.js not set';
    right.append(note);
  }
}

function mkLogoutButton() {
  const out = document.createElement('button');
  out.className = 'btn btn-ghost btn-sm';
  out.textContent = 'Log out';
  out.onclick = async () => {
    await logout();
    location.href = 'index.html';
  };
  return out;
}
