import { Meter, Panel } from '../components/ui';
import { useSession } from '../store/session';

const ALL_SKILLS = [
  'LINUX',
  'NETWORKING',
  'WEB',
  'PROGRAMMING',
  'CRYPTOGRAPHY',
  'OSINT',
  'FORENSICS',
  'REVERSE_ENGINEERING',
  'CLOUD',
  'RED_TEAM',
  'BLUE_TEAM',
  'PROBLEM_SOLVING',
] as const;

const label = (skill: string): string =>
  skill
    .toLowerCase()
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');

export function SkillsPage() {
  const { me } = useSession();
  const values = new Map((me?.skills ?? []).map((skill) => [skill.skill, skill.value]));

  return (
    <main className="space-y-6">
      <h1 className="font-mono text-xl font-bold">Skills</h1>
      <Panel title="Technical">
        <ul className="space-y-4">
          {ALL_SKILLS.map((skill) => {
            const value = values.get(skill) ?? 0;
            return (
              <li key={skill} className="space-y-1.5">
                <div className="flex justify-between font-mono text-xs">
                  <span className={value > 0 ? 'text-text' : 'text-muted'}>{label(skill)}</span>
                  <span className="text-muted">{value}</span>
                </div>
                <Meter percent={value} tone={value > 0 ? 'signal' : 'info'} />
              </li>
            );
          })}
        </ul>
        <p className="mt-6 text-xs leading-relaxed text-muted">
          Skills grow from finishing missions that teach them. The chapters that would move
          networking, web and the rest are not built yet — see the roadmap.
        </p>
      </Panel>
    </main>
  );
}
