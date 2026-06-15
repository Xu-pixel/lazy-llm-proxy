import { Elysia, sse, t } from 'elysia'
import OpenAI from 'openai'
import { bearer } from '@elysiajs/bearer'

const FALLBACK_ERROR = 'model internal error'

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

// 把 OpenAI 的流包装成 SSE 
async function* chatSSE(messages: any[]) {
  console.log("call openai api")
  try {
    const stream = await openai.chat.completions.create({
      model: process.env.OPENAI_API_MODEL!,
      stream: true,
      messages
    })
    for await (const chunk of stream) {
      yield chunk
    }
  } catch (err) {
    console.error(err)
    throw new ModelInternalError()
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
      return sse(chatSSE(messages))
    }
    try {
      return await openai.chat.completions.create({
        model: process.env.OPENAI_API_MODEL!,
        messages,
      })
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