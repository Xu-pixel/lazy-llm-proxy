import { mkdirSync } from "node:fs";
import { Database } from "bun:sqlite";

const DB_PATH = "lazy-llm-proxy-db/lazy-llm-proxy.db";
mkdirSync("lazy-llm-proxy-db", { recursive: true });
const db = new Database(DB_PATH, { strict: true });
db.run("PRAGMA journal_mode = WAL");

db.run(`CREATE TABLE IF NOT EXISTS providers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  base_url TEXT NOT NULL,
  api_key TEXT NOT NULL,
  models TEXT,
  created_at TEXT DEFAULT (datetime('now'))
)`);

db.run(`CREATE TABLE IF NOT EXISTS apikeys (
  key TEXT PRIMARY KEY,
  providers TEXT NOT NULL,
  expires_at TEXT,
  system_prompt TEXT,
  force_prompt INTEGER DEFAULT 0,
  token_limit INTEGER,
  tokens_used INTEGER DEFAULT 0,
  ips TEXT,
  model_names TEXT,
  created_at TEXT DEFAULT (datetime('now'))
)`);

db.run(`CREATE TABLE IF NOT EXISTS usage_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  apikey TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  model TEXT,
  prompt_tokens INTEGER DEFAULT 0,
  completion_tokens INTEGER DEFAULT 0,
  total_tokens INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
)`);

export interface Provider {
  id: string
  name: string
  base_url: string
  api_key: string
  models?: string[]
  created_at?: string
}

export interface ApiKey {
  key: string
  providers: string[]
  expires_at?: string | null
  system_prompt?: string | null
  force_prompt?: boolean
  token_limit?: number | null
  tokens_used?: number
  ips?: string[]
  model_names?: string[]
  created_at?: string
}

const join = (arr?: string[]) => arr?.length ? arr.join(",") : null;
const split = (s: string | null) => s ? s.split(",") : undefined;

function toApiKey(r: any): ApiKey {
  return { ...r, providers: r.providers.split(","), force_prompt: !!r.force_prompt, ips: split(r.ips), model_names: split(r.model_names) };
}

function toProvider(r: any): Provider {
  return { ...r, models: split(r.models) };
}

// --- Provider ---

const stmts = {
  insertProvider: db.query("INSERT INTO providers (id, name, base_url, api_key, models) VALUES (?1, ?2, ?3, ?4, ?5)"),
  getProvider: db.query("SELECT * FROM providers WHERE id = ?1"),
  listProviders: db.query("SELECT * FROM providers"),
  deleteProvider: db.query("DELETE FROM providers WHERE id = ?1"),
  insertApiKey: db.query("INSERT INTO apikeys (key, providers, expires_at, system_prompt, force_prompt, token_limit, ips, model_names) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)"),
  getApiKey: db.query("SELECT * FROM apikeys WHERE key = ?1"),
  listApiKeys: db.query("SELECT * FROM apikeys"),
  deleteApiKey: db.query("DELETE FROM apikeys WHERE key = ?1"),
  insertUsage: db.query("INSERT INTO usage_logs (apikey, provider_id, model, prompt_tokens, completion_tokens, total_tokens) VALUES (?1, ?2, ?3, ?4, ?5, ?6)"),
  addTokens: db.query("UPDATE apikeys SET tokens_used = tokens_used + ?1 WHERE key = ?2"),
  apiKeyUsage: db.query("SELECT model, SUM(prompt_tokens) as prompt_tokens, SUM(completion_tokens) as completion_tokens, SUM(total_tokens) as total_tokens, COUNT(*) as requests FROM usage_logs WHERE apikey = ?1 GROUP BY model"),
  providerUsage: db.query("SELECT model, SUM(prompt_tokens) as prompt_tokens, SUM(completion_tokens) as completion_tokens, SUM(total_tokens) as total_tokens, COUNT(*) as requests FROM usage_logs WHERE provider_id = ?1 GROUP BY model"),
};

export function createProvider(p: Omit<Provider, "id" | "created_at">) {
  const id = crypto.randomUUID();
  stmts.insertProvider.run(id, p.name, p.base_url, p.api_key, join(p.models));
  return id;
}

export function getProvider(id: string) {
  const r = stmts.getProvider.get(id);
  return r ? toProvider(r) : null;
}

export function listProviders() {
  return stmts.listProviders.all().map(toProvider);
}

export function updateProvider(id: string, p: Partial<Omit<Provider, "id" | "created_at">>) {
  const sets: string[] = [];
  const vals: any[] = [];
  if (p.name !== undefined) { sets.push("name = ?"); vals.push(p.name); }
  if (p.base_url !== undefined) { sets.push("base_url = ?"); vals.push(p.base_url); }
  if (p.api_key !== undefined) { sets.push("api_key = ?"); vals.push(p.api_key); }
  if (p.models !== undefined) { sets.push("models = ?"); vals.push(join(p.models)); }
  if (!sets.length) return;
  vals.push(id);
  db.run(`UPDATE providers SET ${sets.join(",")} WHERE id = ?`, vals);
}

export function deleteProvider(id: string) {
  stmts.deleteProvider.run(id);
}

// --- ApiKey ---

export function createApiKey(a: Omit<ApiKey, "key" | "created_at" | "tokens_used">) {
  const key = `sk-${crypto.randomUUID().replace(/-/g, "")}`;
  stmts.insertApiKey.run(key, a.providers.join(","), a.expires_at ?? null, a.system_prompt ?? null, a.force_prompt ? 1 : 0, a.token_limit ?? null, join(a.ips), join(a.model_names));
  return key;
}

export function getApiKey(key: string) {
  const r = stmts.getApiKey.get(key);
  return r ? toApiKey(r) : null;
}

export function listApiKeys() {
  return stmts.listApiKeys.all().map(toApiKey);
}

export function updateApiKey(key: string, a: Partial<Omit<ApiKey, "key" | "created_at">>) {
  const sets: string[] = [];
  const vals: any[] = [];
  if (a.providers !== undefined) { sets.push("providers = ?"); vals.push(a.providers.join(",")); }
  if (a.expires_at !== undefined) { sets.push("expires_at = ?"); vals.push(a.expires_at); }
  if (a.system_prompt !== undefined) { sets.push("system_prompt = ?"); vals.push(a.system_prompt); }
  if (a.force_prompt !== undefined) { sets.push("force_prompt = ?"); vals.push(a.force_prompt ? 1 : 0); }
  if (a.token_limit !== undefined) { sets.push("token_limit = ?"); vals.push(a.token_limit); }
  if (a.tokens_used !== undefined) { sets.push("tokens_used = ?"); vals.push(a.tokens_used); }
  if (a.ips !== undefined) { sets.push("ips = ?"); vals.push(join(a.ips)); }
  if (a.model_names !== undefined) { sets.push("model_names = ?"); vals.push(join(a.model_names)); }
  if (!sets.length) return;
  vals.push(key);
  db.run(`UPDATE apikeys SET ${sets.join(",")} WHERE key = ?`, vals);
}

export function deleteApiKey(key: string) {
  stmts.deleteApiKey.run(key);
}

// --- Usage ---

export function recordUsage(apikey: string, provider_id: string, model: string, prompt_tokens: number, completion_tokens: number) {
  const total = prompt_tokens + completion_tokens;
  stmts.insertUsage.run(apikey, provider_id, model, prompt_tokens, completion_tokens, total);
  stmts.addTokens.run(total, apikey);
}

export function getApiKeyUsage(key: string) {
  const detail = stmts.apiKeyUsage.all(key);
  const ak = getApiKey(key);
  return { tokens_used: ak?.tokens_used ?? 0, token_limit: ak?.token_limit ?? null, detail };
}

export function getProviderUsage(id: string) {
  return stmts.providerUsage.all(id);
}
