import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import type { MissionDetailResponse, MissionProgress, MissionResult } from '@zero-root/types';
import { api } from '../lib/api';
import { formatDuration, stars } from '../lib/format';
import { Button, ErrorNote, Input, Panel } from '../components/ui';
import { Terminal } from '../components/Terminal';
import { KnowledgeReview } from '../components/KnowledgeReview';
import { useSession } from '../store/session';
import { useLocaleStore, useT } from '../i18n';

export function LabPage() {
  const { sessionId = '' } = useParams();
  const navigate = useNavigate();
  const location = useLocation() as { state?: { missionId?: string } };
  const { refresh } = useSession();
  const t = useT();
  const locale = useLocaleStore((state) => state.locale);

  const [missionId, setMissionId] = useState(location.state?.missionId ?? '');
  const [detail, setDetail] = useState<MissionDetailResponse | null>(null);
  const [progress, setProgress] = useState<MissionProgress | null>(null);
  const [result, setResult] = useState<MissionResult | null>(null);
  const [flag, setFlag] = useState('');
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const resultRef = useRef<HTMLDivElement>(null);

  // The result lands below the terminal, so without this the player finishes a mission and
  // the payoff — the rating, the XP, and what they just learned — is off the bottom of the
  // screen. That moment is the whole product bet; it should not need scrolling to find.
  useEffect(() => {
    if (result === null) return;

    // Deferred by a frame, and re-run when `detail` changes, because the page is not yet
    // scrollable at the moment the result appears: the knowledge review arrives from a
    // refetch just afterwards, and that is what pushes the panel below the fold. Scrolling
    // before then clamps to zero and silently does nothing.
    const frame = requestAnimationFrame(() => {
      resultRef.current?.scrollIntoView({ block: 'start' });
    });
    return () => cancelAnimationFrame(frame);
  }, [result, detail]);

  useEffect(() => {
    if (missionId === '') return;
    void api
      .mission(missionId)
      .then((loaded) => {
        setDetail(loaded);
        setProgress(loaded.progress);
      })
      .catch(() => setError(t('mission.loadFailed')));
    // Mission text is server-rendered, so a language change refetches it.
  }, [missionId, locale]);

  const onProgress = useCallback((updated: MissionProgress) => {
    setProgress(updated);
    setMissionId((current) => (current === '' ? updated.missionId : current));
  }, []);

  const onClosed = useCallback((reason: string) => setNote(reason), []);

  const submitFlag = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    setError('');
    setNote('');
    try {
      const response = await api.submitFlag(missionId, flag);
      setProgress(response.progress);
      if (response.correct) {
        setFlag('');
        setResult(response.result);
        await refresh();
        if (response.result === null) {
          setNote(t('lab.rightFlagNotDone'));
        } else {
          // The mission was loaded while still in progress, so its knowledge review was
          // withheld. Now that it is complete, fetch it: that review is the point.
          setDetail(await api.mission(missionId).catch(() => detail));
        }
      } else {
        setError(t('lab.wrongFlag'));
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t('lab.submitFailed'));
    }
  };

  /** Closes the lab, then goes wherever the player chose. The container is always released. */
  const leaveFor = async (destination: string): Promise<void> => {
    await api.destroyLab(sessionId).catch(() => undefined);
    await refresh();
    navigate(destination);
  };

  const leave = (): Promise<void> =>
    leaveFor(missionId === '' ? '/missions' : `/missions/${missionId}`);

  const mission = detail?.mission;

  return (
    <main className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="font-mono text-xs tracking-[0.2em] text-muted uppercase">
            {t('lab.session')}
          </p>
          <h1 className="font-mono text-xl font-bold">{mission?.title ?? 'Lab'}</h1>
        </div>
        <div className="flex items-center gap-4">
          {progress !== null && (
            <span className="font-mono text-xs text-muted">
              {formatDuration(progress.elapsedSeconds)} · {progress.completedRequiredCount}/
              {progress.requiredTaskCount} {t('lab.objectivesShort')}
              {progress.hintsUsed.length > 0 && ` · ${progress.hintsUsed.length} hints`}
            </span>
          )}
          <Button variant="danger" onClick={() => void leave()}>
            {t('lab.closeLab')}
          </Button>
        </div>
      </header>

      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <div className="space-y-4">
          <Terminal sessionId={sessionId} onProgress={onProgress} onClosed={onClosed} />

          <Panel title={t('lab.submitFlag')}>
            <form onSubmit={submitFlag} className="flex flex-wrap items-end gap-3">
              <div className="min-w-56 flex-1">
                <Input
                  label={t('lab.flag')}
                  placeholder="ZR{…}"
                  value={flag}
                  onChange={(event) => setFlag(event.target.value)}
                />
              </div>
              <Button type="submit" disabled={flag.trim() === ''}>
                {t('lab.submit')}
              </Button>
            </form>
            <p className="mt-3 text-xs text-muted">{t('lab.flagNote')}</p>
          </Panel>

          <ErrorNote>{error}</ErrorNote>
          {note !== '' && (
            <p className="rounded-md border border-warn/40 bg-warn/10 px-3 py-2 font-mono text-sm text-warn">
              {note}
            </p>
          )}

          {result !== null && (
            <div ref={resultRef}>
              <Panel title={t('lab.complete')}>
                <dl className="grid grid-cols-2 gap-x-6 gap-y-2 font-mono text-sm sm:grid-cols-4">
                  <div>
                    <dt className="text-xs text-muted">{t('lab.time')}</dt>
                    <dd>{formatDuration(result.elapsedSeconds)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted">{t('lab.hintsUsed')}</dt>
                    <dd>{result.hintsUsed}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted">{t('lab.mistakes')}</dt>
                    <dd>{result.mistakes}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted">{t('lab.score')}</dt>
                    <dd>{result.score}</dd>
                  </div>
                </dl>
                <p className="mt-4 font-mono text-lg text-warn">{stars(result.rating)}</p>
                <p className="mt-1 font-mono text-sm text-signal">+{result.xpAwarded} XP</p>
                {mission !== undefined && (
                  <div className="mt-6">
                    <KnowledgeReview mission={mission} />
                  </div>
                )}
                <div className="mt-6 flex flex-wrap gap-3">
                  <Button onClick={() => void leaveFor('/missions')}>{t('lab.nextMission')}</Button>
                  <Button variant="ghost" onClick={() => void leaveFor('/dashboard')}>
                    {t('nav.dashboard')}
                  </Button>
                </div>
              </Panel>
            </div>
          )}
        </div>

        <aside className="space-y-4">
          <Panel title={t('mission.objectives')}>
            <ul className="space-y-2">
              {(mission?.tasks ?? []).map((task) => {
                const done = progress?.tasks.find((t) => t.taskId === task.id)?.completed ?? false;
                return (
                  <li key={task.id} className="flex items-start gap-2 text-sm">
                    <span
                      className={`mt-0.5 font-mono ${done ? 'text-signal' : 'text-muted'}`}
                      aria-hidden
                    >
                      {done ? '[x]' : '[ ]'}
                    </span>
                    <span className={done ? 'text-muted line-through' : ''}>
                      {task.description}
                      {task.optional && (
                        <span className="ml-1.5 font-mono text-[11px] text-info">
                          {t('mission.bonus')}
                        </span>
                      )}
                    </span>
                  </li>
                );
              })}
            </ul>
          </Panel>

          {detail !== null && detail.revealedHints.length > 0 && (
            <Panel title={t('lab.hintsBought')}>
              <ol className="space-y-3">
                {detail.revealedHints.map((hint) => (
                  <li key={hint.level} className="text-sm leading-relaxed">
                    <span className="mr-2 font-mono text-xs text-warn">{hint.level}</span>
                    {hint.text}
                  </li>
                ))}
              </ol>
            </Panel>
          )}

          <Panel title={t('mission.objective')}>
            <p className="text-sm leading-relaxed text-muted">{mission?.objective}</p>
          </Panel>
        </aside>
      </div>
    </main>
  );
}
