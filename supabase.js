// supabase.js — Supabase client init.
//
// The publishable (anon) key is PUBLIC by design — it is safe to ship in static
// client code. Access is governed by Row Level Security on the database, not by
// hiding this key. See SETUP.md for how to point this at a different project.
//
// Override at runtime without editing this file by defining window.WWW_CONFIG
// (e.g. in a separate, untracked config.js) before this module loads.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4'

const DEFAULTS = {
  url: 'https://ajswbhmibyeabsuxbrwt.supabase.co',
  anonKey: 'sb_publishable_-ECUZQiYgBlpqgwruFNxmg_eSjWe_-A',
}

const cfg = (typeof window !== 'undefined' && window.WWW_CONFIG) || {}
export const SUPABASE_URL = cfg.url || DEFAULTS.url
export const SUPABASE_ANON_KEY = cfg.anonKey || DEFAULTS.anonKey

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  realtime: { params: { eventsPerSecond: 10 } },
})
