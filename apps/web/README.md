# apps/web — player client

React · TypeScript · Vite · Tailwind · Zustand · React Router, with **xterm.js** for the
terminal.

Routes: `/` `/login` `/register` `/dashboard` `/missions` `/missions/:id` `/lab/:sessionId`
`/skills` `/notebook` `/achievements` `/profile`.

UI direction and the dashboard sketch are in [`docs/05-architecture.md`](../../docs/05-architecture.md).

**Not yet implemented** — this is Sprint 1 of [`docs/07-roadmap.md`](../../docs/07-roadmap.md).
The terminal never talks to a container directly; it speaks WebSocket to the API's terminal
gateway.
