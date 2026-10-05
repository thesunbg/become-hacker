import { Meter, Panel } from '../components/ui';
import { useSession } from '../store/session';
import { useT } from '../i18n';

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

export function SkillsPage() {
  const { me } = useSession();
  const t = useT();
  const values = new Map((me?.skills ?? []).map((skill) => [skill.skill, skill.value]));

  return (
    <main className="space-y-6">
      <h1 className="font-mono text-xl font-bold">{t('skills.title')}</h1>
      <Panel title={t('skills.technical')}>
        <ul className="space-y-4">
          {ALL_SKILLS.map((skill) => {
            const value = values.get(skill) ?? 0;
            return (
              <li key={skill} className="space-y-1.5">
                <div className="flex justify-between font-mono text-xs">
                  <span className={value > 0 ? 'text-text' : 'text-muted'}>
                    {t(`skill.${skill}`)}
                  </span>
                  <span className="text-muted">{value}</span>
                </div>
                <Meter percent={value} tone={value > 0 ? 'signal' : 'info'} />
              </li>
            );
          })}
        </ul>
        <p className="mt-6 text-xs leading-relaxed text-muted">{t('skills.note')}</p>
      </Panel>
    </main>
  );
}
