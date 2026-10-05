import type { PublicMission } from '@zero-root/types';
import { Panel } from './ui';

/**
 * The knowledge review.
 *
 * This is the step that turns a solved puzzle into understanding, and the reason the game
 * exists — so it is not a footnote on the result screen. It only appears once the mission is
 * complete, because the real-world mapping would otherwise give the answer away.
 */
export function KnowledgeReview({ mission }: { mission: PublicMission }) {
  if (mission.knowledge.length === 0) return null;

  return (
    <Panel title="What you just learned">
      <ul className="space-y-6">
        {mission.knowledge.map((entry) => (
          <li key={entry.concept} className="space-y-2">
            <h3 className="font-mono text-sm text-signal">{entry.concept}</h3>
            <p className="text-sm leading-relaxed text-text/90">{entry.explanation}</p>
            {entry.realWorld !== undefined && (
              <p className="border-l-2 border-info/40 pl-3 text-sm leading-relaxed text-muted">
                {entry.realWorld}
              </p>
            )}
          </li>
        ))}
      </ul>
    </Panel>
  );
}
