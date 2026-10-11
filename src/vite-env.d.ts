/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Supabase project URL. Sign-in is disabled when this or the anon key is missing. */
  readonly VITE_SUPABASE_URL?: string;
  /** Supabase anon (publishable) key — safe to ship to the browser. */
  readonly VITE_SUPABASE_ANON_KEY?: string;
  /** API origin. Leave empty in dev to use the Vite proxy (`/api` → localhost:8000). */
  readonly VITE_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
