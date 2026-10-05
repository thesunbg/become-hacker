import { useEffect } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import { AuthPage } from './pages/AuthPage';
import { DashboardPage } from './pages/DashboardPage';
import { LabPage } from './pages/LabPage';
import { MissionPage } from './pages/MissionPage';
import { MissionsPage } from './pages/MissionsPage';
import { SkillsPage } from './pages/SkillsPage';
import { useSession } from './store/session';
import { useT } from './i18n';

/** Routes that need a session. The server enforces this too; this only avoids a flash. */
function RequireSession({ children }: { children: React.ReactNode }) {
  const status = useSession((state) => state.status);
  const t = useT();

  if (status === 'unknown') {
    return <p className="p-8 font-mono text-sm text-muted">{t('auth.checking')}</p>;
  }
  if (status === 'signed-out') return <Navigate to="/login" replace />;
  return <>{children}</>;
}

export function App() {
  const refresh = useSession((state) => state.refresh);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <Routes>
      <Route path="/login" element={<AuthPage mode="login" />} />
      <Route path="/register" element={<AuthPage mode="register" />} />

      <Route
        element={
          <RequireSession>
            <Layout />
          </RequireSession>
        }
      >
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/missions" element={<MissionsPage />} />
        <Route path="/missions/:id" element={<MissionPage />} />
        <Route path="/skills" element={<SkillsPage />} />
      </Route>

      <Route
        path="/lab/:sessionId"
        element={
          <RequireSession>
            <LabPage />
          </RequireSession>
        }
      />

      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  );
}
