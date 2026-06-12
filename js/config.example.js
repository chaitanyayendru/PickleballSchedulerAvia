// Copy this file to `config.js` and fill in your Supabase project details.
// The anon key is safe to ship publicly — Row Level Security protects the data.
window.PB_CONFIG = {
  SUPABASE_URL: 'https://YOUR-PROJECT-REF.supabase.co',
  SUPABASE_ANON_KEY: 'YOUR_PUBLIC_ANON_KEY',

  // Pickleball-Scheduler-specific
  COURT_NAME: 'Community Court',
  SLOT_HOURS: 1,           // hour-based slots; the rule engine assumes 1
  WEEKLY_LIMIT: 16,
  SAME_HOUR_WEEKLY_LIMIT: 2,
  GROUP_SIZE: 6,
};
