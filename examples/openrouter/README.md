# OpenRouter example

A custom agent that recalls memories into its system prompt, calls OpenRouter, and ingests the turn back into memory. Works without an API key (it prints the prompt and stops).

```bash
pnpm build
OPENROUTER_API_KEY=sk-or-... pnpm --filter example-openrouter start "What do we use for payroll?"
```
