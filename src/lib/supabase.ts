import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

/** `null` when VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY aren't set: the app runs signed out. */
export const supabase: SupabaseClient | null = url && anonKey ? createClient(url, anonKey) : null;
