## Memory (ai-memory)

You have a persistent local memory shared with other AI agents on this machine (local SQLite; nothing leaves the machine).

- At the start of a task call `memory_recall` with a short description of the task and treat the results as prior context.
- Call `memory_remember` only for durable knowledge: decisions, architecture facts, conventions, preferences, constraints, lessons. Never store transient task state, tool output or secrets.
- When the user corrects a fact, remember the new statement; the old one is superseded automatically.
- Use `memory_inspect` / `memory_forget` when the user asks what you remember or to forget something.
