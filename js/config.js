// Local placeholder so the static site loads without throwing in offline previews.
// REPLACE these with your actual Supabase project values before deploying.
// (Make sure this file is NOT committed if you'd rather keep keys out of git —
// the anon key is safe to expose, but you may still prefer per-environment configs.)
window.PB_CONFIG = {
  SUPABASE_URL: 'https://YOUR-PROJECT-REF.supabase.co',
  SUPABASE_ANON_KEY: 'YOUR_PUBLIC_ANON_KEY',
  COURT_NAME: 'Community Court',
  SLOT_HOURS: 1,
  WEEKLY_LIMIT: 16,
  SAME_HOUR_WEEKLY_LIMIT: 2,
  GROUP_SIZE: 6,
};
