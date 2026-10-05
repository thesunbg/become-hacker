import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { levelProgress, rankForLevel } from '../lib/format';
import { Meter } from './ui';
import { useSession } from '../store/session';

const NAV = [
  { to: '/dashboard', label: 'Dashboard' },
  { to: '/missions', label: 'Missions' },
  { to: '/skills', label: 'Skills' },
];

export function Layout() {
  const { me, signOut } = useSession();
  const navigate = useNavigate();
  const progress = levelProgress(me?.xp ?? 0);

  return (
    <div className="flex min-h-full flex-col">
      <header className="border-b border-border bg-surface/80 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-3 px-5 py-3">
          <NavLink to="/dashboard" className="font-mono text-sm font-bold tracking-tight">
            ZERO <span className="text-signal">→</span> ROOT
          </NavLink>

          <nav className="flex gap-1">
            {NAV.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  `rounded px-2.5 py-1.5 font-mono text-xs tracking-wider uppercase transition-colors ${
                    isActive ? 'bg-raised text-text' : 'text-muted hover:text-text'
                  }`
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-4">
            <div className="hidden w-40 sm:block">
              <div className="mb-1 flex justify-between font-mono text-[11px] text-muted">
                <span>
                  L{progress.level} {rankForLevel(progress.level)}
                </span>
                <span>{me?.xp ?? 0} XP</span>
              </div>
              <Meter percent={progress.percent} />
            </div>

            <button
              onClick={() => {
                void signOut().then(() => navigate('/login', { replace: true }));
              }}
              className="font-mono text-xs tracking-wider text-muted uppercase hover:text-danger"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>

      <div className="mx-auto w-full max-w-6xl flex-1 px-5 py-8">
        <Outlet />
      </div>
    </div>
  );
}
