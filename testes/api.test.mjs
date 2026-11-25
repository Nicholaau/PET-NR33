/**
 * PET-Digital v1.3.0 — testes da API (Worker).
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
const units = {};

/** Cria uma unidade pela API (como admin) e guarda o id. */
async function createUnit(name, type = 'unidade', token = adminToken) {
  const r = await call('/units', { method: 'POST', token, body: { name, type } });
  assert.equal(r.status, 201, r.data?.error);
  return r.data.unit.id;
}

/** Grava uma PET diretamente no banco (só para testar listas e permissões, sem gerar PDF). */
function insertPet({ numero, userId, deviceId, unitId = null, unitName = null, local = 'PV 10', hash }) {
  const payloadHash = hash || [...crypto.getRandomValues(new Uint8Array(32))].map(b => b.toString(16).padStart(2, '0')).join('');
  env.DB.db.prepare(`INSERT INTO pet_records (id, numero_pet, created_by_user_id, signing_key_id, schema_version, payload_hash, pet_signature_b64,
    server_received_at, status, participant_count, unit_id, unit_name, pet_date, pet_local, pet_trabalho, pet_supervisor)
    VALUES (?, ?, ?, ?, 'teste', ?, 'assinatura', ?, 'accepted', 3, ?, ?, '2026-11-25', ?, 'Limpeza', 'Supervisor Teste')`)
    .run(crypto.randomUUID(), numero, userId, deviceId, payloadHash, new Date().toISOString(), unitId, unitName, local);
  return payloadHash;
}

before(async () => {
  ({ default: worker } = await import(pathToFileURL(join(root, 'worker', 'src', 'index.js')).href));
  env = makeEnv();
  const setup = await call('/setup/admin', { method: 'POST', body: { token: 'token-instalacao', name: 'Admin', matricula: '1', password: 'SenhaAdmin123' } });
  assert.equal(setup.status, 201);
  adminToken = await loginAs('1', 'SenhaAdmin123');
  units.esgoto = await createUnit('Manutenção de Esgoto');
  units.agua = await createUnit('Manutenção de Água', 'nucleo');
});

test('health informa a versão 1.3.0', async () => {
  const r = await call('/health');
  assert.equal(r.data.version, '1.3.0');
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
  assert.equal((await call('/users', { method: 'POST', token: adminToken, body: { name: 'Operador', matricula: '3', role: 'operacional', unitId: units.esgoto, password: 'Temporaria123' } })).status, 201);
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

/* ===================== v1.3.0: unidades ===================== */

test('unidades: nome único sem diferenciar acento e maiúscula; só gestor e admin criam', async () => {
  const dup = await call('/units', { method: 'POST', token: adminToken, body: { name: '  manutencao   de ESGOTO ', type: 'unidade' } });
  assert.equal(dup.status, 409);
  assert.match(dup.data.error, /Já existe/);
  const badType = await call('/units', { method: 'POST', token: adminToken, body: { name: 'Qualquer', type: 'diretoria' } });
  assert.equal(badType.status, 400);
  const operador = await loginAs('3', 'Temporaria123');
  assert.equal((await call('/units', { method: 'POST', token: operador, body: { name: 'Nova', type: 'equipe' } })).status, 403);
  const gestor = await loginAs('2', 'Temporaria123');
  units.eta = await createUnit('ETA Sucupira', 'equipe', gestor);
  // Operacional enxerga apenas as unidades ativas, sem contadores.
  const list = await call('/units', { token: operador });
  assert.ok(list.data.units.some(u => u.id === units.eta));
  assert.equal(list.data.units[0].user_count, undefined);
});

test('unidades: operacional e verificador exigem unidade; gestor pode ficar sem (empresa toda)', async () => {
  const semUnidade = await call('/users', { method: 'POST', token: adminToken, body: { name: 'Sem', matricula: '50', role: 'verificador', password: 'Temporaria123' } });
  assert.equal(semUnidade.status, 400);
  assert.match(semUnidade.data.error, /unidade/);
  const gestor = await call('/users', { method: 'POST', token: adminToken, body: { name: 'Gestor 2', matricula: '51', role: 'gestor', password: 'Temporaria123' } });
  assert.equal(gestor.status, 201);
  assert.equal(gestor.data.user.unitId, null);
  const ok = await call('/users', { method: 'POST', token: adminToken, body: { name: 'Verif Esgoto', matricula: '52', role: 'verificador', unitId: units.esgoto, password: 'Temporaria123' } });
  assert.equal(ok.status, 201);
  assert.equal(ok.data.user.unitName, 'Manutenção de Esgoto');
  const me = await call('/auth/me', { token: await loginAs('52', 'Temporaria123') });
  assert.equal(me.data.user.unitId, units.esgoto);
});

test('unidades: desativar exige mover os usuários antes; renomear e reativar', async () => {
  const r1 = await call('/users', { method: 'POST', token: adminToken, body: { name: 'Op ETA', matricula: '60', role: 'operacional', unitId: units.eta, password: 'Temporaria123' } });
  const blocked = await call(`/units/${units.eta}`, { method: 'PATCH', token: adminToken, body: { status: 'inactive' } });
  assert.equal(blocked.status, 409);
  assert.match(blocked.data.error, /Mova/);
  await call(`/users/${r1.data.user.id}`, { method: 'PATCH', token: adminToken, body: { unitId: units.agua } });
  assert.equal((await call(`/units/${units.eta}`, { method: 'PATCH', token: adminToken, body: { status: 'inactive', name: 'ETA Sucupira (antiga)' } })).status, 200);
  // Unidade desativada não aparece para novos cadastros nem pode ser escolhida.
  const op = await loginAs('3', 'Temporaria123');
  assert.ok(!(await call('/units', { token: op })).data.units.some(u => u.id === units.eta));
  assert.equal((await call('/users', { method: 'POST', token: adminToken, body: { name: 'X', matricula: '61', role: 'operacional', unitId: units.eta, password: 'Temporaria123' } })).status, 400);
  const all = await call('/units?all=1', { token: adminToken });
  assert.equal(all.data.units.find(u => u.id === units.eta).status, 'inactive');
  assert.equal((await call(`/units/${units.eta}`, { method: 'PATCH', token: adminToken, body: { status: 'active' } })).status, 200);
});

test('cadastros antigos: o texto livre de unidade é ligado à lista oficial, com as PETs', async () => {
  // Simula usuários cadastrados antes da v1.3.0 (unidade só em texto).
  env.DB.db.exec(`INSERT INTO app_users (id, name, matricula, role, unit, status, password_hash, password_salt, must_change_password)
    VALUES ('legado-1', 'Legado Um', '70', 'operacional', 'esgoto ', 'active', 'x', 'y', 0),
           ('legado-2', 'Legado Dois', '71', 'operacional', 'esgoto', 'active', 'x', 'y', 0),
           ('legado-3', 'Legado Três', '72', 'operacional', 'Água', 'active', 'x', 'y', 0)`);
  env.DB.db.exec(`INSERT INTO device_keys (id, user_id, device_label, public_key_jwk, public_key_hash, status, approved_at)
    VALUES ('dev-legado', 'legado-1', 'Antigo', '{}', '${'a'.repeat(64)}', 'active', '2026-01-01T00:00:00Z')`);
  insertPet({ numero: 'PET-LEGADO-1', userId: 'legado-1', deviceId: 'dev-legado' });
  const gestor = await loginAs('2', 'Temporaria123');
  assert.equal((await call('/units/legacy', { token: gestor })).status, 403);
  const legacy = await call('/units/legacy', { token: adminToken });
  // Gestor/admin sem unidade são "empresa toda": não entram na lista de cadastros antigos.
  assert.ok(!legacy.data.items.some(i => i.text === ''), 'admin/gestor sem texto ficam de fora');
  const esgotoText = legacy.data.items.find(i => i.text === 'esgoto');
  assert.equal(esgotoText.userCount, 2);
  assert.equal(esgotoText.petCount, 1);
  const map = await call('/units/legacy-map', { method: 'POST', token: adminToken, body: { text: 'esgoto', unitId: units.esgoto } });
  assert.equal(map.status, 200, map.data?.error);
  assert.equal(map.data.userCount, 2);
  assert.equal(map.data.petCount, 1);
  const pet = env.DB.query(`SELECT unit_id, unit_name FROM pet_records WHERE numero_pet = 'PET-LEGADO-1'`)[0];
  assert.equal(pet.unit_id, units.esgoto);
  assert.ok(!(await call('/units/legacy', { token: adminToken })).data.items.some(i => i.text === 'esgoto'));
});

/* ===================== v1.3.0: PETs por unidade ===================== */

test('PETs: verificador lista e consulta só a própria unidade; gestor vê todas e filtra', async () => {
  const deviceId = env.DB.query(`SELECT id FROM device_keys WHERE status = 'active' LIMIT 1`)[0].id;
  const userId = env.DB.query(`SELECT id FROM app_users WHERE matricula = '3'`)[0].id;
  const hEsgoto = insertPet({ numero: 'PET-ESG-1', userId, deviceId, unitId: units.esgoto, unitName: 'Manutenção de Esgoto', local: 'PV 22 Rua A' });
  const hAgua = insertPet({ numero: 'PET-AGUA-1', userId, deviceId, unitId: units.agua, unitName: 'Manutenção de Água', local: 'Reservatório B' });
  env.DB.db.prepare(`INSERT INTO pet_participant_hashes (id, pet_record_id, participant_role, name, matricula) SELECT ?, id, 'supervisor', 'Supervisor Teste', '900' FROM pet_records WHERE numero_pet = 'PET-ESG-1'`).run(crypto.randomUUID());

  const verif = await loginAs('52', 'Temporaria123');
  const list = await call('/pet-records', { token: verif });
  assert.equal(list.status, 200);
  assert.ok(list.data.items.every(i => i.unit_id === units.esgoto));
  assert.ok(list.data.items.some(i => i.numero_pet === 'PET-ESG-1' && i.team[0].name === 'Supervisor Teste'));
  assert.equal(list.data.scope.unitName, 'Manutenção de Esgoto');
  // Mesmo pedindo outra unidade, o verificador continua restrito à dele.
  assert.ok((await call(`/pet-records?unitId=${units.agua}`, { token: verif })).data.items.every(i => i.unit_id === units.esgoto));
  assert.equal((await call('/pet-records/PET-ESG-1', { token: verif })).data.found, true);
  assert.equal((await call('/pet-records/PET-AGUA-1', { token: verif })).data.found, false);
  // Por código técnico: outra unidade só confirma que existe, sem emissor.
  const other = await call('/validate', { method: 'POST', token: verif, body: { payloadHash: hAgua } });
  assert.equal(other.data.found, true);
  assert.equal(other.data.limited, true);
  assert.equal(other.data.record.created_by_name, undefined);
  const own = await call('/validate', { method: 'POST', token: verif, body: { payloadHash: hEsgoto } });
  assert.ok(own.data.record.created_by_name);

  const gestor = await loginAs('2', 'Temporaria123');
  const all = await call('/pet-records', { token: gestor });
  assert.ok(all.data.items.some(i => i.numero_pet === 'PET-AGUA-1'));
  const filtered = await call(`/pet-records?unitId=${units.agua}`, { token: gestor });
  assert.ok(filtered.data.items.every(i => i.unit_id === units.agua));
  const search = await call('/pet-records?q=Reservat', { token: gestor });
  assert.deepEqual(search.data.items.map(i => i.numero_pet), ['PET-AGUA-1']);

  const operador = await loginAs('3', 'Temporaria123');
  assert.equal((await call('/pet-records', { token: operador })).status, 403);
});

/* ===================== v1.3.0: aparelhos ===================== */

test('aparelhos: filtros com contadores, busca e paginação na gestão', async () => {
  // 17 pedidos pendentes de operacionais da unidade Esgoto.
  for (let i = 0; i < 17; i++) {
    const mat = String(100 + i);
    await call('/users', { method: 'POST', token: adminToken, body: { name: `Pedido ${String(i).padStart(2, '0')}`, matricula: mat, role: 'operacional', unitId: units.esgoto, password: 'Temporaria123' } });
    const t = await loginAs(mat, 'Temporaria123');
    await call('/devices/register', { method: 'POST', token: t, body: { deviceLabel: `Cel ${i}`, ...(await newDeviceKey()) } });
  }
  const gestor = await loginAs('2', 'Temporaria123');
  const p1 = await call('/devices?view=manage&status=pending', { token: gestor });
  assert.equal(p1.data.counts.pending, 17);
  assert.equal(p1.data.devices.length, 15);
  assert.equal(p1.data.pages, 2);
  assert.equal(p1.data.devices[0].user_unit_name, 'Manutenção de Esgoto');
  const p2 = await call('/devices?view=manage&status=pending&page=2', { token: gestor });
  assert.equal(p2.data.devices.length, 2);
  const busca = await call('/devices?view=manage&status=pending&q=Pedido%2007', { token: gestor });
  assert.equal(busca.data.total, 1);
  const busca2 = await call('/devices?view=manage&status=pending&q=105', { token: gestor });
  assert.equal(busca2.data.devices[0].user_matricula, '105');
  // Gestor não vê aparelhos de gestor/admin; admin vê.
  const ativosGestor = await call('/devices?view=manage&status=active', { token: gestor });
  assert.ok(ativosGestor.data.devices.every(d => ['operacional', 'verificador'].includes(d.user_role)));
});

test('aparelhos: aprovar e revogar o anterior, aviso de outro ativo e motivo de revogação', async () => {
  const gestor = await loginAs('2', 'Temporaria123');
  const operador = await loginAs('3', 'Temporaria123');
  const novo = await call('/devices/register', { method: 'POST', token: operador, body: { deviceLabel: 'Celular novo', ...(await newDeviceKey()) } });
  const pend = await call('/devices?view=manage&status=pending&q=Operador', { token: gestor });
  const card = pend.data.devices.find(d => d.id === novo.data.device.id);
  assert.equal(card.other_active_count, 1);
  assert.equal(card.other_active_label, 'Celular teste');
  const ok = await call(`/devices/${novo.data.device.id}/approve`, { method: 'POST', token: gestor, body: { revokeOthers: true } });
  assert.equal(ok.data.revokedOthers, 1);
  const mine = (await call('/devices?mine=1', { token: operador })).data.devices;
  assert.equal(mine.filter(d => d.status === 'active').length, 1);
  const antigo = mine.find(d => d.device_label === 'Celular teste');
  assert.equal(antigo.status, 'revoked');
  assert.equal(antigo.revoke_reason, 'Troca de aparelho');
  assert.equal(antigo.refused, false);
  // Revogação com motivo escolhido.
  await call(`/devices/${novo.data.device.id}/revoke`, { method: 'POST', token: gestor, body: { reason: 'Perda ou roubo' } });
  const after = (await call('/devices?mine=1', { token: operador })).data.devices.find(d => d.id === novo.data.device.id);
  assert.equal(after.revoke_reason, 'Perda ou roubo');
  assert.equal(after.revoked_by_name, 'Gestor');
  // Aparelho revogado depois de aprovado: novo pedido não é aceito, precisa de reativação.
  const again = await call(`/devices/${novo.data.device.id}/approve`, { method: 'POST', token: gestor, body: {} });
  assert.equal(again.data.message, 'Aparelho reativado.');
});

test('aparelhos: recusa é diferente de revogação e o pedido recusado pode ser refeito', async () => {
  const gestor = await loginAs('2', 'Temporaria123');
  const verif = await loginAs('52', 'Temporaria123');
  const key = await newDeviceKey();
  const reg = await call('/devices/register', { method: 'POST', token: verif, body: { deviceLabel: 'Tablet', ...key } });
  const refuse = await call(`/devices/${reg.data.device.id}/revoke`, { method: 'POST', token: gestor, body: { reason: 'Pedido não reconhecido' } });
  assert.equal(refuse.data.message, 'Pedido recusado.');
  const row = (await call('/devices?mine=1', { token: verif })).data.devices[0];
  assert.equal(row.refused, true);
  const redo = await call('/devices/register', { method: 'POST', token: verif, body: { deviceLabel: 'Tablet', ...key } });
  assert.equal(redo.status, 200, redo.data?.error);
  assert.equal(redo.data.device.status, 'pending');
  // Depois de aprovado e revogado, o mesmo aparelho não pede de novo sozinho.
  await call(`/devices/${reg.data.device.id}/approve`, { method: 'POST', token: gestor, body: {} });
  await call(`/devices/${reg.data.device.id}/revoke`, { method: 'POST', token: gestor, body: { reason: 'Desligamento' } });
  const blocked = await call('/devices/register', { method: 'POST', token: verif, body: { deviceLabel: 'Tablet', ...key } });
  assert.equal(blocked.status, 409);
  assert.match(blocked.data.error, /reativ/);
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
