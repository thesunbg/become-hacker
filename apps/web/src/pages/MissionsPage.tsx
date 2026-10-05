import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { MissionListResponse } from '@zero-root/types';
import { api } from '../lib/api';
import { stars } from '../lib/format';
import { Panel, StateBadge } from '../components/ui';
import { useLocaleStore, useT } from '../i18n';

export function MissionsPage() {
  const t = useT();
  const locale = useLocaleStore((state) => state.locale);
  const [data, setData] = useState<MissionListResponse | null>(null);

  useEffect(() => {
    void api
      .missions()
      .then(setData)
      .catch(() => setData(null));
  }, [locale]);

  const byChapter = new Map<number, MissionListResponse['missions'][number][]>();
  for (const mission of data?.missions ?? []) {
    const list = byChapter.get(mission.chapter) ?? [];
    list.push(mission);
    byChapter.set(mission.chapter, list);
  }

  return (
    <main className="space-y-6">
      <h1 className="font-mono text-xl font-bold">{t('nav.missions')}</h1>

      {[...byChapter.entries()].map(([chapter, missions]) => (
        <Panel
          key={chapter}
          title={`${t('mission.chapter')} ${chapter} — ${
            data?.chapters.find((c) => c.chapter === chapter)?.title ?? ''
          }`}
        >
          <ul className="divide-y divide-border">
            {missions.map((mission) => {
              const locked = mission.state === 'LOCKED';
              const row = (
                <div
                  className={`flex flex-wrap items-center gap-x-4 gap-y-2 py-3 ${
                    locked ? 'opacity-60' : ''
                  }`}
                >
                  <span className="font-mono text-xs text-muted">{mission.id.slice(-3)}</span>
                  <span className="min-w-40 flex-1 font-mono text-sm">{mission.title}</span>
                  <span className="font-mono text-xs text-warn">{stars(mission.difficulty)}</span>
                  <span className="font-mono text-xs text-muted">
                    ~{mission.estimatedMinutes} {t('mission.minutes')}
                  </span>
                  <StateBadge state={mission.state} />
                </div>
              );

              return (
                <li key={mission.id}>
                  {locked ? (
                    <div title={t('mission.lockedBody')}>{row}</div>
                  ) : (
                    <Link to={`/missions/${mission.id}`} className="block hover:bg-raised/40">
                      {row}
                    </Link>
                  )}
                </li>
              );
            })}
          </ul>
        </Panel>
      ))}
    </main>
  );
}
