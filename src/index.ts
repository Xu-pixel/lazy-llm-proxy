import { Elysia, sse, t } from 'elysia'
import { bearer } from '@elysiajs/bearer'
import OpenAI from 'openai'
import * as proxy from './cache'

const ADMIN_TOKEN = crypto.randomUUID()
console.log(`\n  Admin Token: ${ADMIN_TOKEN}\n`)

function adminGuard(bearer: string | undefined) {
  if (bearer !== ADMIN_TOKEN) throw new Error('Forbidden')
}

function getClient(base_url: string, api_key: string) {
  return new OpenAI({ baseURL: base_url, apiKey: api_key })
}

function applySystemPrompt(messages: any[], ak: proxy.ApiKey) {
  if (!ak.system_prompt) return messages
  if (ak.force_prompt) {
    messages = messages.filter((m: any) => m.role !== 'system')
  }
  messages.unshift({ role: 'system', content: ak.system_prompt })
  return messages
}

async function* streamWithUsage(
  stream: AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>,
  onDone: (prompt: number, completion: number) => void,
) {
  let prompt = 0, completion = 0
  try {
    for await (const chunk of stream) {
      if (chunk.usage) {
        prompt = chunk.usage.prompt_tokens ?? 0
        completion = chunk.usage.completion_tokens ?? 0
      }
      yield chunk
    }
  } finally {
    onDone(prompt, completion)
  }
}

const app = new Elysia()
  .use(bearer())

  // ── Chat Proxy ──

  .post('/v1/chat/completions', async ({ body, bearer, request }) => {
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
      ?? request.headers.get('x-real-ip')
      ?? undefined

    if (!bearer) throw new Error('Unauthorized')
    const ak = await proxy.resolveKey(bearer, ip)
    if (!ak) throw new Error('Unauthorized or quota exceeded')
    if (!proxy.checkModel(ak, body.model)) throw new Error('Model not allowed')

    const pv = await proxy.pickProvider(ak)
    if (!pv) throw new Error('No available provider')

    const client = getClient(pv.base_url, pv.api_key)
    let messages = (body.messages ?? []).map((m: any) => ({
      role: m.role, content: m.content,
    }))
    messages = applySystemPrompt(messages, ak)

    const model = pv.models?.includes(body.model) ? body.model
      : ak.model_names?.length ? body.model
      : pv.models?.[0] ?? body.model

    if (body.stream) {
      const stream = await client.chat.completions.create({
        model, stream: true, stream_options: { include_usage: true }, messages,
      })
      return sse(streamWithUsage(stream, (p, c) => {
        proxy.recordUsage(ak.key, pv.id, model, p, c).catch(console.error)
      }))
    }

    const result = await client.chat.completions.create({ model, messages })
    const { prompt_tokens = 0, completion_tokens = 0 } = result.usage ?? {}
    await proxy.recordUsage(ak.key, pv.id, model, prompt_tokens, completion_tokens)
    return result
  }, {
    body: t.Object({
      stream: t.Optional(t.Boolean()),
      model: t.String(),
      messages: t.Optional(t.Array(t.Any())),
    }, { additionalProperties: true })
  })

  // ── Provider CRUD ──

  .post('/admin/providers', async ({ body, bearer }) => {
    adminGuard(bearer)
    const id = await proxy.addProvider(body)
    return { id }
  }, {
    body: t.Object({
      name: t.String(),
      base_url: t.String(),
      api_key: t.String(),
      models: t.Optional(t.Array(t.String())),
    })
  })

  .get('/admin/providers', ({ bearer }) => {
    adminGuard(bearer)
    return proxy.listProviders()
  })

  .get('/admin/providers/:id', async ({ params, bearer }) => {
    adminGuard(bearer)
    return await proxy.getProvider(params.id) ?? { error: 'not found' }
  })

  .patch('/admin/providers/:id', async ({ params, body, bearer }) => {
    adminGuard(bearer)
    await proxy.modifyProvider(params.id, body)
    return { ok: true }
  }, {
    body: t.Object({
      name: t.Optional(t.String()),
      base_url: t.Optional(t.String()),
      api_key: t.Optional(t.String()),
      models: t.Optional(t.Array(t.String())),
    })
  })

  .delete('/admin/providers/:id', async ({ params, bearer }) => {
    adminGuard(bearer)
    await proxy.removeProvider(params.id)
    return { ok: true }
  })

  .get('/admin/providers/:id/usage', ({ params, bearer }) => {
    adminGuard(bearer)
    return proxy.getProviderUsage(params.id)
  })

  // ── ApiKey CRUD ──

  .post('/admin/keys', async ({ body, bearer }) => {
    adminGuard(bearer)
    const key = await proxy.issueKey(body)
    return { key }
  }, {
    body: t.Object({
      providers: t.Array(t.String()),
      expires_at: t.Optional(t.Union([t.String(), t.Null()])),
      system_prompt: t.Optional(t.Union([t.String(), t.Null()])),
      force_prompt: t.Optional(t.Boolean()),
      token_limit: t.Optional(t.Union([t.Number(), t.Null()])),
      ips: t.Optional(t.Array(t.String())),
      model_names: t.Optional(t.Array(t.String())),
    })
  })

  .get('/admin/keys', ({ bearer }) => {
    adminGuard(bearer)
    return proxy.listKeys()
  })

  .get('/admin/keys/:key', async ({ params, bearer }) => {
    adminGuard(bearer)
    return await proxy.getKey(params.key) ?? { error: 'not found' }
  })

  .patch('/admin/keys/:key', async ({ params, body, bearer }) => {
    adminGuard(bearer)
    await proxy.modifyKey(params.key, body)
    return { ok: true }
  }, {
    body: t.Object({
      providers: t.Optional(t.Array(t.String())),
      expires_at: t.Optional(t.Union([t.String(), t.Null()])),
      system_prompt: t.Optional(t.Union([t.String(), t.Null()])),
      force_prompt: t.Optional(t.Boolean()),
      token_limit: t.Optional(t.Union([t.Number(), t.Null()])),
      tokens_used: t.Optional(t.Number()),
      ips: t.Optional(t.Array(t.String())),
      model_names: t.Optional(t.Array(t.String())),
    })
  })

  .delete('/admin/keys/:key', async ({ params, bearer }) => {
    adminGuard(bearer)
    await proxy.revokeKey(params.key)
    return { ok: true }
  })

  .get('/admin/keys/:key/usage', ({ params, bearer }) => {
    adminGuard(bearer)
    return proxy.getKeyUsage(params.key)
  })

  // ── Convenience ──

  .post('/admin/keys/:key/reset-usage', async ({ params, bearer }) => {
    adminGuard(bearer)
    await proxy.resetUsage(params.key)
    return { ok: true }
  })

  .post('/admin/keys/:key/providers/:pid', async ({ params, bearer }) => {
    adminGuard(bearer)
    await proxy.addProviderToKey(params.key, params.pid)
    return { ok: true }
  })

  .delete('/admin/keys/:key/providers/:pid', async ({ params, bearer }) => {
    adminGuard(bearer)
    await proxy.removeProviderFromKey(params.key, params.pid)
    return { ok: true }
  })

  .listen(5001)

console.log(`lazy-llm-proxy listening on :${app.server?.port}`)
