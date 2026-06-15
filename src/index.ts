import { Elysia, sse, t } from 'elysia'
import OpenAI from 'openai'
import { bearer } from '@elysiajs/bearer'
import { mkdirSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

const FALLBACK_ERROR = 'model internal error'
const enableThinking = process.env.ENABLE_THINKING === 'true'
const SESSIONS_DIR = 'lazy-llm-sessions'

mkdirSync(SESSIONS_DIR, { recursive: true })

const openai = new OpenAI({
  baseURL: process.env.OPENAI_API_BASE_URL,
  apiKey: process.env.OPENAI_API_KEY,
})

function openaiError(message: string, type = 'server_error', code = 'internal_error') {
  return { error: { message, type, code } }
}

class ModelInternalError extends Error {
  constructor() {
    super(FALLBACK_ERROR)
  }
}

function completionParams(messages: any[], stream: boolean) {
  return {
    model: process.env.OPENAI_API_MODEL!,
    messages,
    stream,
    chat_template_kwargs: { enable_thinking: enableThinking },
  }
}

function extractAssistantContent(part: { content?: string | null; reasoning_content?: string | null } | undefined) {
  if (!part) return ''
  return (part.reasoning_content ?? '') + (part.content ?? '')
}

function logSession(messages: any[], model: string, assistantContent: string) {
  setImmediate(() => {
    const record = {
      timestamp: new Date().toISOString(),
      model,
      messages: [
        ...messages.filter(m => m.role !== 'system'),
        { role: 'assistant', content: assistantContent },
      ],
    }
    const filename = `${record.timestamp.replace(/[:.]/g, '-')}-${randomUUID()}.jsonl`
    writeFile(join(SESSIONS_DIR, filename), JSON.stringify(record) + '\n')
      .catch(err => console.error('failed to log session:', err))
  })
}

// 把 OpenAI 的流包装成 SSE 
async function* chatSSE(messages: any[], downstreamModel: string) {
  console.log("call openai api")
  let content = ''
  try {
    const stream = await openai.chat.completions.create(
      completionParams(messages, true) as any,
    ) as unknown as AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>
    for await (const chunk of stream) {
      content += extractAssistantContent(chunk.choices[0]?.delta)
      yield chunk
    }
  } catch (err) {
    console.error(err)
    throw new ModelInternalError()
  } finally {
    if (content) logSession(messages, downstreamModel, content)
  }
}

new Elysia()
  .onError(({ error, set }) => {
    if (error instanceof ModelInternalError) {
      set.status = 500
      return openaiError(FALLBACK_ERROR)
    }
  })
  .use(bearer())
  .post('/v1/chat/completions', async ({ body, bearer }) => {
    if(bearer !== process.env.DOWNSTREAM_KEY) {
      throw new Error('Unauthorized')
    }

    if(body.model !== process.env.DOWNSTREAM_MODEL_NAME) {
      throw new Error('Model not supported')
    }

    let messages = body.messages
    //查找用户请求中的system prompt 如果有则拼接到user会话上
    const systemPrompt = messages.find(item => item.role === 'system')
    if(systemPrompt) {
      messages.unshift({
        role: 'user',
        content: systemPrompt.content,
      })
    }

    // 添加写死的system prompt
    messages.unshift({
      role: 'system',
      content: process.env.SYSTEM_PROMPT!,
    })

    if (body.stream) {
      return sse(chatSSE(messages, body.model))
    }
    try {
      const res = await openai.chat.completions.create(
        completionParams(messages, false) as any,
      )
      const assistantContent = extractAssistantContent(res.choices[0]?.message)
      if (assistantContent) logSession(messages, body.model, assistantContent)
      return res
    } catch (err) {
      console.error(err)
      throw new ModelInternalError()
    }
  }, {
    body: t.Object({
      stream: t.Optional(t.Boolean()),
      model: t.String(),
      messages: t.Array(t.Any()),
    }, { additionalProperties: true })
  })
  .listen(5001)