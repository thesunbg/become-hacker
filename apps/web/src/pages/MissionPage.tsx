import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type { MissionDetailResponse } from '@zero-root/types';
import { api } from '../lib/api';
import { stars } from '../lib/format';
import { Button, ErrorNote, Panel, StateBadge } from '../components/ui';
import { useLocaleStore, useT } from '../i18n';
import { KnowledgeReview } from '../components/KnowledgeReview';

/** The briefing: story, objective, checklist, hints, and the way into the lab. */
export function MissionPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const t = useT();
  const locale = useLocaleStore((state) => state.locale);

  const [detail, setDetail] = useState<MissionDetailResponse | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (): Promise<void> => {
    try {
      setDetail(await api.mission(id));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t('mission.loadFailed'));
    }
  }, [id]);

  useEffect(() => {
    void load();
    // Mission text comes from the server, so switching language refetches it.
  }, [load, locale]);

  const enterLab = async (): Promise<void> => {
    setError('');
    setBusy(true);
    try {
      const lab = await api.createLab(id);
      navigate(`/lab/${lab.sessionId}`, { state: { missionId: id } });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t('lab.labFailed'));
      setBusy(false);
    }
  };

  const buyHint = async (): Promise<void> => {
    setError('');
    try {
      await api.hint(id);
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t('mission.noHintLeft'));
    }
  };

  if (detail === null) {
    return (
      <main className="space-y-4">
        <ErrorNote>{error}</ErrorNote>
        {error === '' && <p className="font-mono text-sm text-muted">{t('dash.loading')}</p>}
      </main>
    );
  }

  const { mission, progress } = detail;
  const locked = mission.state === 'LOCKED';
  const completed = mission.state === 'COMPLETED';
  const nextHintCost = mission.hints.find((hint) => !hint.revealed)?.xpCost;

  return (
    <main className="space-y-6">
      <header className="space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <p className="font-mono text-xs tracking-[0.2em] text-muted uppercase">
            {t('mission.chapter')} {mission.chapter} · {mission.id.slice(-3)}
          </p>
          <StateBadge state={mission.state} />
        </div>
        <h1 className="font-mono text-2xl font-bold">{mission.title}</h1>
        <p className="font-mono text-xs text-warn">
          {stars(mission.difficulty)} · ~{mission.estimatedMinutes} {t('mission.minutes')} ·{' '}
          {mission.xp} XP
        </p>
      </header>

      {locked ? (
        <Panel title={t('mission.locked')}>
          <p className="text-sm text-muted">{t('mission.lockedBody')}</p>
        </Panel>
      ) : (
        <>
          <Panel title={t('mission.briefing')}>
            <p className="font-mono text-sm leading-relaxed whitespace-pre-line text-text/90">
              {mission.story}
            </p>
          </Panel>

          <Panel title={t('mission.objective')}>
            <p className="text-sm leading-relaxed">{mission.objective}</p>
          </Panel>

          <Panel
            title={t('mission.objectives')}
            action={
              <span className="font-mono text-[11px] text-muted">
                {progress?.completedRequiredCount ?? 0} / {progress?.requiredTaskCount ?? 0}
              </span>
            }
          >
            <ul className="space-y-2">
              {mission.tasks.map((task) => {
                const done = progress?.tasks.find((t) => t.taskId === task.id)?.completed ?? false;
                return (
                  <li key={task.id} className="flex items-start gap-3 text-sm">
                    <span
                      className={`mt-0.5 font-mono ${done ? 'text-signal' : 'text-muted'}`}
                      aria-hidden
                    >
                      {done ? '[x]' : '[ ]'}
                    </span>
                    <span className={done ? 'text-muted line-through' : ''}>
                      {task.description}
                      {task.optional && (
                        <span className="ml-2 font-mono text-[11px] text-info">
                          {t('mission.bonus')}
                        </span>
                      )}
                    </span>
                  </li>
                );
              })}
            </ul>
            <span className="sr-only">
              {progress?.completedRequiredCount ?? 0} of {progress?.requiredTaskCount ?? 0} required
              objectives complete
            </span>
          </Panel>

          <Panel
            title={t('mission.hints')}
            action={
              nextHintCost !== undefined ? (
                <Button variant="ghost" onClick={() => void buyHint()}>
                  {t('mission.askHint')} (−{nextHintCost} XP)
                </Button>
              ) : undefined
            }
          >
            {detail.revealedHints.length === 0 ? (
              <p className="text-sm text-muted">{t('mission.noHintsYet')}</p>
            ) : (
              <ol className="space-y-3">
                {detail.revealedHints.map((hint) => (
                  <li key={hint.level} className="text-sm leading-relaxed">
                    <span className="mr-2 font-mono text-xs text-warn">{hint.level}</span>
                    {hint.text}
                  </li>
                ))}
              </ol>
            )}
          </Panel>

          {completed && <KnowledgeReview mission={mission} />}

          <ErrorNote>{error}</ErrorNote>

          <div className="flex flex-wrap gap-3">
            <Button onClick={() => void enterLab()} disabled={busy}>
              {busy
                ? t('mission.startingLab')
                : t(completed ? 'mission.revisitLab' : 'mission.enterLab')}
            </Button>
            <Button variant="ghost" onClick={() => navigate('/missions')}>
              {t('mission.backToMissions')}
            </Button>
          </div>
        </>
      )}
    </main>
  );
}
