# lazy-llm-proxy

**Let your agent run the show. we don't need a complicated panel** A fast, headless OpenAI-compatible proxy where **agents manage providers, keys, quotas, and usage** over a clean HTTP API—no dashboard required. Spin up upstreams (OpenAI, OpenRouter-style bases, or your own gateway), mint downstream keys, and tweak limits on the fly from scripts or Cursor.

Built with [Bun](https://bun.sh/) + [Elysia](https://elysiajs.com/). SQLite for truth, Redis for hot cache. Same mental model as rolling your own **#openrouter** / **#one-api** style router, but designed for **agentic ops**: provision, rotate, and audit without touching the UI.

---

### Why this exists

- **Agent-first**: Admin routes + a [Cursor skill](https://github.com/Xu-pixel/lazy-llm-proxy/tree/main/skills) so your coding agent knows how to call the API.
- **Multi-provider**: Route traffic across several upstreams; attach them to keys; random pick per request.
- **Guardrails**: Per-key token budgets, IP allowlists, optional system prompts (forced or not), model allowlists.
- **Observable**: Per-key and per-provider usage breakdowns.

---

### Install the skill (Cursor)

Give your agent the playbook for providers, keys, quotas, and admin calls:

```bash
npx skills add https://github.com/Xu-pixel/lazy-llm-proxy/skills
```

Repo: [github.com/Xu-pixel/lazy-llm-proxy](https://github.com/Xu-pixel/lazy-llm-proxy)

---

### Development

```bash
bun install
bun run dev
```

Listens on **`http://localhost:5001`**. Chat proxy: `POST /v1/chat/completions` with a downstream key. Admin API: `GET/POST/PATCH/DELETE /admin/*` with the **Admin token** printed once at startup (`Authorization: Bearer …`).

---

`#openrouter` `#one-api`
