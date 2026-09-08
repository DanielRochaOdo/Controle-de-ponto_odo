import React, { useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { Helmet } from 'react-helmet';
import { Eye, EyeOff, Lock, UserRound } from 'lucide-react';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { useToast } from '@/components/ui/use-toast';

const Login = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const { user, signIn } = useAuth();
  const { toast } = useToast();
  const location = useLocation();

  if (user) return <Navigate to={location.state?.from?.pathname || '/dashboard'} replace />;

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!email || !password) {
      toast({ title: 'Campos obrigatórios', description: 'Informe usuário e senha.', variant: 'destructive' });
      return;
    }

    setLoading(true);
    const { error } = await signIn(email, password);
    setLoading(false);
    if (error) toast({ title: 'Não foi possível entrar', description: error.message, variant: 'destructive' });
  };

  return (
    <>
      <Helmet>
        <title>Controle de Ponto | Odontoart</title>
        <meta name="description" content="Sistema interno de controle de ponto da Odontoart." />
      </Helmet>

      <div className="flex min-h-screen items-center justify-center bg-[radial-gradient(circle_at_top,#f8fbff_0,#eef4f9_45%,#f7f9fb_100%)] px-4">
        <div className="w-full max-w-[520px]">
          <div className="rounded-2xl border border-slate-200/80 bg-white px-8 py-12 shadow-[0_18px_60px_rgba(15,49,84,0.08)] sm:px-14">
            <div className="mb-10 text-center">
              <div className="inline-flex flex-col items-center text-[#0b3154]">
                <span className="text-5xl font-light tracking-tight leading-none">Odontoart</span>
                <span className="mt-2 h-4 w-24 rounded-b-full border-b-4 border-[#0b3154]" />
              </div>
              <h1 className="mt-7 text-2xl font-semibold text-[#0b3154]">Controle de Ponto</h1>
            </div>

            <form className="space-y-4" onSubmit={handleSubmit}>
              <label className="relative block">
                <UserRound className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" />
                <input
                  type="email"
                  autoComplete="username"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="Usuário"
                  disabled={loading}
                  className="h-14 w-full rounded-lg border border-slate-300 bg-white pl-12 pr-4 text-base outline-none transition placeholder:text-slate-400 focus:border-[#17558a] focus:ring-2 focus:ring-[#17558a]/10"
                />
              </label>

              <label className="relative block">
                <Lock className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" />
                <input
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="Senha"
                  disabled={loading}
                  className="h-14 w-full rounded-lg border border-slate-300 bg-white pl-12 pr-12 text-base outline-none transition placeholder:text-slate-400 focus:border-[#17558a] focus:ring-2 focus:ring-[#17558a]/10"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((value) => !value)}
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                  aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'}
                >
                  {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                </button>
              </label>

              <button
                type="submit"
                disabled={loading}
                className="mt-2 h-14 w-full rounded-lg bg-[#0d4d82] text-base font-semibold text-white shadow-sm transition hover:bg-[#0b426f] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {loading ? 'Entrando...' : 'Entrar'}
              </button>
            </form>
          </div>

          <p className="mt-8 text-center text-sm text-slate-400">Sistema interno • Odontoart</p>
        </div>
      </div>
    </>
  );
};

export default Login;
