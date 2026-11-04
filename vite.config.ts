import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// Supabase is the backend -- no server of ours to proxy to. The Vercel
// integration populates SUPABASE_URL / SUPABASE_ANON_KEY, but it also adds
// SUPABASE_SERVICE_ROLE_KEY, SUPABASE_SECRET_KEY and SUPABASE_JWT_SECRET, so
// the 'SUPABASE_' prefix must never be exposed wholesale. Instead the two
// public values are picked out by name and inlined; everything else stays
// server-side. Locally, VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY in .env
// work too.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const pick = (...keys: string[]) => keys.map((key) => env[key]).find(Boolean) ?? ''

  return {
    plugins: [react()],
    define: {
      'import.meta.env.SUPABASE_URL': JSON.stringify(pick('SUPABASE_URL', 'VITE_SUPABASE_URL')),
      'import.meta.env.SUPABASE_ANON_KEY': JSON.stringify(
        pick('SUPABASE_ANON_KEY', 'SUPABASE_PUBLISHABLE_KEY', 'VITE_SUPABASE_ANON_KEY'),
      ),
    },
    server: { port: 5173 },
    build: { outDir: 'dist', sourcemap: true },
  }
})
