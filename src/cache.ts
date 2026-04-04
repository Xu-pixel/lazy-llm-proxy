import { redis } from "bun"
import * as store from "./store"
import type { Provider, ApiKey } from "./store"

export type { Provider, ApiKey }

const TTL = 300
const K = {
  ak: (k: string) => `ak:${k}`,
  pv: (id: string) => `pv:${id}`,
  tk: (k: string) => `tk:${k}`,
}

async function cacheGet<T>(key: string, loader: () => T | null): Promise<T | null> {
  const hit = await redis.get(key)
  if (hit) return JSON.parse(hit)
  const val = loader()
  if (!val) return null
  await redis.set(key, JSON.stringify(val))
  await redis.expire(key, TTL)
  return val
}

async function invalidate(...keys: string[]) {
  for (const k of keys) await redis.del(k)
}

// ── Provider ──

export async function addProvider(p: Omit<Provider, "id" | "created_at">) {
  return store.createProvider(p)
}

export async function getProvider(id: string) {
  return cacheGet<Provider>(K.pv(id), () => store.getProvider(id))
}

export function listProviders() {
  return store.listProviders()
}

export async function modifyProvider(id: string, p: Partial<Omit<Provider, "id" | "created_at">>) {
  store.updateProvider(id, p)
  await invalidate(K.pv(id))
}

export async function removeProvider(id: string) {
  const keys = store.listApiKeys().filter(a => a.providers.includes(id))
  store.deleteProvider(id)
  await invalidate(K.pv(id), ...keys.map(a => K.ak(a.key)))
}

// ── ApiKey ──

export async function issueKey(a: Omit<ApiKey, "key" | "created_at" | "tokens_used">) {
  return store.createApiKey(a)
}

export async function getKey(key: string) {
  return cacheGet<ApiKey>(K.ak(key), () => store.getApiKey(key))
}

export function listKeys() {
  return store.listApiKeys()
}

export async function modifyKey(key: string, a: Partial<Omit<ApiKey, "key" | "created_at">>) {
  store.updateApiKey(key, a)
  await invalidate(K.ak(key))
}

export async function revokeKey(key: string) {
  store.deleteApiKey(key)
  await invalidate(K.ak(key), K.tk(key))
}

// ── 便捷配额 / Provider 操作 ──

export async function setQuota(key: string, tokenLimit: number) {
  store.updateApiKey(key, { token_limit: tokenLimit })
  await invalidate(K.ak(key))
}

export async function resetUsage(key: string) {
  store.updateApiKey(key, { tokens_used: 0 })
  await invalidate(K.ak(key))
  await redis.set(K.tk(key), "0")
}

export async function addProviderToKey(key: string, providerId: string) {
  const ak = store.getApiKey(key)
  if (!ak || ak.providers.includes(providerId)) return
  store.updateApiKey(key, { providers: [...ak.providers, providerId] })
  await invalidate(K.ak(key))
}

export async function removeProviderFromKey(key: string, providerId: string) {
  const ak = store.getApiKey(key)
  if (!ak) return
  const next = ak.providers.filter(p => p !== providerId)
  if (next.length === 0) throw new Error("apikey must have at least one provider")
  store.updateApiKey(key, { providers: next })
  await invalidate(K.ak(key))
}

// ── 请求热路径 ──

export async function getTokensUsed(key: string): Promise<number> {
  const cached = await redis.get(K.tk(key))
  if (cached !== null) return Number(cached)
  const ak = store.getApiKey(key)
  const used = ak?.tokens_used ?? 0
  await redis.set(K.tk(key), String(used))
  return used
}

export async function resolveKey(key: string, ip?: string): Promise<ApiKey | null> {
  const ak = await getKey(key)
  if (!ak) return null
  if (ak.expires_at && new Date(ak.expires_at) < new Date()) return null
  if (ak.ips?.length && ip && !ak.ips.includes(ip)) return null
  if (ak.token_limit) {
    const used = await getTokensUsed(key)
    if (used >= ak.token_limit) return null
  }
  return ak
}

export function checkModel(ak: ApiKey, model: string) {
  return !ak.model_names?.length || ak.model_names.includes(model)
}

export async function pickProvider(ak: ApiKey): Promise<Provider | null> {
  const id = ak.providers[Math.floor(Math.random() * ak.providers.length)]
  return getProvider(id)
}

export async function recordUsage(apikey: string, providerId: string, model: string, promptTokens: number, completionTokens: number) {
  const total = promptTokens + completionTokens
  store.recordUsage(apikey, providerId, model, promptTokens, completionTokens)
  const tkKey = K.tk(apikey)
  if (await redis.exists(tkKey)) {
    await redis.send("INCRBY", [tkKey, String(total)])
  } else {
    const ak = store.getApiKey(apikey)
    await redis.set(tkKey, String(ak?.tokens_used ?? 0))
  }
  await invalidate(K.ak(apikey))
}

// ── 用量查询 ──

export function getKeyUsage(key: string) {
  return store.getApiKeyUsage(key)
}

export function getProviderUsage(id: string) {
  return store.getProviderUsage(id)
}
