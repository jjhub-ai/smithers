Smithers v2 Implementation Status Report

Executive Summary

Based on a comprehensive codebase analysis against the PRD/design docs,
Smithers v2 is approximately 30-40% complete:
┌─────────────────┬────────┬─────────────────────────────────────────────┐
│ Layer │ Status │ Notes │
├─────────────────┼────────┼─────────────────────────────────────────────┤
│ Existing v1 │ ✅ │ Workflows, stores, execution, caching — │
│ Framework │ 100% │ mature and production-ready │
├─────────────────┼────────┼─────────────────────────────────────────────┤
│ Protocol & │ 🟡 50% │ NDJSON protocol defined, adapters exist, │
│ Daemon │ │ but not wired together │
├─────────────────┼────────┼─────────────────────────────────────────────┤
│ Swift ↔ Python │ 🟡 50% │ AgentClient spawns agentd, parses events, │
│ Bridge │ │ but no persistence │
├─────────────────┼────────┼─────────────────────────────────────────────┤
│ Chat/Graph UI │ 🔴 5% │ Skeleton views only, no real message │
│ │ │ rendering or streaming │
├─────────────────┼────────┼─────────────────────────────────────────────┤
│ Advanced │ 🔴 0% │ Skills, search, forms, browser, todos — not │
│ Features │ │ started │
└─────────────────┴────────┴─────────────────────────────────────────────┘

---

What's Working

Python Backend (agentd)

- ✅ AgentDaemon with NDJSON event loop
- ✅ AnthropicAgentAdapter streaming from Claude API
- ✅ FakeAgentAdapter for deterministic testing
- ✅ HostRuntime sandbox with path escape protection
- ✅ Full protocol event types (20+ types matching PRD)
- ✅ Request/response marshaling

Swift Frontend

- ✅ AgentClient spawns agentd subprocess
- ✅ SessionGraph data model with DAG operations
- ✅ SmithersView shell with sidebar + detail layout
- ✅ Event type enums matching Python protocol

Core Framework (v1)

- ✅ 1,400+ passing tests
- ✅ @workflow decorator + type-safe dependencies
- ✅ SqliteStore with full persistence (cache, runs, events, approvals)
- ✅ Parallel execution, Ralph loops, timeouts, retry logic
- ✅ Metrics, WebSocket updates, event bus

---

Critical Gaps (Tier 1 - Blocking)

These must be built to unblock everything else:
Gap: SessionManager → Adapter wiring
Location: session.py
Impact: Events don't flow from Claude to UI
────────────────────────────────────────
Gap: SessionEvent → SQLite
Location: Missing table
Impact: Sessions not persisted, can't resume
────────────────────────────────────────
Gap: Session Graph Reducer
Location: Missing
Impact: Events don't become graph nodes
────────────────────────────────────────
Gap: UI streaming
Location: SessionDetail.swift
Impact: Chat is static placeholder

---

PRD Category Scorecard
┌────────────────────────────────┬─────┬───────────────────────────────┐
│ Category │ % │ Status │
├────────────────────────────────┼─────┼───────────────────────────────┤
│ 1. Agent Runtime Protocol │ 70% │ Protocol ✅, integration 🔴 │
├────────────────────────────────┼─────┼───────────────────────────────┤
│ 2. Sandboxing │ 40% │ Host MVP ✅, VM stub needed │
├────────────────────────────────┼─────┼───────────────────────────────┤
│ 3. Swift ↔ Python Bridge │ 50% │ Working but no crash recovery │
├────────────────────────────────┼─────┼───────────────────────────────┤
│ 4. Session Graph & Persistence │ 20% │ Models exist, no storage │
├────────────────────────────────┼─────┼───────────────────────────────┤
│ 5. Chat Transcript UI │ 5% │ Placeholder only │
├────────────────────────────────┼─────┼───────────────────────────────┤
│ 6. Tool Output & Artifacts │ 10% │ Types defined, no storage │
├────────────────────────────────┼─────┼───────────────────────────────┤
│ 7. Terminal Drawer │ 0% │ Not started │
├────────────────────────────────┼─────┼───────────────────────────────┤
│ 8. JJ Checkpoints │ 0% │ Events only, no JJ wrapper │
├────────────────────────────────┼─────┼───────────────────────────────┤
│ 9. JJ Stack Ops │ 0% │ Not started │
├────────────────────────────────┼─────┼───────────────────────────────┤
│ 10. Graph View │ 5% │ Data model only │
├────────────────────────────────┼─────┼───────────────────────────────┤
│ 11. Skills System │ 0% │ Not started │
├────────────────────────────────┼─────┼───────────────────────────────┤
│ 12. Create Form │ 0% │ Not started │
├────────────────────────────────┼─────┼───────────────────────────────┤
│ 13. Browser Surface │ 0% │ Not started │
├────────────────────────────────┼─────┼───────────────────────────────┤
│ 14. Todos Panel │ 0% │ Not started │
├────────────────────────────────┼─────┼───────────────────────────────┤
│ 15. Search │ 0% │ Not started │
├────────────────────────────────┼─────┼───────────────────────────────┤
│ 16-21. Other │ 0% │ Not started │
└────────────────────────────────┴─────┴───────────────────────────────┘

---

Key Files Reference

Python (agentd)
src/agentd/
├── daemon.py # Main event loop, request routing
├── session.py # Session + SessionManager (needs wiring)
├── protocol/
│ ├── events.py # 20+ EventTypes, Event dataclass
│ └── requests.py # Request parsing
├── adapters/
│ ├── base.py # AgentAdapter ABC
│ ├── anthropic.py # Claude API streaming
│ └── fake.py # Deterministic testing
└── sandbox/
├── base.py # SandboxRuntime ABC
└── host.py # HostRuntime with path validation

Swift (Smithers)
macos/Sources/Features/Smithers/
├── SmithersView.swift # Root NavigationSplitView
├── Session.swift # Session model
├── SessionDetail.swift # Main content (placeholder)
├── SessionSidebar.swift # Session list
├── Agent/
│ └── AgentClient.swift # Subprocess + event parsing
├── Graph/
│ └── GraphNode.swift # SessionGraph DAG
└── Protocol/
├── Event.swift # Event enum
└── Request.swift # Request models

---

Recommended Next Steps

Week 1-2 (Foundation)

1. Wire SessionManager.\_run_agent() → adapter invocation
2. Add session_events SQLite table + persistence
3. Build Python SessionGraph reducer (events → graph)
4. Connect Swift AgentClient events → SessionGraph

Week 2-4 (Core UX) 5. Build chat transcript with virtualized list + markdown 6. Implement tool cards with collapsible output 7. Add terminal drawer with PTY attachment 8. Integration tests for full chat flow

Week 4-8 (Graph + Features) 9. Graph view canvas + selection sync 10. JJ checkpoint wrapper + restore UI 11. Skills palette (⌘K) + summarize skill 12. Search (FTS + global UI)

---

Bottom Line

The architecture is solid — protocol design, event sourcing, and
Swift-Python boundary are well thought out. The v1 framework provides a
mature execution engine.

What's missing is primarily integration and UI work:

- Connect the existing pieces (adapters → persistence → UI)
- Build the actual chat/graph rendering
- Layer in features vertically (checkpoints, skills, search)
