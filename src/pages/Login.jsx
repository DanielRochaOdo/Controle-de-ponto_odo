import React, { useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { Helmet } from 'react-helmet';
import { Eye, EyeOff, Lock, User } from 'lucide-react';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { useToast } from '@/components/ui/use-toast';
import { ODONTOART_LOGO } from '@/lib/brand';

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

      <div className="flex min-h-screen items-center justify-center bg-[radial-gradient(circle_at_top,#ffffff_0,#f2fbe9_46%,#f8fcf5_100%)] px-4">
        <div className="w-full max-w-[520px]">
          <div className="rounded-2xl border border-[#d8efc5] bg-white px-8 py-11 shadow-[0_20px_60px_rgba(6,95,47,0.10)] sm:px-14">
            <div className="mb-9 text-center">
              <img src={ODONTOART_LOGO} alt="Odontoart Planos Odontológicos" className="mx-auto w-full max-w-[300px] object-contain" />
              <h1 className="mt-7 text-2xl font-semibold text-[#065F2F]">Controle de Ponto</h1>
              <p className="mt-1 text-sm text-slate-500">Acesso interno Odontoart</p>
            </div>

            <form className="space-y-4" onSubmit={handleSubmit}>
              <label className="relative block">
                <User className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-[#5f7f6a]" />
                <input
                  type="email"
                  autoComplete="username"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="Usuário"
                  disabled={loading}
                  className="h-14 w-full rounded-lg border border-[#cfe8bc] bg-white pl-12 pr-4 text-base outline-none transition placeholder:text-slate-400 focus:border-[#57D100] focus:ring-2 focus:ring-[#57D100]/20"
                />
              </label>

              <label className="relative block">
                <Lock className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-[#5f7f6a]" />
                <input
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="Senha"
                  disabled={loading}
                  className="h-14 w-full rounded-lg border border-[#cfe8bc] bg-white pl-12 pr-12 text-base outline-none transition placeholder:text-slate-400 focus:border-[#57D100] focus:ring-2 focus:ring-[#57D100]/20"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((value) => !value)}
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-[#5f7f6a] transition hover:text-[#065F2F]"
                  aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'}
                >
                  {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                </button>
              </label>

              <button
                type="submit"
                disabled={loading}
                className="mt-2 h-14 w-full rounded-lg bg-[#57D100] text-base font-semibold text-[#064E2C] shadow-sm transition hover:bg-[#4cc000] focus:outline-none focus:ring-2 focus:ring-[#57D100]/30 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {loading ? 'Entrando...' : 'Entrar'}
              </button>
            </form>
          </div>

          <p className="mt-7 text-center text-sm text-[#6b8a74]">Sistema interno • Odontoart</p>
        </div>
      </div>
    </>
  );
};

export default Login;
