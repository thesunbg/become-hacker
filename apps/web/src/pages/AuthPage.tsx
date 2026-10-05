import { useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { Button, ErrorNote, Input } from '../components/ui';
import { useSession } from '../store/session';
import { useT } from '../i18n';

/** Sign in and sign up, which are the same form with one extra field. */
export function AuthPage({ mode }: { mode: 'login' | 'register' }) {
  const { status, signIn, signUp } = useSession();
  const t = useT();
  const navigate = useNavigate();
  const location = useLocation();

  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  if (status === 'signed-in') return <Navigate to="/dashboard" replace />;

  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    setError('');
    setBusy(true);
    try {
      if (mode === 'register') await signUp(email, username, password);
      else await signIn(email, password);
      navigate('/dashboard', { replace: true });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t('auth.failed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="mx-auto flex min-h-full max-w-md flex-col justify-center gap-8 px-5 py-16">
      <header className="space-y-3">
        <h1 className="font-mono text-2xl font-bold tracking-tight">
          ZERO <span className="text-signal">→</span> ROOT
        </h1>
        <p className="font-mono text-xs tracking-[0.2em] text-muted uppercase">{t('tagline')}</p>
        <p className="text-sm leading-relaxed text-muted">{t('intro')}</p>
      </header>

      <form onSubmit={submit} className="space-y-4" noValidate>
        <Input
          label={t('auth.email')}
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />

        {mode === 'register' && (
          <Input
            label={t('auth.handle')}
            autoComplete="username"
            required
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            hint={t('auth.handleHint')}
          />
        )}

        <Input
          label={t('auth.password')}
          type="password"
          autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
          required
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          {...(mode === 'register' ? { hint: t('auth.passwordHint') } : {})}
        />

        <ErrorNote>{error}</ErrorNote>

        <Button type="submit" disabled={busy} className="w-full">
          {busy ? t('auth.working') : t(mode === 'register' ? 'auth.createAccount' : 'auth.signIn')}
        </Button>
      </form>

      <p className="text-center text-sm text-muted">
        {mode === 'register' ? (
          <>
            {t('auth.haveAccount')}{' '}
            <Link
              to={{ pathname: '/login', search: location.search }}
              className="text-info hover:underline"
            >
              {t('auth.signIn')}
            </Link>
          </>
        ) : (
          <>
            {t('auth.firstTime')}{' '}
            <Link to="/register" className="text-info hover:underline">
              {t('auth.startFromZero')}
            </Link>
          </>
        )}
      </p>
    </main>
  );
}
