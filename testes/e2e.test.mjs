/**
 * PET-Digital v1.2.0 — testes ponta a ponta (navegador em tamanho de celular).
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
  await page.fill('[name="unidade"]', 'DMAE — Manutenção de Esgoto');
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

  // Validação oficial na aba Gestão (admin).
  await page.click('#manageTabBtn');
  await page.setInputFiles('#verifyPdfFile', pdfPath);
  await page.setInputFiles('#verifyJsonFile', jsonPath);
  await page.click('#verifyFilesBtn');
  await page.waitForSelector('#verifyResult.alert-ok', { timeout: 30000 });
  assert.match(await page.textContent('#verifyResult'), /Documento válido/);

  const rows = servers.db.query('SELECT numero_pet FROM pet_records');
  assert.equal(rows.length, 1);
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

test('11. operacional: troca de senha, aparelho aguardando aprovação e aprovação pelo gestor', async () => {
  // Admin cadastra um operacional pela aba Gestão.
  await page.click('#manageTabBtn');
  await page.click('#newUserToggle');
  await page.fill('#newUserName', 'Operador de Campo');
  await page.fill('#newUserMatricula', '2000');
  await page.fill('#newUserPassword', 'Temporaria123');
  await page.click('#createUserBtn');
  await page.waitForSelector('#usersList .list-card:has-text("Operador de Campo")');

  // Sai e entra como operacional: senha temporária leva à Conta.
  await page.click('[data-tab="accountTab"]');
  await page.click('#logoutBtn');
  await page.click('#confirmOk');
  await page.waitForSelector('#loginScreen:not(.hidden)');
  await page.fill('#loginMatricula', '2000');
  await page.fill('#loginPassword', 'Temporaria123');
  await page.click('#loginBtn');
  await page.waitForSelector('#accountTab.active');
  assert.equal(await page.isVisible('#pwdPanel'), true, 'troca de senha aberta');
  assert.equal(await page.isVisible('#manageTabBtn'), false, 'operacional não vê Gestão');
  await page.fill('#currentPassword', 'Temporaria123');
  await page.fill('#newOwnPassword', 'NovaSenha456');
  await page.fill('#confirmOwnPassword', 'NovaSenha456');
  await page.click('#changeOwnPasswordBtn');
  await page.waitForSelector('#passwordChangeNotice.hidden', { state: 'attached' });

  await page.fill('#deviceLabel', 'Celular do teste');
  await page.click('#registerDeviceBtn');
  await page.waitForFunction(() => document.querySelector('#deviceChipText').textContent.includes('Aguardando'));
  await shot('aguardando-aprovacao');

  // Gestor/admin vê o número na aba Gestão e aprova.
  await page.click('#logoutBtn');
  await page.click('#confirmOk');
  await page.fill('#loginMatricula', '1000');
  await page.fill('#loginPassword', 'SenhaForte123');
  await page.click('#loginBtn');
  await page.waitForSelector('#appShell:not(.hidden)');
  await page.waitForSelector('#manageBadge:not(.hidden)');
  assert.equal((await page.textContent('#manageBadge')).trim(), '1');
  await page.click('#manageTabBtn');
  await shot('gestao');
  await page.click('[data-device-approve]');
  await page.waitForSelector('#manageBadge.hidden', { state: 'attached' });

  await page.click('[data-tab="accountTab"]');
  await page.click('#logoutBtn');
  await page.click('#confirmOk');
  await page.fill('#loginMatricula', '2000');
  await page.fill('#loginPassword', 'NovaSenha456');
  await page.click('#loginBtn');
  await page.waitForFunction(() => document.querySelector('#deviceChipText').textContent.includes('autorizado'));
  assert.deepEqual(errors, [], 'sem erros de JavaScript');
});
