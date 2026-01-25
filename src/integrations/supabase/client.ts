import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://bxchawikvnvxzerlsffs.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_30agTp2SQN9EeT9dGfoh7w_2tWmYuAJ';

// Strict validation - throw if misconfigured
if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
  throw new Error('CRITICAL: Supabase URL or Key is missing. Cannot initialize application.');
}

if (!SUPABASE_URL.includes('bxchawikvnvxzerlsffs.supabase.co')) {
  throw new Error('CRITICAL: Supabase URL does not match expected project. Check configuration.');
}

// Dev-only startup log
if (import.meta.env.DEV) {
  console.log('[Neotopia] Supabase URL:', SUPABASE_URL);
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true,
  },
});

export { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY };
