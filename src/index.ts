import { Elysia, sse, t } from 'elysia'
import OpenAI from 'openai'

const openai = new OpenAI({
  baseURL: process.env.OPENAI_API_BASE_URL,
  apiKey: process.env.OPENAI_API_KEY,
})

// 把 OpenAI 的流包装成 SSE 
async function* chatSSE(messages: any[]) {
  console.log("call openai api")
  // 1️⃣ 调用 SDK，开启流式
  const stream = await openai.chat.completions.create({
    model: process.env.OPENAI_API_MODEL!,
    stream: true,
    messages
  })
  for await (const chunk of stream) {
    yield chunk
  }
}

new Elysia()
  .post('/v1/chat/completions', ({ body }) => {
    // 把body中的dialogue转成messages
    const messages = body.dialogue.map((item: any) => ({
      role: item.role,
      content: item.content,
    }))
    if (body.stream) {
      return sse(chatSSE(messages))
    } else {
      return openai.chat.completions.create({
        model: process.env.OPENAI_API_MODEL!,
        messages,
      })
    }
  }, {
    body: t.Object({
      stream: t.Optional(t.Boolean()),
      // 从openai的api文档中复制出来的
      dialogue: t.Array(t.Any()),
    }, { additionalProperties: true })
  })
  .listen(5001)