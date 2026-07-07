import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY

// Sesión persistida en localStorage → disponible sin conexión vía getSession().
export const supabase = createClient(url, anon, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    storage: window.localStorage,
    storageKey: 'ci-inventario-auth',
  },
})
