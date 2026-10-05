/**
 * The English strings, and the shape every other language must match.
 *
 * Typed as the source of truth rather than loaded from JSON, so a language missing a string
 * is a compile error instead of a blank space someone notices in production. A dictionary is
 * enough for a handful of languages; an i18n library would be more machinery than this needs.
 */
export const en = {
  tagline: 'Learn. Hack. Think. Defend.',
  intro:
    'A courier left a laptop at your door. No note, no sender. There is no desktop — just a blinking cursor, waiting for you.',

  'auth.email': 'Email',
  'auth.handle': 'Handle',
  'auth.password': 'Password',
  'auth.handleHint': 'Letters, numbers, underscores and hyphens.',
  'auth.passwordHint': 'At least 12 characters. Length beats punctuation.',
  'auth.createAccount': 'Create account',
  'auth.signIn': 'Sign in',
  'auth.working': 'Working…',
  'auth.haveAccount': 'Already have an account?',
  'auth.firstTime': 'First time here?',
  'auth.startFromZero': 'Start from zero',
  'auth.signOut': 'Sign out',
  'auth.checking': 'Checking your session…',
  'auth.failed': 'Something went wrong.',

  'nav.dashboard': 'Dashboard',
  'nav.missions': 'Missions',
  'nav.skills': 'Skills',

  'dash.level': 'Level',
  'dash.thinking': 'Thinking',
  'dash.thinkingHint': 'Observation, logic, persistence.',
  'dash.technical': 'Technical',
  'dash.technicalHint': 'Averaged across your skills.',
  'dash.defense': 'Defense',
  'dash.defenseHint': 'Unlocks with the blue team chapters.',
  'dash.currentMission': 'Current mission',
  'dash.chapters': 'Chapters',
  'dash.enterBriefing': 'Enter briefing',
  'dash.nothingWaiting': 'Nothing waiting.',
  'dash.moreComing': 'More chapters are on the way.',
  'dash.loading': 'Loading…',
  'dash.missionsComplete': 'missions complete',
  'dash.missionComplete': 'mission complete',
  'dash.toLevel': 'to L',

  'mission.chapter': 'Chapter',
  'mission.briefing': 'Briefing',
  'mission.objective': 'Objective',
  'mission.objectives': 'Objectives',
  'mission.hints': 'Hints',
  'mission.askHint': 'Ask for a hint',
  'mission.noHintsYet':
    'Hints start with a question, not an answer. They cost XP, and you keep what you work out yourself.',
  'mission.enterLab': 'Enter lab',
  'mission.revisitLab': 'Revisit the lab',
  'mission.startingLab': 'Starting the lab…',
  'mission.backToMissions': 'Back to missions',
  'mission.locked': 'Locked',
  'mission.lockedBody':
    'Finish what this mission requires first. The briefing is part of what you earn by getting here.',
  'mission.bonus': 'bonus',
  'mission.minutes': 'min',
  'mission.loadFailed': 'Could not load this mission.',
  'mission.noHintLeft': 'No hints left on this mission.',

  'lab.session': 'Lab session',
  'lab.closeLab': 'Close lab',
  'lab.submitFlag': 'Submit a flag',
  'lab.flag': 'Flag',
  'lab.submit': 'Submit',
  'lab.flagNote':
    'The server checks this against content you have never been sent. Guessing is throttled, and a wrong answer costs very little — the penalty for being wrong is meant to be mild.',
  'lab.wrongFlag': 'Not the flag. Look again at what you have actually found.',
  'lab.rightFlagNotDone': 'That is the right flag — but the mission is not finished yet.',
  'lab.submitFailed': 'Could not submit that.',
  'lab.labFailed': 'Could not start a lab.',
  'lab.lost': 'Lost the connection to the lab.',
  'lab.complete': 'Mission complete',
  'lab.time': 'Time',
  'lab.hintsUsed': 'Hints',
  'lab.mistakes': 'Mistakes',
  'lab.score': 'Score',
  'lab.nextMission': 'Next mission',
  'lab.hintsBought': 'Hints you bought',
  'lab.objectivesShort': 'objectives',

  'knowledge.title': 'What you just learned',

  'skills.title': 'Skills',
  'skills.technical': 'Technical',
  'skills.note':
    'Skills grow from finishing missions that teach them. The chapters that would move networking, web and the rest are not built yet — see the roadmap.',

  'state.LOCKED': 'Locked',
  'state.AVAILABLE': 'Available',
  'state.STARTED': 'Started',
  'state.IN_PROGRESS': 'In progress',
  'state.COMPLETED': 'Complete',
  'state.FAILED': 'Failed',
  'state.ABANDONED': 'Abandoned',

  'skill.LINUX': 'Linux',
  'skill.NETWORKING': 'Networking',
  'skill.WEB': 'Web',
  'skill.PROGRAMMING': 'Programming',
  'skill.CRYPTOGRAPHY': 'Cryptography',
  'skill.OSINT': 'OSINT',
  'skill.FORENSICS': 'Forensics',
  'skill.REVERSE_ENGINEERING': 'Reverse Engineering',
  'skill.CLOUD': 'Cloud',
  'skill.RED_TEAM': 'Red Team',
  'skill.BLUE_TEAM': 'Blue Team',
  'skill.PROBLEM_SOLVING': 'Problem Solving',
} as const;

export type MessageKey = keyof typeof en;
export type Messages = Readonly<Record<MessageKey, string>>;
