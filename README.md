# Pickleball Scheduler

A free, static, community-pickleball-court booking site. Hosts on GitHub Pages, stores data in Supabase (free tier — no credit card).

## Features

- **24-hour weekly schedule** with color-coded bookings per group
- **Group registration** — 6 members per group, name + PIN login
- **Booking rules enforced in the database**:
  - Same hour ≤ 2× per week per group
  - ≤ 16 bookings per week per group
  - Multiple bookings per day allowed
- **Extensions**: once your current slot passes its halfway mark, you can extend into the next free hour
- **Swap requests**: politely ask another group to free a slot — in-app, with optional email notifications
- **Full booking history** browsable per group
- **Responsive, accessible UI** with light/dark mode

## Why this stack

GitHub Pages is static-only (no backend). To get *shared* persistence across all players for free, this app pairs the static site with Supabase's free Postgres + Auth tier. Row-Level Security + a single Postgres trigger enforce all the rules — the client can't bypass them by tampering with JavaScript.

## Setup

### 1. Create a Supabase project

1. Sign up at <https://supabase.com> (free, no card).
2. Create a new project. Pick a region close to your community. Save the database password somewhere safe.
3. In your project, go to **SQL Editor** → **New query**. Paste the contents of [`supabase/schema.sql`](supabase/schema.sql) and click **Run**. You should see "Success. No rows returned".
4. Go to **Authentication → Providers → Email** and **turn off "Confirm email"** (the app uses synthetic group emails that no one will receive). Save.
5. Go to **Project Settings → API** and copy:
   - The **Project URL** (looks like `https://abcdefg.supabase.co`)
   - The **anon public key** (a long `eyJ…` JWT)

### 2. Wire up `config.js`

```bash
cp js/config.example.js js/config.js
```

Open `js/config.js` and replace `YOUR-PROJECT-REF.supabase.co` and `YOUR_PUBLIC_ANON_KEY` with the values from step 1.5. The anon key is safe to publish — Row-Level Security is what protects your data.

### 3. Try it locally

ES modules don't load over `file://`. Start any static server:

```bash
# Python
python -m http.server 8000

# or Node
npx serve .
```

Then open <http://localhost:8000>. Register a test group, book a slot, log out, log in again, etc.

### 4. Deploy to GitHub Pages

```bash
git init
git add .
git commit -m "Initial pickleball scheduler"
git branch -M main
git remote add origin https://github.com/<you>/<repo>.git
git push -u origin main
```

Then on GitHub: **Settings → Pages → Build and deployment**. Set **Source: Deploy from a branch**, **Branch: `main` / `/ (root)`**, save. Pages will publish to `https://<you>.github.io/<repo>/` within a minute or two.

### 5. (Optional) Enable email notifications for swap requests

This step is purely optional — swap requests work in-app without it. To get emails on top:

1. Sign up at [Resend](https://resend.com) (free tier: 3,000 emails/month, no card).
2. Verify your sending domain or use the Resend sandbox sender.
3. Create a Supabase Edge Function called `send-swap-email` that calls the Resend API. Skeleton:

   ```ts
   // supabase/functions/send-swap-email/index.ts
   import { serve } from "https://deno.land/std/http/server.ts";
   serve(async (req) => {
     const { requesting_group_id, target_booking_id, message } = await req.json();
     // 1. Look up the target booking's group leader_email via the service role key
     // 2. POST to https://api.resend.com/emails with Authorization: Bearer RESEND_API_KEY
     return new Response("ok");
   });
   ```

4. Set `RESEND_API_KEY` as a Supabase project secret and deploy with `supabase functions deploy send-swap-email`.

The client already calls `supabase.functions.invoke('send-swap-email', ...)` whenever a swap request is created — if the function isn't deployed, the call quietly fails and the in-app request still works.

## File layout

```
.
├── index.html         # Weekly schedule grid (main view)
├── register.html      # Group registration form
├── login.html         # Group login (name + PIN)
├── dashboard.html     # Your group: bookings, swap inbox, history
├── about.html         # Rules
├── css/styles.css     # Design system + components
├── js/
│   ├── config.example.js
│   ├── config.js              # not committed if you prefer (see below)
│   ├── util.js                # date helpers, ISO week, colors
│   ├── supabase-client.js     # singleton client
│   ├── auth.js                # register / login / nav
│   ├── scheduler.js           # the week grid component
│   ├── booking.js             # book / cancel / extend
│   └── swap.js                # swap-request CRUD
├── supabase/
│   └── schema.sql             # tables, trigger, RLS policies
└── .nojekyll                  # tell GitHub Pages not to process underscores
```

## Editing the rules

All rules live in `supabase/schema.sql` inside the `enforce_booking_rules` trigger. To change them (e.g. raise the weekly cap to 20), edit the function and re-run it in the SQL editor — the trigger gets replaced. Update `js/config.js` constants to match for the UI labels.

## Security notes

- **The anon key is public by design.** Row-Level Security policies are the real authorization layer. Read them in `schema.sql` — the policies allow anyone to *read* schedule data (community visibility), but only the owning group (matched by `auth.uid()`) can write its own bookings or members.
- **PINs are stored as Supabase Auth passwords**, hashed by Supabase. They are not in `groups.leader_email` or anywhere visible.
- **Synthetic emails (`<slug>@pickleball.local`)** never receive real mail and are never displayed. They exist so we can use Supabase's password-based auth without asking each player for an email address.

## What's not included

- Push or in-browser notifications
- Booking reminders
- Multi-court support (one court per deployment)
- Calendar export (.ics)

These are all small additions if you want them later.
