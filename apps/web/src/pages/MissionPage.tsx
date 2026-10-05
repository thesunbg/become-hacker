import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type { MissionDetailResponse } from '@zero-root/types';
import { api } from '../lib/api';
import { stars } from '../lib/format';
import { Button, ErrorNote, Panel, StateBadge } from '../components/ui';
import { KnowledgeReview } from '../components/KnowledgeReview';

/** The briefing: story, objective, checklist, hints, and the way into the lab. */
export function MissionPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();

  const [detail, setDetail] = useState<MissionDetailResponse | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (): Promise<void> => {
    try {
      setDetail(await api.mission(id));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not load this mission.');
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const enterLab = async (): Promise<void> => {
    setError('');
    setBusy(true);
    try {
      const lab = await api.createLab(id);
      navigate(`/lab/${lab.sessionId}`, { state: { missionId: id } });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not start a lab.');
      setBusy(false);
    }
  };

  const buyHint = async (): Promise<void> => {
    setError('');
    try {
      await api.hint(id);
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'No hint available.');
    }
  };

  if (detail === null) {
    return (
      <main className="space-y-4">
        <ErrorNote>{error}</ErrorNote>
        {error === '' && <p className="font-mono text-sm text-muted">Loading…</p>}
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
            Chapter {mission.chapter} · {mission.id.slice(-3)}
          </p>
          <StateBadge state={mission.state} />
        </div>
        <h1 className="font-mono text-2xl font-bold">{mission.title}</h1>
        <p className="font-mono text-xs text-warn">
          {stars(mission.difficulty)} · ~{mission.estimatedMinutes} min · {mission.xp} XP
        </p>
      </header>

      {locked ? (
        <Panel title="Locked">
          <p className="text-sm text-muted">
            Finish what this mission requires first. The briefing is part of what you earn by
            getting here.
          </p>
        </Panel>
      ) : (
        <>
          <Panel title="Briefing">
            <p className="font-mono text-sm leading-relaxed whitespace-pre-line text-text/90">
              {mission.story}
            </p>
          </Panel>

          <Panel title="Objective">
            <p className="text-sm leading-relaxed">{mission.objective}</p>
          </Panel>

          <Panel
            title="Objectives"
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
                        <span className="ml-2 font-mono text-[11px] text-info">bonus</span>
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
            title="Hints"
            action={
              nextHintCost !== undefined ? (
                <Button variant="ghost" onClick={() => void buyHint()}>
                  Ask for a hint (−{nextHintCost} XP)
                </Button>
              ) : undefined
            }
          >
            {detail.revealedHints.length === 0 ? (
              <p className="text-sm text-muted">
                Hints start with a question, not an answer. They cost XP, and you keep what you work
                out yourself.
              </p>
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
              {busy ? 'Starting the lab…' : completed ? 'Revisit the lab' : 'Enter lab'}
            </Button>
            <Button variant="ghost" onClick={() => navigate('/missions')}>
              Back to missions
            </Button>
          </div>
        </>
      )}
    </main>
  );
}
