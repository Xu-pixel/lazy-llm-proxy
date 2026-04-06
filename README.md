<div align="center">
  <img src="icon.png" width="128" alt="lazy-llm-proxy" />
</div>

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

### Docker

Requires **Redis** (cache and counters) and this image; SQLite data lives at `lazy-llm-proxy-db/lazy-llm-proxy.db` and is persisted via a volume.

**1. Start Redis**

```bash
docker run -d --name lazy-llm-redis -p 6379:6379 redis:7-alpine
```

**2. Pull from GHCR and run**

Prebuilt images are published to GitHub Container Registry. **Multi-arch** `linux/amd64` and `linux/arm64` are built in CI (GitHub Actions), so you do not need to cross-build locally from an ARM Mac.

```bash
docker pull ghcr.io/xu-pixel/lazy-llm-proxy:latest
```

From a directory where you want SQLite files (run `mkdir -p lazy-llm-proxy-db` first):

```bash
docker run --rm -p 5001:5001 \
  -e REDIS_URL=redis://host.docker.internal:6379 \
  -v "$(pwd)/lazy-llm-proxy-db:/app/lazy-llm-proxy-db" \
  ghcr.io/xu-pixel/lazy-llm-proxy:latest
```

- `**-v "$(pwd)/lazy-llm-proxy-db:/app/lazy-llm-proxy-db"**`: Mounts host `./lazy-llm-proxy-db` into the container at the same path, matching `lazy-llm-proxy-db/lazy-llm-proxy.db` in the app.
- `**REDIS_URL**`: On macOS / Windows, `host.docker.internal` reaches Redis on the host. On Linux, use the host IP or put Redis and the proxy on the same Docker network, e.g. `redis://lazy-llm-redis:6379` (see below).
- If the package is **private**, run `docker login ghcr.io` first (use a GitHub PAT with `read:packages`).

**Same Docker network (recommended on Linux or when you prefer not to use the host gateway)**

```bash
docker network create lazy-llm-net

docker run -d --name lazy-llm-redis --network lazy-llm-net -p 6379:6379 redis:7-alpine

docker run --rm --network lazy-llm-net -p 5001:5001 \
  -e REDIS_URL=redis://lazy-llm-redis:6379 \
  -v "$(pwd)/lazy-llm-proxy-db:/app/lazy-llm-proxy-db" \
  ghcr.io/xu-pixel/lazy-llm-proxy:latest
```

**Build from source (optional)**

From the repo root:

```bash
docker build -t lazy-llm-proxy .
docker run --rm -p 5001:5001 \
  -e REDIS_URL=redis://host.docker.internal:6379 \
  -v "$(pwd)/lazy-llm-proxy-db:/app/lazy-llm-proxy-db" \
  lazy-llm-proxy
```

The service listens on `**http://localhost:5001**`. The Admin Token is printed once in the container logs (`docker logs`).

---

### Development

```bash
bun install
bun run dev
```

Listens on `**http://localhost:5001**`. Chat proxy: `POST /v1/chat/completions` with a downstream key. Admin API: `GET/POST/PATCH/DELETE /admin/*` with the **Admin token** printed once at startup (`Authorization: Bearer …`).

---

`#openrouter` `#one-api`