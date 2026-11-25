/**
 * PET-Digital v1.3.0 — testes ponta a ponta (navegador em tamanho de celular).
 *
 * O quê: usa o aplicativo como um supervisor usaria, contra o Worker e o banco locais.
 * Como: Playwright + Chromium; nada é publicado e nenhum dado de produção é tocado.
 * Quando: antes de publicar cada versão.  Rodar:  node --test testes/e2e.test.mjs
 *         (Para guardar capturas de tela: PET_SCREENSHOTS=pasta node --test testes/e2e.test.mjs)
 *
 * Cobre:
 *  1. Primeiro administrador, login e autorização automática do aparelho do admin.
 *  2. Campos ficam vermelhos só depois de tentar avançar; a função que leva ao campo com erro existe.
 *  3. Checklist aceita Sim/Não/N/A sem bloquear; N/A exige justificativa (sem mínimo de caracteres).
 *  4. Teste após ventilação aparece sozinho quando a medição inicial sai do limite; valores com vírgula.
 *  5. Equipe: foto, assinatura em tela cheia, revisão e emissão; PDF e arquivo de validação baixados.
 *  6. O PDF traz justificativa de N/A, detector e declaração de ciência; a PET é validada na aba Gestão.
 *  7. Falha de envio: a PET fica pendente, sobrevive a recarregar o app e é reenviada SEM duplicar.
 *  8. Sem internet: o usuário continua conectado e o rascunho continua disponível.
 *  9. Abrir a aba Conta não apaga o formulário (bug da v1.1.6).
 * 10. Sessão recusada pelo servidor volta ao login sem apagar o rascunho.
 * 11. Unidades criadas pelo admin; operacional com unidade automática no formulário; aviso de aparelho
 *     pendente para o admin, aba Aparelhos e aprovação.
 * 12. Operacional emite PET; verificador da mesma unidade vê só ela na Conferência; PET de fora da
 *     unidade é confirmada como autêntica, sem detalhes.
 * 13. Aba Aparelhos: filtros com contadores e revogação com motivo.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { createRequire } from 'node:module';
// Playwright é carregado por `require` para funcionar tanto instalado na pasta testes/ quanto globalmente.
const { chromium } = createRequire(import.meta.url)('playwright');
import { startLocalServers, TEST_BOOTSTRAP_TOKEN } from './servidor-local.mjs';

const SHOTS = process.env.PET_SCREENSHOTS || '';
let servers, browser, context, page;
let shotIndex = 0;
const errors = [];
// Arquivos da primeira PET (emitida pelo admin, sem unidade), usados no teste do verificador.
let adminPetFiles = null;

async function shot(name) {
  if (!SHOTS) return;
  await mkdir(SHOTS, { recursive: true });
  await page.screenshot({ path: join(SHOTS, `${String(++shotIndex).padStart(2, '0')}-${name}.png`), fullPage: false });
}

async function api(path, { method = 'GET', body, token } = {}) {
  const res = await fetch(servers.apiUrl + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, body: await res.json() };
}

/** Gera uma foto JPEG dentro do próprio navegador (dispensa arquivos de imagem no pacote). */
async function makePhoto(label) {
  const b64 = await page.evaluate(text => {
    const c = document.createElement('canvas'); c.width = 640; c.height = 480;
    const x = c.getContext('2d');
    x.fillStyle = '#c9dbef'; x.fillRect(0, 0, 640, 480);
    x.fillStyle = '#0b3a66'; x.beginPath(); x.arc(320, 190, 90, 0, Math.PI * 2); x.fill();
    x.fillStyle = '#fff'; x.fillRect(250, 330, 140, 90); x.fillStyle = '#111'; x.font = '24px sans-serif'; x.fillText(text, 262, 380);
    return c.toDataURL('image/jpeg', 0.8).split(',')[1];
  }, label);
  return { name: `${label}.jpg`, mimeType: 'image/jpeg', buffer: Buffer.from(b64, 'base64') };
}

async function drawSignature() {
  const box = await page.locator('#signaturePad').boundingBox();
  await page.mouse.move(box.x + box.width * 0.15, box.y + box.height * 0.6);
  await page.mouse.down();
  for (let i = 1; i <= 24; i++) await page.mouse.move(box.x + box.width * (0.15 + i * 0.03), box.y + box.height * (0.6 - Math.sin(i / 2) * 0.2), { steps: 2 });
  await page.mouse.up();
}

async function next() { await page.click('#formNextBtn'); }

/** Responde um item do checklist como um toque do usuário, repetindo se a tela ainda estiver rolando. */
async function answer(n, value) {
  const input = page.locator(`[name="check_${n}"][value="${value}"]`);
  for (let attempt = 0; attempt < 5 && !(await input.isChecked()); attempt++) {
    await page.waitForTimeout(attempt ? 250 : 0);
    await input.click({ timeout: 3000 }).catch(() => {});
  }
  assert.ok(await input.isChecked(), `item ${n} respondido`);
}
async function stepTitle() { return (await page.textContent('#stepTitle')).trim(); }

async function fillPerson(index, nome, matricula) {
  await page.locator('#peopleList .person-row').nth(index).click();
  await page.fill('#personNome', nome);
  await page.fill('#personMatricula', matricula);
  await page.setInputFiles('#personPhotoInput', await makePhoto(matricula));
  await page.waitForSelector('#personPhotoPreview img');
  if (index === 0) await shot('pessoa');
  await page.click('#personSignBtn');
  await drawSignature();
  if (index === 0) await shot('assinatura');
  await page.click('#sigConfirmBtn');
  await page.waitForSelector('#personSigPreview img');
  await page.click('#personDoneBtn');
}

/** Preenche uma PET completa. `gasOut` simula medição inicial fora do limite. */
async function fillCompletePet({ local = 'PV 2187 — Rua das Acácias', gasOut = false } = {}) {
  // v1.3.0: quem tem unidade no cadastro recebe o campo já preenchido e travado.
  if (!(await page.locator('[name="unidade"]').getAttribute('readonly') !== null)) await page.fill('[name="unidade"]', 'DMAE — Manutenção de Esgoto');
  await page.fill('[name="local"]', local);
  await page.fill('[name="horaTermino"]', '23:59');
  await page.fill('[name="trabalho"]', 'Desobstrução e inspeção do poço de visita.');
  await page.click('#salvamentoGroup label:first-child');
  await page.fill('[name="detectorId"]', 'MX4-0231');
  await page.fill('[name="detectorCalibracao"]', '2099-12-31');
  await next();
  for (let i = 1; i <= 22; i++) {
    const n = String(i).padStart(2, '0');
    const value = n === '12' || n === '15' ? 'N' : n === '19' ? 'NA' : 'S';
    await answer(n, value);
  }
  await page.fill('[name="check_19_justification"]', 'Sem ar mandado');
  await page.locator('#ck-19').scrollIntoViewIfNeeded();
  await shot('checklist');
  await next();
  await page.fill('[name="gas_inicial_hora"]', '08:10');
  await page.fill('[name="gas_inicial_o2"]', gasOut ? '19,1' : '20,9');
  await page.fill('[name="gas_inicial_lie"]', '0');
  await page.fill('[name="gas_inicial_h2s"]', gasOut ? '7' : '0');
  await page.fill('[name="gas_inicial_co"]', '2');
  if (gasOut) {
    await page.fill('[name="gas_ventilacao_hora"]', '08:30');
    await page.fill('[name="gas_ventilacao_o2"]', '20,8');
    await page.fill('[name="gas_ventilacao_lie"]', '0');
    await page.fill('[name="gas_ventilacao_h2s"]', '1');
    await page.fill('[name="gas_ventilacao_co"]', '2');
    await page.locator('#ventNeededNotice').scrollIntoViewIfNeeded();
    await shot('medicoes');
  }
  await next();
  await fillPerson(0, 'Carlos Mendes', '31045');
  await fillPerson(1, 'Rafael Lima', '35512');
  await fillPerson(2, 'Bruno Costa', '36780');
  await shot('equipe');
  await next();
  await page.click('#cienciaCard span');
  await next();
  assert.equal(await stepTitle(), 'Revisão');
}

async function waitDownloads(trigger, count) {
  const downloads = [];
  const done = new Promise(resolve => {
    page.on('download', function handler(d) { downloads.push(d); if (downloads.length === count) { page.off('download', handler); resolve(); } });
  });
  await trigger();
  await done;
  return downloads;
}

before(async () => {
  servers = await startLocalServers({ apiPort: 18787, webPort: 18788 });
  browser = await chromium.launch();
  context = await browser.newContext({
    viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1,
    serviceWorkers: 'block', acceptDownloads: true, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo',
    permissions: ['geolocation'], geolocation: { latitude: -18.9186, longitude: -48.2772, accuracy: 15 }
  });
  page = await context.newPage();
  page.on('pageerror', err => errors.push(err.message));
  page.on('console', msg => { if (msg.type() === 'error' && !/Failed to load resource|ERR_|net::/.test(msg.text())) errors.push(msg.text()); });
});

after(async () => {
  await browser?.close();
  await servers?.close();
});

test('1. primeiro administrador, login e aparelho autorizado', async () => {
  await page.goto(servers.webUrl);
  // O app coloca o cursor na matrícula logo após abrir; espera isso para não digitar no campo errado.
  await page.waitForFunction(() => document.activeElement?.id === 'loginMatricula');
  await shot('login');
  await page.click('#setupAdminForm summary');
  await page.fill('#setupToken', TEST_BOOTSTRAP_TOKEN);
  await page.fill('#setupName', 'Administrador de Teste');
  await page.fill('#setupMatricula', '1000');
  await page.fill('#setupPassword', 'SenhaForte123');
  await page.click('#setupAdminBtn');
  await page.waitForFunction(() => document.querySelector('#loginMatricula').value === '1000', null, { timeout: 10000 })
    .catch(async () => assert.fail('Primeiro administrador não foi criado. Aviso na tela: ' + await page.textContent('#toast') + ' | ' + JSON.stringify(await page.evaluate(() => ['setupToken','setupName','setupMatricula','setupPassword'].map(id => document.getElementById(id).value)))));
  await page.fill('#loginPassword', 'SenhaForte123');
  await page.click('#togglePasswordBtn');
  assert.equal(await page.getAttribute('#loginPassword', 'type'), 'text', 'botão Mostrar senha');
  await page.click('#loginBtn');
  await page.waitForSelector('#appShell:not(.hidden)');
  // Admin: o aparelho é autorizado automaticamente na primeira solicitação.
  await page.click('#deviceChip');
  await page.click('#registerDeviceBtn');
  await page.waitForFunction(() => document.querySelector('#deviceChipText').textContent.includes('autorizado'));
  await page.click('[data-tab="formTab"]');
  await shot('etapa1-vazia');
  assert.equal(await page.locator('.is-invalid').count(), 0, 'nenhum campo vermelho antes de tentar avançar');
});

test('2. erros só aparecem ao avançar e a tela leva ao campo', async () => {
  await next();
  await page.waitForSelector('#stepErrorBox:not(.hidden)');
  assert.ok(await page.locator('.is-invalid').count() > 0, 'campos destacados após tentar avançar');
  await shot('etapa1-erros');
  await page.click('#stepErrorGo');
  await page.waitForFunction(() => document.activeElement?.name, null, { timeout: 3000 }).catch(() => {});
  const focused = await page.evaluate(() => document.activeElement?.name);
  assert.equal(focused, 'unidade', '“Ir para o primeiro” leva ao primeiro campo vazio');
  await page.fill('[name="unidade"]', 'DMAE');
  assert.equal(await page.locator('[name="unidade"].is-invalid').count(), 0, 'vermelho some ao preencher');
  assert.deepEqual(errors, [], 'sem erros de JavaScript');
});

test('3 a 6. emissão completa com medição fora do limite, PDF e validação', async () => {
  await page.reload();
  await page.waitForSelector('#appShell:not(.hidden)');
  await fillCompletePet({ gasOut: true });
  await shot('revisao');
  const review = await page.textContent('#reviewContent');
  assert.match(review, /Itens marcados como NÃO/);
  assert.match(review, /Sem ar mandado/);
  assert.match(review, /Após ventilação/);
  await page.click('#formNextBtn');
  await page.waitForSelector('#doneView:not(.hidden)', { timeout: 60000 });
  await shot('concluida');
  const numero = (await page.textContent('#doneNumero')).trim();
  assert.match(numero, /^PET-\d{8}-\d{6}-[A-Z0-9]{4}$/);

  const [pdfDl] = await waitDownloads(() => page.click('#sharePdfBtn'), 1);
  const [jsonDl] = await waitDownloads(() => page.click('#shareJsonBtn'), 1);
  const pdfPath = await pdfDl.path();
  const jsonPath = await jsonDl.path();
  const dossier = JSON.parse(await readFile(jsonPath, 'utf8'));
  assert.equal(dossier.payload.fields.petNumero, numero);
  assert.equal(dossier.payload.fields.gas_inicial_o2, '19,1');
  assert.equal(dossier.payload.checklist.find(c => c.number === '19').justification, 'Sem ar mandado');
  assert.equal(dossier.payload.professionals[0].type, 'supervisor');
  if (process.env.PET_KEEP_PDF) await (await import('node:fs/promises')).copyFile(pdfPath, process.env.PET_KEEP_PDF);
  adminPetFiles = { pdfPath, jsonPath, numero };

  // Validação oficial na aba Gestão (admin).
  await page.click('#manageTabBtn');
  await page.setInputFiles('#verifyPdfFile', pdfPath);
  await page.setInputFiles('#verifyJsonFile', jsonPath);
  await page.click('#verifyFilesBtn');
  await page.waitForSelector('#verifyResult.alert-ok', { timeout: 30000 });
  assert.match(await page.textContent('#verifyResult'), /Documento válido/);

  // v1.3.0: a PET aparece na lista de PETs registradas com data e local gravados no servidor.
  await page.waitForSelector(`#petList .list-card:has-text("${numero}")`);
  assert.match(await page.textContent('#petList'), /PV 2187/);
  await shot('gestao-pets');

  const rows = servers.db.query('SELECT numero_pet, pet_local, unit_id FROM pet_records');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].pet_local, 'PV 2187 — Rua das Acácias');
  assert.equal(rows[0].unit_id, null, 'admin sem unidade: PET sem unidade');
  assert.deepEqual(errors, [], 'sem erros de JavaScript');
});

test('7. falha no envio: PET pendente, sobrevive a recarregar e é reenviada sem duplicar', async () => {
  await page.click('[data-tab="formTab"]');
  await page.click('#newPetBtn');
  await fillCompletePet({ local: 'Reservatório R3 — teste de falha' });
  // Derruba só o próximo envio da PET, como se a internet caísse no meio do registro.
  let dropped = false;
  await page.route(servers.apiUrl + '/pet-records', route => {
    if (!dropped && route.request().method() === 'POST') { dropped = true; return route.abort('internetdisconnected'); }
    return route.continue();
  });
  await page.click('#formNextBtn');
  await page.waitForSelector('#pendingAttemptBox:not(.hidden)', { timeout: 60000 });
  const pendingText = await page.textContent('#pendingAttemptText');
  const numero = pendingText.match(/PET-\d{8}-\d{6}-[A-Z0-9]{4}/)[0];
  await shot('envio-pendente');

  // Antes (v1.1.6) recarregar ou abrir a aba Sistema perdia a tentativa e gerava outra PET.
  await page.unroute(servers.apiUrl + '/pet-records');
  await page.reload();
  await page.waitForSelector('#appShell:not(.hidden)');
  await page.click('[data-tab="accountTab"]');
  await page.click('[data-tab="formTab"]');
  if (process.env.PET_DEBUG) console.log(await page.evaluate(() => { const k = Object.keys(localStorage).find(k => k.startsWith('petDigitalDraftV9')); const d = JSON.parse(localStorage.getItem(k)); return JSON.stringify({ ciencia: d.fields.declaracaoCiencia, checked: document.querySelector('[name=declaracaoCiencia]').checked, people: d.people.map(p => [p.nome, !!p.photoDataUrl, !!p.signatureDataUrl]) }); }));
  for (let i = 0; i < 5; i++) await next();
  if (process.env.PET_DEBUG) console.log(await stepTitle(), await page.textContent('#stepErrorBox'));
  assert.equal(await stepTitle(), 'Revisão');
  await page.waitForSelector('#pendingAttemptBox:not(.hidden)');
  assert.match(await page.textContent('#pendingAttemptText'), new RegExp(numero));

  await page.click('#formNextBtn');
  await page.waitForSelector('#doneView:not(.hidden)', { timeout: 60000 });
  assert.equal((await page.textContent('#doneNumero')).trim(), numero, 'mesmo número da tentativa pendente');
  const rows = servers.db.query('SELECT numero_pet FROM pet_records WHERE numero_pet = ?', numero);
  assert.equal(rows.length, 1, 'registrada uma única vez');
  assert.equal(servers.db.query('SELECT COUNT(*) AS n FROM pet_records')[0].n, 2);

  await page.click('[data-tab="recordsTab"]');
  await shot('minhas-pets');
  assert.equal(await page.locator('#recordsList .list-card').count(), 2);
});

test('8 e 9. sem internet continua conectado; trocar de aba não apaga o formulário', async () => {
  await page.click('[data-tab="formTab"]');
  await page.click('#newPetBtn');
  await page.fill('[name="local"]', 'Rascunho que não pode sumir');
  await page.click('[data-tab="accountTab"]');
  await page.click('[data-tab="formTab"]');
  assert.equal(await page.inputValue('[name="local"]'), 'Rascunho que não pode sumir');

  // Simula a queda de internet bloqueando a API (o app em si continua carregando, como faria
  // o Service Worker no celular).
  await page.route(servers.apiUrl + '/**', route => route.abort('internetdisconnected'));
  await page.goto(servers.webUrl);
  await page.waitForSelector('#appShell:not(.hidden)');
  assert.equal(await page.isVisible('#loginScreen'), false, 'continua conectado sem internet');
  assert.equal(await page.inputValue('[name="local"]'), 'Rascunho que não pode sumir');
  await page.waitForSelector('#offlineBanner:not(.hidden)');
  await shot('sem-internet');
  await page.unroute(servers.apiUrl + '/**');
});

test('10. sessão recusada pelo servidor volta ao login sem apagar o rascunho', async () => {
  servers.db.db.exec("UPDATE auth_sessions SET revoked_at = '2000-01-01T00:00:00Z'");
  await page.goto(servers.webUrl);
  await page.waitForSelector('#loginScreen:not(.hidden)');
  await page.fill('#loginMatricula', '1000');
  await page.fill('#loginPassword', 'SenhaForte123');
  await page.click('#loginBtn');
  await page.waitForSelector('#appShell:not(.hidden)');
  assert.equal(await page.inputValue('[name="local"]'), 'Rascunho que não pode sumir');
  assert.deepEqual(errors, [], 'sem erros de JavaScript');
});

/** Sai da conta atual e entra com outra. */
async function switchUser(matricula, password) {
  await page.click('[data-tab="accountTab"]');
  await page.click('#logoutBtn');
  await page.click('#confirmOk');
  await page.waitForSelector('#loginScreen:not(.hidden)');
  await page.fill('#loginMatricula', matricula);
  await page.fill('#loginPassword', password);
  await page.click('#loginBtn');
  await page.waitForSelector('#appShell:not(.hidden)');
}

/** Cadastra um usuário pela Gestão → Usuários. */
async function createUserUi(name, matricula, role, unitName) {
  await page.click('#newUserToggle');
  await page.fill('#newUserName', name);
  await page.fill('#newUserMatricula', matricula);
  await page.selectOption('#newUserRole', role);
  if (unitName) await page.selectOption('#newUserUnitId', { label: unitName });
  await page.fill('#newUserPassword', 'Temporaria123');
  await page.click('#createUserBtn');
  await page.waitForSelector(`#usersList .list-card:has-text("${name}")`);
}

/** Primeiro acesso: troca a senha temporária. */
async function changeTemporaryPassword(newPassword) {
  await page.waitForSelector('#accountTab.active');
  await page.fill('#currentPassword', 'Temporaria123');
  await page.fill('#newOwnPassword', newPassword);
  await page.fill('#confirmOwnPassword', newPassword);
  await page.click('#changeOwnPasswordBtn');
  await page.waitForSelector('#passwordChangeNotice.hidden', { state: 'attached' });
}

test('11. unidades, operacional com unidade automática, aviso de aparelho pendente e aprovação', async () => {
  // Admin cria as unidades na Gestão → Unidades.
  await page.click('#manageTabBtn');
  await page.click('[data-manage-section="units"]');
  for (const [name, type] of [['Manutenção de Esgoto', 'unidade'], ['ETA Sucupira', 'equipe']]) {
    await page.click('#newUnitToggle');
    await page.fill('#newUnitName', name);
    await page.click(`#newUnitType label:has(input[value="${type}"])`);
    await page.click('#createUnitBtn');
    await page.waitForSelector(`#unitsList .list-card:has-text("${name}")`);
  }
  // Nome repetido (sem acento/maiúscula) é recusado.
  await page.click('#newUnitToggle');
  await page.fill('#newUnitName', 'manutencao de esgoto');
  await page.click('#createUnitBtn');
  await page.waitForFunction(() => /Já existe/.test(document.querySelector('#toast').textContent));
  await page.click('#newUnitToggle');
  await shot('unidades');

  // Cadastro de usuários com unidade da lista.
  await page.click('[data-manage-section="users"]');
  await page.click('#newUserToggle');
  await page.fill('#newUserName', 'Sem Unidade');
  await page.fill('#newUserMatricula', '1999');
  await page.fill('#newUserPassword', 'Temporaria123');
  await page.click('#createUserBtn');
  await page.waitForFunction(() => /Escolha a unidade/.test(document.querySelector('#toast').textContent));
  await page.click('#newUserToggle');
  await createUserUi('Operador de Campo', '2000', 'operacional', 'Manutenção de Esgoto');
  await createUserUi('Verificadora Esgoto', '3000', 'verificador', 'Manutenção de Esgoto');
  await page.selectOption('#userUnitFilter', { label: 'ETA Sucupira' });
  assert.equal(await page.locator('#usersList .list-card').count(), 0, 'filtro por unidade');
  await page.selectOption('#userUnitFilter', { label: 'Manutenção de Esgoto' });
  assert.equal(await page.locator('#usersList .list-card').count(), 2);
  await shot('usuarios');

  // Operacional: troca de senha, unidade automática e pedido do aparelho.
  await switchUser('2000', 'Temporaria123');
  assert.equal(await page.isVisible('#pwdPanel'), true, 'troca de senha aberta');
  assert.equal(await page.isVisible('#manageTabBtn'), false, 'operacional não vê Gestão');
  assert.equal(await page.isVisible('#devicesTabBtn'), false, 'operacional não vê Aparelhos');
  assert.match(await page.textContent('#accountInfo'), /Manutenção de Esgoto/);
  await changeTemporaryPassword('NovaSenha456');
  await page.fill('#deviceLabel', 'Celular do teste');
  await page.click('#registerDeviceBtn');
  await page.waitForFunction(() => document.querySelector('#deviceChipText').textContent.includes('Aguardando'));
  assert.match(await page.textContent('#deviceRegistrationStatus'), /Pedido enviado em .* às \d{2}:\d{2}/);
  await shot('aguardando-aprovacao');
  await page.click('[data-tab="formTab"]');
  assert.equal(await page.inputValue('[name="unidade"]'), 'Manutenção de Esgoto');
  assert.notEqual(await page.getAttribute('[name="unidade"]', 'readonly'), null, 'unidade travada');

  // Admin: faixa de aviso, número na aba Aparelhos e aprovação.
  await switchUser('1000', 'SenhaForte123');
  await page.waitForSelector('#pendingDevicesBanner:not(.hidden)');
  assert.match(await page.textContent('#pendingDevicesText'), /1 aparelho aguardando aprovação/);
  assert.equal((await page.textContent('#devicesBadge')).trim(), '1');
  await shot('aviso-pendente');
  await page.click('#pendingDevicesGo');
  await page.waitForSelector('#devicesTab.active');
  assert.equal(await page.isVisible('#pendingDevicesBanner'), false, 'faixa some dentro da aba Aparelhos');
  const card = page.locator('#devicesList .list-card').first();
  await card.waitFor();
  assert.match(await card.textContent(), /Operador de Campo/);
  assert.match(await card.textContent(), /Manutenção de Esgoto/);
  assert.match(await card.textContent(), /Celular do teste/);
  await shot('aparelhos-pendentes');
  await card.locator('[data-device-approve]').click();
  await page.waitForSelector('#devicesBadge.hidden', { state: 'attached' });
  await page.waitForSelector('#devicesList .empty-state');

  await switchUser('2000', 'NovaSenha456');
  await page.waitForFunction(() => document.querySelector('#deviceChipText').textContent.includes('autorizado'));
  assert.deepEqual(errors, [], 'sem erros de JavaScript');
});

test('12. verificador vê só as PETs da unidade; PET de outra unidade só tem a autenticidade confirmada', async () => {
  // Operacional (Esgoto) emite uma PET.
  await page.click('[data-tab="formTab"]');
  await fillCompletePet({ local: 'Elevatória EE-04' });
  await page.click('#formNextBtn');
  await page.waitForSelector('#doneView:not(.hidden)', { timeout: 60000 });
  const numero = (await page.textContent('#doneNumero')).trim();
  const row = servers.db.query('SELECT p.unit_name, p.pet_local FROM pet_records p WHERE numero_pet = ?', numero)[0];
  assert.equal(row.unit_name, 'Manutenção de Esgoto', 'unidade gravada pelo servidor');

  // Verificadora da mesma unidade.
  await switchUser('3000', 'Temporaria123');
  await changeTemporaryPassword('Verifica789');
  assert.equal((await page.textContent('#manageTabBtn')).trim(), 'Conferência');
  assert.equal(await page.isVisible('#devicesTabBtn'), false);
  await page.click('#manageTabBtn');
  assert.equal(await page.isVisible('#manageSections'), false, 'verificador não vê Usuários/Unidades');
  await page.waitForSelector('#petList .list-card');
  assert.equal(await page.locator('#petList .list-card').count(), 1, 'só a PET da unidade');
  assert.match(await page.textContent('#petList'), new RegExp(numero));
  assert.match(await page.textContent('#petList'), /Elevatória EE-04/);
  assert.match(await page.textContent('#petList'), /Carlos Mendes/);
  assert.match(await page.textContent('#petListScope'), /Manutenção de Esgoto/);
  await shot('conferencia-verificador');

  // A PET do admin não tem unidade: a verificadora confirma só a autenticidade.
  await page.setInputFiles('#verifyPdfFile', adminPetFiles.pdfPath);
  await page.setInputFiles('#verifyJsonFile', adminPetFiles.jsonPath);
  await page.click('#verifyFilesBtn');
  await page.waitForSelector('#verifyResult.alert-ok', { timeout: 30000 });
  const text = await page.textContent('#verifyResult');
  assert.match(text, /Documento autêntico/);
  assert.match(text, /outra unidade/);
  assert.doesNotMatch(text, /Administrador de Teste/, 'sem nome do emissor');
  await shot('validacao-outra-unidade');
  assert.deepEqual(errors, [], 'sem erros de JavaScript');
});

test('13. aba Aparelhos: contadores e revogação com motivo', async () => {
  await switchUser('1000', 'SenhaForte123');
  await page.click('#devicesTabBtn');
  await page.click('[data-device-filter="active"]');
  await page.waitForSelector('#devicesList .list-card:has-text("Operador de Campo")');
  assert.equal((await page.textContent('[data-device-count="active"]')).trim(), '2');
  const card = page.locator('#devicesList .list-card:has-text("Operador de Campo")');
  assert.match(await card.textContent(), /Último uso: há|agora há pouco/);
  await card.locator('[data-device-revoke]').click();
  await page.waitForSelector('#deviceActionDialog[open]');
  await page.click('.reason-option:has-text("Perda ou roubo")');
  await shot('revogar-motivo');
  await page.click('#deviceActionConfirm');
  await page.waitForSelector('#deviceActionDialog:not([open])', { state: 'attached' });
  await page.click('[data-device-filter="revoked"]');
  await page.waitForSelector('#devicesList .list-card:has-text("Perda ou roubo")');
  assert.match(await page.textContent('#devicesList'), /Revogado em/);
  await shot('aparelhos-revogados');
  assert.deepEqual(errors, [], 'sem erros de JavaScript');
});
