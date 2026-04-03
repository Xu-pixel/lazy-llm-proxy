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
  .post('/v1/chat/completions', ({ body,headers }) => {
    if(headers['authorization'] !== process.env.DOWNSTREAM_KEY) {
      throw new Error('Unauthorized')
    }

    if(body.model !== process.env.DOWNSTREAM_MODEL_NAME) {
      throw new Error('Model not supported')
    }

    // 把body中的dialogue转成messages
    let messages = body.dialogue.map((item: any) => ({
      role: item.role,
      content: item.content,
    }))

    //查找用户请求中的system prompt 如果有则删除,可能有多个
    messages = messages.filter(item => item.role !== 'system')

    // 添加我们的system prompt
    messages.unshift({
      role: 'system',
      content: process.env.SYSTEM_PROMPT!,
    })

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
      model: t.String(),
      // 从openai的api文档中复制出来的
      dialogue: t.Array(t.Any()),
    }, { additionalProperties: true })
  })
  .listen(5001)