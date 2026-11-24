/**
 * PET-Digital v1.2.0 — testes da API (Worker).
 *
 * O quê: confere regras de segurança e permissões diretamente no código do Worker.
 * Como: chama `worker.fetch()` com o banco simulado (SQLite local); não usa rede nem navegador.
 * Quando: antes de publicar qualquer alteração no Worker.  Rodar:  node --test testes/api.test.mjs
 */
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createTestDatabase } from './d1-sqlite.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let worker;
let env;

function makeEnv(extra = {}) {
  return {
    DB: createTestDatabase(join(root, 'migrations')),
    APP_NAME: 'PET-DIGITAL-NR33', APP_ENV: 'teste', VALIDATION_PROFILE: 'PET-DIGITAL-NR33-v1',
    SESSION_SECRET: 'segredo', PASSWORD_PEPPER: 'pimenta', BOOTSTRAP_ADMIN_TOKEN: 'token-instalacao',
    SESSION_TTL_SECONDS: '28800', CORS_ALLOWED_ORIGIN: 'https://pet-digital.pages.dev',
    LOGIN_MAX_ACCOUNT: '5', LOGIN_MAX_IP: '20',
    ...extra
  };
}

async function call(path, { method = 'GET', body, token, origin = 'https://pet-digital.pages.dev', ip = '10.0.0.1', e = env } = {}) {
  const headers = { 'Content-Type': 'application/json', Origin: origin, 'CF-Connecting-IP': ip };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await worker.fetch(new Request('https://api.teste' + path, { method, headers, body: body ? JSON.stringify(body) : undefined }), e);
  let data = null;
  try { data = await res.json(); } catch {}
  return { status: res.status, data, headers: res.headers };
}

async function loginAs(matricula, password) {
  const r = await call('/auth/login', { method: 'POST', body: { matricula, password } });
  assert.equal(r.status, 200, `login de ${matricula}: ${r.data?.error}`);
  return r.data.token;
}

async function newDeviceKey() {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const jwk = await crypto.subtle.exportKey('jwk', pair.publicKey);
  // Mesma regra de JSON canônico do app e do Worker (chaves em ordem alfabética).
  const stable = obj => obj === null || typeof obj !== 'object' ? JSON.stringify(obj)
    : Array.isArray(obj) ? '[' + obj.map(stable).join(',') + ']'
    : '{' + Object.keys(obj).sort().map(k => JSON.stringify(k) + ':' + stable(obj[k])).join(',') + '}';
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(stable(jwk)));
  const hash = Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
  return { publicKeyJwk: jwk, publicKeyHash: hash, algorithm: 'ECDSA-P256-SHA256' };
}

let adminToken;

before(async () => {
  ({ default: worker } = await import(pathToFileURL(join(root, 'worker', 'src', 'index.js')).href));
  env = makeEnv();
  const setup = await call('/setup/admin', { method: 'POST', body: { token: 'token-instalacao', name: 'Admin', matricula: '1', password: 'SenhaAdmin123' } });
  assert.equal(setup.status, 201);
  adminToken = await loginAs('1', 'SenhaAdmin123');
});

test('health informa a versão 1.2.0', async () => {
  const r = await call('/health');
  assert.equal(r.data.version, '1.2.0');
});

test('primeiro administrador só pode ser criado uma vez e exige o token', async () => {
  assert.equal((await call('/setup/admin', { method: 'POST', body: { token: 'errado', name: 'X', matricula: '9', password: 'SenhaForte123' } })).status >= 400, true);
  assert.equal((await call('/setup/admin', { method: 'POST', body: { token: 'token-instalacao', name: 'X', matricula: '9', password: 'SenhaForte123' } })).status, 409);
});

test('login devolve a validade da sessão (usada para manter o usuário conectado offline)', async () => {
  const r = await call('/auth/login', { method: 'POST', body: { matricula: '1', password: 'SenhaAdmin123' } });
  assert.ok(Date.parse(r.data.expiresAt) > Date.now() + 7 * 3600 * 1000);
});

test('senha errada repetida bloqueia a conta temporariamente', async () => {
  let last;
  for (let i = 0; i < 6; i++) last = await call('/auth/login', { method: 'POST', body: { matricula: '1', password: 'errada' }, ip: '10.9.9.9' });
  assert.equal(last.status, 429);
  env.DB.db.exec('DELETE FROM auth_rate_limits');
});

test('CORS: endereço principal e publicações de teste do Pages são aceitos; outros sites não', async () => {
  assert.equal((await call('/health', { origin: 'https://pet-digital.pages.dev' })).headers.get('access-control-allow-origin'), 'https://pet-digital.pages.dev');
  assert.equal((await call('/health', { origin: 'https://90c5aba6.pet-digital.pages.dev' })).headers.get('access-control-allow-origin'), 'https://90c5aba6.pet-digital.pages.dev');
  assert.notEqual((await call('/health', { origin: 'https://site-malicioso.com' })).headers.get('access-control-allow-origin'), 'https://site-malicioso.com');
  assert.notEqual((await call('/health', { origin: 'https://x.outro-projeto.pages.dev' })).headers.get('access-control-allow-origin'), 'https://x.outro-projeto.pages.dev');
  assert.notEqual((await call('/health', { origin: 'https://a.b.pet-digital.pages.dev' })).headers.get('access-control-allow-origin'), 'https://a.b.pet-digital.pages.dev');
  const closed = makeEnv({ CORS_ALLOW_PREVIEWS: 'false' });
  assert.equal((await call('/health', { origin: 'https://90c5aba6.pet-digital.pages.dev', e: closed })).headers.get('access-control-allow-origin'), 'https://pet-digital.pages.dev');
});

test('/db-test exige administrador', async () => {
  assert.equal((await call('/db-test')).status, 401);
  assert.equal((await call('/db-test', { token: adminToken })).status, 200);
});

test('hierarquia: gestor não cria administrador; operacional não lista usuários', async () => {
  assert.equal((await call('/users', { method: 'POST', token: adminToken, body: { name: 'Gestor', matricula: '2', role: 'gestor', password: 'Temporaria123' } })).status, 201);
  assert.equal((await call('/users', { method: 'POST', token: adminToken, body: { name: 'Operador', matricula: '3', role: 'operacional', password: 'Temporaria123' } })).status, 201);
  const gestor = await loginAs('2', 'Temporaria123');
  const operador = await loginAs('3', 'Temporaria123');
  assert.equal((await call('/users', { method: 'POST', token: gestor, body: { name: 'X', matricula: '4', role: 'admin', password: 'Temporaria123' } })).status, 403);
  assert.equal((await call('/users', { token: operador })).status, 403);
});

test('aparelho de operacional fica pendente até um gestor aprovar', async () => {
  const operador = await loginAs('3', 'Temporaria123');
  const gestor = await loginAs('2', 'Temporaria123');
  const key = await newDeviceKey();
  const reg = await call('/devices/register', { method: 'POST', token: operador, body: { deviceLabel: 'Celular teste', ...key } });
  assert.equal(reg.status, 201, reg.data?.error);
  assert.equal(reg.data.device.status, 'pending');
  const approve = await call(`/devices/${reg.data.device.id}/approve`, { method: 'POST', token: gestor, body: {} });
  assert.equal(approve.status, 200);
  const list = await call('/devices', { token: operador });
  assert.equal(list.data.devices.find(d => d.public_key_hash === key.publicKeyHash).status, 'active');
});

test('registro de PET exige sessão e rejeita arquivo de validação inválido', async () => {
  assert.equal((await call('/pet-records', { method: 'POST', body: {} })).status, 401);
  const bad = await call('/pet-records', { method: 'POST', token: adminToken, body: { idempotencyKey: crypto.randomUUID(), pdfBase64: 'JVBERi0=', jsonText: '{}' } });
  assert.ok(bad.status >= 400 && bad.status < 500, `esperado 4xx, veio ${bad.status}`);
});

test('sessão revogada é recusada com 401 (o app volta ao login sem apagar o rascunho)', async () => {
  const token = await loginAs('1', 'SenhaAdmin123');
  await call('/auth/logout', { method: 'POST', token, body: {} });
  assert.equal((await call('/auth/me', { token })).status, 401);
});
