(() => {
  'use strict';

  /**
   * PET Digital NR-33 v1.1.4 — frontend comentado.
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
  const APP_VERSION = '1.1.4';

  // Perfil técnico aceito pelo próprio validador. Esses valores padronizam como o hash
  // é calculado, qual algoritmo assina o registro e como outro validador deve conferir.
  const VALIDATION_PROFILE = 'PET-DIGITAL-NR33-v1';
  const ACCEPTED_VALIDATION_PROFILES = new Set(['PET-DIGITAL-NR33-v1', 'PET-DIGITAL-NR33-PROOF/v1']);
  const PAYLOAD_SCHEMA = 'PET-DIGITAL-NR33/v1.1.4';
  const RECORD_TYPE = 'PET-DIGITAL-DOSSIE/v1';
  const HASH_ALGORITHM = 'SHA-256';
  const SIGNATURE_ALGORITHM = 'ECDSA-P256-SHA256';
  const CANONICALIZATION_ALGORITHM = 'JSON_CANONICAL_STABLE_STRINGIFY_V1';

  // Limiares mínimos para aceitar uma assinatura desenhada no canvas.
  // Evita salvar canvas vazio ou marcas acidentais muito pequenas como assinatura válida.
  const SIGNATURE_MIN_INK_PIXELS = 35;
  const SIGNATURE_MIN_BOUNDS = 8;

  // Bibliotecas usadas apenas quando o usuário pede compartilhamento direto do PDF.
  // O aplicativo continua funcionando sem elas: se o carregamento externo falhar,
  // o sistema mantém o fluxo tradicional de impressão/salvar PDF pelo navegador.
  const PDF_LIBRARIES = {
    html2canvas: 'https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js',
    jsPdf: 'https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js'
  };

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
   * Retorna a data atual no padrão ISO reduzido `AAAA-MM-DD`.
   * Ativação: usada no carregamento do formulário e na validação da calibração.
   * O que faz: aproveita `toISOString()` e corta apenas a parte da data.
   */
  function todayISO() {
    return new Date().toISOString().slice(0, 10);
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
      savedAt: new Date().toISOString()
    }));
  }

  async function readOfficialFiles(record) {
    const id = outputStorageId(record?.recordId);
    if (!id) return null;
    try { return await withOutputStore('readonly', store => store.get(id)); }
    catch { return null; }
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

  /** Carrega a sessão salva localmente. */
  function loadAuthState() {
    try { authState = JSON.parse(sessionStorage.getItem(STORAGE_AUTH) || 'null'); }
    catch { authState = null; }
    return authState;
  }

  /** Salva a sessão ativa localmente. */
  function saveAuthState(state) {
    authState = state || null;
    if (authState) sessionStorage.setItem(STORAGE_AUTH, JSON.stringify(authState));
    else sessionStorage.removeItem(STORAGE_AUTH);
    renderAuthState();
  }

  /** Retorna o token Bearer atual, se houver. */
  function authToken() { return authState?.token || loadAuthState()?.token || ''; }

  /** Chamada padronizada para a API Worker. */
  async function apiFetch(path, options = {}) {
    const headers = new Headers(options.headers || {});
    headers.set('Content-Type', 'application/json');
    const token = authToken();
    if (token) headers.set('Authorization', `Bearer ${token}`);
    const response = await fetch(API_BASE_URL + path, {
      method: options.method || 'GET',
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined,
      cache: 'no-store'
    });
    const text = await response.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
    if (!response.ok || data?.ok === false) {
      throw new Error(data?.error || `Erro HTTP ${response.status}`);
    }
    return data;
  }

  /** Atualiza a interface de login e a liberação da área principal.
   * O quê: controla a tela inicial de credenciais e a área do aplicativo.
   * Como: se não houver sessão válida, mostra apenas a tela de login; se houver sessão,
   * libera cabeçalho, formulário, registros e administração.
   * Quando: na inicialização, após login, logout e validação da sessão pelo Worker.
   */
  function renderAuthState() {
    const loginScreen = $('#loginScreen');
    const appShell = $('#appShell');
    const appTopbar = $('#appTopbar');
    const appFooter = $('#appFooter');
    const status = $('#authStatus');
    const sessionStatus = $('#sessionStatus');
    const apiLabel = $('#apiBaseLabel');
    if (apiLabel) apiLabel.textContent = API_BASE_URL;
    const state = authState || loadAuthState();
    const isLogged = !!state?.user;

    [appShell, appTopbar, appFooter].forEach(el => el?.classList.toggle('hidden', !isLogged));
    loginScreen?.classList.toggle('hidden', isLogged);

    if (status) {
      if (!isLogged) {
        status.className = 'validation-box warn';
        status.textContent = 'Informe matrícula e senha para acessar o PET Digital.';
      } else {
        status.className = 'validation-box ok';
        status.textContent = `Conectado como ${state.user.name} (${state.user.matricula}).`;
      }
    }

    if (sessionStatus) {
      if (!isLogged) {
        sessionStatus.className = 'validation-box warn';
        sessionStatus.textContent = 'Sessão não iniciada.';
      } else {
        sessionStatus.className = 'validation-box ok';
        sessionStatus.textContent = `Usuário conectado: ${state.user.name} (${state.user.matricula}) — perfil: ${state.user.role}.`;
      }
    }

    const canVerify = ['admin', 'gestor', 'verificador'].includes(state?.user?.role);
    const verifyNav = $('[data-tab="verifyTab"]');
    verifyNav?.classList.toggle('hidden', !canVerify);
    const isManager = ['admin', 'gestor'].includes(state?.user?.role);
    $('#userManagementSection')?.classList.toggle('hidden', !isManager);
    $('#teamDevicesSection')?.classList.toggle('hidden', !isManager);
    configureRoleSelects();

    const passwordNotice = $('#passwordChangeNotice');
    if (passwordNotice) {
      passwordNotice.classList.toggle('hidden', !state?.user?.mustChangePassword);
      passwordNotice.textContent = state?.user?.mustChangePassword
        ? 'Sua senha atual é temporária. Altere-a antes de emitir uma PET oficial.'
        : '';
    }

    updateFormAccessStatus();
  }

  /**
   * Atualiza o aviso de acesso na tela de preenchimento.
   * O quê: orienta o usuário sobre o próximo passo antes de emitir a PET oficial.
   * Como: confere se há sessão local e mostra um texto simples, sem expor termos técnicos.
   * Quando: ao abrir o app, fazer login, sair, registrar dispositivo ou trocar de aba.
   */
  function updateFormAccessStatus(message, type = 'warn') {
    const box = $('#formAuthGate');
    if (!box) return;
    const state = authState || loadAuthState();
    if (message) {
      box.className = `validation-box ${type}`;
      box.textContent = message;
      return;
    }
    if (!state?.user) {
      box.className = 'validation-box warn';
      box.textContent = 'Para emitir a PET oficial e gerar PDF/comprovante técnico, faça login na tela inicial.';
      return;
    }
    if (state.user.mustChangePassword) {
      box.className = 'validation-box warn';
      box.textContent = 'Altere a senha temporária na aba Sistema antes de emitir uma PET oficial.';
      return;
    }
    box.className = 'validation-box ok';
    box.textContent = `Usuário conectado: ${state.user.name}. Confirme a situação deste dispositivo na aba Sistema.`;
  }

  /**
   * Confere se a conta e o dispositivo podem emitir documento oficial.
   * O quê: bloqueia finalização/PDF/comprovante sem login e sem dispositivo autorizado.
   * Como: gera ou lê a proteção local do dispositivo, consulta a API e verifica se o status está ativo.
   * Quando: antes de finalizar a PET, gerar PDF, compartilhar PDF ou salvar/compartilhar comprovante técnico.
   */
  async function ensureOfficialAccessOrGuide(actionLabel = 'continuar') {
    const state = authState || loadAuthState();
    if (!state?.user || !authToken()) {
      updateFormAccessStatus(`Faça login para ${actionLabel}.`, 'warn');
      alert(`Faça login para ${actionLabel}.`);
      showTab('systemTab');
      setTimeout(() => $('#loginMatricula')?.focus(), 100);
      return false;
    }

    if (state.user.mustChangePassword) {
      updateFormAccessStatus('Altere a senha temporária antes de continuar.', 'warn');
      alert('Por segurança, altere a senha temporária antes de emitir a PET oficial.');
      showTab('systemTab');
      setTimeout(() => $('#currentPassword')?.focus(), 100);
      return false;
    }

    let devices = [];
    let key;
    try {
      const data = await apiFetch('/devices');
      devices = data.devices || [];
      renderDevicesList(devices);
      await migrateLegacyKeyForCurrentUser(devices);
      key = await ensureKeyPair();
      await updateKeyStatus();
    } catch (err) {
      updateFormAccessStatus('Não foi possível consultar ou preparar este dispositivo para emissão oficial.', 'bad');
      alert('Não foi possível preparar este dispositivo: ' + err.message);
      showTab('systemTab');
      return false;
    }

    const ownMatches = devices.filter(d => d.public_key_hash === key.publicKeyHash && (!d.user_id || d.user_id === state.user.id));
    const active = ownMatches.find(d => d.status === 'active');
    if (active) {
      updateFormAccessStatus('Acesso confirmado. Você pode finalizar a PET oficial e gerar os documentos.', 'ok');
      return true;
    }
    const pending = ownMatches.find(d => d.status === 'pending');
    if (pending) {
      updateFormAccessStatus('Este dispositivo já foi enviado para autorização, mas ainda está pendente de aprovação.', 'warn');
      alert('Este dispositivo ainda está aguardando aprovação. Solicite aprovação a um gestor/admin antes de gerar documento oficial.');
      showTab('systemTab');
      return false;
    }

    updateFormAccessStatus('Este dispositivo ainda não foi autorizado para emissão oficial.', 'warn');
    alert('Antes de gerar documento oficial, autorize este dispositivo na aba Sistema.');
    showTab('systemTab');
    setTimeout(() => $('#registerDeviceBtn')?.focus(), 100);
    return false;
  }

  /**
   * Garante que o documento já foi gerado e registrado como um conjunto único.
   * O quê: impede exportação de arquivo não vinculado ao servidor.
   * Como: exige serverRegistration e os arquivos temporários cujos hashes foram registrados.
   * Quando: antes de abrir, baixar ou compartilhar PDF/comprovante.
   */
  async function ensureRecordReadyForOutput(record, actionLabel = 'gerar documento') {
    if (!record) return false;
    const accessOk = await ensureOfficialAccessOrGuide(actionLabel);
    if (!accessOk) return false;
    if (!record.serverRegistration || !record.output?.pdfHashSha256 || !record.output?.jsonHashSha256) {
      alert('Esta PET ainda não concluiu a geração e o registro dos dois arquivos oficiais. Use “Finalizar PET oficial” para concluir ou repetir o envio pendente.');
      return false;
    }
    const files = await readOfficialFiles(record);
    if (!files?.pdfFile || !files?.jsonText) {
      alert('Os arquivos temporários desta PET não estão mais disponíveis neste dispositivo. Use a via já enviada ao supervisor; não é seguro recriar outro PDF com o mesmo registro.');
      return false;
    }
    return true;
  }

  /** Cria o primeiro admin usando o token de instalação configurado no Worker. */
  async function setupFirstAdmin() {
    const body = {
      token: normalizeText($('#setupToken').value),
      name: normalizeText($('#setupName').value),
      matricula: normalizeText($('#setupMatricula').value),
      email: normalizeText($('#setupEmail').value),
      password: $('#setupPassword').value
    };
    if (!body.token || !body.name || !body.matricula || !body.password) return alert('Informe token, nome, matrícula e senha inicial.');
    const data = await apiFetch('/setup/admin', { method: 'POST', body });
    alert('Primeiro administrador criado. Agora faça login com a matrícula e senha cadastradas.');
    $('#loginMatricula').value = body.matricula;
    $('#setupToken').value = $('#setupPassword').value = '';
    renderAuthState();
    return data;
  }

  /** Faz login no Worker e guarda o token de sessão. */
  async function login() {
    const matricula = normalizeText($('#loginMatricula').value);
    const password = $('#loginPassword').value;
    if (!matricula || !password) return alert('Informe matrícula e senha.');
    const data = await apiFetch('/auth/login', { method: 'POST', body: { matricula, password } });
    saveAuthState({ token: data.token, user: data.user, loggedAt: new Date().toISOString() });
    $('#loginPassword').value = '';
    purgeLegacySharedStorage();
    loadUserWorkspace();
    await refreshDevices(true);
    if (data.user.mustChangePassword) {
      showTab('systemTab');
      updateFormAccessStatus('Altere a senha temporária antes da emissão oficial.', 'warn');
      alert('Login realizado. Antes de emitir uma PET oficial, altere a senha temporária na área Minha conta.');
      setTimeout(() => $('#currentPassword')?.focus(), 100);
    } else {
      showTab('formTab');
      updateFormAccessStatus('Login realizado. Confira a situação deste dispositivo antes da emissão oficial.', 'ok');
    }
  }

  /** Encerra a sessão, elimina dados em memória e impede que a próxima conta veja a área anterior. */
  async function logout() {
    try { if (authToken()) await apiFetch('/auth/logout', { method: 'POST', body: {} }); } catch {}
    clearWorkspaceMemory();
    saveAuthState(null);
    if ($('#devicesList')) $('#devicesList').innerHTML = '';
    if ($('#usersList')) $('#usersList').innerHTML = '';
    const box = $('#deviceRegistrationStatus');
    if (box) {
      box.className = 'validation-box warn';
      box.textContent = 'Entre no sistema para autorizar ou consultar este dispositivo.';
    }
    setTimeout(() => $('#loginMatricula')?.focus(), 100);
  }

  /** Consulta o usuário atual no Worker para confirmar se o token ainda vale. */
  async function refreshMe() {
    if (!authToken()) { renderAuthState(); return; }
    try {
      const data = await apiFetch('/auth/me');
      saveAuthState({ ...authState, user: data.user });
      purgeLegacySharedStorage();
      loadUserWorkspace();
      await refreshDevices(true);
    } catch {
      saveAuthState(null);
    }
  }

  /**
   * O quê: define quais perfis aparecem nos formulários conforme a conta logada.
   * Como: admin recebe os quatro perfis; gestor somente operacional/verificador.
   * Quando: login, atualização da sessão e abertura da administração.
   */
  function configureRoleSelects(selected = {}) {
    const actorRole = (authState || loadAuthState())?.user?.role;
    const roles = actorRole === 'admin'
      ? [['operacional','Operacional'], ['verificador','Verificador'], ['gestor','Gestor'], ['admin','Administrador']]
      : [['operacional','Operacional'], ['verificador','Verificador']];
    [['#newUserRole', selected.newRole], ['#editUserRole', selected.editRole]].forEach(([selector, value]) => {
      const select = $(selector);
      if (!select) return;
      const desired = value || select.value || 'operacional';
      select.innerHTML = roles.map(([v,label]) => `<option value="${v}">${label}</option>`).join('');
      if (roles.some(([v]) => v === desired)) select.value = desired;
    });
  }

  /** Cadastra usuário com senha temporária. */
  async function createUser() {
    const body = {
      name: normalizeText($('#newUserName').value),
      matricula: normalizeText($('#newUserMatricula').value),
      email: normalizeText($('#newUserEmail').value),
      role: $('#newUserRole').value,
      unit: normalizeText($('#newUserUnit').value),
      password: $('#newUserPassword').value
    };
    if (!body.name || !body.matricula || !body.password) return alert('Informe nome, matrícula e senha temporária.');
    await apiFetch('/users', { method: 'POST', body });
    alert('Usuário cadastrado. No primeiro acesso ele deverá trocar a senha temporária.');
    ['#newUserName','#newUserMatricula','#newUserEmail','#newUserUnit','#newUserPassword'].forEach(sel => { const el = $(sel); if (el) el.value = ''; });
    configureRoleSelects({ newRole: 'operacional' });
    await refreshUsers();
  }

  /** Retorna se a conta logada pode administrar o usuário-alvo. */
  function canManageUser(target) {
    const actor = (authState || loadAuthState())?.user;
    if (!actor) return false;
    if (actor.role === 'admin') return true;
    return actor.role === 'gestor' && ['operacional', 'verificador'].includes(target.role);
  }

  /** Traduz perfis e situações para termos amigáveis. */
  function roleLabel(role) { return ({ admin:'Administrador', gestor:'Gestor', verificador:'Verificador', operacional:'Operacional' }[role] || role); }
  function statusLabel(status) { return ({ active:'Ativo', pending:'Pendente', suspended:'Suspenso', disabled:'Acesso excluído/desabilitado' }[status] || status); }

  /** Renderiza usuários e ações permitidas pela hierarquia. */
  function renderUsers(users) {
    const box = $('#usersList');
    if (!box) return;
    box.innerHTML = (users || []).map(u => {
      const manageable = canManageUser(u);
      const isSelf = u.id === (authState || loadAuthState())?.user?.id;
      const actions = manageable ? `<div class="actions no-print">
        <button type="button" class="small secondary" data-user-edit="${escapeAttr(u.id)}">Editar</button>
        ${isSelf ? '<small class="hint">Use “Minha conta” para alterar sua senha.</small>' : `<button type="button" class="small ghost" data-user-reset="${escapeAttr(u.id)}">Redefinir senha</button><button type="button" class="small danger ghost" data-user-delete="${escapeAttr(u.id)}">Excluir acesso</button>`}
      </div>` : '<small class="hint">Somente administrador pode alterar este perfil.</small>';
      return `<div class="record-item user-record" data-user-id="${escapeAttr(u.id)}">
        <div><strong>${escapeHtml(u.name)}</strong><br>Matrícula: ${escapeHtml(u.matricula)} • ${escapeHtml(roleLabel(u.role))} • ${escapeHtml(statusLabel(u.status))}<br><small>${escapeHtml(u.email || 'Sem e-mail')} ${u.unit ? ' • ' + escapeHtml(u.unit) : ''}</small>${u.mustChangePassword ? '<br><small class="status-warning">Senha temporária: troca pendente</small>' : ''}</div>
        ${actions}
      </div>`;
    }).join('') || '<p class="hint">Nenhum usuário encontrado.</p>';
  }

  /** Lista usuários cadastrados. */
  async function refreshUsers() {
    const box = $('#usersList');
    if (!box || !['admin','gestor'].includes((authState || loadAuthState())?.user?.role)) return;
    try {
      const data = await apiFetch('/users');
      box.dataset.users = JSON.stringify(data.users || []);
      renderUsers(data.users || []);
    } catch (err) {
      box.innerHTML = `<div class="validation-box bad">${escapeHtml(err.message)}</div>`;
    }
  }

  /** Recupera da lista renderizada o usuário escolhido. */
  function cachedUser(userId) {
    try { return JSON.parse($('#usersList')?.dataset.users || '[]').find(u => u.id === userId) || null; }
    catch { return null; }
  }

  /** Abre a janela de edição já preenchida. */
  function openEditUser(userId) {
    const user = cachedUser(userId);
    if (!user || !canManageUser(user)) return alert('Você não tem permissão para editar este usuário.');
    $('#editUserId').value = user.id;
    $('#editUserName').value = user.name || '';
    $('#editUserMatricula').value = user.matricula || '';
    $('#editUserEmail').value = user.email || '';
    $('#editUserUnit').value = user.unit || '';
    configureRoleSelects({ editRole: user.role });
    $('#editUserStatus').value = user.status || 'active';
    $('#editUserDialog').showModal();
  }

  /** Envia as alterações cadastrais ao Worker. */
  async function saveUserEdit() {
    const id = $('#editUserId').value;
    const body = {
      name: normalizeText($('#editUserName').value),
      matricula: normalizeText($('#editUserMatricula').value),
      email: normalizeText($('#editUserEmail').value),
      unit: normalizeText($('#editUserUnit').value),
      role: $('#editUserRole').value,
      status: $('#editUserStatus').value
    };
    if (!body.name || !body.matricula) return alert('Nome e matrícula são obrigatórios.');
    const data = await apiFetch(`/users/${encodeURIComponent(id)}`, { method: 'PATCH', body });
    $('#editUserDialog').close();
    if (id === (authState || loadAuthState())?.user?.id) saveAuthState({ ...authState, user: data.user });
    await refreshUsers();
    alert('Cadastro atualizado.');
  }

  /** Abre a janela de redefinição de senha. */
  function openResetPassword(userId) {
    const user = cachedUser(userId);
    if (!user || !canManageUser(user)) return alert('Você não tem permissão para redefinir a senha deste usuário.');
    $('#resetPasswordUserId').value = user.id;
    $('#resetPasswordUserLabel').textContent = `${user.name} — matrícula ${user.matricula}`;
    $('#temporaryPassword').value = $('#temporaryPasswordConfirm').value = '';
    $('#resetPasswordDialog').showModal();
  }

  /** Define senha temporária e encerra sessões antigas. */
  async function confirmResetPassword() {
    const id = $('#resetPasswordUserId').value;
    const password = $('#temporaryPassword').value;
    const confirmation = $('#temporaryPasswordConfirm').value;
    if (password.length < 8) return alert('A senha temporária deve ter pelo menos 8 caracteres.');
    if (password !== confirmation) return alert('As senhas temporárias não coincidem.');
    await apiFetch(`/users/${encodeURIComponent(id)}/reset-password`, { method: 'POST', body: { temporaryPassword: password } });
    $('#resetPasswordDialog').close();
    await refreshUsers();
    alert('Senha redefinida. Informe a senha temporária ao usuário por canal seguro.');
  }

  /** Exclui logicamente o acesso, preservando histórico. */
  async function deleteUser(userId) {
    const user = cachedUser(userId);
    if (!user || !canManageUser(user)) return alert('Você não tem permissão para excluir este acesso.');
    if (!confirm(`Excluir o acesso de ${user.name}? As PETs e a auditoria serão preservadas, mas sessões e dispositivos serão encerrados.`)) return;
    await apiFetch(`/users/${encodeURIComponent(userId)}`, { method: 'DELETE' });
    await refreshUsers();
    await refreshDevices(true);
    alert('Acesso excluído e histórico preservado.');
  }

  /** Altera a senha da própria conta. */
  async function changeOwnPassword() {
    const currentPassword = $('#currentPassword').value;
    const newPassword = $('#newOwnPassword').value;
    const confirmation = $('#confirmOwnPassword').value;
    if (!currentPassword || newPassword.length < 8) return alert('Informe a senha atual e uma nova senha com pelo menos 8 caracteres.');
    if (newPassword !== confirmation) return alert('A confirmação da nova senha não coincide.');
    const data = await apiFetch('/auth/change-password', { method: 'POST', body: { currentPassword, newPassword } });
    saveAuthState({ ...authState, user: data.user });
    $('#currentPassword').value = $('#newOwnPassword').value = $('#confirmOwnPassword').value = '';
    alert('Senha alterada com sucesso.');
  }

  /**
   * O quê: apaga a proteção local sem deixar uma autorização ativa órfã no sistema.
   * Como: consulta o status da chave atual; se estiver active/pending, exige revogação/rejeição prévia.
   * Quando: manutenção avançada, troca planejada de aparelho ou limpeza controlada.
   */
  async function resetLocalDeviceProtection() {
    const key = await readLocalKeyPair();
    if (!key) return alert('Este aparelho não possui proteção local para apagar.');
    if (authToken()) {
      const data = await apiFetch('/devices');
      const state = authState || loadAuthState();
      const linked = (data.devices || []).find(d => d.public_key_hash === key.publicKeyHash && d.user_id === state?.user?.id);
      if (linked && ['active','pending'].includes(linked.status)) {
        alert(linked.status === 'active'
          ? 'Antes de apagar a proteção local, a autorização deste aparelho deve ser revogada por um gestor/admin. Isso evita deixar um dispositivo autorizado sem a chave correspondente.'
          : 'Antes de apagar a proteção local, a solicitação pendente deve ser rejeitada por um gestor/admin.');
        return;
      }
    }
    if (!confirm('Apagar definitivamente a proteção local deste aparelho? Depois será necessário configurar uma nova autorização.')) return;
    await deleteLocalKeyPair();
    await updateKeyStatus();
    await refreshDevices(true);
  }

  /**
   * O quê: prepara a chave local e solicita autorização em um único clique.
   * Como: `ensureKeyPair()` cria a proteção se não existir e a API evita cadastro duplicado.
   * Quando: botão “Configurar e solicitar autorização”.
   */
  async function registerDevice(button) {
    if (!authToken()) return alert('Faça login antes de configurar este dispositivo.');
    if (button) button.disabled = true;
    try {
      const key = await ensureKeyPair();
      const body = {
        deviceLabel: normalizeText($('#deviceLabel').value) || `Dispositivo ${new Date().toLocaleDateString('pt-BR')}`,
        publicKeyJwk: key.publicKey,
        publicKeyHash: key.publicKeyHash,
        algorithm: SIGNATURE_ALGORITHM
      };
      const data = await apiFetch('/devices/register', { method: 'POST', body });
      alert(data.message || (data.device.status === 'active' ? 'Dispositivo autorizado.' : 'Solicitação enviada para aprovação.'));
      await refreshDevices(true);
      await updateKeyStatus();
    } finally {
      if (button) button.disabled = false;
    }
  }

  /** Renderiza somente a área administrativa de dispositivos da equipe. */
  function renderDevicesList(devices) {
    const box = $('#devicesList');
    if (!box) return;
    const actor = (authState || loadAuthState())?.user;
    if (!['admin','gestor'].includes(actor?.role)) { box.innerHTML = ''; return; }
    box.innerHTML = (devices || []).map(d => {
      const status = statusLabel(d.status);
      const primary = d.status === 'pending'
        ? `<button type="button" class="small secondary" data-device-approve="${escapeAttr(d.id)}">Aprovar</button>`
        : ['revoked','lost'].includes(d.status)
          ? `<button type="button" class="small secondary" data-device-approve="${escapeAttr(d.id)}">Reativar</button>`
          : '';
      const revoke = d.status === 'active'
        ? `<button type="button" class="small danger ghost" data-device-revoke="${escapeAttr(d.id)}">Revogar</button>`
        : d.status === 'pending'
          ? `<button type="button" class="small danger ghost" data-device-revoke="${escapeAttr(d.id)}">Rejeitar</button>`
          : '';
      return `<div class="record-item"><div><strong>${escapeHtml(d.device_label)}</strong><br>Usuário: ${escapeHtml(d.user_name || d.user_id || '')} (${escapeHtml(d.user_matricula || '')}) • ${escapeHtml(status)}<details class="advanced-details"><summary>Detalhes técnicos</summary><small class="hash-text">Código do dispositivo: ${escapeHtml(d.public_key_hash)}</small></details></div><div class="actions no-print">${primary}${revoke}</div></div>`;
    }).join('') || '<p class="hint">Nenhum dispositivo cadastrado.</p>';
  }

  /** Consulta a situação do aparelho atual e, para gestores/admins, carrega a fila da equipe. */
  async function refreshDevices(silent = false) {
    const box = $('#devicesList');
    try {
      const data = await apiFetch('/devices');
      renderDevicesList(data.devices || []);
      await migrateLegacyKeyForCurrentUser(data.devices || []);
      const key = await readLocalKeyPair();
      const state = authState || loadAuthState();
      const mine = key ? (data.devices || []).filter(d => d.public_key_hash === key.publicKeyHash && d.user_id === state?.user?.id) : [];
      const active = mine.find(d => d.status === 'active');
      const pending = mine.find(d => d.status === 'pending');
      const revoked = mine.find(d => ['revoked','lost'].includes(d.status));
      const deviceBox = $('#deviceRegistrationStatus');
      const button = $('#registerDeviceBtn');
      if (deviceBox && state?.user) {
        if (!key) {
          deviceBox.className = 'validation-box warn';
          deviceBox.textContent = 'Este aparelho ainda não foi configurado. Clique no botão abaixo; a preparação e a solicitação serão feitas automaticamente.';
          if (button) { button.disabled = false; button.textContent = 'Configurar e solicitar autorização'; }
        } else if (active) {
          deviceBox.className = 'validation-box ok';
          deviceBox.textContent = 'Este dispositivo está autorizado. Não há outra etapa necessária.';
          if (button) { button.disabled = true; button.textContent = 'Dispositivo autorizado'; }
          if (!state.user.mustChangePassword) updateFormAccessStatus('Acesso confirmado. Você pode finalizar a PET oficial e gerar os documentos.', 'ok');
        } else if (pending) {
          deviceBox.className = 'validation-box warn';
          deviceBox.textContent = 'Solicitação enviada. Agora basta um gestor/admin clicar em Aprovar; o usuário não precisa repetir nenhuma ação.';
          if (button) { button.disabled = true; button.textContent = 'Aguardando aprovação'; }
          updateFormAccessStatus('Este dispositivo ainda aguarda aprovação para emissão oficial.', 'warn');
        } else if (revoked) {
          deviceBox.className = 'validation-box bad';
          deviceBox.textContent = 'A autorização deste aparelho foi revogada. Solicite a reativação a um gestor/admin; não faça novo cadastro.';
          if (button) { button.disabled = true; button.textContent = 'Autorização revogada'; }
        } else {
          deviceBox.className = 'validation-box warn';
          deviceBox.textContent = 'A proteção local existe, mas ainda não foi enviada ao sistema. Clique no botão abaixo uma única vez.';
          if (button) { button.disabled = false; button.textContent = 'Enviar solicitação de autorização'; }
        }
      }
      await updateKeyStatus();
    } catch (err) {
      if (!silent && box) box.innerHTML = `<div class="validation-box bad">${escapeHtml(err.message)}</div>`;
    }
  }

  /** Aprova, reativa, rejeita ou revoga e atualiza a lista imediatamente. */
  async function changeDeviceStatus(id, action, button) {
    if (button) button.disabled = true;
    try {
      const data = await apiFetch(`/devices/${encodeURIComponent(id)}/${action}`, { method: 'POST', body: {} });
      await refreshDevices();
      alert(data.message || 'Situação do dispositivo atualizada.');
    } finally {
      if (button) button.disabled = false;
    }
  }

  /** Mostra status de sincronização/registro no servidor. */
  function renderServerPanel(message, type = 'warn') {
    const panel = $('#serverPanel');
    if (!panel) return;
    panel.classList.remove('hidden');
    panel.className = `integrity-panel validation-box ${type}`;
    panel.textContent = message;
  }

  /** Consulta um código técnico já registrado no sistema. */
  async function validateHashOnServer(hash) {
    const payloadHash = normalizeText(hash || $('#serverHashInput').value).toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(payloadHash)) return alert('Informe um código técnico válido com 64 caracteres.');
    const result = $('#serverValidateResult');
    try {
      const data = await apiFetch('/validate', { method: 'POST', body: { payloadHash } });
      result.className = 'validation-box ' + (data.found ? 'ok' : 'warn');
      result.textContent = data.found ? `Comprovante encontrado no sistema. Nº PET: ${data.record.numero_pet}. Recebido em: ${formatDateTime(data.record.server_received_at)}. Status: ${data.record.status}.` : 'Comprovante não encontrado no sistema.';
    } catch (err) {
      result.className = 'validation-box bad';
      result.textContent = err.message;
    }
  }

  /**
   * Lê uma foto selecionada/capturada e gera uma imagem JPEG compactada em Data URL.
   * Ativação: evento `change` do campo de foto de cada profissional.
   * O que faz: lê o arquivo, carrega em imagem, redimensiona em canvas e devolve uma
   * string `data:image/jpeg;base64,...` para salvar no dossiê e imprimir no PDF.
   */
  async function fileToCompressedDataUrl(file, maxWidth = 640, quality = 0.78) {
    if (!file || !file.type?.startsWith('image/')) throw new Error('Selecione uma imagem válida.');
    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error('Não foi possível ler a imagem.'));
      reader.readAsDataURL(file);
    });
    const img = await new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('Não foi possível carregar a imagem.'));
      image.src = dataUrl;
    });
    const ratio = Math.min(1, maxWidth / Math.max(img.width, img.height));
    const width = Math.max(1, Math.round(img.width * ratio));
    const height = Math.max(1, Math.round(img.height * ratio));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, width, height);
    return canvas.toDataURL('image/jpeg', quality);
  }

  /**
   * Mede se o canvas de assinatura possui tinta suficiente para ser considerado assinado.
   * Ativação: botão 'Registrar assinatura'.
   * O que faz: percorre os pixels do canvas, conta pixels não transparentes/escuros e calcula
   * a área ocupada. Isso impede que um canvas vazio seja salvo como assinatura válida.
   */
  function getSignatureCanvasMetrics(canvas) {
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const { width, height } = canvas;
    const data = ctx.getImageData(0, 0, width, height).data;
    let inkPixels = 0;
    let minX = width;
    let minY = height;
    let maxX = -1;
    let maxY = -1;

    for (let i = 0; i < data.length; i += 4) {
      const alpha = data[i + 3];
      if (alpha <= 16) continue;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      if (r > 245 && g > 245 && b > 245) continue;
      const pixel = i / 4;
      const x = pixel % width;
      const y = Math.floor(pixel / width);
      inkPixels++;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }

    const boundsWidth = maxX >= minX ? maxX - minX + 1 : 0;
    const boundsHeight = maxY >= minY ? maxY - minY + 1 : 0;
    const isSigned = inkPixels >= SIGNATURE_MIN_INK_PIXELS && (boundsWidth >= SIGNATURE_MIN_BOUNDS || boundsHeight >= SIGNATURE_MIN_BOUNDS);
    return { isSigned, inkPixels, boundsWidth, boundsHeight };
  }

  /**
   * Limpa os dados de assinatura de um profissional e atualiza a interface do cartão.
   * Ativação: assinatura vazia, botão 'Limpar assinatura' e correção de assinaturas inválidas.
   * O que faz: remove imagem, hash, data/hora e métricas da assinatura para impedir que
   * assinatura vazia ou incompleta avance para o dossiê.
   */
  function clearPersonSignature(person, card) {
    Object.assign(person, {
      signatureDataUrl: '',
      signedAt: '',
      signatureHash: '',
      signatureMetrics: null,
      _dirtySignature: false
    });
    if (card) {
      const canvas = $('.signature-pad', card);
      if (canvas) canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
      const status = $('.sig-status', card);
      if (status) status.textContent = 'Pendente de assinatura';
    }
  }

  /**
   * Obtém o IP público no momento da geração do PDF.
   * Ativação: botão 'Gerar PDF oficial', dentro de `buildPdfGenerationProof`.
   * O que faz: tenta primeiro o endpoint Cloudflare `/cdn-cgi/trace`; se falhar, tenta
   * `api.ipify.org`; se ambos falharem, registra o erro no dossiê sem travar a impressão.
   */
  async function getPublicIpInfo() {
    const attempts = [
      async () => {
        const response = await fetch('/cdn-cgi/trace', { cache: 'no-store' });
        if (!response.ok) throw new Error('Cloudflare trace indisponível.');
        const text = await response.text();
        const map = Object.fromEntries(text.trim().split('\n').map(line => line.split('=')));
        if (!map.ip) throw new Error('IP não retornado pelo Cloudflare trace.');
        return { ip: map.ip, source: 'cloudflare-cdn-cgi-trace', raw: map };
      },
      async () => {
        const response = await fetch('https://api.ipify.org?format=json', { cache: 'no-store' });
        if (!response.ok) throw new Error('IPify indisponível.');
        const json = await response.json();
        if (!json.ip) throw new Error('IP não retornado pelo IPify.');
        return { ip: json.ip, source: 'api.ipify.org' };
      }
    ];
    const errors = [];
    for (const attempt of attempts) {
      try { return await attempt(); }
      catch (err) { errors.push(err.message); }
    }
    return { ip: '', source: '', error: errors.join(' | ') || 'IP não obtido.' };
  }

  /**
   * Solicita a geolocalização do navegador/dispositivo.
   * Ativação: botão 'Gerar PDF oficial', dentro de `buildPdfGenerationProof`.
   * O que faz: usa `navigator.geolocation.getCurrentPosition` com alta precisão, registra
   * latitude, longitude, acurácia e timestamp, ou salva o motivo da indisponibilidade.
   */
  function getGeolocationInfo() {
    return new Promise(resolve => {
      if (!navigator.geolocation) {
        resolve({ available: false, error: 'Geolocalização não suportada pelo navegador.' });
        return;
      }
      navigator.geolocation.getCurrentPosition(
        position => resolve({
          available: true,
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracyMeters: position.coords.accuracy,
          altitude: position.coords.altitude,
          altitudeAccuracy: position.coords.altitudeAccuracy,
          heading: position.coords.heading,
          speed: position.coords.speed,
          capturedAt: new Date(position.timestamp).toISOString()
        }),
        error => resolve({ available: false, error: error.message || 'Geolocalização não autorizada/indisponível.' }),
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
      );
    });
  }

  /**
   * Prepara a prova de geração do PDF para recálculo de hash.
   * Ativação: criação da prova e validação posterior do JSON.
   * O que faz: clona a prova e remove os campos que só existem depois do hash/assinatura,
   * evitando cálculo circular.
   */
  function proofHashInput(proof) {
    const clone = { ...proof };
    delete clone.pdfProofHashSha256;
    delete clone.cryptographicSignature;
    return clone;
  }

  /**
   * Descreve formalmente o padrão de validação usado pelo dossiê.
   * Ativação: montagem do payload da PET e da prova de geração do PDF.
   * O que faz: registra no próprio JSON quais algoritmos e regras de normalização foram
   * usados. Esses metadados entram no payload assinado, facilitando validação externa.
   */
  function buildProofStandard(scope) {
    return {
      validationProfile: VALIDATION_PROFILE,
      scope,
      appVersion: APP_VERSION,
      payloadSchema: PAYLOAD_SCHEMA,
      canonicalizationAlgorithm: CANONICALIZATION_ALGORITHM,
      hashAlgorithm: HASH_ALGORITHM,
      signatureAlgorithm: SIGNATURE_ALGORITHM,
      hashEncoding: 'hexadecimal-lowercase',
      signatureEncoding: 'base64',
      publicKeyFormat: 'JWK',
      photoEncoding: 'data-url-base64-jpeg',
      signatureImageEncoding: 'data-url-base64-png',
      validationSummary: [
        'Recalcular o hash do payload usando JSON canônico estável.',
        'Recalcular os hashes dos bytes reais do PDF e do arquivo JSON.',
        'Consultar o registro exato no servidor pelo número, hashes, emissor e dispositivo.',
        'Verificar as assinaturas ECDSA com a chave pública autorizada no servidor na emissão.'
      ]
    };
  }

  /**
   * Confere se o dossiê usa o padrão técnico que este validador aceita.
   * Ativação: importação de JSON na aba Validar.
   * O que faz: não confia cegamente no algoritmo escrito no arquivo; apenas aceita o
   * conjunto de algoritmos codificado nesta aplicação.
   */
  function validateSupportedProofStandard(standard, contextLabel = 'payload') {
    const warnings = [];
    const errors = [];
    if (!standard) {
      warnings.push(`${contextLabel}: padrão de validação não declarado; tentando validar pelo padrão atual.`);
      return { errors, warnings };
    }
    if (!ACCEPTED_VALIDATION_PROFILES.has(standard.validationProfile)) errors.push(`${contextLabel}: perfil de validação incompatível.`);
    if (standard.canonicalizationAlgorithm !== CANONICALIZATION_ALGORITHM) errors.push(`${contextLabel}: regra de JSON canônico incompatível.`);
    if (standard.hashAlgorithm !== HASH_ALGORITHM) errors.push(`${contextLabel}: algoritmo de hash incompatível.`);
    if (standard.signatureAlgorithm !== SIGNATURE_ALGORITHM) errors.push(`${contextLabel}: algoritmo de assinatura incompatível.`);
    return { errors, warnings };
  }

  /**
   * Monta a prova de geração do PDF.
   * Ativação: clique no botão 'Gerar PDF oficial'.
   * O que faz: coleta data/hora local e ISO, fuso, IP, geolocalização e userAgent; calcula
   * hash próprio da prova e assina esse hash com a chave criptográfica local.
   */
  async function buildPdfGenerationProof(record) {
    const generatedAt = new Date();
    const [ipInfo, geoInfo] = await Promise.all([getPublicIpInfo(), getGeolocationInfo()]);
    const proof = {
      type: 'PDF-GENERATION-PROOF/v1',
      validationProfile: VALIDATION_PROFILE,
      appVersion: APP_VERSION,
      canonicalizationAlgorithm: CANONICALIZATION_ALGORITHM,
      hashAlgorithm: HASH_ALGORITHM,
      signatureAlgorithm: SIGNATURE_ALGORITHM,
      proofStandard: buildProofStandard('PDF_GENERATION_PROOF'),
      recordId: record.recordId,
      petNumero: record.payload?.fields?.petNumero || '',
      payloadHashSha256: record.integrity?.payloadHashSha256 || '',
      generatedAt: generatedAt.toISOString(),
      generatedAtLocal: generatedAt.toLocaleString('pt-BR'),
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || '',
      timezoneOffsetMinutes: generatedAt.getTimezoneOffset(),
      publicIp: ipInfo.ip || '',
      publicIpSource: ipInfo.source || '',
      publicIpError: ipInfo.error || '',
      geolocation: geoInfo,
      userAgent: navigator.userAgent
    };
    proof.pdfProofHashSha256 = await sha256Hex(proofHashInput(proof));
    proof.cryptographicSignature = await signPayloadHash(proof.pdfProofHashSha256);
    return proof;
  }

  /**
   * Recupera a prova de PDF mais recente de um registro.
   * Ativação: painéis de integridade, impressão e validação visual.
   * O que faz: acessa o array `pdfGenerationProofs` e retorna o último item, se existir.
   */
  function latestPdfProof(record) {
    const proofs = record?.integrity?.pdfGenerationProofs || [];
    return proofs.length ? proofs[proofs.length - 1] : null;
  }

  /**
   * Renderiza o checklist e um campo de justificativa para cada resposta N/A.
   * O campo fica oculto até N/A ser escolhido; itens críticos não permitem N/A.
   */
  function renderChecklist() {
    const tbody = $('#checklistTable tbody');
    tbody.innerHTML = checklistItems.map((item, index) => {
      const n = String(index + 1).padStart(2, '0');
      const naDisabled = NA_FORBIDDEN_ITEMS.has(n);
      return `<tr data-check-row="${n}">
        <td>${n}</td>
        <td>${escapeHtml(item)}${naDisabled ? '<br><small class="critical-note">Item crítico: N/A não permitido.</small>' : ''}</td>
        <td><input required type="radio" name="check_${n}" value="S" aria-label="${n} Sim" /></td>
        <td><input required type="radio" name="check_${n}" value="N" aria-label="${n} Não" /></td>
        <td><input required type="radio" name="check_${n}" value="NA" aria-label="${n} Não se aplica" ${naDisabled ? 'disabled' : ''} /></td>
      </tr>
      <tr class="na-justification-row hidden" data-na-row="${n}">
        <td></td><td colspan="4"><label>Justificativa do N/A — item ${n}
          <input name="check_${n}_justification" minlength="10" maxlength="300" placeholder="Explique objetivamente por que o item não se aplica" />
        </label></td>
      </tr>`;
    }).join('');
  }

  /** Mostra/oculta a justificativa do N/A conforme a resposta selecionada. */
  function updateNaJustificationVisibility(number) {
    const selected = $(`input[name="check_${number}"]:checked`);
    const row = $(`[data-na-row="${number}"]`);
    const input = $(`[name="check_${number}_justification"]`);
    const active = selected?.value === 'NA';
    row?.classList.toggle('hidden', !active);
    if (input) { input.required = active; if (!active) input.value = ''; }
  }

  /**
   * Cria o objeto interno de um profissional.
   * Ativação: inicialização da equipe e botões 'Adicionar entrante/vigia'.
   * O que faz: gera ID único, define papel/tipo, marca se é obrigatório e inicializa
   * campos de nome, matrícula, foto, assinatura e respectivos hashes.
   */
  function createPerson(type, required = false) {
    const baseRole = type === 'supervisor' ? 'Supervisor de Entrada' : type === 'vigia' ? 'Vigia' : 'Entrante';
    return {
      id: crypto.randomUUID ? crypto.randomUUID() : 'p-' + Date.now() + '-' + Math.random().toString(16).slice(2),
      role: required && type === 'supervisor' ? baseRole : `${baseRole} - 1`,
      type,
      required,
      nome: '',
      matricula: '',
      signatureDataUrl: '',
      signedAt: '',
      signatureHash: '',
      signatureMetrics: null,
      photoDataUrl: '',
      photoCapturedAt: '',
      photoHash: ''
    };
  }

  /**
   * Reinicia a lista de profissionais para o mínimo obrigatório.
   * Ativação: abertura inicial e botão 'Limpar formulário'.
   * O que faz: cria 1 entrante, 1 vigia e 1 supervisor, depois reindexa os rótulos.
   */
  function resetPeople() {
    people = initialPeople.map(p => createPerson(p.type, p.required));
    reindexPeople();
  }

  /**
   * Recalcula a numeração visual de entrantes e vigias.
   * Ativação: após adicionar, remover, restaurar rascunho ou reiniciar pessoas.
   * O que faz: renumera Entrante - 1, Entrante - 2, Vigia - 1 etc., mantendo o supervisor
   * com o nome fixo 'Supervisor de Entrada'.
   */
  function reindexPeople() {
    let entrante = 0;
    let vigia = 0;
    people.forEach(p => {
      if (p.type === 'entrante') p.role = `Entrante - ${++entrante}`;
      if (p.type === 'vigia') p.role = `Vigia - ${++vigia}`;
      if (p.type === 'supervisor') p.role = 'Supervisor de Entrada';
    });
  }

  /**
   * Adiciona novo entrante ou vigia à PET.
   * Ativação: botões 'Adicionar entrante' e 'Adicionar vigia'.
   * O que faz: sincroniza inputs atuais, cria o profissional, insere na posição correta
   * da lista, reindexa, redesenha a tela e salva rascunho automaticamente.
   */
  function addProfessional(type) {
    syncPeopleFromInputs();
    const person = createPerson(type, false);
    if (type === 'entrante') {
      const firstNonEntrante = people.findIndex(p => p.type !== 'entrante');
      people.splice(firstNonEntrante === -1 ? people.length : firstNonEntrante, 0, person);
    } else if (type === 'vigia') {
      const supervisorIndex = people.findIndex(p => p.type === 'supervisor');
      people.splice(supervisorIndex === -1 ? people.length : supervisorIndex, 0, person);
    }
    reindexPeople();
    renderPeople();
    markFinalizedRecordStale();
    autoSaveDraft();
  }

  /**
   * Renderiza os cartões de profissionais, fotos e assinaturas.
   * Ativação: inicialização, restauração de rascunho, adição/remoção de pessoas.
   * O que faz: monta o HTML de cada pessoa, exibe foto/status, cria canvas de assinatura
   * e recarrega a assinatura já salva quando existir.
   */
  function renderPeople() {
    const list = $('#peopleList');
    list.innerHTML = '';
    people.forEach(person => {
      const div = document.createElement('div');
      div.className = 'person-card';
      div.dataset.personId = person.id;
      div.innerHTML = `
        <div class="person-head">
          <span class="person-role">${escapeHtml(person.role)} <span title="Obrigatório">*</span></span>
          ${!person.required && ['entrante', 'vigia'].includes(person.type) ? '<button type="button" class="small danger ghost remove-person">Remover</button>' : ''}
        </div>
        <div class="grid cols-2">
          <label>Nome completo
            <input data-field="nome" required value="${escapeAttr(person.nome)}" />
          </label>
          <label>Matrícula
            <input data-field="matricula" required value="${escapeAttr(person.matricula)}" />
          </label>
        </div>
        <div class="auth-grid">
          <div class="photo-box">
            <strong>Foto do servidor</strong>
            <p class="photo-note">A foto deve mostrar o rosto do servidor com o crachá funcional visível.</p>
            <div class="photo-preview">${person.photoDataUrl ? `<img src="${person.photoDataUrl}" alt="Foto de ${escapeAttr(person.nome || person.role)}" />` : '<span>Sem foto</span>'}</div>
            <label class="photo-input-label no-print">Capturar/selecionar foto
              <input class="person-photo-input" type="file" accept="image/*" capture="user" />
            </label>
            <div class="signature-actions no-print">
              <button type="button" class="small ghost clear-photo">Limpar foto</button>
              <span class="photo-status">${person.photoCapturedAt ? 'Capturada em ' + formatDateTime(person.photoCapturedAt) : 'Pendente de foto'}</span>
            </div>
          </div>
          <div class="signature-box">
            <strong>Assinatura</strong>
            <canvas class="signature-pad" width="900" height="220"></canvas>
            <div class="signature-actions no-print">
              <button type="button" class="small secondary save-signature">Registrar assinatura</button>
              <button type="button" class="small ghost clear-signature">Limpar assinatura</button>
              <span class="sig-status">${person.signatureDataUrl ? 'Assinada em ' + formatDateTime(person.signedAt) : 'Pendente de assinatura'}</span>
            </div>
          </div>
        </div>`;
      list.appendChild(div);
      const canvas = $('.signature-pad', div);
      setupCanvas(canvas, person);
      if (person.signatureDataUrl) {
        const img = new Image();
        img.onload = () => {
          const ctx = canvas.getContext('2d');
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        };
        img.src = person.signatureDataUrl;
      }
    });
  }

  /**
   * Configura o canvas usado para assinatura manuscrita.
   * Ativação: chamada por `renderPeople` para cada cartão de profissional.
   * O que faz: define estilo do traço e registra eventos de mouse/toque para desenhar
   * a assinatura; marca a assinatura como alterada quando houver novo traço.
   */
  function setupCanvas(canvas, person) {
    const ctx = canvas.getContext('2d');
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#111';
    let drawing = false;
    let drawn = false;

    // Calcula a posição do mouse/toque dentro do canvas, corrigindo escala visual x escala real.
    function pos(event) {
      const rect = canvas.getBoundingClientRect();
      const source = event.touches ? event.touches[0] : event;
      return {
        x: (source.clientX - rect.left) * (canvas.width / rect.width),
        y: (source.clientY - rect.top) * (canvas.height / rect.height)
      };
    }
    // Inicia um novo traço da assinatura quando o usuário toca/clica no canvas.
    function start(event) {
      event.preventDefault();
      drawing = true;
      const p = pos(event);
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
    }
    // Continua o traço enquanto o usuário arrasta o dedo/mouse.
    function move(event) {
      if (!drawing) return;
      event.preventDefault();
      const p = pos(event);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
      drawn = true;
    }
    // Encerra o traço e marca a assinatura como alterada para exigir novo registro.
    function end(event) {
      if (!drawing) return;
      event.preventDefault();
      drawing = false;
      if (drawn) person._dirtySignature = true;
    }
    canvas.addEventListener('mousedown', start);
    canvas.addEventListener('mousemove', move);
    canvas.addEventListener('mouseup', end);
    canvas.addEventListener('mouseleave', end);
    canvas.addEventListener('touchstart', start, { passive: false });
    canvas.addEventListener('touchmove', move, { passive: false });
    canvas.addEventListener('touchend', end, { passive: false });
  }

  /**
   * Invalida a PET finalizada quando o formulário é alterado depois da assinatura.
   * Ativação: edição de campos, foto, assinatura ou inclusão/remoção de profissionais.
   * O que faz: desabilita PDF/comprovante técnico da finalização anterior para evitar que o usuário
   * compartilhe um dossiê antigo após ter modificado dados na tela.
   */
  function markFinalizedRecordStale() {
    if (!finalizedRecord) return;
    finalizedRecord = null;
    const finalizeButton = $('#finalizeBtn');
    if (finalizeButton) { finalizeButton.disabled = false; finalizeButton.textContent = 'Finalizar PET oficial'; }
    ['#registerServerBtn', '#printBtn', '#sharePdfBtn', '#exportBtn', '#shareJsonBtn'].forEach(selector => {
      const btn = $(selector);
      if (btn) btn.disabled = true;
    });
    const panel = $('#integrityPanel');
    if (panel) panel.classList.add('hidden');
    const area = $('#printArea');
    if (area) {
      area.classList.add('hidden');
      area.innerHTML = '';
    }
    const serverPanel = $('#serverPanel');
    if (serverPanel) serverPanel.classList.add('hidden');
    const box = $('#validationBox');
    if (box) {
      box.className = 'validation-box warn';
      box.textContent = 'O formulário foi alterado após a última finalização. Valide e finalize novamente para gerar PDF/comprovante técnico atualizados.';
    }
  }

  /**
   * Centraliza a amarração de todos os eventos da interface.
   * Ativação: uma vez durante `init()`, depois que o DOM e os componentes dinâmicos existem.
   * O que faz: liga botões, abas, uploads de foto, assinatura, validação, finalização,
   * impressão, exportação, tela de registros, validação de JSON e autosave.
   */
  function bindEvents() {
    // Navegação superior: cada botão com `data-tab` abre a seção correspondente.
    $$('[data-tab]').forEach(button => {
      button.addEventListener('click', () => showTab(button.dataset.tab));
    });

    // Alterações de nome/matrícula nos cartões de profissionais atualizam o estado em memória.
    $('#peopleList').addEventListener('input', event => {
      const card = event.target.closest('.person-card');
      if (!card || !event.target.dataset.field) return;
      const person = people.find(p => p.id === card.dataset.personId);
      if (person) person[event.target.dataset.field] = event.target.value;
      markFinalizedRecordStale();
      autoSaveDraft();
    });

    // Upload/captura de foto: comprime imagem, registra data/hora, calcula hash e atualiza preview.
    $('#peopleList').addEventListener('change', async event => {
      if (!event.target.classList.contains('person-photo-input')) return;
      const card = event.target.closest('.person-card');
      const person = people.find(p => p.id === card?.dataset.personId);
      const file = event.target.files?.[0];
      if (!person || !file) return;
      try {
        const dataUrl = await fileToCompressedDataUrl(file);
        person.photoDataUrl = dataUrl;
        person.photoCapturedAt = new Date().toISOString();
        person.photoHash = await sha256Hex(dataUrl);
        const preview = $('.photo-preview', card);
        preview.innerHTML = `<img src="${dataUrl}" alt="Foto de ${escapeAttr(person.nome || person.role)}" />`;
        $('.photo-status', card).textContent = `Capturada em ${formatDateTime(person.photoCapturedAt)}`;
        markFinalizedRecordStale();
        autoSaveDraft();
      } catch (err) {
        alert('Não foi possível registrar a foto: ' + err.message);
      } finally {
        event.target.value = '';
      }
    });

    // Botões dentro dos cartões: registrar/limpar assinatura, limpar foto e remover profissional.
    $('#peopleList').addEventListener('click', async event => {
      const card = event.target.closest('.person-card');
      if (!card) return;
      const person = people.find(p => p.id === card.dataset.personId);
      if (!person) return;
      if (event.target.classList.contains('save-signature')) {
        const canvas = $('.signature-pad', card);
        const metrics = getSignatureCanvasMetrics(canvas);
        if (!metrics.isSigned) {
          clearPersonSignature(person, card);
          markFinalizedRecordStale();
          autoSaveDraft();
          alert(`${person.role}: desenhe a assinatura antes de registrar. O canvas vazio não será aceito.`);
          return;
        }
        person.signatureDataUrl = canvas.toDataURL('image/png');
        person.signedAt = new Date().toISOString();
        person.signatureHash = await sha256Hex(person.signatureDataUrl);
        person.signatureMetrics = metrics;
        person._dirtySignature = false;
        $('.sig-status', card).textContent = `Assinada em ${formatDateTime(person.signedAt)}`;
        markFinalizedRecordStale();
        autoSaveDraft();
      }
      if (event.target.classList.contains('clear-signature')) {
        clearPersonSignature(person, card);
        markFinalizedRecordStale();
        autoSaveDraft();
      }
      if (event.target.classList.contains('clear-photo')) {
        Object.assign(person, { photoDataUrl: '', photoCapturedAt: '', photoHash: '' });
        $('.photo-preview', card).innerHTML = '<span>Sem foto</span>';
        $('.photo-status', card).textContent = 'Pendente de foto';
        markFinalizedRecordStale();
        autoSaveDraft();
      }
      if (event.target.classList.contains('remove-person')) {
        people = people.filter(p => p.id !== person.id);
        reindexPeople();
        renderPeople();
        markFinalizedRecordStale();
        autoSaveDraft();
      }
    });

    // N/A exige justificativa e é limitado a itens não críticos.
    $('#checklistTable').addEventListener('change', event => {
      const match = event.target.name?.match(/^check_(\d{2})$/);
      if (match) updateNaJustificationVisibility(match[1]);
    });

    // Botões principais do formulário e ações de rascunho/finalização/exportação.
    $('#addEntrante').addEventListener('click', () => addProfessional('entrante'));
    $('#addVigia').addEventListener('click', () => addProfessional('vigia'));
    $('#saveDraft').addEventListener('click', () => { saveDraft(); alert('Rascunho salvo neste dispositivo.'); });
    $('#clearDraft').addEventListener('click', () => {
      if (!confirm('Deseja limpar o formulário e apagar o rascunho local?')) return;
      const draftKey = currentDraftKey();
      if (draftKey) localStorage.removeItem(draftKey);
      finalizedRecord = null;
      $('#petForm').reset();
      checklistItems.forEach((_, idx) => updateNaJustificationVisibility(String(idx + 1).padStart(2, '0')));
      setDefaultDateTime();
      resetPeople();
      renderPeople();
      $('#validationBox').className = 'validation-box';
      $('#validationBox').textContent = 'Preencha o formulário e clique em “Validar”. Para finalizar e gerar os documentos oficiais, é necessário estar logado e com o dispositivo autorizado.';
      $('#integrityPanel').classList.add('hidden');
      $('#finalizeBtn').disabled = false;
      $('#finalizeBtn').textContent = 'Finalizar PET oficial';
      $('#registerServerBtn').disabled = true;
      $('#registerServerBtn').classList.add('hidden');
      $('#printBtn').disabled = true;
      $('#sharePdfBtn').disabled = true;
      $('#exportBtn').disabled = true;
      $('#shareJsonBtn').disabled = true;
    });

    $('#validateBtn').addEventListener('click', () => {
      const result = validateCurrentForm();
      showValidation(result);
    });

    $('#finalizeBtn').addEventListener('click', finalizeRecord);
    $('#registerServerBtn').addEventListener('click', event => retryPendingRecordRegistration(finalizedRecord, event.currentTarget));
    $('#printBtn').addEventListener('click', event => openOfficialPdf(finalizedRecord, event.currentTarget));
    $('#sharePdfBtn').addEventListener('click', event => sharePdfRecord(finalizedRecord, event.currentTarget));
    $('#exportBtn').addEventListener('click', async () => {
      if (!finalizedRecord) return;
      const ready = await ensureRecordReadyForOutput(finalizedRecord, 'salvar o comprovante técnico');
      if (!ready) return;
      const files = await readOfficialFiles(finalizedRecord);
      if (files?.jsonText) downloadBlob(new Blob([files.jsonText], { type: 'application/json' }), files.jsonFilename || jsonFilename(finalizedRecord));
    });
    $('#shareJsonBtn').addEventListener('click', event => shareJsonRecord(finalizedRecord, event.currentTarget));

    // Eventos das abas auxiliares: histórico local, validador de JSON e gerenciamento da chave.
    $('#refreshRecords').addEventListener('click', renderRecords);
    $('#verifyFilesBtn').addEventListener('click', () => verifyFiles());
    $('#exportPublicKey').addEventListener('click', exportPublicKey);
    $('#resetKey').addEventListener('click', () => resetLocalDeviceProtection().catch(err => alert('Não foi possível apagar a proteção local: ' + err.message)));

    // Eventos da aba Sistema: login, primeiro admin, usuários, dispositivos e validação no D1.
    $('#setupAdminBtn')?.addEventListener('click', () => setupFirstAdmin().catch(err => alert('Erro ao criar admin: ' + err.message)));
    $('#loginBtn')?.addEventListener('click', () => login().catch(err => alert('Erro no login: ' + err.message)));
    $('#logoutBtn')?.addEventListener('click', () => logout());
    $('#createUserBtn')?.addEventListener('click', () => createUser().catch(err => alert('Erro ao cadastrar usuário: ' + err.message)));
    $('#refreshUsersBtn')?.addEventListener('click', () => refreshUsers());
    $('#changeOwnPasswordBtn')?.addEventListener('click', () => changeOwnPassword().catch(err => alert('Erro ao alterar senha: ' + err.message)));
    $('#saveUserEditBtn')?.addEventListener('click', () => saveUserEdit().catch(err => alert('Erro ao atualizar usuário: ' + err.message)));
    $('#confirmResetPasswordBtn')?.addEventListener('click', () => confirmResetPassword().catch(err => alert('Erro ao redefinir senha: ' + err.message)));
    $$('[data-close-dialog]').forEach(btn => btn.addEventListener('click', () => $('#' + btn.dataset.closeDialog)?.close()));
    $('#usersList')?.addEventListener('click', event => {
      const editId = event.target.dataset.userEdit;
      const resetId = event.target.dataset.userReset;
      const deleteId = event.target.dataset.userDelete;
      if (editId) openEditUser(editId);
      if (resetId) openResetPassword(resetId);
      if (deleteId) deleteUser(deleteId).catch(err => alert('Erro ao excluir acesso: ' + err.message));
    });
    $('#registerDeviceBtn')?.addEventListener('click', event => registerDevice(event.currentTarget).catch(err => alert('Erro ao configurar dispositivo: ' + err.message)));
    $('#refreshDevicesBtn')?.addEventListener('click', () => refreshDevices());
    $('#serverValidateBtn')?.addEventListener('click', () => validateHashOnServer());
    $('#devicesList')?.addEventListener('click', event => {
      const approveId = event.target.dataset.deviceApprove;
      const revokeId = event.target.dataset.deviceRevoke;
      if (approveId) changeDeviceStatus(approveId, 'approve', event.target).catch(err => alert(err.message));
      if (revokeId && confirm(event.target.textContent.includes('Rejeitar') ? 'Rejeitar esta solicitação?' : 'Revogar este dispositivo?')) changeDeviceStatus(revokeId, 'revoke', event.target).catch(err => alert(err.message));
    });

    // Autosave com debounce para evitar perda de preenchimento durante o uso em campo.
    // Qualquer alteração após finalizar invalida os botões PDF/comprovante técnico até nova finalização.
    const handleFormEdited = debounce(() => {
      markFinalizedRecordStale();
      autoSaveDraft();
    }, 400);
    $('#petForm').addEventListener('input', handleFormEdited);
    $('#petForm').addEventListener('change', handleFormEdited);
  }

  /**
   * Alterna a aba visível do aplicativo.
   * Ativação: clique nos botões do menu superior.
   * O que faz: remove a classe `active` de todas as abas, ativa a aba escolhida e atualiza
   * dados específicos quando necessário, como registros ou status da chave.
   */
  function showTab(tabId) {
    const state = authState || loadAuthState();
    if (!state?.user) {
      renderAuthState();
      setTimeout(() => $('#loginMatricula')?.focus(), 100);
      return;
    }
    if (tabId === 'verifyTab' && !['admin','gestor','verificador'].includes(state.user.role)) { alert('Seu perfil não possui acesso à validação oficial.'); return; }
    $$('.tab').forEach(t => t.classList.remove('active'));
    const target = $('#' + tabId) || $('#formTab');
    target.classList.add('active');
    if (tabId === 'recordsTab') renderRecords();
    if (tabId === 'systemTab') { renderAuthState(); refreshMe(); refreshDevices(true); if (['admin','gestor'].includes((authState || loadAuthState())?.user?.role)) refreshUsers(); }
  }

  /**
   * Preenche data e hora padrão sem sobrescrever valores existentes.
   * Ativação: inicialização e limpeza do formulário.
   * O que faz: se os campos estiverem vazios, usa a data atual e a hora local atual.
   */
  function setDefaultDateTime() {
    const form = $('#petForm');
    if (!form.elements.data.value) form.elements.data.value = todayISO();
    if (!form.elements.horaEmissao.value) form.elements.horaEmissao.value = nowTime();
  }

  /**
   * Coleta os campos gerais do formulário.
   * Ativação: montagem do payload final da PET.
   * O que faz: lê FormData, ignora checklist porque ele tem estrutura própria, normaliza
   * textos e acrescenta userAgent, versão do app e data/hora da coleta.
   */
  function collectFormFields() {
    const form = $('#petForm');
    const data = new FormData(form);
    const fields = {};
    for (const [key, value] of data.entries()) {
      if (key.startsWith('check_')) continue;
      fields[key] = normalizeText(value);
    }
    fields.userAgent = navigator.userAgent;
    fields.appVersion = APP_VERSION;
    fields.collectedAt = new Date().toISOString();
    return fields;
  }

  /**
   * Coleta as respostas do checklist.
   * Ativação: validação e montagem do payload final.
   * O que faz: percorre os 22 itens e retorna número, texto do item e resposta selecionada.
   */
  function collectChecklist() {
    return checklistItems.map((item, idx) => {
      const n = String(idx + 1).padStart(2, '0');
      const selected = $(`input[name="check_${n}"]:checked`);
      const justification = normalizeText($(`[name="check_${n}_justification"]`)?.value);
      return { number: n, item, answer: selected ? selected.value : '', justification };
    });
  }

  /**
   * Coleta a relação de profissionais para o dossiê.
   * Ativação: validação, salvamento de rascunho e montagem do payload final.
   * O que faz: sincroniza inputs com a memória e retorna dados essenciais, foto, assinatura
   * e hashes de cada participante.
   */
  function collectPeople() {
    syncPeopleFromInputs();
    return people.map(p => ({
      role: p.role,
      type: p.type,
      required: !!p.required,
      nome: normalizeText(p.nome),
      matricula: normalizeText(p.matricula),
      signatureDataUrl: p.signatureDataUrl || '',
      signedAt: p.signedAt || '',
      signatureHash: p.signatureHash || '',
      signatureMetrics: p.signatureMetrics || null,
      photoDataUrl: p.photoDataUrl || '',
      photoCapturedAt: p.photoCapturedAt || '',
      photoHash: p.photoHash || ''
    }));
  }

  /**
   * Sincroniza nome e matrícula digitados nos cartões com o array `people`.
   * Ativação: antes de coletar, validar, salvar rascunho ou adicionar/remover pessoa.
   * O que faz: procura cada cartão no DOM e copia seus inputs para o objeto correspondente.
   */
  function syncPeopleFromInputs() {
    $$('.person-card').forEach(card => {
      const person = people.find(p => p.id === card.dataset.personId);
      if (!person) return;
      person.nome = $('[data-field="nome"]', card).value;
      person.matricula = $('[data-field="matricula"]', card).value;
    });
  }

  /**
   * Gera automaticamente o número da PET.
   * Ativação: montagem do payload, no momento da finalização.
   * O que faz: combina data da PET, hora ISO atual e sufixo aleatório curto para formar
   * identificador legível e com baixa chance de colisão.
   */
  function generatePetNumber(fields) {
    const datePart = (fields.data || todayISO()).replace(/-/g, '');
    const timePart = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(8, 14);
    const randomPart = Math.random().toString(36).slice(2, 6).toUpperCase();
    return `PET-${datePart}-${timePart}-${randomPart}`;
  }

  /**
   * Monta o payload assinado. O número é criado uma única vez por tentativa oficial.
   * O emissor autenticado também entra no payload, vinculando usuário, matrícula e conteúdo.
   */
  function buildPayload(existingPetNumber = '') {
    const fields = collectFormFields();
    fields.petNumero = existingPetNumber || generatePetNumber(fields);
    fields.petNumeroGeradoAutomaticamente = 'Sim';
    const user = currentUser();
    return {
      schema: PAYLOAD_SCHEMA,
      proofStandard: buildProofStandard('PET_PAYLOAD'),
      issuedBy: { userId: user?.id || '', name: user?.name || '', matricula: user?.matricula || '', role: user?.role || '' },
      fields,
      checklist: collectChecklist(),
      professionals: collectPeople(),
      regulatoryNotice: {
        nr33: 'Permissão de Entrada e Trabalho para espaços confinados; registros devem ser mantidos pela organização.',
        validationCriteria: 'O2 > 19,5 e < 23; LIE < 10; H2S < 5 ppm; CO < 25 ppm; checklist sem impeditivos; N/A limitado e justificado.'
      }
    };
  }

  /** Executa todas as regras impeditivas antes da emissão oficial. */
  function validateCurrentForm() {
    syncPeopleFromInputs();
    const form = $('#petForm');
    const errors = [];
    const warnings = [];

    if (!form.checkValidity()) {
      errors.push('Há campos obrigatórios não preenchidos.');
      const first = form.querySelector(':invalid');
      if (first) errors.push(`Verifique o campo: ${first.name || first.dataset?.field || first.getAttribute('aria-label') || first.type}.`);
    }

    const checklist = collectChecklist();
    checklist.forEach(c => { if (!c.answer) errors.push(`Checklist item ${c.number} sem resposta.`); });
    const naItems = checklist.filter(c => c.answer === 'NA');
    if (naItems.length > MAX_NA_ITEMS) errors.push(`Use N/A somente quando indispensável. Limite: ${MAX_NA_ITEMS} itens; informado: ${naItems.length}.`);
    naItems.forEach(c => {
      if (NA_FORBIDDEN_ITEMS.has(c.number)) errors.push(`Item ${c.number} é crítico e não aceita N/A.`);
      if (normalizeText(c.justification).length < 10) errors.push(`Item ${c.number}: justifique o N/A com pelo menos 10 caracteres.`);
    });

    const negativeBlocking = checklist.filter(c => c.answer === 'N' && !['12', '15', '20'].includes(c.number));
    if (negativeBlocking.length) errors.push(`Há ${negativeBlocking.length} item(ns) impeditivo(s) marcado(s) como NÃO.`);
    const answer = n => checklist.find(c => c.number === n)?.answer;
    if (answer('12') !== 'N') errors.push('Item 12 deve estar marcado como NÃO para confirmar ausência de atmosfera IPVS.');
    if (answer('15') === 'S' && answer('19') !== 'S') errors.push('Item 15 indica necessidade de ar mandado, mas o item 19 não confirma linha de ar instalada e operando.');
    if (answer('20') === 'S') warnings.push('Há necessidade de ferramentas intrinsecamente seguras. Confira a especificação antes da entrada.');

    if (answer('10') !== 'S') errors.push('Item 10 deve confirmar que a calibração do detector está atualizada.');
    if (!normalizeText(form.elements.detectorId.value)) errors.push('Informe o identificador do detector.');
    if (!form.elements.detectorCalibracao.value) errors.push('Informe a validade/calibração do detector.');
    if (form.elements.detectorCalibracao.value && form.elements.detectorCalibracao.value < (form.elements.data.value || todayISO())) errors.push('A validade/calibração do detector está vencida na data da PET.');

    const gasChecks = checkGasMeasurements();
    errors.push(...gasChecks.errors);
    warnings.push(...gasChecks.warnings);

    const typeCounts = people.reduce((acc, p) => { acc[p.type] = (acc[p.type] || 0) + 1; return acc; }, {});
    if (!typeCounts.entrante) errors.push('Inclua pelo menos um entrante.');
    if (!typeCounts.vigia) errors.push('Inclua pelo menos um vigia.');
    if (typeCounts.supervisor !== 1) errors.push('Inclua exatamente um supervisor de entrada.');

    people.forEach(p => {
      if (!normalizeText(p.nome)) errors.push(`${p.role}: nome obrigatório.`);
      if (!normalizeText(p.matricula)) errors.push(`${p.role}: matrícula obrigatória.`);
      if (!p.photoDataUrl) errors.push(`${p.role}: foto obrigatória, com rosto e crachá funcional visível.`);
      if (!p.signatureDataUrl) errors.push(`${p.role}: assinatura obrigatória.`);
      if (p._dirtySignature) errors.push(`${p.role}: assinatura alterada, mas ainda não registrada.`);
      if (p.signatureDataUrl && p.signatureMetrics && !p.signatureMetrics.isSigned) errors.push(`${p.role}: assinatura inválida ou vazia.`);
    });

    const matriculas = new Map();
    people.forEach(p => {
      const mat = normalizeText(p.matricula).toLowerCase();
      if (!mat) return;
      const list = matriculas.get(mat) || [];
      list.push(p.role); matriculas.set(mat, list);
    });
    matriculas.forEach((roles, mat) => { if (roles.length > 1) errors.push(`Matrícula repetida (${mat}) em: ${roles.join(', ')}.`); });

    const supervisorCard = people.find(p => p.type === 'supervisor');
    const supervisorField = normalizeText(form.elements.supervisorEntrada.value).toLowerCase();
    const supervisorName = normalizeText(supervisorCard?.nome).toLowerCase();
    if (supervisorField && supervisorName && supervisorField !== supervisorName) errors.push('O supervisor da identificação está diferente do supervisor que assinou.');

    const emission = form.elements.horaEmissao.value;
    const termino = form.elements.horaTermino.value;
    if (emission && termino && termino <= emission) warnings.push('Hora de término igual ou anterior à emissão. Confira serviço após meia-noite.');
    if (!crypto?.subtle) errors.push('Este navegador não oferece os recursos criptográficos necessários.');
    return { ok: errors.length === 0, errors, warnings };
  }

  /** Valida medições atmosféricas e impede valores negativos ou fora dos limites. */
  function checkGasMeasurements() {
    const form = $('#petForm');
    const errors = [];
    const warnings = [];
    function val(name) {
      const raw = form.elements[name]?.value;
      if (raw === '') return null;
      const n = Number(String(raw).replace(',', '.'));
      return Number.isFinite(n) ? n : null;
    }
    const rows = [
      { key: 'inicial', label: 'Teste inicial', required: true },
      { key: 'ventilacao', label: 'Teste após ventilação', required: false }
    ];
    rows.forEach(row => {
      const values = { o2: val(`gas_${row.key}_o2`), lie: val(`gas_${row.key}_lie`), h2s: val(`gas_${row.key}_h2s`), co: val(`gas_${row.key}_co`) };
      const any = Object.values(values).some(v => v !== null) || form.elements[`gas_${row.key}_hora`]?.value;
      if (row.required || any) {
        if (!form.elements[`gas_${row.key}_hora`]?.value) errors.push(`${row.label}: hora não preenchida.`);
        Object.entries(values).forEach(([k, v]) => {
          if (v === null) errors.push(`${row.label}: campo ${k.toUpperCase()} não preenchido ou inválido.`);
          else if (v < 0) errors.push(`${row.label}: ${k.toUpperCase()} não pode ser negativo.`);
        });
        if (values.o2 !== null && !(values.o2 > 19.5 && values.o2 < 23)) errors.push(`${row.label}: O₂ fora do intervalo seguro.`);
        if (values.lie !== null && !(values.lie < 10)) errors.push(`${row.label}: inflamável (%LIE) igual ou acima de 10%.`);
        if (values.h2s !== null && !(values.h2s < 5)) errors.push(`${row.label}: H₂S igual ou acima de 5 ppm.`);
        if (values.co !== null && !(values.co < 25)) errors.push(`${row.label}: CO igual ou acima de 25 ppm.`);
      }
    });
    return { errors, warnings };
  }

  /**
   * Exibe o resultado da validação na interface.
   * Ativação: botão 'Validar' e tentativa de finalização.
   * O que faz: aplica classe visual de sucesso/alerta/erro e lista impedimentos e avisos.
   */
  function showValidation(result) {
    const box = $('#validationBox');
    box.className = 'validation-box ' + (result.ok ? (result.warnings.length ? 'warn' : 'ok') : 'bad');
    const lines = [];
    lines.push(result.ok ? 'VALIDAÇÃO CONCLUÍDA: sem impeditivos automáticos.' : 'VALIDAÇÃO COM IMPEDITIVOS: corrija antes de finalizar.');
    if (result.errors.length) lines.push('\nImpedimentos:\n- ' + result.errors.join('\n- '));
    if (result.warnings.length) lines.push('\nAlertas para conferência:\n- ' + result.warnings.join('\n- '));
    box.textContent = lines.join('\n');
  }

  /**
   * Finaliza a PET como operação única: gera PDF, calcula hashes reais, gera o JSON exato e registra tudo.
   * O botão fica bloqueado durante o envio e, após sucesso, exige limpar/iniciar nova emissão.
   */
  async function finalizeRecord() {
    if (finalizationInProgress) return;
    if (finalizedRecord?.serverRegistration) {
      alert('Esta PET já foi finalizada. Para uma nova emissão, use “Limpar formulário” e confirme o início de uma nova PET.');
      return;
    }
    const accessOk = await ensureOfficialAccessOrGuide('finalizar a PET oficial');
    if (!accessOk) return;
    const validation = validateCurrentForm();
    showValidation(validation);
    if (!validation.ok) return alert('Não é possível finalizar enquanto houver impedimentos automáticos.');

    const button = $('#finalizeBtn');
    finalizationInProgress = true;
    if (button) { button.disabled = true; button.textContent = 'Gerando e registrando...'; }
    try {
      // Em uma tentativa pendente, reaproveita número, conteúdo e idempotência para não duplicar emissão.
      let record = finalizedRecord;
      if (!record?.pendingOfficialRegistration) {
        const payload = buildPayload();
        const payloadHash = await sha256Hex(payload);
        const signature = await signPayloadHash(payloadHash);
        record = {
          recordType: RECORD_TYPE,
          recordId: payloadHash.slice(0, 16).toUpperCase(),
          idempotencyKey: crypto.randomUUID(),
          payload,
          integrity: {
            payloadHashSha256: payloadHash,
            supervisorCryptographicSignature: signature,
            finalizedAt: new Date().toISOString(),
            validationWarnings: validation.warnings,
            pdfGenerationProofs: []
          },
          pendingOfficialRegistration: true
        };
        finalizedRecord = record;
      }

      // A prova é criada antes do PDF, portanto aparece no arquivo que será efetivamente hasheado.
      if (!latestPdfProof(record)) {
        const proof = await buildPdfGenerationProof(record);
        record.integrity.pdfGenerationProofs.push(proof);
        record.integrity.latestPdfProofHashSha256 = proof.pdfProofHashSha256;
      }
      renderIntegrity(record);
      renderPrintArea(record);

      const pdfFile = await createPdfFile(record);
      const pdfHash = await sha256BlobHex(pdfFile);
      const dossier = buildRegisteredDossier(record, pdfHash, pdfFile.name);
      const jsonText = JSON.stringify(dossier, null, 2);
      const jsonHash = await sha256Hex(jsonText);
      record.output = {
        pdfFilename: pdfFile.name,
        jsonFilename: jsonFilename(record),
        pdfHashSha256: pdfHash,
        jsonHashSha256: jsonHash,
        generatedAt: new Date().toISOString()
      };
      await saveOfficialFiles(record, pdfFile, jsonText);

      await registerRecordOnServer(record, { pdfHash, jsonHash, pdfFile, jsonText });
      record.pendingOfficialRegistration = false;
      updateStoredRecord(record);
      localStorage.removeItem(currentDraftKey());
      renderIntegrity(record);
      renderPrintArea(record);
      ['#printBtn','#sharePdfBtn','#exportBtn','#shareJsonBtn'].forEach(sel => { const b=$(sel); if (b) b.disabled=false; });
      $('#registerServerBtn').disabled = true;
      $('#registerServerBtn').classList.add('hidden');
      if (button) { button.disabled = true; button.textContent = 'PET finalizada'; }
      updateFormAccessStatus('PET oficial gerada e registrada. Envie o PDF e o comprovante ao supervisor.', 'ok');
      alert('PET oficial concluída. O PDF e o comprovante foram vinculados ao registro do servidor. Envie os dois arquivos ao supervisor.');
      saveRecord(record);
      renderRecords();
    } catch (err) {
      if (finalizedRecord) {
        finalizedRecord.pendingOfficialRegistration = true;
        updateStoredRecord(finalizedRecord);
      }
      $('#registerServerBtn').disabled = false;
      $('#registerServerBtn').classList.remove('hidden');
      renderServerPanel('A emissão não foi concluída. Nenhum novo número será criado ao tentar novamente: ' + err.message, 'bad');
      alert('Não foi possível concluir a emissão oficial: ' + err.message + '\nTente novamente; o sistema reutilizará a mesma tentativa para evitar duplicidade.');
      if (button) { button.disabled = false; button.textContent = 'Tentar finalizar novamente'; }
    } finally { finalizationInProgress = false; }
  }

  /** Monta o comprovante técnico exato que será exportado e cujo arquivo é hasheado. */
  function buildRegisteredDossier(record, pdfHash, pdfName) {
    return {
      recordType: record.recordType,
      recordId: record.recordId,
      payload: record.payload,
      integrity: record.integrity,
      fileIntegrity: {
        pdfFilename: pdfName,
        pdfSha256: pdfHash,
        jsonEncoding: 'UTF-8',
        jsonSerialization: 'JSON.stringify(obj, null, 2)',
        serverValidationRequired: true
      },
      validationEndpoint: `${API_BASE_URL}/validate-document`
    };
  }

  /** Envia PDF e comprovante ao Worker apenas durante a validação; o D1 guarda somente hashes/metadados. */
  async function registerRecordOnServer(record, fileHashes = {}) {
    if (!record || !authToken()) throw new Error('Sessão necessária para registrar a PET.');
    const proof = latestPdfProof(record);
    if (!proof) throw new Error('Prova do PDF ausente.');
    const pdfFile = fileHashes.pdfFile || (await readOfficialFiles(record))?.pdfFile;
    const jsonText = fileHashes.jsonText || (await readOfficialFiles(record))?.jsonText;
    if (!pdfFile || !jsonText) throw new Error('Arquivos oficiais ausentes para validação no servidor.');
    const body = {
      // O Worker extrai payload, assinaturas, prova e hashes diretamente do comprovante,
      // evitando duplicar fotos/assinaturas no corpo da requisição e reduzindo confiança no cliente.
      idempotencyKey: record.idempotencyKey,
      pdfBase64: await blobToBase64(pdfFile),
      jsonText
    };
    const data = await apiFetch('/pet-records', { method: 'POST', body });
    record.serverRegistration = data.petRecord;
    renderServerPanel(`PET registrada no sistema. Nº PET: ${data.petRecord.numero_pet}.`, 'ok');
    return data;
  }

  /** Repete somente o envio pendente, reutilizando número, arquivos e idempotência já criados. */
  async function retryPendingRecordRegistration(record, triggerButton) {
    if (!record?.pendingOfficialRegistration) return;
    const files = await readOfficialFiles(record);
    if (!files?.pdfFile || !files?.jsonText || !record.output) {
      alert('Esta tentativa não possui os arquivos completos. Retorne ao formulário e finalize novamente.');
      return;
    }
    const button = triggerButton || $('#registerServerBtn');
    const original = button?.textContent || '';
    try {
      if (button) { button.disabled = true; button.textContent = 'Repetindo registro...'; }
      await registerRecordOnServer(record, {
        pdfFile: files.pdfFile,
        jsonText: files.jsonText
      });
      record.pendingOfficialRegistration = false;
      updateStoredRecord(record);
      if (record === finalizedRecord) {
        ['#printBtn','#sharePdfBtn','#exportBtn','#shareJsonBtn'].forEach(sel => { const b=$(sel); if (b) b.disabled=false; });
        $('#registerServerBtn').classList.add('hidden');
        $('#finalizeBtn').disabled = true;
        $('#finalizeBtn').textContent = 'PET finalizada';
      }
      renderRecords();
      alert('Registro concluído sem criar nova PET.');
    } catch (err) { alert('O registro continua pendente: ' + err.message); }
    finally { if (button && !record.serverRegistration) { button.disabled = false; button.textContent = original || 'Repetir registro pendente'; } }
  }

  /** Abre o PDF oficial exato salvo no IndexedDB; não recria arquivo com hash diferente. */
  async function openOfficialPdf(record, triggerButton) {
    if (!record) return;
    if (!await ensureRecordReadyForOutput(record, 'abrir o PDF oficial')) return;
    const files = await readOfficialFiles(record);
    const button = triggerButton || $('#printBtn');
    const original = button?.textContent || '';
    try {
      if (button) { button.disabled = true; button.textContent = 'Abrindo PDF...'; }
      const url = URL.createObjectURL(files.pdfFile);
      const opened = window.open(url, '_blank', 'noopener');
      if (!opened) downloadBlob(files.pdfFile, files.pdfFilename || pdfFilename(record));
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } finally { if (button) { button.disabled = false; button.textContent = original || 'Abrir PDF oficial'; } }
  }

  /** Compartilha o JSON exato cujo hash foi registrado no D1. */
  async function shareJsonRecord(record, triggerButton) {
    if (!record || !await ensureRecordReadyForOutput(record, 'compartilhar o comprovante técnico')) return;
    const files = await readOfficialFiles(record);
    const button = triggerButton || $('#shareJsonBtn');
    const original = button?.textContent || '';
    try {
      if (button) { button.disabled = true; button.textContent = 'Compartilhando...'; }
      const file = new File([files.jsonText], files.jsonFilename || jsonFilename(record), { type: 'application/json' });
      await shareFilesOrDownload([file], 'Comprovante PET Digital NR-33', `Comprovante da ${record.payload?.fields?.petNumero || record.recordId}.`);
    } catch (err) { if (err.name !== 'AbortError') alert('Não foi possível compartilhar: ' + err.message); }
    finally { if (button) { button.disabled = false; button.textContent = original || 'Compartilhar comprovante'; } }
  }

  /** Compartilha o PDF exato cujo hash foi registrado no D1. */
  async function sharePdfRecord(record, triggerButton) {
    if (!record || !await ensureRecordReadyForOutput(record, 'compartilhar o PDF oficial')) return;
    const files = await readOfficialFiles(record);
    const button = triggerButton || $('#sharePdfBtn');
    const original = button?.textContent || '';
    try {
      if (button) { button.disabled = true; button.textContent = 'Abrindo compartilhamento...'; }
      const file = files.pdfFile instanceof File ? files.pdfFile : new File([files.pdfFile], files.pdfFilename || pdfFilename(record), { type: 'application/pdf' });
      await shareFilesOrDownload([file], 'PET Digital NR-33 — PDF', `PDF da ${record.payload?.fields?.petNumero || record.recordId}.`);
    } catch (err) { if (err.name !== 'AbortError') alert('Não foi possível compartilhar o PDF: ' + err.message); }
    finally { if (button) { button.disabled = false; button.textContent = original || 'Compartilhar PDF'; } }
  }

  /**
   * Carrega uma biblioteca JavaScript externa apenas quando necessária.
   * Ativação: geração de PDF compartilhável, dentro de `ensurePdfLibraries`.
   * O que faz: injeta uma tag script e resolve quando o navegador conclui o carregamento.
   */
  function loadScriptOnce(src) {
    return new Promise((resolve, reject) => {
      const existing = document.querySelector(`script[src="${src}"]`);
      if (existing) {
        existing.addEventListener('load', resolve, { once: true });
        existing.addEventListener('error', () => reject(new Error('Falha ao carregar biblioteca.')), { once: true });
        if (existing.dataset.loaded === 'true') resolve();
        return;
      }
      const script = document.createElement('script');
      script.src = src;
      script.async = true;
      script.onload = () => { script.dataset.loaded = 'true'; resolve(); };
      script.onerror = () => reject(new Error('Falha ao carregar biblioteca externa para PDF.'));
      document.head.appendChild(script);
    });
  }

  /**
   * Garante que html2canvas e jsPDF estejam disponíveis.
   * Ativação: antes de criar o PDF compartilhável.
   * O que faz: usa bibliotecas já carregadas, quando existirem, ou tenta carregá-las por CDN.
   */
  async function ensurePdfLibraries() {
    if (!window.html2canvas) await loadScriptOnce(PDF_LIBRARIES.html2canvas);
    if (!window.jspdf?.jsPDF) await loadScriptOnce(PDF_LIBRARIES.jsPdf);
    if (!window.html2canvas || !window.jspdf?.jsPDF) throw new Error('Bibliotecas de geração de PDF não disponíveis.');
  }

  /**
   * Aguarda as imagens da área de impressão carregarem antes de transformar em PDF.
   * Ativação: criação de PDF compartilhável.
   * O que faz: evita PDF sem logo, foto ou assinatura quando a renderização começa cedo demais.
   */
  function waitForImages(root) {
    const images = $$('img', root);
    return Promise.all(images.map(img => img.complete ? Promise.resolve() : new Promise(resolve => {
      img.onload = resolve;
      img.onerror = resolve;
    })));
  }

  /**
   * Cria um arquivo PDF real a partir da área de impressão.
   * Ativação: botão 'Compartilhar PDF'.
   * O que faz: renderiza cada página da PET como imagem de alta resolução e insere as páginas
   * em um PDF A4 paisagem, retornando um File pronto para Web Share API ou download.
   */
  async function createPdfFile(record) {
    renderPrintArea(record);
    await ensurePdfLibraries();
    const area = $('#printArea');
    area.classList.add('pdf-render-mode');
    try {
      await waitForImages(area);
      const { jsPDF } = window.jspdf;
      const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4', compress: true });
      const pages = $$('.print-page', area);
      if (!pages.length) throw new Error('Área de impressão não encontrada.');
      for (let i = 0; i < pages.length; i++) {
        const canvas = await window.html2canvas(pages[i], { scale: 2, backgroundColor: '#ffffff', useCORS: true, logging: false });
        const imgData = canvas.toDataURL('image/jpeg', 0.92);
        if (i > 0) pdf.addPage('a4', 'landscape');
        pdf.addImage(imgData, 'JPEG', 0, 0, 297, 210, undefined, 'FAST');
      }
      const blob = pdf.output('blob');
      return new File([blob], pdfFilename(record), { type: 'application/pdf' });
    } finally {
      area.classList.remove('pdf-render-mode');
    }
  }

  /**
   * Atualiza o painel de integridade exibido após a finalização.
   * Ativação: finalização da PET e geração de prova de PDF.
   * O que faz: mostra recordId, hash do payload, algoritmo, hash da chave pública e, se
   * existir, os dados da última prova de geração do PDF.
   */
  function renderIntegrity(record) {
    const panel = $('#integrityPanel');
    const proof = latestPdfProof(record);
    const proofText = proof ? `<br><strong>Última geração de PDF:</strong><br>
      Data/hora: ${formatDateTime(proof.generatedAt)}<br>
      IP: ${escapeHtml(proof.publicIp || 'não obtido')}<br>
      Geolocalização: ${proof.geolocation?.available ? `${escapeHtml(String(proof.geolocation.latitude))}, ${escapeHtml(String(proof.geolocation.longitude))} ± ${escapeHtml(String(Math.round(proof.geolocation.accuracyMeters || 0)))} m` : escapeHtml(proof.geolocation?.error || 'não obtida')}<br>
      <details class="advanced-details"><summary>Detalhes técnicos</summary><code>${escapeHtml(proof.pdfProofHashSha256)}</code></details>` : '';
    panel.classList.remove('hidden');
    const standard = record.payload?.proofStandard || {};
    panel.innerHTML = `<strong>PET finalizada:</strong> ${escapeHtml(record.payload?.fields?.petNumero || record.recordId)}<br>
      <strong>Código de conferência:</strong> ${escapeHtml(record.recordId)}<br>
      <strong>Finalizado em:</strong> ${formatDateTime(record.integrity.finalizedAt)}${proofText}
      <details class="advanced-details"><summary>Detalhes técnicos do comprovante</summary>
        <strong>Padrão:</strong> ${escapeHtml(standard.validationProfile || VALIDATION_PROFILE)}<br>
        <strong>Normalização:</strong> ${escapeHtml(standard.canonicalizationAlgorithm || CANONICALIZATION_ALGORITHM)}<br>
        <strong>Código técnico:</strong><br><code>${escapeHtml(record.integrity.payloadHashSha256)}</code><br>
        <strong>Assinatura técnica:</strong> ${escapeHtml(record.integrity.supervisorCryptographicSignature.algorithm)}<br>
        <strong>Dispositivo:</strong> ${escapeHtml(record.integrity.supervisorCryptographicSignature.publicKeyHash)}
      </details>`;
  }

  /**
   * Monta o HTML específico para impressão/PDF.
   * Ativação: finalização da PET e antes de imprimir/gerar PDF.
   * O que faz: cria duas páginas A4 paisagem com identificação, checklist, gases, fotos,
   * assinaturas, notas e dados de integridade/prova.
   */
  function renderPrintArea(record) {
    const area = $('#printArea');
    area.classList.remove('hidden');
    const p = record.payload;
    const f = p.fields;
    const checkRows = p.checklist.map(c => `<tr>
      <td class="center">${escapeHtml(c.number)}</td><td>${escapeHtml(c.item)}</td>
      <td class="center">${c.answer === 'S' ? 'X' : ''}</td>
      <td class="center">${c.answer === 'N' ? 'X' : ''}</td>
      <td class="center">${c.answer === 'NA' ? 'X' : ''}</td>
    </tr>`).join('');
    const prosRows = p.professionals.filter(pro => pro.nome || pro.matricula || pro.required).map(pro => `<tr>
      <td><strong>${escapeHtml(pro.role)}</strong><br>${escapeHtml(pro.nome || '')}</td>
      <td>${escapeHtml(pro.matricula || '')}</td>
      <td>${pro.photoDataUrl ? `<img class="print-photo" src="${pro.photoDataUrl}" alt="Foto" />` : ''}<small>${pro.photoCapturedAt ? 'Foto: ' + formatDateTime(pro.photoCapturedAt) : ''}</small></td>
      <td>${pro.signatureDataUrl ? `<img class="print-sig" src="${pro.signatureDataUrl}" alt="Assinatura" />` : ''}<small>${pro.signedAt ? 'Assinado em ' + formatDateTime(pro.signedAt) : ''}</small></td>
    </tr>`).join('');
    const gasRows = [
      ['1-Teste Inicial/Hora', f.gas_inicial_hora, f.gas_inicial_o2, f.gas_inicial_lie, f.gas_inicial_h2s, f.gas_inicial_co, f.gas_inicial_obs],
      ['2-Teste Após Ventilação/Hora', f.gas_ventilacao_hora, f.gas_ventilacao_o2, f.gas_ventilacao_lie, f.gas_ventilacao_h2s, f.gas_ventilacao_co, f.gas_ventilacao_obs]
    ].map(r => `<tr><td>${escapeHtml(r[0])}<br>${escapeHtml(r[1] || '')}</td><td class="center">${escapeHtml(r[2] || '')}</td><td class="center">${escapeHtml(r[3] || '')}</td><td class="center">H₂S: ${escapeHtml(r[4] || '')}<br>CO: ${escapeHtml(r[5] || '')}</td><td>${escapeHtml(r[6] || '')}</td></tr>`).join('');
    const pdfProof = latestPdfProof(record);
    const geoText = pdfProof?.geolocation?.available
      ? `${Number(pdfProof.geolocation.latitude).toFixed(6)}, ${Number(pdfProof.geolocation.longitude).toFixed(6)} ± ${Math.round(pdfProof.geolocation.accuracyMeters || 0)} m`
      : `Não obtida${pdfProof?.geolocation?.error ? ' — ' + pdfProof.geolocation.error : ''}`;
    const pdfProofHtml = pdfProof ? `<strong>Prova de geração do PDF:</strong> ${formatDateTime(pdfProof.generatedAt)} • <strong>IP:</strong> ${escapeHtml(pdfProof.publicIp || 'não obtido')} • <strong>Geolocalização:</strong> ${escapeHtml(geoText)} • <strong>Hash da prova:</strong> ${escapeHtml(pdfProof.pdfProofHashSha256)}` : '<strong>Prova de geração do PDF:</strong> não registrada.';
    const validationCode = `${record.recordId}-${record.integrity.payloadHashSha256.slice(0, 12).toUpperCase()}`;
    const validationInfoHtml = `<strong>Código de conferência:</strong> ${escapeHtml(validationCode)} • <strong>Perfil:</strong> ${escapeHtml(p.proofStandard?.validationProfile || VALIDATION_PROFILE)} • <strong>Hash:</strong> ${escapeHtml(p.proofStandard?.hashAlgorithm || HASH_ALGORITHM)} • <strong>Assinatura:</strong> ${escapeHtml(p.proofStandard?.signatureAlgorithm || SIGNATURE_ALGORITHM)} • <strong>JSON canônico:</strong> ${escapeHtml(p.proofStandard?.canonicalizationAlgorithm || CANONICALIZATION_ALGORITHM)} • <strong>Validação:</strong> exige o comprovante técnico correspondente.`;

    area.innerHTML = `
      <div class="print-page">
        <div class="print-header">
          <div class="print-logo"><img class="print-dmae-logo" src="logo-dmae-2026.png" alt="DMAE" /><small>Departamento Municipal de Água e Esgoto</small></div>
          <div class="print-title"><h1>PET - PERMISSÃO DE ENTRADA E TRABALHO<br>ESPAÇO CONFINADO<br>NBR14787/NR33</h1></div>
          <div class="print-rev">Revisão: 00/2025<br>Mod.: 01/2025<br>PET Digital</div>
        </div>
        <div class="print-grid">
          <div class="print-cell"><strong>1-NOME DA UNIDADE:</strong>${escapeHtml(f.unidade)}</div>
          <div class="print-cell"><strong>2-Nº DA PET:</strong>${escapeHtml(f.petNumero)}</div>
          <div class="print-cell"><strong>3-DATA:</strong>${formatDate(f.data)}</div>
          <div class="print-cell wide"><strong>4-LOCAL DO ESPAÇO CONFINADO:</strong>${escapeHtml(f.local)}</div>
          <div class="print-cell"><strong>5-HORA DA EMISSÃO:</strong>${escapeHtml(f.horaEmissao)}</div>
          <div class="print-cell"><strong>6-HORA DO TÉRMINO:</strong>${escapeHtml(f.horaTermino)}</div>
          <div class="print-cell full"><strong>7-TRABALHO A SER REALIZADO:</strong>${escapeHtml(f.trabalho)}</div>
          <div class="print-cell wide"><strong>8-SUPERVISOR DE ENTRADA:</strong>${escapeHtml(f.supervisorEntrada)}</div>
          <div class="print-cell wide"><strong>9-EQUIPE DE SALVAMENTO:</strong>${escapeHtml(f.equipeSalvamento)} — Tel.: ${escapeHtml(f.telefoneSalvamento)}</div>
        </div>
        <table class="print-table">
          <thead><tr><th>Nº</th><th>ITENS A SEREM VERIFICADOS ANTES DA EMISSÃO DA PET</th><th>SIM</th><th>NÃO</th><th>N/A</th></tr></thead>
          <tbody>${checkRows}</tbody>
        </table>
        <div class="print-observacoes"><strong>Observações:</strong> ${escapeHtml(f.observacoes || '')}</div>
        <div class="print-integrity"><strong>Registro:</strong> ${record.recordId} • <strong>Hash SHA-256:</strong> ${record.integrity.payloadHashSha256} • <strong>Assinado:</strong> ${formatDateTime(record.integrity.finalizedAt)}<br>${validationInfoHtml}<br>${pdfProofHtml}</div>
      </div>
      <div class="print-page">
        <div class="print-section-title">MEDIÇÕES DE GASES PERIGOSOS</div>
        <table class="print-table">
          <thead><tr><th></th><th>Oxigênio (%)<br>(19,5% &lt; O₂ &lt; 23%)</th><th>Inflamável (%LIE)<br>(&lt; 10%)</th><th>Gás/Tóxico (ppm)<br>H₂S &lt; 5 ppm / CO &lt; 25 ppm</th><th>Obs.</th></tr></thead>
          <tbody>${gasRows}</tbody>
        </table>
        <div class="print-section-title">RELAÇÃO DE PROFISSIONAIS</div>
        <table class="print-table">
          <thead><tr><th>Profissional</th><th>Matrícula</th><th>Foto</th><th>Assinatura</th></tr></thead>
          <tbody>${prosRows}</tbody>
        </table>
        <div class="print-observacoes"><strong>Legenda:</strong> S – Sim &nbsp;&nbsp; N – Não &nbsp;&nbsp; N/A – Não se aplica</div>
        <div class="print-observacoes">
          <strong>Nota de Orientação</strong><br>
          1- O acesso só deve ocorrer após a emissão e endosso da PET. 2- A PET deve ser encerrada ou cancelada ao término, condição não prevista, interrupção ou troca de equipe. 3- A PET é válida somente para cada entrada. 4- O vigia não pode realizar outras tarefas. 5- Não é permitido trabalho individual ou isolado. 6- O supervisor emite, encerra/cancela, testa, confere equipamentos e checa procedimentos. 7- O portador do monitor de gás deve ser o último a sair. 8- Em caso de alarme, abandonar imediatamente o local.
        </div>
        <div class="print-integrity"><strong>Assinatura criptográfica ECDSA-P256:</strong> ${escapeHtml(record.integrity.supervisorCryptographicSignature.signatureBase64)}<br><strong>Hash da chave pública:</strong> ${escapeHtml(record.integrity.supervisorCryptographicSignature.publicKeyHash)}<br>${validationInfoHtml}<br>${pdfProofHtml}</div>
      </div>`;
  }

  /**
   * Salva o rascunho atual no dispositivo.
   * Ativação: botão 'Salvar rascunho' e autosave.
   * O que faz: serializa campos e profissionais e grava em `localStorage` para retomada.
   */
  function saveDraft() {
    const draft = {
      savedAt: new Date().toISOString(),
      fields: serializeForm(),
      people: collectPeople()
    };
    const key = currentDraftKey();
    if (!key) return;
    localStorage.setItem(key, JSON.stringify(draft));
  }

  /**
   * Tenta salvar rascunho silenciosamente.
   * Ativação: eventos de input/change, alteração de foto, assinatura e lista de pessoas.
   * O que faz: chama `saveDraft()` dentro de try/catch para não interromper a tela em
   * caso de limite de armazenamento ou erro local.
   */
  function autoSaveDraft() {
    try { saveDraft(); } catch (err) { console.warn('Não foi possível salvar rascunho', err); }
  }

  /**
   * Restaura rascunho salvo no localStorage.
   * Ativação: inicialização do app.
   * O que faz: lê JSON do rascunho, restaura campos e profissionais; se estiver corrompido,
   * ignora com aviso no console.
   */
  function loadDraft() {
    const key = currentDraftKey();
    if (!key) return false;
    const raw = localStorage.getItem(key);
    if (!raw) return false;
    try {
      const draft = JSON.parse(raw);
      restoreForm(draft.fields || {});
      checklistItems.forEach((_, idx) => updateNaJustificationVisibility(String(idx + 1).padStart(2, '0')));
      if (Array.isArray(draft.people) && draft.people.length) {
        people = draft.people.map((p, idx) => ({ id: crypto.randomUUID ? crypto.randomUUID() : 'p-' + idx, ...p }));
        reindexPeople();
        renderPeople();
      }
      return true;
    } catch (err) {
      console.warn('Rascunho inválido', err);
      return false;
    }
  }

  /**
   * Serializa todos os campos HTML do formulário.
   * Ativação: salvamento de rascunho.
   * O que faz: percorre inputs, textareas e selects, tratando rádio/checkbox de modo
   * compatível com posterior restauração.
   */
  function serializeForm() {
    const form = $('#petForm');
    const result = {};
    $$('input, textarea, select', form).forEach(el => {
      if (!el.name) return;
      if (el.type === 'radio') {
        if (el.checked) result[el.name] = el.value;
      } else if (el.type === 'checkbox') {
        result[el.name] = el.checked;
      } else {
        result[el.name] = el.value;
      }
    });
    return result;
  }

  /**
   * Restaura valores nos campos HTML do formulário.
   * Ativação: carregamento de rascunho salvo.
   * O que faz: localiza campos pelo atributo `name` e recoloca valores, inclusive rádio
   * e checkbox.
   */
  function restoreForm(values) {
    const form = $('#petForm');
    Object.entries(values).forEach(([name, value]) => {
      const els = $$(`[name="${cssEscape(name)}"]`, form);
      els.forEach(el => {
        if (el.type === 'radio') el.checked = el.value === value;
        else if (el.type === 'checkbox') el.checked = !!value;
        else el.value = value;
      });
    });
  }

  /**
   * Reduz um registro concluído antes de colocá-lo no localStorage.
   * O quê: evita duplicar fotos, assinaturas e todo o dossiê em um armazenamento pequeno.
   * Como: registros já aceitos guardam apenas metadados necessários para a lista e para
   * localizar os arquivos exatos no IndexedDB; tentativas pendentes preservam o conteúdo
   * completo, pois ainda precisam ser reenviadas com a mesma idempotência.
   * Quando: toda gravação/atualização do histórico local.
   */
  function recordForLocalStorage(record) {
    if (!record?.serverRegistration || record?.pendingOfficialRegistration) return record;
    return {
      recordType: record.recordType,
      recordId: record.recordId,
      idempotencyKey: record.idempotencyKey,
      payload: {
        schema: record.payload?.schema,
        proofStandard: record.payload?.proofStandard,
        issuedBy: record.payload?.issuedBy,
        fields: record.payload?.fields || {}
      },
      integrity: {
        payloadHashSha256: record.integrity?.payloadHashSha256,
        finalizedAt: record.integrity?.finalizedAt,
        latestPdfProofHashSha256: record.integrity?.latestPdfProofHashSha256
      },
      output: record.output,
      serverRegistration: record.serverRegistration,
      pendingOfficialRegistration: false
    };
  }

  /**
   * Salva uma PET finalizada no histórico local.
   * Ativação: finalização da PET.
   * O que faz: coloca o novo registro no início da lista e mantém no máximo 200 registros
   * no localStorage para evitar crescimento indefinido.
   */
  function saveRecord(record) {
    const storedRecord = recordForLocalStorage(record);
    const records = getRecords().filter(r => r.recordId !== record.recordId);
    records.unshift(storedRecord);
    const limited = records.slice(0, 200);
    const key = currentRecordsKey();
    if (!key) return;
    localStorage.setItem(key, JSON.stringify(limited));
  }

  /**
   * Atualiza um registro já salvo no histórico local.
   * Ativação: após gerar prova de PDF para um registro existente.
   * O que faz: procura pelo recordId, substitui o registro, ou insere no início se não achar.
   */
  function updateStoredRecord(record) {
    const storedRecord = recordForLocalStorage(record);
    const records = getRecords();
    const idx = records.findIndex(r => r.recordId === record.recordId);
    if (idx >= 0) records[idx] = storedRecord;
    else records.unshift(storedRecord);
    const key = currentRecordsKey();
    if (!key) return;
    localStorage.setItem(key, JSON.stringify(records.slice(0, 200)));
  }

  /**
   * Lê os registros finalizados salvos neste dispositivo.
   * Ativação: aba Registros, atualização de registro e impressão/exportação.
   * O que faz: interpreta o JSON do localStorage e devolve array vazio em caso de erro.
   */
  function getRecords() {
    const key = currentRecordsKey();
    if (!key) return [];
    try { return JSON.parse(localStorage.getItem(key) || '[]'); }
    catch { return []; }
  }

  /**
   * Renderiza a lista de PETs finalizadas neste dispositivo.
   * Ativação: abrir aba Registros ou clicar em “Atualizar lista”.
   * O que faz: monta cartões com dados básicos e ações de PDF, comprovante técnico,
   * registro no sistema e exclusão local.
   */
  function renderRecords() {
    const box = $('#recordsList');
    const records = getRecords();
    if (!records.length) {
      box.innerHTML = '<p class="hint">Nenhum registro finalizado neste dispositivo.</p>';
      return;
    }
    box.innerHTML = records.map((r, idx) => `<div class="record-item">
      <div><strong>${escapeHtml(r.payload?.fields?.petNumero || r.recordId)}</strong><br>
      Local: ${escapeHtml(r.payload?.fields?.local || '')}<br>
      Finalizado: ${formatDateTime(r.integrity?.finalizedAt)}<br>
      Situação: ${r.serverRegistration ? 'registrado no sistema' : 'pendente de registro no sistema'}
      <details class="advanced-details"><summary>Detalhes técnicos</summary><small class="record-hash">Código: ${escapeHtml(r.integrity?.payloadHashSha256 || '')}</small></details></div>
      <div class="actions">
        <button type="button" class="small secondary" data-record-action="print" data-index="${idx}">Abrir PDF</button>
        <button type="button" class="small secondary" data-record-action="sharePdf" data-index="${idx}">Compartilhar PDF</button>
        <button type="button" class="small secondary" data-record-action="export" data-index="${idx}">Comprovante</button>
        <button type="button" class="small secondary" data-record-action="shareJson" data-index="${idx}">Compartilhar comprovante</button>
        ${r.pendingOfficialRegistration && r.output?.pdfHashSha256 ? `<button type="button" class="small ghost" data-record-action="registerServer" data-index="${idx}">Repetir registro pendente</button>` : ''}
        <button type="button" class="small danger ghost" data-record-action="delete" data-index="${idx}">Excluir local</button>
      </div>
    </div>`).join('');
    box.onclick = async event => {
      const btn = event.target.closest('[data-record-action]');
      if (!btn) return;
      const rec = getRecords()[Number(btn.dataset.index)];
      if (!rec) return;
      if (btn.dataset.recordAction === 'print') {
        finalizedRecord = rec;
        showTab('formTab');
        await openOfficialPdf(rec, btn);
      }
      if (btn.dataset.recordAction === 'sharePdf') {
        finalizedRecord = rec;
        await sharePdfRecord(rec, btn);
      }
      if (btn.dataset.recordAction === 'export') {
        finalizedRecord = rec;
        const ready = await ensureRecordReadyForOutput(rec, 'salvar o comprovante técnico');
        if (ready) { const files = await readOfficialFiles(rec); downloadBlob(new Blob([files.jsonText], { type: 'application/json' }), files.jsonFilename || jsonFilename(rec)); }
      }
      if (btn.dataset.recordAction === 'shareJson') await shareJsonRecord(rec, btn);
      if (btn.dataset.recordAction === 'registerServer') await retryPendingRecordRegistration(rec, btn);
      if (btn.dataset.recordAction === 'delete') {
        if (!confirm('Excluir este registro apenas deste dispositivo?')) return;
        const updated = getRecords();
        updated.splice(Number(btn.dataset.index), 1);
        const key = currentRecordsKey();
        if (key) localStorage.setItem(key, JSON.stringify(updated));
        await deleteOfficialFiles(rec.recordId);
        renderRecords();
      }
    };
  }

  /**
   * Valida simultaneamente o PDF e o comprovante JSON, além de consultar o registro exato no Worker.
   * Sem os dois arquivos, a validação oficial não é concluída.
   */
  async function verifyFiles() {
    const jsonFile = $('#verifyJsonFile')?.files?.[0];
    const pdfFile = $('#verifyPdfFile')?.files?.[0];
    const result = $('#verifyResult');
    if (!jsonFile || !pdfFile) {
      result.className = 'validation-box warn';
      result.textContent = 'Selecione o PDF oficial e o comprovante técnico JSON correspondentes.';
      return;
    }
    try {
      const state = currentUser();
      if (!['admin','gestor','verificador'].includes(state?.role)) throw new Error('Seu perfil não possui acesso à validação oficial.');
      const text = await jsonFile.text();
      const jsonHash = await sha256Hex(text);
      const pdfHash = await sha256BlobHex(pdfFile);
      const record = JSON.parse(text);
      if (!record.payload || !record.integrity || !record.fileIntegrity) throw new Error('Arquivo não é um comprovante oficial v1.1.4 completo.');
      if (pdfHash !== record.fileIntegrity.pdfSha256) throw new Error('O PDF selecionado não corresponde ao hash gravado no comprovante.');

      const standardCheck = validateSupportedProofStandard(record.payload.proofStandard, 'PET');
      const recalculated = await sha256Hex(record.payload);
      const hashMatches = recalculated === record.integrity.payloadHashSha256;
      const signatureOk = standardCheck.errors.length === 0 && await verifySignature(recalculated, record.integrity.supervisorCryptographicSignature);
      const proofs = record.integrity.pdfGenerationProofs || [];
      if (!proofs.length) throw new Error('Comprovante sem prova de geração do PDF.');
      let allProofsOk = true;
      for (const proof of proofs) {
        const proofHash = await sha256Hex(proofHashInput(proof));
        allProofsOk = allProofsOk && proofHash === proof.pdfProofHashSha256 && await verifySignature(proofHash, proof.cryptographicSignature);
      }
      const localOk = standardCheck.errors.length === 0 && hashMatches && signatureOk && allProofsOk;
      const server = await apiFetch('/validate-document', { method: 'POST', body: {
        // Os arquivos são enviados somente durante a validação para o Worker recalcular
        // os hashes de forma independente. O servidor não os armazena no D1.
        pdfBase64: await blobToBase64(pdfFile),
        jsonText: text
      }});
      const allOk = localOk && server.valid === true;
      result.className = 'validation-box ' + (allOk ? 'ok' : 'bad');
      const technicalText = `Hash do PDF: ${pdfHash}
Hash do JSON: ${jsonHash}
Hash do payload: ${recalculated}
Integridade local: ${localOk ? 'OK' : 'FALHA'}
Registro exato no servidor: ${server.found ? 'ENCONTRADO' : 'NÃO ENCONTRADO'}
Chave autorizada na emissão: ${server.keyAuthorizedAtRegistration ? 'SIM' : 'NÃO'}
Assinaturas confirmadas no servidor: ${server.signaturesValid ? 'SIM' : 'NÃO'}
Emissor: ${server.issuer ? `${server.issuer.name} (${server.issuer.matricula})` : 'NÃO CONFIRMADO'}`;
      result.innerHTML = `<strong>${allOk ? 'Documento válido: PDF, comprovante, emissor e dispositivo confirmados.' : 'Documento não validado.'}</strong><br>${escapeHtml(server.message || server.reason || '')}<details class="advanced-details"><summary>Detalhes técnicos</summary><pre>${escapeHtml(technicalText)}</pre></details>`;
    } catch (err) {
      result.className = 'validation-box bad';
      result.textContent = 'Não foi possível validar oficialmente: ' + err.message;
    }
  }

  /**
   * Exporta a chave pública da instalação atual.
   * Ativação: botão 'Exportar chave pública' na aba Chave.
   * O que faz: garante existência de chave e baixa um JSON contendo algoritmo, hash e
   * chave pública, sem exportar a chave privada separadamente.
   */
  async function exportPublicKey() {
    const key = await ensureKeyPair();
    downloadJson({ algorithm: key.algorithm, createdAt: key.createdAt, publicKeyHash: key.publicKeyHash, publicKey: key.publicKey }, 'dados_autorizacao_dispositivo_pet_digital.json');
  }

  /**
   * Atualiza a visualização da chave criptográfica local.
   * Ativação: abrir aba Chave, criar/apagar chave e inicialização.
   * O que faz: mostra se há chave local e, quando houver, exibe algoritmo, data de criação,
   * hash da chave pública e o JSON público.
   */
  async function updateKeyStatus() {
    const box = $('#keyStatus');
    const key = await readLocalKeyPair();
    if (!key) {
      box.innerHTML = '<p class="hint">A proteção local ainda não foi criada. Ela será criada automaticamente quando você clicar em “Configurar e solicitar autorização”.</p>';
      return;
    }
    box.innerHTML = `<p><strong>Dispositivo preparado:</strong> sim<br><strong>Armazenamento:</strong> ${escapeHtml(key.storage || 'local seguro do navegador')}<br><strong>Criado em:</strong> ${formatDateTime(key.createdAt)}</p><details class="advanced-details"><summary>Detalhes técnicos</summary><strong>Algoritmo:</strong> ${escapeHtml(key.algorithm)}<br><strong>Código do dispositivo:</strong> <span class="hash-text">${escapeHtml(key.publicKeyHash)}</span><pre>${escapeHtml(JSON.stringify({ publicKeyHash: key.publicKeyHash, publicKey: key.publicKey }, null, 2))}</pre></details>`;
  }

  /**
   * Cria uma base padronizada e legível para nomes de arquivo.
   * Ativação: exportação, compartilhamento e sugestão de nome do PDF.
   * O que faz: combina número da PET, data, local resumido e registro em um nome seguro.
   */
  function recordFileStem(record) {
    const fields = record?.payload?.fields || {};
    const pet = fields.petNumero || record?.recordId || 'PET';
    const date = (fields.data || '').replace(/-/g, '') || new Date(record?.integrity?.finalizedAt || Date.now()).toISOString().slice(0, 10).replace(/-/g, '');
    const local = normalizeText(fields.local || 'local').slice(0, 50);
    const stem = `PET_NR33_DMAE_${pet}_${date}_${local}_${record?.recordId || ''}`;
    return safeFilename(stem).replace(/^_+|_+$/g, '').slice(0, 150);
  }

  /** Retorna o nome sugerido para o PDF da PET. */
  function pdfFilename(record) { return `${recordFileStem(record)}.pdf`; }

  /** Retorna o nome sugerido para o comprovante técnico da PET. */
  function jsonFilename(record) { return `${recordFileStem(record)}_dossie.json`; }

  /**
   * Força o download de um objeto como arquivo JSON.
   * Ativação: exportar dossiê e exportar chave pública.
   * O que faz: cria Blob, URL temporária e um link invisível, clica nele e libera a URL.
   */
  function downloadJson(data, filename) {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    downloadBlob(blob, filename);
  }

  /** Baixa um Blob/File usando link temporário. */
  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  /**
   * Compartilha arquivos pela Web Share API ou baixa como fallback.
   * Ativação: botões de compartilhamento de PDF/comprovante técnico.
   * O que faz: tenta abrir a folha nativa de compartilhamento do celular; quando o navegador
   * não suporta arquivos, salva os arquivos localmente para o usuário encaminhar manualmente.
   */
  async function shareFilesOrDownload(files, title, text) {
    if (navigator.share && navigator.canShare && navigator.canShare({ files })) {
      await navigator.share({ files, title, text });
      return;
    }
    files.forEach(file => downloadBlob(file, file.name));
    alert('Este navegador não permite compartilhar arquivos diretamente. O arquivo foi baixado para envio manual.');
  }

  /**
   * Registra o Service Worker para funcionamento offline e atualização controlada.
   * Ativação: inicialização do app.
   * O que faz: registra `sw.js`, mostra banner quando houver nova versão instalada, salva
   * rascunho antes de aplicar atualização e recarrega quando o novo SW assumir controle.
   */
  function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('./sw.js').then(reg => {
      reg.addEventListener('updatefound', () => {
        const newWorker = reg.installing;
        newWorker?.addEventListener('statechange', () => {
          if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
            waitingWorker = newWorker;
            $('#updateBanner').classList.remove('hidden');
          }
        });
      });
    }).catch(console.warn);
    $('#applyUpdate').addEventListener('click', () => {
      if (!waitingWorker) return;
      saveDraft();
      waitingWorker.postMessage({ type: 'SKIP_WAITING' });
    });
    navigator.serviceWorker.addEventListener('controllerchange', () => window.location.reload());
  }

  /**
   * Cria uma versão atrasada de uma função.
   * Ativação: autosave do formulário.
   * O que faz: aguarda o usuário parar de digitar por alguns milissegundos antes de salvar,
   * reduzindo gravações repetidas no localStorage.
   */
  function debounce(fn, ms) {
    let timer;
    return (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => fn(...args), ms);
    };
  }

  /**
   * Escapa caracteres perigosos antes de inserir texto no HTML.
   * Ativação: toda renderização que usa dados do usuário.
   * O que faz: substitui &, <, >, aspas e apóstrofo por entidades HTML para reduzir risco
   * de injeção de conteúdo na interface/PDF.
   */
  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[ch]));
  }

  /**
   * Escapa valores usados dentro de atributos HTML.
   * Ativação: preenchimento de `value`, `alt` e trechos similares.
   * O que faz: reaproveita `escapeHtml` e também escapa crase.
   */
  function escapeAttr(value) { return escapeHtml(value).replace(/`/g, '&#096;'); }

  /**
   * Escapa nomes usados em seletores CSS.
   * Ativação: restauração de campos pelo atributo `name`.
   * O que faz: usa `CSS.escape` quando disponível; caso contrário, aplica escape simples
   * para aspas.
   */
  function cssEscape(value) {
    if (window.CSS && CSS.escape) return CSS.escape(value);
    return String(value).replace(/"/g, '\\"');
  }

  /**
   * Formata data `AAAA-MM-DD` para `DD/MM/AAAA`.
   * Ativação: renderização da versão de impressão/PDF.
   * O que faz: divide a string por hífen e reorganiza os componentes.
   */
  function formatDate(value) {
    if (!value) return '';
    const [y, m, d] = value.split('-');
    if (!y || !m || !d) return value;
    return `${d}/${m}/${y}`;
  }

  /**
   * Formata data/hora ISO para padrão brasileiro local.
   * Ativação: painéis, status de foto/assinatura, registros e validação.
   * O que faz: tenta usar `toLocaleString('pt-BR')`; se falhar, devolve o valor original.
   */
  function formatDateTime(value) {
    if (!value) return '';
    try { return new Date(value).toLocaleString('pt-BR'); }
    catch { return value; }
  }

  /**
   * Torna uma string segura para nome de arquivo.
   * Ativação: exportação de JSON do dossiê.
   * O que faz: troca caracteres fora de letras/números/ponto/hífen/sublinhado por `_`.
   */
  function safeFilename(value) {
    return String(value).replace(/[^a-z0-9._-]+/gi, '_');
  }

  /**
   * Inicializa o aplicativo após o carregamento do DOM.
   * Ativação: evento `DOMContentLoaded`.
   * O que faz: renderiza checklist e equipe, registra eventos, preenche data/hora, restaura
   * rascunho, atualiza status de chave e ativa o Service Worker.
   */
  function init() {
    renderChecklist();
    resetPeople();
    renderPeople();
    bindEvents();
    setDefaultDateTime();
    purgeLegacySharedStorage();
    updateKeyStatus();
    loadAuthState();
    renderAuthState();
    refreshMe();
    if (!authToken()) setTimeout(() => $('#loginMatricula')?.focus(), 100);
    registerServiceWorker();
  }

  document.addEventListener('DOMContentLoaded', init);
})();
