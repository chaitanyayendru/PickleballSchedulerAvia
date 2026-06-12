import { sb, currentIdentity } from './supabase-client.js';
import { validateEmail } from './util.js';

// ============================================================
// Individual auth (the only auth path in v3)
// ============================================================

export async function registerIndividual({ displayName, email, password }) {
  const errs = [];
  if (!displayName || displayName.trim().length < 2) errs.push('Display name must be at least 2 characters');
  const emailErr = validateEmail(email); if (emailErr) errs.push(emailErr);
  if (!password || password.length < 8) errs.push('Password must be at least 8 characters');
  if (errs.length) throw new Error(errs.join('. '));

  const client = sb();

  const { data: signUp, error: signErr } = await client.auth.signUp({
    email: email.trim().toLowerCase(),
    password,
  });
  if (signErr) {
    if (/already registered/i.test(signErr.message || '')) {
      throw new Error('That email is already registered. Try logging in.');
    }
    if (/rate limit/i.test(signErr.message || '')) {
      throw new Error('Supabase email rate limit hit. Turn off "Confirm email" in Supabase → Authentication → Providers → Email, then try again.');
    }
    throw signErr;
  }
  if (!signUp.session) {
    const { error: signInErr } = await client.auth.signInWithPassword({
      email: email.trim().toLowerCase(),
      password,
    });
    if (signInErr) {
      throw new Error('Account created — if Supabase email confirmation is on, check your inbox to confirm, then log in. Otherwise: ' + signInErr.message);
    }
  }

  const session = (await client.auth.getSession()).data.session;
  if (!session) throw new Error('Could not establish session after signup.');

  const { error: pErr } = await client.from('profiles').insert({
    id: session.user.id,
    display_name: displayName.trim(),
    email: email.trim().toLowerCase(),
  });
  if (pErr && pErr.code !== '23505') throw new Error('Could not save profile: ' + pErr.message);

  return { id: session.user.id, display_name: displayName.trim(), email: email.trim().toLowerCase() };
}

export async function loginIndividual({ email, password }) {
  if (!email || !password) throw new Error('Email and password required');
  const { error } = await sb().auth.signInWithPassword({
    email: email.trim().toLowerCase(),
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
    { id: 'home',      label: 'Schedule',  href: 'index.html' },
    { id: 'groups',    label: 'Groups',    href: 'groups.html' },
    { id: 'dashboard', label: 'Dashboard', href: 'dashboard.html' },
    { id: 'about',     label: 'Rules',     href: 'about.html' },
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
    if (id.kind === 'group' || id.kind === 'individual') {
      const label = id.kind === 'group'
        ? id.group.name + ' (captain)'
        : (id.profile && id.profile.display_name) || id.session.user.email || 'You';
      const span = document.createElement('span');
      span.className = 'nav-user';
      span.textContent = label;
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
      reg.href = 'signup.html';
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
