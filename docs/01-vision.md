# 01 — Product Vision

**ZERO → ROOT** — *Learn. Hack. Think. Defend.*

A web RPG where the player starts from nothing and becomes a cybersecurity professional. It
combines cybersecurity education, logic puzzles, an interactive terminal, story-driven missions,
a virtual computer/network, attack & defense, RPG progression, and an AI mentor.

## The founding principle

> **Players do not learn first and then play. They play, and that forces them to learn.**

The player is never handed the answer. Every mission follows this arc:

```
Observe → Think → Experiment → Fail → Investigate → Solve → Understand → Apply
```

"Fail" is a first-class step. Failure is where the learning happens, so penalties for it stay
mild (see [02-gameplay.md](02-gameplay.md) — XP).

## Goals

1. A complete beginner can start.
2. The player must actually reason, not pattern-match.
3. The player uses a real terminal.
4. Knowledge is bound directly to gameplay, never delivered as a lecture.
5. Every mission gets its own sandbox.
6. Progression is legible.
7. The design extends from basic to advanced cybersecurity.
8. **Players can never attack the real Internet.**

## Non-goals for the MVP

Explicitly out of scope — do not build these before the MVP works:

multiplayer · real money · NFT · blockchain · mobile app · marketplace · social network ·
AI-generated missions · complex cloud infrastructure · real malware execution

## Target users

| Tier | Starting point | Goal |
| --- | --- | --- |
| **Beginner** | No Linux, network, web or security knowledge | Zero → understands how computers and the Internet work |
| **Intermediate** | Basic IT knowledge | Learn pentesting/cybersecurity through practice |
| **Advanced** | Already knows security | Hard challenges, attack chains, red team, blue team |

## Character arc

```
Unknown → Newbie → Curious → Script Kiddie → Hacker → Pentester
        → Red Teamer → Security Engineer → Elite Hacker
```

The player is not a superhero. They start with:

```
Knowledge: 0      Money: 100      Reputation: 0      Tools: Basic Terminal
```

They build an identity through gameplay.

## North star

```
"I don't know."
   → "I wonder..."
   → "Let me investigate."
   → "Ah! That's how it works."
   → "I can exploit it."
   → "I understand why it works."
   → "Now I can defend it."
   → "I can design a secure system."
```

That is the real progression: **Zero → Hacker → Security Professional → Root.**

## Success criteria

The MVP works if someone with no cybersecurity background can:

1. Register · 2. Understand the story · 3. Enter a safe virtual computer · 4. Use a real terminal ·
5. **Discover something without being told the answer** · 6. Solve mission 01 ·
7. Understand what they learned · 8. Want to play mission 02.

If all eight hold, keep building.

## The first ten minutes

The first session is the whole product bet:

```
00:00 create account      05:00 explore filesystem
00:30 story begins        06:00 find hidden file
01:00 receive laptop      07:00 discover first clue
02:00 open terminal       08:00 find flag
03:00 whoami              09:00 mission complete
04:00 pwd                 10:00 "You just learned Linux filesystem fundamentals."
```

The player should finish thinking: *"I want to know what happens next."*
