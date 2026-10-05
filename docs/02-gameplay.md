# 02 — Gameplay Systems

## Main loop

```
Login → Dashboard → Choose Mission → Mission Briefing → Enter Lab → Investigate
      → Use Tools → Solve Objective → Submit Flag/Evidence → Mission Result
      → Knowledge Review → XP / Skill / Achievement → Unlock Mission
```

"Knowledge Review" is not optional polish — it is the step that converts a solved puzzle into
understanding.

## Hint system

Each mission carries 3–5 hint levels that escalate from conceptual to concrete. **A hint never
reveals the answer outright.**

```
Hint 1  Think about hidden files.                       −5 XP
Hint 2  Linux can show files beginning with ".".       −10 XP
Hint 3  Try: ls -la                                    −20 XP
```

## AI mentor

MVP ships rule-based hints. An LLM mentor comes later and must obey the same escalation:

```
LEVEL 1  Ask a guiding question
LEVEL 2  Explain the concept
LEVEL 3  Suggest a direction
LEVEL 4  Suggest a tool
LEVEL 5  Give command syntax
LEVEL 6  Explain the solution      ← reduces score
```

Worked example:

> **Player:** "I don't know what to do."
> **AI:** "What information do you currently have?"
> **Player:** "I know port 80 is open."
> **AI:** "What protocol commonly runs on port 80?"

## XP

| Earns XP                   | Costs XP            |
| -------------------------- | ------------------- |
| Mission completion         | Using a hint        |
| First-attempt solve        | Unnecessary action  |
| No hints used              | Repeated failure    |
| Efficient solution         | Triggering an alarm |
| Correct reasoning          |                     |
| Bonus objectives           |                     |
| Finding hidden information |                     |

**Keep penalties mild.** The purpose is learning, not punishment.

XP is never stored as a single mutable counter. It lives in an append-only ledger
(`xp_transactions`) and the total is derived — see [05-architecture.md](05-architecture.md).

## Mission rating

Up to five stars, computed from completion, efficiency, hints used, mistakes and discovery.

```
Mission Complete

Time       08:31
Hints      1
Mistakes   2

Score      842
Rating     ★★★★
```

## Skills

```
Linux · Networking · Web · Programming · Cryptography · OSINT · Forensics
Reverse Engineering · Cloud · Red Team · Blue Team · Problem Solving
```

Tracked as a 0–100 value per skill, e.g. `Linux 72 · Networking 41 · Web 20 · Cryptography 5`.

## Hacker thinking score

Deliberately kept **separate** from technical skills, because thinking is the thing we actually
want to grow:

```
Observation · Logic · Curiosity · Persistence · Creativity · Attention · Planning · Problem Solving
```

e.g. `Observation 92 · Logic 88 · Persistence 97 · Problem Solving 91`

## Achievements

```
FIRST_ROOT · FIRST_SCAN · NO_HINT · NIGHT_OWL · LOG_HUNTER
DNS_MASTER · PACKET_WATCHER · WEB_EXPLORER · PERFECT_MISSION
```

## Hacker notebook

Every player gets a notebook for recording findings — the habit every real operator has.

MVP features: create / edit / delete notes, mission-linked notes, markdown support. Later the
AI mentor can read the notebook to give grounded hints.

```
Target: 10.10.10.5
Interesting ports: 80, 443
Username: admin
Possible issue: ...
```

## Player profile

```
Player
 ├── id          ├── xp           ├── skills        ├── achievements
 ├── username    ├── reputation   ├── missions      └── statistics
 ├── avatar      ├── ethics
 └── level
```

## Real-world mapping

After every mission, show the player the bridge from puzzle to profession:

```
GAME CONCEPT            SECURITY CONCEPT          REAL WORLD
Find hidden service  →  Service enumeration   →   Attack surface discovery
```

## Reports and severity (advanced levels)

At higher levels the player writes an actual finding report:

```
Executive Summary · Finding · Severity · Evidence · Impact · Recommendation · Remediation
```

Severity: `INFO · LOW · MEDIUM · HIGH · CRITICAL` (map to CVSS later).

## Chapter certificate

On chapter completion, issue an in-game certificate showing score and skill deltas. Advanced
tracks may later be _mapped to_ recognised frameworks — **never claim official certification.**

## Post-MVP engagement systems

- **Daily challenge** — one puzzle per day; rewards XP, achievement, streak.
- **Weekly boss** — "WEEKLY INCIDENT": everyone gets the same environment; ranked by time,
  accuracy, stealth, hints used and report quality.
- **Leaderboards** — global, country, friends, weekly, monthly, per-chapter. Rank on skill,
  mission score, efficiency, difficulty and consistency — **not raw XP**, or players grind easy
  missions.
- **Multiplayer** — 1v1, red vs blue, CTF, team CTF, cyber war, tournaments.

## Story

A continuous narrative across chapters. The player receives an old laptop from an unknown
person. On it, `README.txt`:

> _"If you want to understand the Internet, stop using it like a normal user."_

Investigating leads to a mysterious hacker group: **NULL**.
