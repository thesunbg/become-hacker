import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { MissionListResponse, PublicMission } from '@zero-root/types';
import { api } from '../lib/api';
import { levelProgress, rankForLevel, stars } from '../lib/format';
import { Button, Meter, Panel, StateBadge } from '../components/ui';
import { useSession } from '../store/session';

/** The one mission the player should look at next. */
function nextMission(missions: readonly PublicMission[]): PublicMission | undefined {
  return (
    missions.find((mission) => mission.state === 'IN_PROGRESS' || mission.state === 'STARTED') ??
    missions.find((mission) => mission.state === 'AVAILABLE')
  );
}

export function DashboardPage() {
  const { me } = useSession();
  const [data, setData] = useState<MissionListResponse | null>(null);

  useEffect(() => {
    void api
      .missions()
      .then(setData)
      .catch(() => setData(null));
  }, []);

  const progress = levelProgress(me?.xp ?? 0);
  const current = data === null ? undefined : nextMission(data.missions);
  const completed = data?.missions.filter((m) => m.state === 'COMPLETED').length ?? 0;

  const technical = Math.round(
    (me?.skills.reduce((sum, skill) => sum + skill.value, 0) ?? 0) /
      Math.max(1, me?.skills.length ?? 1),
  );

  return (
    <main className="space-y-6">
      <Panel>
        <div className="flex flex-wrap items-end justify-between gap-6">
          <div>
            <p className="font-mono text-xs tracking-[0.2em] text-muted uppercase">
              Level {progress.level}
            </p>
            <h1 className="mt-1 font-mono text-2xl font-bold">{rankForLevel(progress.level)}</h1>
            <p className="mt-1 text-sm text-muted">
              {me?.username} · {me?.xp ?? 0} XP · {completed} mission
              {completed === 1 ? '' : 's'} complete
            </p>
          </div>
          <div className="w-full max-w-xs">
            <div className="mb-1.5 flex justify-between font-mono text-[11px] text-muted">
              <span>{progress.percent}%</span>
              <span>
                {progress.into} / {progress.needed} to L{progress.level + 1}
              </span>
            </div>
            <Meter percent={progress.percent} />
          </div>
        </div>
      </Panel>

      <div className="grid gap-6 md:grid-cols-3">
        <Panel title="Thinking" className="md:col-span-1">
          <p className="font-mono text-3xl text-info">{Math.min(100, completed * 12)}</p>
          <p className="mt-1 text-xs text-muted">Observation, logic, persistence.</p>
        </Panel>
        <Panel title="Technical" className="md:col-span-1">
          <p className="font-mono text-3xl text-signal">{technical}</p>
          <p className="mt-1 text-xs text-muted">Averaged across your skills.</p>
        </Panel>
        <Panel title="Defense" className="md:col-span-1">
          <p className="font-mono text-3xl text-muted">0</p>
          <p className="mt-1 text-xs text-muted">Unlocks with the blue team chapters.</p>
        </Panel>
      </div>

      <Panel title="Current mission">
        {current === undefined ? (
          <p className="text-sm text-muted">
            Nothing waiting. {completed > 0 ? 'More chapters are on the way.' : 'Loading…'}
          </p>
        ) : (
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="max-w-xl space-y-2">
              <div className="flex items-center gap-3">
                <h2 className="font-mono text-lg">{current.title}</h2>
                <StateBadge state={current.state} />
              </div>
              <p className="font-mono text-xs text-warn">{stars(current.difficulty)}</p>
              <p className="text-sm leading-relaxed text-muted">{current.objective}</p>
            </div>
            <Link to={`/missions/${current.id}`}>
              <Button>Enter briefing</Button>
            </Link>
          </div>
        )}
      </Panel>

      <Panel title="Chapters">
        <ul className="divide-y divide-border">
          {(data?.chapters ?? []).map((chapter) => (
            <li key={chapter.chapter} className="flex items-center gap-4 py-3 first:pt-0 last:pb-0">
              <span className="font-mono text-xs text-muted">
                {String(chapter.chapter).padStart(2, '0')}
              </span>
              <span className="flex-1 font-mono text-sm">{chapter.title}</span>
              <span className="font-mono text-xs text-muted">
                {chapter.completedCount} / {chapter.missionCount}
              </span>
              <div className="w-24">
                <Meter
                  percent={(chapter.completedCount / Math.max(1, chapter.missionCount)) * 100}
                />
              </div>
            </li>
          ))}
        </ul>
      </Panel>
    </main>
  );
}
