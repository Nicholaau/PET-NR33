'use strict';
/**
 * PET-Digital v1.1.5 — núcleo compartilhado.
 * O quê: constantes, utilitários, armazenamento local/IndexedDB e criptografia.
 * Como: declara as funções usadas pelos módulos carregados depois deste arquivo.
 * Quando: é o primeiro script do frontend.
 */


/**
 * PET Digital NR-33 v1.1.5 — frontend comentado.
 *
 * Visão geral do arquivo:
 * - A interface é um PWA estático no Cloudflare Pages, mas a emissão oficial depende
 *   do Worker/D1 para autenticação, autorização do dispositivo e registro dos hashes.
 * - O estado temporário fica em memória; rascunhos e registros são separados por usuário
 *   no localStorage, enquanto PDF/JSON temporários ficam no IndexedDB do dispositivo.
 * - O fluxo principal é: login -> preencher -> validar -> gerar os arquivos finais ->
 *   recalcular os hashes reais -> registrar no Worker -> compartilhar PDF + comprovante.
 * - Foto, assinatura desenhada, dados do formulário e prova de geração do PDF entram
 *   no material que é hasheado e assinado criptograficamente.
 *
 * Observação: os comentários foram escritos no padrão 'O quê / Como / Quando' para facilitar auditoria,
 * revisão técnica e evolução controlada do código.
 */

// Versão funcional gravada no dossiê e exibida nos elementos de prova.
const APP_VERSION = '1.1.5';

// Perfil técnico aceito pelo próprio validador. Esses valores padronizam como o hash
// é calculado, qual algoritmo assina o registro e como outro validador deve conferir.
const VALIDATION_PROFILE = 'PET-DIGITAL-NR33-v1';
const ACCEPTED_VALIDATION_PROFILES = new Set(['PET-DIGITAL-NR33-v1', 'PET-DIGITAL-NR33-PROOF/v1']);
const PAYLOAD_SCHEMA = 'PET-DIGITAL-NR33/v1.1.5';
const RECORD_TYPE = 'PET-DIGITAL-DOSSIE/v1';
const HASH_ALGORITHM = 'SHA-256';
const SIGNATURE_ALGORITHM = 'ECDSA-P256-SHA256';
const CANONICALIZATION_ALGORITHM = 'JSON_CANONICAL_STABLE_STRINGIFY_V1';

// Limiares mínimos para aceitar uma assinatura desenhada no canvas.
// Evita salvar canvas vazio ou marcas acidentais muito pequenas como assinatura válida.
const SIGNATURE_MIN_INK_PIXELS = 35;
const SIGNATURE_MIN_BOUNDS = 8;


// Chaves usadas no localStorage para separar rascunhos, registros finalizados e chave criptográfica.
const STORAGE_DRAFT = 'petDigitalDraftV8';
const STORAGE_RECORDS = 'petDigitalRecordsV2';
const STORAGE_KEYPAIR = 'petDigitalKeyPairV2';
const STORAGE_AUTH = 'petDigitalAuthV1';
const API_BASE_URL = 'https://pet-digital-api.nicholas-dmae.workers.dev';
const FRONTEND_ORIGIN = 'https://pet-digital.pages.dev';
const KEY_DB_NAME = 'petDigitalCryptoDbV2';
const KEY_DB_STORE = 'signingKeys';
const KEY_DB_PREFIX = 'user:';
const LEGACY_KEY_DB_ID = 'main';
const OUTPUT_DB_NAME = 'petDigitalOutputsV1';
const OUTPUT_DB_STORE = 'officialFiles';

// Limites defensivos iguais aos adotados pelo Worker. Mantê-los aqui melhora a
// experiência, mas o servidor continua sendo a autoridade e repete as verificações.
const MAX_PARTICIPANTS = 20;
const MAX_ENTRANTES = 15;
const MAX_VIGIAS = 4;
const MAX_LOCAL_RECORDS = 30;
const MAX_SOURCE_PHOTO_BYTES = 12 * 1024 * 1024;
const PHOTO_MAX_WIDTH = 480;
const PHOTO_JPEG_QUALITY = 0.72;
const FORM_STEPS = [
  { number: 1, label: 'Identificação' },
  { number: 2, label: 'Checklist' },
  { number: 3, label: 'Atmosfera' },
  { number: 4, label: 'Equipe' },
  { number: 5, label: 'Ciência' },
  { number: 6, label: 'Finalização' }
];

// Política de N/A: itens críticos nunca aceitam N/A; demais exigem justificativa.
const MAX_NA_ITEMS = 5;
const NA_FORBIDDEN_ITEMS = new Set(['01','02','03','05','06','08','10','11','12','14','16','17','18','22']);

// Itens do checklist extraídos do modelo da PET. A tabela é renderizada dinamicamente a partir desta lista.
const checklistItems = [
  'Todos os entrantes e vigias estão certificados para trabalho em espaço confinado?',
  'Todos os entrantes e vigias foram informados dos riscos existentes?',
  'Os entrantes estão portando os EPI adequados aos riscos?',
  'Todos os entrantes estão portando cinto de segurança?',
  'O equipamento de resgate está operante e devidamente instalado?',
  'Todos os entrantes e vigias estão com exame periódico (ASO) atualizado?',
  'Foi nomeado um entrante para portar o Alert Gás?',
  'Todas as fontes de energias (elétrica, gás etc.) que possam interferir na segurança do trabalho foram desativadas, bloqueadas e sinalizadas?',
  'As bocas de visitas/escotilhas foram todas abertas?',
  'O detector multi-gás / alert-gás está com a calibração atualizada?',
  'Foi avaliada a condição da atmosfera antes da entrada (H₂S, CO, O₂, CH₄)?',
  'A atmosfera está IPVS (perigosa à vida e à saúde)?',
  'O equipamento exaustor/insuflador está instalado e operando?',
  'As condições da atmosfera permitem a execução do serviço de forma segura?',
  'É necessário manter suprimento de ar mandado para os trabalhadores entrantes?',
  'Foram instalados acessos seguros ao interior do espaço confinado?',
  'Foi neutralizada a possibilidade de desprendimento de gases tóxicos ou inflamáveis durante a execução do serviço?',
  'As fontes de geração de gases tóxicos e inflamáveis estão controladas e monitoradas?',
  'Equipamento de ar mandado (linha de ar) está instalado e operando?',
  'Há necessidade de utilização de ferramentas elétricas intrinsecamente seguras?',
  'Foi feito o bloqueio ou by-pass de válvulas/comportas que servem ao espaço confinado?',
  'Foram definidas as formas de resgate e transporte em caso de acidente?'
];

// Estrutura inicial obrigatória da equipe: 1 entrante, 1 vigia e 1 supervisor.
const initialPeople = [
  { role: 'Entrante - 1', required: true, type: 'entrante' },
  { role: 'Vigia - 1', required: true, type: 'vigia' },
  { role: 'Supervisor de Entrada', required: true, type: 'supervisor' }
];

// Lista em memória dos profissionais exibidos na tela de assinatura.
let people = [];

// Última PET finalizada na sessão atual. É usada para habilitar PDF e exportação JSON.
let finalizedRecord = null;
let finalizationInProgress = false;
let currentFormStep = 1;

// Sessão autenticada no Worker/D1. O token é usado apenas para chamadas da API.
let authState = null;

// Service Worker aguardando atualização; usado pelo banner 'Nova versão disponível'.
let waitingWorker = null;

// Atalhos de seleção DOM: `$` retorna um elemento; `$$` retorna um array de elementos.
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

/**
 * Normaliza textos digitados pelo usuário.
 * Ativação: chamada durante a coleta e validação do formulário.
 * O que faz: converte valores nulos/indefinidos em string vazia e remove espaços
 * extras no início e no fim, evitando hash diferente por espaços acidentais.
 */
function normalizeText(value) {
  return String(value ?? '').trim();
}

/**
 * Retorna a data civil local no padrão `AAAA-MM-DD`.
 * Ativação: usada no carregamento do formulário e na validação da calibração.
 * O que faz: lê ano, mês e dia do aparelho sem converter para UTC, evitando mudança
 * indevida de data perto da meia-noite em Uberlândia.
 */
function todayISO(date = new Date()) {
  // Não usa UTC: campos type=date devem refletir o dia civil do aparelho em campo.
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Retorna a hora local atual no formato `HH:MM`.
 * Ativação: usada ao abrir ou limpar o formulário para sugerir hora de emissão.
 * O que faz: lê hora/minuto do dispositivo e preenche zeros à esquerda.
 */
function nowTime() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/**
 * Serializa objetos de forma determinística para cálculo de hash.
 * Ativação: usada por `sha256Hex` quando o valor recebido é objeto/array.
 * O que faz: ordena alfabeticamente as chaves antes de converter para JSON, para
 * que o mesmo conteúdo gere o mesmo hash mesmo se a ordem das chaves variar.
 */
function stableStringify(obj) {
  if (obj === null || typeof obj !== 'object') return JSON.stringify(obj);
  if (Array.isArray(obj)) return '[' + obj.map(stableStringify).join(',') + ']';
  const keys = Object.keys(obj).sort();
  return '{' + keys.map(k => JSON.stringify(k) + ':' + stableStringify(obj[k])).join(',') + '}';
}

/**
 * Converte bytes em Base64.
 * Ativação: usada depois que o WebCrypto gera a assinatura binária.
 * O que faz: transforma o `ArrayBuffer` da assinatura em string armazenável no JSON.
 */
function bytesToBase64(bytes) {
  let binary = '';
  const arr = new Uint8Array(bytes);
  for (let i = 0; i < arr.length; i++) binary += String.fromCharCode(arr[i]);
  return btoa(binary);
}

/**
 * Converte Base64 de volta para bytes.
 * Ativação: usada na tela Validar, antes de verificar a assinatura criptográfica.
 * O que faz: decodifica a assinatura salva no JSON para o formato aceito pelo WebCrypto.
 */
function base64ToBytes(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * Calcula SHA-256 e retorna o resultado em hexadecimal.
 * Ativação: usada ao hashear payload, fotos, assinaturas e prova de geração do PDF.
 * O que faz: converte texto/objeto em bytes, chama `crypto.subtle.digest` e monta a
 * representação hexadecimal que será exibida e conferida posteriormente.
 */
async function sha256Hex(value) {
  const text = typeof value === 'string' ? value : stableStringify(value);
  const data = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
}

/** Calcula SHA-256 dos bytes exatos de um Blob/File. */
async function sha256BlobHex(blob) {
  const bytes = await blob.arrayBuffer();
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
}

/** Converte Blob/File em Base64 puro para validação transitória no Worker. */
async function blobToBase64(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(binary);
}

/** Retorna o usuário ativo; evita misturar dados locais de contas diferentes. */
function currentUser() { return (authState || loadAuthState())?.user || null; }

/** Monta uma chave de armazenamento exclusiva por usuário. */
function scopedStorageKey(base) {
  const user = currentUser();
  return user?.id ? `${base}:${user.id}` : null;
}

function currentDraftKey() { return scopedStorageKey(STORAGE_DRAFT); }
function currentRecordsKey() { return scopedStorageKey(STORAGE_RECORDS); }
function outputStorageId(recordId) {
  const user = currentUser();
  if (!user?.id || !recordId) return null;
  return `${user.id}:${recordId}`;
}

/** Abre o IndexedDB que guarda temporariamente os arquivos oficiais por usuário. */
function openOutputDatabase() {
  return new Promise((resolve, reject) => {
    if (!window.indexedDB) return reject(new Error('IndexedDB não disponível neste navegador.'));
    const request = indexedDB.open(OUTPUT_DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(OUTPUT_DB_STORE)) db.createObjectStore(OUTPUT_DB_STORE, { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Falha ao abrir armazenamento dos documentos.'));
  });
}

async function withOutputStore(mode, callback) {
  const db = await openOutputDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(OUTPUT_DB_STORE, mode);
      const store = tx.objectStore(OUTPUT_DB_STORE);
      const result = callback(store);
      if (result && typeof result.onsuccess !== 'undefined') {
        result.onsuccess = () => resolve(result.result);
        result.onerror = () => reject(result.error || new Error('Operação de documentos falhou.'));
      } else {
        tx.oncomplete = () => resolve(result);
        tx.onerror = () => reject(tx.error || new Error('Transação de documentos falhou.'));
      }
    });
  } finally { db.close(); }
}

async function saveOfficialFiles(record, pdfFile, jsonText) {
  const id = outputStorageId(record.recordId);
  if (!id) throw new Error('Usuário ou registro não identificado para salvar os documentos.');
  await withOutputStore('readwrite', store => store.put({
    id,
    userId: currentUser().id,
    recordId: record.recordId,
    pdfFile,
    jsonText,
    pdfFilename: pdfFile.name,
    jsonFilename: jsonFilename(record),
    pdfHash: record.output?.pdfHashSha256,
    jsonHash: record.output?.jsonHashSha256,
    // A cópia completa fica no IndexedDB, não no localStorage. Isso permite repetir
    // uma tentativa pendente sem consumir a pequena cota síncrona do navegador.
    recordSnapshot: structuredCloneSafe(record),
    savedAt: new Date().toISOString()
  }));
}

async function readOfficialFiles(record) {
  const id = outputStorageId(record?.recordId);
  if (!id) return null;
  try { return await withOutputStore('readonly', store => store.get(id)); }
  catch { return null; }
}

async function hydrateRecord(record) {
  if (!record) return null;
  const files = await readOfficialFiles(record);
  return files?.recordSnapshot || record;
}

function structuredCloneSafe(value) {
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

function isQuotaError(error) {
  return error?.name === 'QuotaExceededError' || error?.code === 22 || error?.code === 1014;
}

function showStorageNotice(message, kind = 'warn') {
  const box = $('#storageNotice');
  if (!box) return;
  box.className = `validation-box ${kind}`;
  box.textContent = message;
  box.classList.remove('hidden');
}

function safeLocalStorageSet(key, value, description = 'dados locais') {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch (error) {
    const message = isQuotaError(error)
      ? `O armazenamento local deste aparelho ficou cheio. Não foi possível salvar ${description}. Envie os documentos ao supervisor e exclua registros locais antigos.`
      : `Não foi possível salvar ${description} neste aparelho.`;
    // O erro local fica visível, mas não desfaz uma PET que já tenha sido aceita no servidor.
    // Retornar false permite que cada ação decida se deve apenas avisar ou interromper.
    showStorageNotice(message, 'bad');
    console.warn(message, error);
    return false;
  }
}

async function deleteOfficialFiles(recordId) {
  const id = outputStorageId(recordId);
  if (!id) return;
  try { await withOutputStore('readwrite', store => store.delete(id)); } catch {}
}

/** Remove as chaves globais antigas que poderiam expor dados de outro usuário. */
function purgeLegacySharedStorage() {
  ['petDigitalDraftV7','petDigitalRecordsV1'].forEach(key => localStorage.removeItem(key));
}

/** Limpa estado em memória ao trocar/sair de usuário, sem apagar os dados próprios já separados. */
function clearWorkspaceMemory() {
  finalizedRecord = null;
  const finalize = $('#finalizeBtn');
  if (finalize) { finalize.disabled = false; finalize.textContent = 'Finalizar PET oficial'; }
  finalizationInProgress = false;
  people = [];
  const form = $('#petForm');
  if (form) form.reset();
  resetPeople();
  renderPeople();
  setDefaultDateTime();
  const printArea = $('#printArea');
  if (printArea) { printArea.innerHTML = ''; printArea.classList.add('hidden'); }
  ['#integrityPanel','#serverPanel'].forEach(sel => $(sel)?.classList.add('hidden'));
  ['#registerServerBtn','#printBtn','#sharePdfBtn','#exportBtn','#shareJsonBtn'].forEach(sel => { const b=$(sel); if (b) b.disabled=true; });
  const records = $('#recordsList'); if (records) records.innerHTML = '';
  showFormStep(1);
}

/** Carrega somente o rascunho e os registros pertencentes ao usuário autenticado. */
function loadUserWorkspace() {
  clearWorkspaceMemory();
  loadDraft();
  renderRecords();
}

/**
 * Abre o IndexedDB usado para armazenar a chave privada não exportável.
 * Ativação: criação, assinatura, exibição de status e exclusão da chave local.
 * O que faz: cria/abre um banco local do navegador com uma store simples para CryptoKey.
 */
function openKeyDatabase() {
  return new Promise((resolve, reject) => {
    if (!window.indexedDB) return reject(new Error('IndexedDB não disponível neste navegador.'));
    const request = indexedDB.open(KEY_DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(KEY_DB_STORE)) db.createObjectStore(KEY_DB_STORE, { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Falha ao abrir IndexedDB.'));
  });
}

/** Executa uma operação simples na store de chaves do IndexedDB. */
async function withKeyStore(mode, callback) {
  const db = await openKeyDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(KEY_DB_STORE, mode);
      const store = tx.objectStore(KEY_DB_STORE);
      const result = callback(store);
      if (result && typeof result.onsuccess !== 'undefined') {
        result.onsuccess = () => resolve(result.result);
        result.onerror = () => reject(result.error || new Error('Operação de chave falhou.'));
      } else {
        tx.oncomplete = () => resolve(result);
        tx.onerror = () => reject(tx.error || new Error('Transação de chave falhou.'));
      }
    });
  } finally {
    db.close();
  }
}

/**
 * Retorna o identificador da chave do usuário atualmente autenticado.
 * O quê: impede que duas contas que usem o mesmo navegador compartilhem a mesma chave privada.
 * Como: combina um prefixo fixo com o ID interno do usuário devolvido pelo Worker.
 * Quando: em toda leitura, criação ou exclusão da proteção criptográfica local.
 */
function currentKeyDbId() {
  const userId = (authState || loadAuthState())?.user?.id;
  return userId ? `${KEY_DB_PREFIX}${userId}` : null;
}

/** Lê uma chave específica da store local. */
async function readKeyById(id) {
  if (!id) return null;
  try { return await withKeyStore('readonly', store => store.get(id)); }
  catch { return null; }
}

/** Exclui uma chave específica da store local. */
async function deleteKeyById(id) {
  if (!id) return;
  try { await withKeyStore('readwrite', store => store.delete(id)); } catch {}
}

/** Busca somente a chave pertencente ao usuário autenticado. */
async function readLocalKeyPair() {
  return readKeyById(currentKeyDbId());
}

/** Salva a chave no espaço local exclusivo da conta autenticada. */
async function writeLocalKeyPair(record) {
  const id = currentKeyDbId();
  const userId = (authState || loadAuthState())?.user?.id;
  if (!id || !userId) throw new Error('Faça login antes de configurar a proteção deste dispositivo.');
  await withKeyStore('readwrite', store => store.put({ ...record, id, ownerUserId: userId }));
}

/** Apaga somente a chave local da conta autenticada e remove resíduos antigos. */
async function deleteLocalKeyPair() {
  await deleteKeyById(currentKeyDbId());
  localStorage.removeItem(STORAGE_KEYPAIR);
}

/**
 * Migra com segurança a chave global usada até a v1.1.3.
 * O quê: preserva uma chave antiga somente quando o servidor confirma que ela pertence à conta atual.
 * Como: compara o hash da chave antiga com os dispositivos do usuário retornados pelo D1; sem correspondência,
 * a chave antiga não é usada nem atribuída automaticamente a outra pessoa.
 * Quando: após consultar `/devices`, antes de criar uma nova chave para o usuário atual.
 */
async function migrateLegacyKeyForCurrentUser(devices = []) {
  const currentId = currentKeyDbId();
  const userId = (authState || loadAuthState())?.user?.id;
  if (!currentId || !userId) return null;
  const current = await readKeyById(currentId);
  if (current?.privateKey && current?.publicKey) return current;
  const legacy = await readKeyById(LEGACY_KEY_DB_ID);
  if (!legacy?.privateKey || !legacy?.publicKeyHash) return null;
  const belongsToCurrentUser = devices.some(device =>
    device.user_id === userId && device.public_key_hash === legacy.publicKeyHash
  );
  if (!belongsToCurrentUser) return null;
  const migrated = { ...legacy, id: currentId, ownerUserId: userId, migratedAt: new Date().toISOString() };
  await withKeyStore('readwrite', store => store.put(migrated));
  await deleteKeyById(LEGACY_KEY_DB_ID);
  return migrated;
}

/**
 * Garante que exista uma chave criptográfica local.
 * Ativação: chamada sempre que o app precisa assinar um hash.
 * O que faz: tenta carregar a chave ECDSA não exportável do IndexedDB; se não existir,
 * cria uma nova. A chave privada não é exportada nem gravada como texto.
 */
async function ensureKeyPair() {
  const stored = await readLocalKeyPair();
  if (stored?.privateKey && stored?.publicKey) return stored;
  return createKeyPair();
}

/**
 * Cria uma nova chave ECDSA P-256 para assinatura local.
 * Ativação: botão 'Gerar chave' ou primeira finalização sem chave existente.
 * O que faz: gera par de chaves, exporta somente a chave pública, reimporta a chave
 * privada como não exportável e salva essa CryptoKey no IndexedDB do dispositivo.
 */
async function createKeyPair() {
  const generated = await crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['sign', 'verify']
  );
  const publicKey = await crypto.subtle.exportKey('jwk', generated.publicKey);
  const privateJwk = await crypto.subtle.exportKey('jwk', generated.privateKey);
  const privateKey = await crypto.subtle.importKey('jwk', privateJwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const publicKeyHash = await sha256Hex(publicKey);
  const stored = {
    id: currentKeyDbId(),
    ownerUserId: (authState || loadAuthState())?.user?.id,
    algorithm: SIGNATURE_ALGORITHM,
    storage: 'IndexedDB CryptoKey não exportável',
    createdAt: new Date().toISOString(),
    publicKey,
    privateKey,
    publicKeyHash
  };
  await writeLocalKeyPair(stored);
  localStorage.removeItem(STORAGE_KEYPAIR); // remove formato antigo exportável, se existir
  updateKeyStatus();
  return stored;
}

/**
 * Importa a chave pública JWK para validação de assinatura.
 * Ativação: chamada por `verifySignature`.
 * O que faz: transforma o JSON da chave pública em objeto criptográfico apto a verificar.
 */
async function importPublicKey(jwk) {
  return crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
}

/**
 * Assina criptograficamente um hash já calculado.
 * Ativação: finalização da PET e geração da prova do PDF.
 * O que faz: carrega/cria chave, assina o hash com ECDSA P-256/SHA-256 e retorna
 * assinatura, chave pública, hash da chave pública, algoritmo e data/hora da assinatura.
 */
async function signPayloadHash(payloadHash) {
  const keyPair = await ensureKeyPair();
  const privateKey = keyPair.privateKey;
  const signatureBytes = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    privateKey,
    new TextEncoder().encode(payloadHash)
  );
  return {
    algorithm: keyPair.algorithm,
    publicKey: keyPair.publicKey,
    publicKeyHash: keyPair.publicKeyHash,
    signatureBase64: bytesToBase64(signatureBytes),
    signedAt: new Date().toISOString()
  };
}

/**
 * Verifica se uma assinatura criptográfica corresponde a um hash.
 * Ativação: tela 'Validar' ao importar um comprovante técnico.
 * O que faz: importa a chave pública do dossiê e usa WebCrypto para confirmar se a
 * assinatura realmente foi feita sobre aquele hash.
 */
async function verifySignature(payloadHash, signature) {
  if (!signature?.publicKey || !signature?.signatureBase64) return false;
  const publicKey = await importPublicKey(signature.publicKey);
  return crypto.subtle.verify(
    { name: 'ECDSA', hash: 'SHA-256' },
    publicKey,
    base64ToBytes(signature.signatureBase64),
    new TextEncoder().encode(payloadHash)
  );
}

