import { useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { Button, ErrorNote, Input } from '../components/ui';
import { useSession } from '../store/session';

/** Sign in and sign up, which are the same form with one extra field. */
export function AuthPage({ mode }: { mode: 'login' | 'register' }) {
  const { status, signIn, signUp } = useSession();
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
      setError(caught instanceof Error ? caught.message : 'Something went wrong.');
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
        <p className="font-mono text-xs tracking-[0.2em] text-muted uppercase">
          Learn. Hack. Think. Defend.
        </p>
        <p className="text-sm leading-relaxed text-muted">
          A courier left a laptop at your door. No note, no sender. There is no desktop — just a
          blinking cursor, waiting for you.
        </p>
      </header>

      <form onSubmit={submit} className="space-y-4" noValidate>
        <Input
          label="Email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />

        {mode === 'register' && (
          <Input
            label="Handle"
            autoComplete="username"
            required
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            hint="Letters, numbers, underscores and hyphens."
          />
        )}

        <Input
          label="Password"
          type="password"
          autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
          required
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          {...(mode === 'register'
            ? { hint: 'At least 12 characters. Length beats punctuation.' }
            : {})}
        />

        <ErrorNote>{error}</ErrorNote>

        <Button type="submit" disabled={busy} className="w-full">
          {busy ? 'Working…' : mode === 'register' ? 'Create account' : 'Sign in'}
        </Button>
      </form>

      <p className="text-center text-sm text-muted">
        {mode === 'register' ? (
          <>
            Already have an account?{' '}
            <Link
              to={{ pathname: '/login', search: location.search }}
              className="text-info hover:underline"
            >
              Sign in
            </Link>
          </>
        ) : (
          <>
            First time here?{' '}
            <Link to="/register" className="text-info hover:underline">
              Start from zero
            </Link>
          </>
        )}
      </p>
    </main>
  );
}
