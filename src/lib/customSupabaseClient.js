import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

if (!isSupabaseConfigured) {
  console.warn(
    'Supabase não configurado no ambiente local. Defina VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY em .env.local.'
  );
}

// Mantemos um cliente válido estruturalmente para que a aplicação possa renderizar
// mesmo sem configuração local. As chamadas de Auth são bloqueadas pelo AuthContext
// com uma mensagem explícita, evitando o erro confuso "Invalid API key".
export const supabase = createClient(
  supabaseUrl || 'https://placeholder.supabase.co',
  supabaseAnonKey || 'placeholder-anon-key'
);
