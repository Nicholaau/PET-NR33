'use strict';
/**
 * PET-Digital v1.2.0 — formulário e emissão.
 * O quê: fotos, assinaturas, checklist, medições, etapas, revisão, validação e finalização.
 * Como: coleta o formulário, aplica regras locais e prepara o dossiê assinado.
 * Quando: preenchimento e finalização da PET.
 *
 * Mudanças da v1.2.0 (interface aprovada no protótipo):
 * - barra fixa Voltar/Próxima no rodapé; campos ficam vermelhos só depois de tentar avançar;
 * - checklist agrupado por assunto, com contador e rolagem automática para o próximo item;
 * - medições com indicação de limite ao lado de cada campo e teste após ventilação automático;
 * - equipe em lista compacta, editor por pessoa, câmera traseira e assinatura em tela cheia;
 * - etapa 6 virou revisão completa antes de finalizar;
 * - a tentativa gerada e não registrada é reaproveitada (sem PET duplicada);
 * - restaurada a função focusIssue (antes `focusFirstFormIssue`, ausente na v1.1.6).
 */

/**
 * Lê uma foto selecionada/capturada e gera uma imagem JPEG compactada em Data URL.
 * Ativação: evento `change` do campo de foto de cada profissional.
 * O que faz: lê o arquivo, carrega em imagem, redimensiona em canvas e devolve uma
 * string `data:image/jpeg;base64,...` para salvar no dossiê e imprimir no PDF.
 */
async function fileToCompressedDataUrl(file, maxWidth = PHOTO_MAX_WIDTH, quality = PHOTO_JPEG_QUALITY) {
  if (!file || !file.type?.startsWith('image/')) throw new Error('Selecione uma imagem válida.');
  if (file.size > MAX_SOURCE_PHOTO_BYTES) throw new Error(`A foto excede ${MAX_SOURCE_PHOTO_BYTES / 1024 / 1024} MB. Use a câmera do aparelho ou uma imagem menor.`);
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
 * Obtém do próprio Worker o IP e a hora observados pelo servidor.
 * Ativação: geração da prova do PDF.
 * Como: chama `/client-context`; não consulta serviços públicos de terceiros e não
 * coloca respostas autenticadas no cache offline.
 */
async function getPublicIpInfo() {
  try {
    const context = await apiFetch('/client-context');
    return {
      ip: context.ip || '',
      source: 'cloudflare-worker',
      serverTime: context.serverTime || '',
      colo: context.colo || '',
      country: context.country || ''
    };
  } catch (error) {
    return { ip: '', source: '', error: error.message || 'IP não obtido.' };
  }
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
    serverObservedAt: ipInfo.serverTime || '',
    cloudflareColo: ipInfo.colo || '',
    cloudflareCountry: ipInfo.country || '',
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
 * Normaliza registros criados por tentativas anteriores antes de continuar uma emissão.
 * O quê: garante que objetos/arrays obrigatórios existam, inclusive `pdfGenerationProofs`.
 * Como: corrige somente a estrutura em memória; não inventa hashes, assinaturas nem arquivos.
 * Quando: ao reutilizar uma tentativa interrompida ou carregar registro de versão anterior.
 */
function normalizeFinalizationRecordStructure(record) {
  if (!record || typeof record !== 'object') return null;
  if (!record.integrity || typeof record.integrity !== 'object') record.integrity = {};
  if (!Array.isArray(record.integrity.pdfGenerationProofs)) record.integrity.pdfGenerationProofs = [];
  if (!record.idempotencyKey) record.idempotencyKey = crypto.randomUUID();
  return record;
}

/**
 * Confere se uma tentativa realmente pode ser reenviada ao servidor.
 * O quê: exige PDF + JSON + hashes de saída antes de marcar uma PET como pendente.
 * Como: consulta o IndexedDB e compara a existência dos artefatos com `record.output`.
 * Quando: após erro de rede/servidor e antes de exibir “Repetir registro pendente”.
 */
async function hasCompletePendingArtifacts(record) {
  const normalized = normalizeFinalizationRecordStructure(record);
  if (!normalized?.recordId || !normalized.output?.pdfHashSha256 || !normalized.output?.jsonHashSha256) return false;
  try {
    const files = await readOfficialFiles(normalized);
    return Boolean(files?.pdfFile && files?.jsonText);
  } catch {
    return false;
  }
}

/* =====================================================================
 * CHECKLIST
 * ===================================================================== */

/**
 * Renderiza o checklist agrupado por assunto.
 * O quê: um cartão por item, com Sim/Não/N/A e campo de justificativa que aparece só no N/A.
 * Como: um único conjunto de rádios por item (`check_NN`), usado por rascunho, validação e payload.
 * Quando: uma vez, na inicialização.
 */
function renderChecklist() {
  const container = $('#checklistGroups');
  if (!container) return;
  container.innerHTML = CHECKLIST_GROUPS.map(group => `
    <div class="check-group" data-check-group>
      <div class="check-group-head"><h3>${escapeHtml(group.title)}</h3><span data-group-count></span></div>
      ${group.items.map(n => {
        const text = checklistItems[Number(n) - 1];
        return `<fieldset class="check-card" id="ck-${n}" data-check-card="${n}">
          <legend><span class="check-number">${n}</span><span>${escapeHtml(text)}</span></legend>
          <div class="answers">
            <label class="answer-btn"><input type="radio" name="check_${n}" value="S" aria-label="Item ${n}: Sim" /><span>Sim</span></label>
            <label class="answer-btn"><input type="radio" name="check_${n}" value="N" aria-label="Item ${n}: Não" /><span>Não</span></label>
            <label class="answer-btn"><input type="radio" name="check_${n}" value="NA" aria-label="Item ${n}: Não se aplica" /><span>N/A</span></label>
          </div>
          <label class="field na-just hidden" id="ckj-${n}">Por que não se aplica?
            <input name="check_${n}_justification" maxlength="300" placeholder="Justificativa curta" />
          </label>
        </fieldset>`;
      }).join('')}
    </div>`).join('');
}

/** Mostra/oculta a justificativa do N/A conforme a resposta marcada. */
function updateNaJustificationVisibility(number) {
  const selected = $(`input[name="check_${number}"]:checked`);
  const box = $(`#ckj-${number}`);
  const input = $(`[name="check_${number}_justification"]`);
  const active = selected?.value === 'NA';
  box?.classList.toggle('hidden', !active);
  if (input && !active) input.value = '';
}

/** Atualiza contador geral, contadores por grupo e justificativas visíveis. */
function updateChecklistUi() {
  let answered = 0;
  CHECKLIST_DISPLAY_ORDER.forEach(n => {
    if ($(`input[name="check_${n}"]:checked`)) answered++;
    updateNaJustificationVisibility(n);
  });
  const text = $('#checklistProgressText');
  if (text) text.textContent = `${answered} de ${checklistItems.length} respondidos`;
  const bar = $('#checklistProgressBar');
  if (bar) bar.style.width = `${Math.round(answered / checklistItems.length * 100)}%`;
  $$('[data-check-group]').forEach((groupEl, idx) => {
    const items = CHECKLIST_GROUPS[idx].items;
    const done = items.filter(n => $(`input[name="check_${n}"]:checked`)).length;
    const counter = $('[data-group-count]', groupEl);
    if (counter) counter.textContent = `${done} / ${items.length}`;
  });
}

/** Depois de responder um item, leva a tela ao próximo item sem resposta. */
function scrollToNextChecklistItem(number, answer) {
  if (answer === 'NA') {
    setTimeout(() => $(`[name="check_${number}_justification"]`)?.focus({ preventScroll: false }), 60);
    return;
  }
  const order = CHECKLIST_DISPLAY_ORDER;
  const next = order.slice(order.indexOf(number) + 1).find(n => !$(`input[name="check_${n}"]:checked`));
  if (next) setTimeout(() => $(`#ck-${next}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 80);
}

/* =====================================================================
 * MEDIÇÕES
 * ===================================================================== */

/** Converte o texto digitado (aceita vírgula) em número; vazio vira null e texto inválido vira NaN. */
function parseGasValue(raw) {
  const text = String(raw ?? '').trim();
  if (!text) return null;
  const n = Number(text.replace(',', '.'));
  return Number.isFinite(n) ? n : NaN;
}

/** Avalia um teste (inicial ou após ventilação) a partir dos campos do formulário. */
function evaluateGasTest(prefix) {
  const form = $('#petForm');
  const hora = form.elements[`${prefix}_hora`]?.value || '';
  const result = { hora, values: {}, complete: !!hora, out: false, invalid: false, any: !!hora || !!normalizeText(form.elements[`${prefix}_obs`]?.value) };
  GAS_LIMITS.forEach(limit => {
    const value = parseGasValue(form.elements[`${prefix}_${limit.key}`]?.value);
    result.values[limit.key] = value;
    if (value === null) { result.complete = false; return; }
    result.any = true;
    if (Number.isNaN(value) || value < 0) { result.invalid = true; result.complete = false; return; }
    if (!limit.ok(value)) result.out = true;
  });
  result.safe = result.complete && !result.out;
  return result;
}

let ventilationAdded = false;

/**
 * Atualiza a indicação de limite de cada campo e a exibição do teste após ventilação.
 * O teste após ventilação aparece sozinho quando algum valor inicial sai do limite.
 */
function updateGasUi() {
  const form = $('#petForm');
  if (!form) return;
  ['gas_inicial', 'gas_ventilacao'].forEach(prefix => {
    GAS_LIMITS.forEach(limit => {
      const name = `${prefix}_${limit.key}`;
      const chip = $(`[data-gas-status="${name}"]`);
      if (!chip) return;
      const value = parseGasValue(form.elements[name]?.value);
      if (value === null) { chip.classList.add('hidden'); return; }
      chip.classList.remove('hidden');
      if (Number.isNaN(value) || value < 0) { chip.className = 'status-chip status-bad'; chip.textContent = 'Valor inválido'; }
      else if (limit.ok(value)) { chip.className = 'status-chip status-ok'; chip.textContent = 'Dentro do limite'; }
      else { chip.className = 'status-chip status-bad'; chip.textContent = 'Fora do limite'; }
    });
  });
  const initial = evaluateGasTest('gas_inicial');
  const vent = evaluateGasTest('gas_ventilacao');
  const needVent = initial.out;
  const showVent = needVent || ventilationAdded || vent.any;
  $('#ventNeededNotice')?.classList.toggle('hidden', !needVent);
  $('#ventCard')?.classList.toggle('hidden', !showVent);
  $('#addVentBtn')?.classList.toggle('hidden', showVent);
  $('#removeVentBtn')?.classList.toggle('hidden', needVent || !showVent);
}

/** Remove o teste após ventilação opcional (só quando o inicial está dentro do limite). */
function removeVentilationTest() {
  const form = $('#petForm');
  ['hora', 'o2', 'lie', 'h2s', 'co', 'obs'].forEach(k => { const el = form.elements[`gas_ventilacao_${k}`]; if (el) el.value = ''; });
  ventilationAdded = false;
  updateGasUi();
  autoSaveDraft();
}

/* =====================================================================
 * EQUIPE
 * ===================================================================== */

function createPerson(type, required = false) {
  const baseRole = type === 'supervisor' ? 'Supervisor de Entrada' : type === 'vigia' ? 'Vigia' : 'Entrante';
  return {
    id: crypto.randomUUID ? crypto.randomUUID() : 'p-' + Date.now() + '-' + Math.random().toString(16).slice(2),
    role: type === 'supervisor' ? baseRole : `${baseRole} - 1`,
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

/** Reinicia a equipe com o mínimo obrigatório: supervisor, 1 entrante e 1 vigia. */
function resetPeople() {
  people = initialPeople.map(p => createPerson(p.type, p.required));
  reindexPeople();
}

/** Ordena (supervisor, entrantes, vigias) e renumera os rótulos. */
function reindexPeople() {
  const rank = { supervisor: 0, entrante: 1, vigia: 2 };
  people.sort((a, b) => (rank[a.type] ?? 9) - (rank[b.type] ?? 9));
  let entrante = 0;
  let vigia = 0;
  people.forEach(p => {
    if (p.type === 'entrante') p.role = `Entrante - ${++entrante}`;
    if (p.type === 'vigia') p.role = `Vigia - ${++vigia}`;
    if (p.type === 'supervisor') p.role = 'Supervisor de Entrada';
  });
}

/** Rótulo amigável para a tela ("Entrante 1" em vez de "Entrante - 1"). */
function personLabel(person) { return String(person?.role || '').replace(' - ', ' '); }

function initialsOf(name) {
  const parts = normalizeText(name).split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}

function personIsComplete(p) {
  return Boolean(normalizeText(p.nome) && normalizeText(p.matricula) && p.photoDataUrl && p.signatureDataUrl);
}

/** Adiciona entrante ou vigia e abre direto o editor da pessoa nova. */
function addProfessional(type) {
  const counts = people.reduce((acc, p) => { acc[p.type] = (acc[p.type] || 0) + 1; return acc; }, {});
  if (people.length >= MAX_PARTICIPANTS) return notify(`Limite total de ${MAX_PARTICIPANTS} participantes atingido.`, 'bad');
  if (type === 'entrante' && (counts.entrante || 0) >= MAX_ENTRANTES) return notify(`Limite de ${MAX_ENTRANTES} entrantes atingido.`, 'bad');
  if (type === 'vigia' && (counts.vigia || 0) >= MAX_VIGIAS) return notify(`Limite de ${MAX_VIGIAS} vigias atingido.`, 'bad');
  const person = createPerson(type, false);
  people.push(person);
  reindexPeople();
  renderPeople();
  autoSaveDraft();
  openPerson(person.id);
}

/** Mostra o supervisor (vindo da etapa Equipe) na etapa Identificação. */
function updateSupervisorAutoDisplay() {
  const supervisor = people.find(person => person.type === 'supervisor');
  const label = $('#supervisorAutoLabel');
  if (!label) return;
  const nome = normalizeText(supervisor?.nome);
  const matricula = normalizeText(supervisor?.matricula);
  label.textContent = nome ? `${nome}${matricula ? ` — matrícula ${matricula}` : ''}` : 'Preenchido a partir da etapa Equipe';
}

/** Lista compacta da equipe: uma linha por pessoa, com situação da foto e da assinatura. */
function renderPeople() {
  const list = $('#peopleList');
  if (!list) return;
  const flagged = triedSteps.has(4);
  list.innerHTML = people.map(p => {
    const missing = flagged && !personIsComplete(p);
    const photoChip = p.photoDataUrl ? ['status-ok', 'Foto ok'] : [missing ? 'status-bad' : 'status-neutral', 'Sem foto'];
    const sigChip = p.signatureDataUrl ? ['status-ok', 'Assinado'] : [missing ? 'status-bad' : 'status-neutral', 'Sem assinatura'];
    const nome = normalizeText(p.nome);
    return `<button type="button" class="person-row${missing ? ' is-missing' : ''}" id="pp-${escapeAttr(p.id)}" data-person-open="${escapeAttr(p.id)}">
      <span class="avatar">${p.photoDataUrl ? `<img src="${p.photoDataUrl}" alt="" />` : escapeHtml(initialsOf(nome))}</span>
      <span class="person-main">
        <span class="person-role">${escapeHtml(personLabel(p))}</span>
        <span class="person-name${nome ? '' : ' empty'}">${escapeHtml(nome || 'Nome não informado')}</span>
        <span class="person-chips"><span class="status-chip ${photoChip[0]}">${photoChip[1]}</span><span class="status-chip ${sigChip[0]}">${sigChip[1]}</span></span>
      </span>
      <svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg>
    </button>`;
  }).join('');
  updateSupervisorAutoDisplay();
}

let openPersonId = null;

/** Abre o editor de uma pessoa da equipe. */
function openPerson(id) {
  const person = people.find(p => p.id === id);
  if (!person) return;
  openPersonId = id;
  renderPersonView();
  showFormView('person');
  window.scrollTo({ top: 0 });
}

/** Preenche o editor com os dados da pessoa aberta. */
function renderPersonView() {
  const person = people.find(p => p.id === openPersonId);
  if (!person) return;
  $('#personRoleTitle').textContent = personLabel(person);
  $('#personNome').value = person.nome || '';
  $('#personMatricula').value = person.matricula || '';
  const preview = $('#personPhotoPreview');
  preview.classList.toggle('has-image', !!person.photoDataUrl);
  preview.innerHTML = person.photoDataUrl
    ? `<img src="${person.photoDataUrl}" alt="Foto de ${escapeAttr(person.nome || personLabel(person))}" />`
    : '<span>Rosto e crachá funcional devem aparecer na foto</span>';
  $('#personPhotoLabel').textContent = person.photoDataUrl ? 'Tirar outra foto' : 'Tirar foto';
  $('#personPhotoInfo').textContent = person.photoCapturedAt ? `Foto registrada em ${formatDateTime(person.photoCapturedAt)}.` : 'Abre a câmera traseira, para fotografar o colega.';
  const sig = $('#personSigPreview');
  sig.innerHTML = person.signatureDataUrl ? `<img src="${person.signatureDataUrl}" alt="Assinatura registrada" />` : '<span>Assinatura pendente</span>';
  $('#personSignBtn').textContent = person.signatureDataUrl ? 'Assinar novamente' : 'Assinar em tela cheia';
  $('#personSigInfo').textContent = person.signedAt ? `Assinada em ${formatDateTime(person.signedAt)}.` : '';
  const sameType = people.filter(p => p.type === person.type).length;
  const removable = person.type !== 'supervisor' && sameType > 1;
  const removeBtn = $('#personRemoveBtn');
  removeBtn.classList.toggle('hidden', !removable);
  removeBtn.textContent = `Remover ${personLabel(person)}`;
}

/** Fecha o editor e volta para a lista, posicionando na pessoa editada. */
function closePerson() {
  const id = openPersonId;
  openPersonId = null;
  renderPeople();
  showFormView('form');
  if (triedSteps.has(4)) refreshStepIssues();
  if (id) setTimeout(() => $(`#pp-${CSS.escape(id)}`)?.scrollIntoView({ block: 'center' }), 30);
}

/* ---------- Assinatura em tela cheia ---------- */

let signatureTarget = null;
let signatureDrawn = false;

/**
 * Abre a área de assinatura em tela cheia.
 * Como: ajusta o tamanho interno do canvas ao tamanho real na tela (evita traço distorcido)
 * e limpa qualquer traço anterior. A assinatura só é gravada em "Confirmar assinatura".
 */
function openSignature(personId) {
  const person = people.find(p => p.id === personId);
  if (!person) return;
  signatureTarget = personId;
  signatureDrawn = false;
  $('#signatureWho').textContent = `${personLabel(person)}${person.nome ? ' — ' + person.nome : ''}`;
  $('#toast')?.classList.add('hidden');
  $('#signatureOverlay').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
  requestAnimationFrame(resizeSignaturePad);
}

function resizeSignaturePad() {
  const canvas = $('#signaturePad');
  if (!canvas || $('#signatureOverlay').classList.contains('hidden')) return;
  const rect = canvas.getBoundingClientRect();
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.max(300, Math.round(rect.width * ratio));
  canvas.height = Math.max(150, Math.round(rect.height * ratio));
  const ctx = canvas.getContext('2d');
  ctx.lineWidth = 3 * ratio;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = '#111';
  signatureDrawn = false;
}

function closeSignature() {
  signatureTarget = null;
  $('#signatureOverlay').classList.add('hidden');
  document.body.style.overflow = '';
}

/** Liga os eventos de desenho (ponteiro: dedo, caneta ou mouse) uma única vez. */
function setupSignaturePad() {
  const canvas = $('#signaturePad');
  if (!canvas) return;
  let drawing = false;
  const pos = event => {
    const rect = canvas.getBoundingClientRect();
    return { x: (event.clientX - rect.left) * (canvas.width / rect.width), y: (event.clientY - rect.top) * (canvas.height / rect.height) };
  };
  canvas.addEventListener('pointerdown', event => {
    event.preventDefault();
    drawing = true;
    try { canvas.setPointerCapture(event.pointerId); } catch {}
    const p = pos(event);
    const ctx = canvas.getContext('2d');
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
  });
  canvas.addEventListener('pointermove', event => {
    if (!drawing) return;
    event.preventDefault();
    const p = pos(event);
    const ctx = canvas.getContext('2d');
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    signatureDrawn = true;
  });
  const end = () => { drawing = false; };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
  canvas.addEventListener('pointerleave', end);
  window.addEventListener('resize', () => { if (signatureTarget && !signatureDrawn) resizeSignaturePad(); });
}

function clearSignaturePad() {
  const canvas = $('#signaturePad');
  canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
  signatureDrawn = false;
}

/** Confere se há traço suficiente, grava imagem, data/hora e hash da assinatura. */
async function confirmSignature() {
  const person = people.find(p => p.id === signatureTarget);
  if (!person) return closeSignature();
  const canvas = $('#signaturePad');
  const metrics = getSignatureCanvasMetrics(canvas);
  if (!metrics.isSigned) return notify('Desenhe a assinatura antes de confirmar.', 'bad');
  person.signatureDataUrl = canvas.toDataURL('image/png');
  person.signedAt = new Date().toISOString();
  person.signatureHash = await sha256Hex(person.signatureDataUrl);
  person.signatureMetrics = metrics;
  closeSignature();
  renderPersonView();
  autoSaveDraft();
  notify('Assinatura registrada.', 'ok', 2000);
}

/** Comprime a foto, registra data/hora e hash e atualiza o editor. */
async function handlePersonPhoto(file) {
  const person = people.find(p => p.id === openPersonId);
  if (!person || !file) return;
  try {
    const dataUrl = await fileToCompressedDataUrl(file);
    person.photoDataUrl = dataUrl;
    person.photoCapturedAt = new Date().toISOString();
    person.photoHash = await sha256Hex(dataUrl);
    renderPersonView();
    autoSaveDraft();
    notify('Foto registrada.', 'ok', 2000);
  } catch (err) {
    notify('Não foi possível registrar a foto: ' + err.message, 'bad');
  }
}

/* =====================================================================
 * NAVEGAÇÃO ENTRE ETAPAS
 * ===================================================================== */

/** Alterna entre formulário, editor de pessoa e tela de conclusão dentro da aba Nova PET. */
function showFormView(view) {
  $('#formView')?.classList.toggle('hidden', view !== 'form');
  $('#personView')?.classList.toggle('hidden', view !== 'person');
  $('#doneView')?.classList.toggle('hidden', view !== 'done');
  updateStepBar();
}

/** A barra Voltar/Próxima só aparece no formulário da aba Nova PET. */
function updateStepBar() {
  const logged = !!(authState || loadAuthState())?.user;
  const formTabActive = $('#formTab')?.classList.contains('active');
  const formVisible = !$('#formView')?.classList.contains('hidden');
  const show = logged && formTabActive && formVisible;
  $('#stepBar')?.classList.toggle('hidden', !show);
  $('#appShell')?.classList.toggle('with-bar', show);
}

/**
 * Exibe uma etapa do formulário.
 * O quê: mostra a seção, atualiza título, segmentos de progresso e rótulos da barra inferior.
 * Quando: navegação Voltar/Próxima, links "Corrigir" da revisão e reinício do formulário.
 */
function showFormStep(step, options = {}) {
  const normalized = Math.min(FORM_STEPS.length, Math.max(1, Number(step) || 1));
  currentFormStep = normalized;
  $$('[data-form-step]').forEach(section => section.classList.toggle('form-step-hidden', Number(section.dataset.formStep) !== normalized));
  const title = $('#stepTitle');
  if (title) title.textContent = FORM_STEPS[normalized - 1].label;
  const counter = $('#stepCounter');
  if (counter) counter.textContent = `Etapa ${normalized} de ${FORM_STEPS.length}`;
  $$('#stepSegments span').forEach((seg, idx) => {
    seg.classList.toggle('done', idx + 1 < normalized);
    seg.classList.toggle('current', idx + 1 === normalized);
  });
  const prev = $('#formPrevBtn');
  if (prev) prev.disabled = normalized === 1;
  const next = $('#formNextBtn');
  if (next) {
    next.textContent = normalized < 5 ? 'Próxima etapa' : normalized === 5 ? 'Revisar' : 'Finalizar PET';
    next.classList.toggle('success', normalized === 6);
    next.classList.toggle('primary', normalized !== 6);
  }
  $('#discardConfirm')?.classList.add('hidden');
  if (normalized === 6) renderReview();
  refreshStepIssues();
  if (!options.keepScroll) window.scrollTo({ top: 0, behavior: options.smooth ? 'smooth' : 'auto' });
}

/** Valida a etapa atual; com pendências, mostra o resumo e leva ao primeiro campo. */
function goToNextFormStep() {
  if (currentFormStep === 6) { finalizeRecord(); return; }
  const result = validateFormStep(currentFormStep);
  if (!result.ok) {
    triedSteps.add(currentFormStep);
    refreshStepIssues();
    if (currentFormStep === 4) renderPeople();
    window.scrollTo({ top: 0, behavior: 'smooth' });
    return;
  }
  if (result.warnings?.length) notify(result.warnings.join('\n'), 'info', 6000);
  showFormStep(currentFormStep + 1);
}

/**
 * Leva a tela ao campo/cartão com problema e coloca o foco nele.
 * (Na v1.1.6 esta função era chamada como `focusFirstFormIssue`, mas não existia.)
 */
function focusIssue(target) {
  if (!target) return;
  target.scrollIntoView({ behavior: 'smooth', block: 'center' });
  const focusable = target.matches?.('input, textarea, select, button') ? target : target.querySelector?.('input, textarea, select, button');
  setTimeout(() => focusable?.focus({ preventScroll: true }), 250);
}

/**
 * Mostra o resumo de pendências da etapa atual e marca os campos em vermelho.
 * Só age em etapas em que o usuário já tentou avançar; depois disso, atualiza sozinho
 * conforme ele corrige (o vermelho some quando o campo é preenchido).
 */
function refreshStepIssues() {
  const box = $('#stepErrorBox');
  $$('.is-invalid, .is-missing').forEach(el => el.classList.remove('is-invalid', 'is-missing'));
  if (!box) return;
  const step = currentFormStep;
  if (step === 6 || !triedSteps.has(step)) { box.classList.add('hidden'); return; }
  const result = validateFormStep(step);
  result.issues.forEach(issue => {
    if (!issue.target) return;
    if (issue.target.matches?.('fieldset, .person-row, .consent-card')) issue.target.classList.add('is-missing');
    else issue.target.classList.add('is-invalid');
  });
  if (!result.issues.length) { box.classList.add('hidden'); return; }
  const blocking = result.issues.find(i => i.blocking);
  $('#stepErrorTitle').textContent = blocking ? blocking.message
    : result.issues.length === 1 ? 'Falta 1 informação nesta etapa' : `Faltam ${result.issues.length} informações nesta etapa`;
  const lines = result.issues.filter(i => !i.blocking).slice(0, 4).map(i => `<li>${escapeHtml(i.message)}</li>`);
  const extra = result.issues.filter(i => !i.blocking).length - 4;
  if (extra > 0) lines.push(`<li>e mais ${extra}</li>`);
  $('#stepErrorList').innerHTML = lines.join('');
  $('#stepErrorGo').onclick = () => focusIssue(result.issues[0].target);
  box.classList.remove('hidden');
}

/* =====================================================================
 * COLETA DE DADOS
 * ===================================================================== */

/** Coleta os campos gerais (o checklist e a equipe têm estrutura própria). */
function collectFormFields() {
  const form = $('#petForm');
  const data = new FormData(form);
  const fields = {};
  for (const [key, value] of data.entries()) {
    if (key.startsWith('check_')) continue;
    fields[key] = normalizeText(value);
  }
  const supervisor = people.find(person => person.type === 'supervisor');
  fields.supervisorEntrada = normalizeText(supervisor?.nome);
  fields.supervisorMatricula = normalizeText(supervisor?.matricula);
  fields.userAgent = navigator.userAgent;
  fields.appVersion = APP_VERSION;
  fields.collectedAt = new Date().toISOString();
  return fields;
}

/** Respostas do checklist na ordem oficial (01 a 22). */
function collectChecklist() {
  return checklistItems.map((item, idx) => {
    const n = String(idx + 1).padStart(2, '0');
    const selected = $(`input[name="check_${n}"]:checked`);
    const justification = normalizeText($(`[name="check_${n}_justification"]`)?.value);
    return { number: n, item, answer: selected ? selected.value : '', justification };
  });
}

/** Equipe para o dossiê: dados, foto, assinatura e hashes. */
function collectPeople() {
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

/** Mantido por compatibilidade: na v1.2.0 o editor grava direto no array `people`. */
function syncPeopleFromInputs() {}

function generatePetNumber(fields) {
  const datePart = (fields.data || todayISO()).replace(/-/g, '');
  const now = new Date();
  const timePart = `${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`;
  const randomPart = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `PET-${datePart}-${timePart}-${randomPart}`;
}

/** Monta o payload assinado. O número é criado uma única vez por tentativa oficial. */
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
      validationCriteria: 'O2 > 19,5 e < 23; LIE < 10; H2S < 5 ppm; CO < 25 ppm; todos os itens do checklist respondidos; N/A com justificativa. As alternativas Sim, Não e N/A são registradas conforme informado e não bloqueiam a emissão por si só.'
    }
  };
}

/**
 * "Impressão digital" do que está preenchido (sem as imagens, só os hashes delas).
 * Usada para saber se o formulário mudou desde a tentativa que ficou pendente.
 */
async function formFingerprint() {
  return sha256Hex({
    fields: serializeForm(),
    people: collectPeople().map(p => ({ ...p, photoDataUrl: undefined, signatureDataUrl: undefined, signatureMetrics: undefined }))
  });
}

/* =====================================================================
 * VALIDAÇÃO
 * Cada regra devolve { message, target, blocking? }. `target` é o elemento destacado.
 * ===================================================================== */

function validateIdentificationSection() {
  const form = $('#petForm');
  const issues = [];
  const warnings = [];
  [['unidade', 'Nome da unidade'], ['local', 'Local do espaço confinado'], ['data', 'Data'], ['horaEmissao', 'Hora da emissão'], ['horaTermino', 'Hora do término'], ['trabalho', 'Trabalho a ser realizado']]
    .forEach(([name, label]) => { if (!normalizeText(form.elements[name]?.value)) issues.push({ message: label, target: form.elements[name] }); });
  if (!$('input[name="equipeSalvamento"]:checked')) issues.push({ message: 'Equipe de salvamento', target: $('#salvamentoGroup') });
  if (!normalizeText(form.elements.detectorId?.value)) issues.push({ message: 'Nº de série do detector', target: form.elements.detectorId });
  const calib = form.elements.detectorCalibracao?.value;
  if (!calib) issues.push({ message: 'Validade da calibração do detector', target: form.elements.detectorCalibracao });
  else if (calib < (form.elements.data?.value || todayISO())) issues.push({ message: 'Calibração do detector vencida na data da PET', target: form.elements.detectorCalibracao });
  const emission = form.elements.horaEmissao?.value;
  const termino = form.elements.horaTermino?.value;
  if (emission && termino && termino <= emission) warnings.push('A hora de término é igual ou anterior à emissão. Confira se o serviço atravessa a meia-noite.');
  return { issues, warnings };
}

function validateChecklistSection() {
  const issues = [];
  const warnings = [];
  const checklist = collectChecklist();
  const byNumber = Object.fromEntries(checklist.map(c => [c.number, c]));
  CHECKLIST_DISPLAY_ORDER.forEach(n => {
    const c = byNumber[n];
    if (!c.answer) issues.push({ message: `Item ${n} sem resposta`, target: $(`#ck-${n}`) });
    else if (c.answer === 'NA' && !normalizeText(c.justification)) issues.push({ message: `Item ${n}: justificativa do N/A`, target: $(`[name="check_${n}_justification"]`) });
  });
  return { issues, warnings, checklist };
}

function validateGasSection() {
  const form = $('#petForm');
  const issues = [];
  const check = (prefix, label) => {
    if (!form.elements[`${prefix}_hora`]?.value) issues.push({ message: `${label}: hora da medição`, target: form.elements[`${prefix}_hora`] });
    GAS_LIMITS.forEach(limit => {
      const el = form.elements[`${prefix}_${limit.key}`];
      const value = parseGasValue(el?.value);
      if (value === null) issues.push({ message: `${label}: ${limit.label}`, target: el });
      else if (Number.isNaN(value) || value < 0) issues.push({ message: `${label}: valor inválido em ${limit.label}`, target: el });
    });
  };
  check('gas_inicial', 'Teste inicial');
  const initial = evaluateGasTest('gas_inicial');
  const vent = evaluateGasTest('gas_ventilacao');
  if (initial.out || vent.any) {
    check('gas_ventilacao', 'Após ventilação');
    if (vent.complete && vent.out) {
      issues.unshift({ message: 'Após a ventilação a atmosfera continua fora do limite. A entrada não pode ser autorizada.', target: form.elements.gas_ventilacao_o2, blocking: true });
    }
  }
  return { issues, warnings: [] };
}

function validatePeopleSection() {
  const issues = [];
  const counts = people.reduce((acc, p) => { acc[p.type] = (acc[p.type] || 0) + 1; return acc; }, {});
  if (people.length > MAX_PARTICIPANTS) issues.push({ message: `A equipe excede ${MAX_PARTICIPANTS} participantes`, target: $('#peopleList') });
  if ((counts.entrante || 0) > MAX_ENTRANTES) issues.push({ message: `A equipe excede ${MAX_ENTRANTES} entrantes`, target: $('#peopleList') });
  if ((counts.vigia || 0) > MAX_VIGIAS) issues.push({ message: `A equipe excede ${MAX_VIGIAS} vigias`, target: $('#peopleList') });
  if (!counts.entrante) issues.push({ message: 'Inclua pelo menos um entrante', target: $('#addEntrante') });
  if (!counts.vigia) issues.push({ message: 'Inclua pelo menos um vigia', target: $('#addVigia') });
  if (counts.supervisor !== 1) issues.push({ message: 'A PET precisa de exatamente um supervisor de entrada', target: $('#peopleList') });
  people.forEach(p => {
    const falta = [];
    if (!normalizeText(p.nome)) falta.push('nome');
    if (!normalizeText(p.matricula)) falta.push('matrícula');
    if (!p.photoDataUrl) falta.push('foto');
    if (!p.signatureDataUrl) falta.push('assinatura');
    if (falta.length) issues.push({ message: `${personLabel(p)}: falta ${falta.join(', ')}`, target: $(`#pp-${CSS.escape(p.id)}`) });
  });
  const seen = new Map();
  people.forEach(p => {
    const mat = normalizeText(p.matricula).toLowerCase();
    if (!mat) return;
    if (seen.has(mat)) issues.push({ message: `Matrícula ${mat} repetida (${seen.get(mat)} e ${personLabel(p)})`, target: $(`#pp-${CSS.escape(p.id)}`) });
    else seen.set(mat, personLabel(p));
  });
  return { issues, warnings: [] };
}

function validateConsentSection() {
  const input = $('#petForm').elements.declaracaoCiencia;
  return { issues: input?.checked ? [] : [{ message: 'Confirmação de ciência da equipe', target: $('#cienciaCard') }], warnings: [] };
}

/** Valida uma etapa. Sim, Não e N/A nunca bloqueiam; só falta de resposta/justificativa. */
function validateFormStep(step) {
  let result = { issues: [], warnings: [] };
  if (step === 1) result = validateIdentificationSection();
  if (step === 2) result = validateChecklistSection();
  if (step === 3) result = validateGasSection();
  if (step === 4) result = validatePeopleSection();
  if (step === 5) result = validateConsentSection();
  return { ...result, ok: result.issues.length === 0, errors: result.issues.map(i => i.message) };
}

/** Executa todas as regras antes da emissão; devolve as etapas com pendência. */
function validateCurrentForm() {
  const pendingSteps = [];
  const errors = [];
  const warnings = [];
  [1, 2, 3, 4, 5].forEach(step => {
    const result = validateFormStep(step);
    if (!result.ok) pendingSteps.push({ step, count: result.issues.length, first: result.issues[0] });
    errors.push(...result.errors);
    warnings.push(...(result.warnings || []));
  });
  if (!crypto?.subtle) errors.push('Este navegador não oferece os recursos criptográficos necessários.');
  return { ok: errors.length === 0, errors, warnings, pendingSteps };
}

/* =====================================================================
 * REVISÃO (ETAPA 6)
 * ===================================================================== */

function reviewBlock(title, step, inner) {
  return `<div class="card review-card">
    <div class="row-between"><h3>${escapeHtml(title)}</h3><button type="button" class="link" data-go-step="${step}">Corrigir</button></div>
    ${inner}
  </div>`;
}

function reviewItem(k, v) {
  return `<div class="review-item"><span class="k">${escapeHtml(k)}</span><span class="v">${escapeHtml(v || '—')}</span></div>`;
}

function formatGasLine(test) {
  return GAS_LIMITS.map(limit => {
    const v = test.values[limit.key];
    const shown = v === null ? '—' : String(v).replace('.', ',');
    return `${limit.short} ${shown}${limit.key === 'o2' || limit.key === 'lie' ? '%' : ' ppm'}`;
  }).join(' · ');
}

/**
 * Monta a tela de revisão: pendências, identificação, checklist (com NÃO e N/A em destaque),
 * medições e equipe, cada bloco com "Corrigir".
 */
function renderReview() {
  const box = $('#reviewContent');
  if (!box) return;
  const f = collectFormFields();
  const checklist = collectChecklist();
  const validation = validateCurrentForm();
  const pending = $('#reviewPending');
  if (pending) {
    if (validation.pendingSteps.length) {
      pending.innerHTML = `<strong>Ainda há pendências</strong>${validation.pendingSteps.map(p =>
        `<button type="button" class="link" data-go-step="${p.step}">Etapa ${p.step} — ${escapeHtml(FORM_STEPS[p.step - 1].label)}: ${p.count} ${p.count === 1 ? 'pendência' : 'pendências'}</button>`).join('')}`;
      pending.classList.remove('hidden');
    } else pending.classList.add('hidden');
  }
  const sup = people.find(p => p.type === 'supervisor');
  const ident = [
    reviewItem('Unidade e local', `${f.unidade || '—'} · ${f.local || '—'}`),
    reviewItem('Data e horário', `${formatDate(f.data)}, das ${f.horaEmissao || '—'} às ${f.horaTermino || '—'}`),
    reviewItem('Trabalho', f.trabalho),
    reviewItem('Supervisor de entrada', sup?.nome ? `${sup.nome} (${sup.matricula || 'sem matrícula'})` : ''),
    reviewItem('Equipe de salvamento', `${f.equipeSalvamento || '—'} · ${f.telefoneSalvamento || ''}`)
  ].join('');
  const s = checklist.filter(c => c.answer === 'S').length;
  const n = checklist.filter(c => c.answer === 'N');
  const na = checklist.filter(c => c.answer === 'NA');
  const checklistHtml = `<div class="counts">
      <div class="count s"><b>${s}</b><small>Sim</small></div>
      <div class="count n"><b>${n.length}</b><small>Não</small></div>
      <div class="count na"><b>${na.length}</b><small>N/A</small></div>
    </div>
    ${n.length ? `<div class="review-list n"><span class="title">Itens marcados como NÃO — confira antes de emitir</span>${n.map(c => `<span><strong>${c.number}</strong> — ${escapeHtml(c.item)}</span>`).join('')}</div>` : ''}
    ${na.length ? `<div class="review-list na"><span class="title">Itens N/A e justificativas</span>${na.map(c => `<span><strong>${c.number}</strong> — ${escapeHtml(c.item)}<br><em>“${escapeHtml(c.justification || 'sem justificativa')}”</em></span>`).join('')}</div>` : ''}`;
  const initial = evaluateGasTest('gas_inicial');
  const vent = evaluateGasTest('gas_ventilacao');
  const gasRow = (label, t) => {
    const status = t.safe ? ['status-ok', 'Dentro do limite'] : t.complete ? ['status-bad', 'Fora do limite'] : ['status-neutral', 'Incompleto'];
    return `<div class="review-item"><div class="review-row"><strong>${escapeHtml(label)}${t.hora ? ' — ' + escapeHtml(t.hora) : ''}</strong><span class="status-chip ${status[0]}">${status[1]}</span></div><span class="v">${escapeHtml(formatGasLine(t))}</span></div>`;
  };
  const gasHtml = gasRow('Teste inicial', initial)
    + ((initial.out || vent.any) ? gasRow('Após ventilação', vent) : '')
    + `<span class="muted small-text">Detector: ${escapeHtml(f.detectorId || '—')}${f.detectorCalibracao ? `, calibração válida até ${escapeHtml(formatDate(f.detectorCalibracao))}` : ''}</span>`;
  const teamHtml = people.map(p => {
    const ok = personIsComplete(p);
    return `<div class="review-row"><span><strong>${escapeHtml(personLabel(p))}</strong><br>${escapeHtml(p.nome || 'Nome não informado')}${p.matricula ? ' · ' + escapeHtml(p.matricula) : ''}</span><span class="status-chip ${ok ? 'status-ok' : 'status-bad'}">${ok ? 'Completo' : 'Pendente'}</span></div>`;
  }).join('');
  box.innerHTML = reviewBlock('Identificação', 1, ident)
    + reviewBlock('Checklist', 2, checklistHtml)
    + reviewBlock('Medições', 3, gasHtml)
    + reviewBlock('Equipe', 4, teamHtml)
    + reviewBlock('Ciência e observações', 5, reviewItem('Declaração de ciência', $('#petForm').elements.declaracaoCiencia?.checked ? 'Confirmada' : 'Não confirmada') + reviewItem('Observações', f.observacoes));
  updateDeviceChip();
  renderPendingAttempt();
}

/** Mostra, na revisão, o aviso de tentativa gerada e ainda não registrada. */
function renderPendingAttempt() {
  const box = $('#pendingAttemptBox');
  if (!box) return;
  const pending = finalizedRecord && !finalizedRecord.serverRegistration && finalizedRecord.pendingOfficialRegistration;
  box.classList.toggle('hidden', !pending);
  if (pending) {
    $('#pendingAttemptText').textContent = `A PET ${finalizedRecord.payload?.fields?.petNumero || finalizedRecord.recordId} já foi gerada, mas o envio ao sistema não terminou. Repita o envio: o mesmo número e os mesmos arquivos serão usados, sem criar outra PET.`;
  }
}

/* =====================================================================
 * EMISSÃO
 * ===================================================================== */

/**
 * Descarta uma tentativa gerada e não registrada.
 * Ela fica marcada como "cancelada antes do registro" em Minhas PETs e perde o botão de reenvio.
 */
function discardPendingAttempt(record) {
  if (!record) return;
  record.pendingOfficialRegistration = false;
  record.discardedAt = new Date().toISOString();
  updateStoredRecord(record);
  deleteOfficialFiles(record.recordId);
  clearPendingPointer();
  if (finalizedRecord?.recordId === record.recordId) finalizedRecord = null;
}

/**
 * Finaliza a PET como operação única: gera PDF, calcula hashes reais, gera o JSON e registra.
 * v1.2.0: uma tentativa pendente é reaproveitada se o formulário não mudou; se mudou, o usuário
 * escolhe descartá-la antes de gerar outra — assim não surgem duas PETs para a mesma entrada.
 */
async function finalizeRecord() {
  if (finalizationInProgress) return;
  if (finalizedRecord?.serverRegistration) { showDone(finalizedRecord); return; }

  const validation = validateCurrentForm();
  if (!validation.ok) {
    validation.pendingSteps.forEach(p => triedSteps.add(p.step));
    renderReview();
    window.scrollTo({ top: 0, behavior: 'smooth' });
    return notify('Ainda há pendências. Toque nelas para corrigir.', 'bad');
  }

  const fingerprint = await formFingerprint();
  if (finalizedRecord && finalizedRecord.pendingOfficialRegistration && finalizedRecord.pendingFormFingerprint && finalizedRecord.pendingFormFingerprint !== fingerprint) {
    const ok = await askConfirm(`Existe uma PET gerada e ainda não registrada (${finalizedRecord.payload?.fields?.petNumero || finalizedRecord.recordId}), e o formulário foi alterado depois dela.\n\nDescartar essa tentativa e emitir uma nova PET com os dados atuais?`, { okLabel: 'Descartar e emitir nova', danger: true });
    if (!ok) return;
    discardPendingAttempt(finalizedRecord);
  }

  const accessOk = await ensureOfficialAccessOrGuide('finalizar a PET');
  if (!accessOk) { updateDeviceChip(); return; }

  finalizationInProgress = true;
  setBusy(true, 'Gerando PDF e arquivo de validação', 'Assinando com a chave deste aparelho e registrando no sistema. Não feche o aplicativo.');
  try {
    let record = normalizeFinalizationRecordStructure(finalizedRecord);
    if (record?.serverRegistration || record?.discardedAt) record = null;
    if (record && record.output?.pdfHashSha256 && await hasCompletePendingArtifacts(record)) {
      // Mesma PET, mesmos arquivos: apenas repete o envio.
      const files = await readOfficialFiles(record);
      await registerRecordOnServer(record, { pdfFile: files.pdfFile, jsonText: files.jsonText });
      await completeRegistration(record, files.pdfFile, files.jsonText);
      return;
    }
    if (!record) {
      const payload = buildPayload();
      const payloadHash = await sha256Hex(payload);
      const signature = await signPayloadHash(payloadHash);
      record = normalizeFinalizationRecordStructure({
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
        pendingOfficialRegistration: false
      });
      record.pendingFormFingerprint = fingerprint;
      finalizedRecord = record;
    }
    if (!latestPdfProof(record)) {
      const proof = await buildPdfGenerationProof(record);
      record.integrity.pdfGenerationProofs.push(proof);
      record.integrity.latestPdfProofHashSha256 = proof.pdfProofHashSha256;
    }
    const pdfFile = await createPdfFile(record);
    const pdfHash = await sha256BlobHex(pdfFile);
    const dossier = buildRegisteredDossier(record, pdfHash, pdfFile.name);
    const jsonText = JSON.stringify(dossier, null, 2);
    const jsonHash = await sha256Hex(jsonText);
    record.output = { pdfFilename: pdfFile.name, jsonFilename: jsonFilename(record), pdfHashSha256: pdfHash, jsonHashSha256: jsonHash, generatedAt: new Date().toISOString() };
    record.pendingOfficialRegistration = true;
    await saveOfficialFiles(record, pdfFile, jsonText);
    updateStoredRecord(record);
    writePendingPointer(record.recordId, record.pendingFormFingerprint || fingerprint);

    await registerRecordOnServer(record, { pdfHash, jsonHash, pdfFile, jsonText });
    await completeRegistration(record, pdfFile, jsonText);
  } catch (err) {
    const reusable = finalizedRecord && await hasCompletePendingArtifacts(finalizedRecord);
    if (finalizedRecord) {
      finalizedRecord.pendingOfficialRegistration = reusable;
      updateStoredRecord(finalizedRecord);
      if (!reusable) clearPendingPointer();
    }
    renderPendingAttempt();
    if (reusable) {
      renderServerPanel('Os arquivos foram gerados, mas o registro no sistema não terminou: ' + err.message, 'bad');
      notify('A PET foi gerada, mas o envio ao sistema não terminou. Use “Repetir envio ao sistema” quando houver conexão; o mesmo número será usado.', 'bad', 9000);
    } else {
      renderServerPanel('A emissão foi interrompida antes de gerar os arquivos: ' + err.message, 'bad');
      notify('Não foi possível concluir a emissão: ' + err.message + '\nO formulário foi preservado.', 'bad', 9000);
    }
  } finally {
    finalizationInProgress = false;
    setBusy(false);
  }
}

/** Depois que o servidor aceita: atualiza cópias locais, limpa rascunho e mostra a conclusão. */
async function completeRegistration(record, pdfFile, jsonText) {
  record.pendingOfficialRegistration = false;
  try { await saveOfficialFiles(record, pdfFile, jsonText); }
  catch (localError) {
    showStorageNotice('A PET foi aceita no servidor, mas o aparelho não conseguiu atualizar a cópia local. Envie agora o PDF e o arquivo de validação.', 'warn');
    console.warn('Falha ao atualizar snapshot local após registro oficial', localError);
  }
  const historySaved = saveRecord(record);
  if (historySaved === false) showStorageNotice('A PET foi aceita no servidor, mas não coube no histórico deste aparelho. Envie agora os dois arquivos.', 'warn');
  clearPendingPointer();
  const draftKey = currentDraftKey();
  if (draftKey) localStorage.removeItem(draftKey);
  finalizedRecord = record;
  $('#serverPanel')?.classList.add('hidden');
  renderRecords();
  showDone(record);
}

/** Tela de conclusão com número, hora e botões de envio dos dois arquivos. */
function showDone(record) {
  $('#doneNumero').textContent = record.payload?.fields?.petNumero || record.recordId;
  const when = record.serverRegistration?.server_received_at || record.output?.generatedAt;
  $('#doneHora').textContent = when ? `Registrada em ${formatDateTime(when)}` : '';
  renderIntegrity(record);
  showFormView('done');
  window.scrollTo({ top: 0 });
}

/** Começa uma nova PET depois da conclusão (ou ao descartar o rascunho). */
function startNewPet() {
  const draftKey = currentDraftKey();
  if (draftKey) localStorage.removeItem(draftKey);
  clearWorkspaceMemory();
  ventilationAdded = false;
  refreshFormDerivedUi();
  setDraftStatus('');
  renderRecords();
}

/* =====================================================================
 * RASCUNHO E ESTADO DERIVADO
 * ===================================================================== */

function setDraftStatus(time) {
  const el = $('#draftStatus');
  if (el) el.textContent = time ? `Rascunho salvo às ${time}` : 'O rascunho é salvo automaticamente';
}

/** Atualiza tudo o que depende dos valores do formulário (contadores, avisos, destaques). */
function refreshFormDerivedUi() {
  updateChecklistUi();
  updateGasUi();
  updateSupervisorAutoDisplay();
  const consent = $('#petForm')?.elements.declaracaoCiencia;
  $('#cienciaCard')?.classList.toggle('checked', !!consent?.checked);
  if (triedSteps.has(currentFormStep)) refreshStepIssues();
}

/* =====================================================================
 * EVENTOS
 * ===================================================================== */

function bindEvents() {
  $$('[data-tab]').forEach(button => button.addEventListener('click', () => showTab(button.dataset.tab)));

  // Login
  $('#loginForm')?.addEventListener('submit', event => { event.preventDefault(); login().catch(err => notify('Erro no login: ' + err.message, 'bad')); });
  $('#togglePasswordBtn')?.addEventListener('click', event => {
    const input = $('#loginPassword');
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    event.currentTarget.textContent = show ? 'Ocultar' : 'Mostrar';
    event.currentTarget.setAttribute('aria-pressed', String(show));
  });
  $('#setupAdminForm')?.addEventListener('submit', event => { event.preventDefault(); setupFirstAdmin().catch(err => notify('Erro ao criar administrador: ' + err.message, 'bad')); });

  // Etapas
  $('#formPrevBtn')?.addEventListener('click', () => showFormStep(currentFormStep - 1));
  $('#formNextBtn')?.addEventListener('click', () => goToNextFormStep());
  $('#reviewContent')?.addEventListener('click', event => { const step = event.target.closest('[data-go-step]')?.dataset.goStep; if (step) showFormStep(Number(step)); });
  $('#reviewPending')?.addEventListener('click', event => {
    const step = Number(event.target.closest('[data-go-step]')?.dataset.goStep);
    if (!step) return;
    triedSteps.add(step);
    showFormStep(step);
    const first = validateFormStep(step).issues[0];
    if (first) setTimeout(() => focusIssue(first.target), 150);
  });
  $('#discardDraftBtn')?.addEventListener('click', () => $('#discardConfirm').classList.remove('hidden'));
  $('#discardCancelBtn')?.addEventListener('click', () => $('#discardConfirm').classList.add('hidden'));
  $('#discardConfirmBtn')?.addEventListener('click', () => {
    if (finalizedRecord && !finalizedRecord.serverRegistration) discardPendingAttempt(finalizedRecord);
    startNewPet();
    notify('Rascunho descartado.', 'info', 2500);
  });

  // Checklist
  $('#checklistGroups')?.addEventListener('change', event => {
    const match = event.target.name?.match(/^check_(\d{2})$/);
    if (!match) return;
    updateNaJustificationVisibility(match[1]);
    updateChecklistUi();
    scrollToNextChecklistItem(match[1], event.target.value);
  });

  // Medições
  $('#addVentBtn')?.addEventListener('click', () => { ventilationAdded = true; updateGasUi(); setTimeout(() => focusIssue($('#petForm').elements.gas_ventilacao_hora), 50); });
  $('#removeVentBtn')?.addEventListener('click', removeVentilationTest);

  // Equipe
  $('#peopleList')?.addEventListener('click', event => { const id = event.target.closest('[data-person-open]')?.dataset.personOpen; if (id) openPerson(id); });
  $('#addEntrante')?.addEventListener('click', () => addProfessional('entrante'));
  $('#addVigia')?.addEventListener('click', () => addProfessional('vigia'));
  $('#personBackBtn')?.addEventListener('click', closePerson);
  $('#personDoneBtn')?.addEventListener('click', closePerson);
  const personField = field => event => {
    const person = people.find(p => p.id === openPersonId);
    if (!person) return;
    person[field] = event.target.value;
    updateSupervisorAutoDisplay();
    autoSaveDraftDebounced();
  };
  $('#personNome')?.addEventListener('input', personField('nome'));
  $('#personMatricula')?.addEventListener('input', personField('matricula'));
  $('#personPhotoInput')?.addEventListener('change', async event => {
    const file = event.target.files?.[0];
    await handlePersonPhoto(file);
    event.target.value = '';
  });
  $('#personSignBtn')?.addEventListener('click', () => openSignature(openPersonId));
  $('#personRemoveBtn')?.addEventListener('click', async () => {
    const person = people.find(p => p.id === openPersonId);
    if (!person) return;
    const ok = await askConfirm(`Remover ${personLabel(person)}${person.nome ? ' (' + person.nome + ')' : ''} da equipe?`, { okLabel: 'Remover', danger: true });
    if (!ok) return;
    people = people.filter(p => p.id !== person.id);
    reindexPeople();
    openPersonId = null;
    renderPeople();
    showFormView('form');
    autoSaveDraft();
  });
  setupSignaturePad();
  $('#sigClearBtn')?.addEventListener('click', clearSignaturePad);
  $('#sigCancelBtn')?.addEventListener('click', closeSignature);
  $('#sigConfirmBtn')?.addEventListener('click', () => confirmSignature().catch(err => notify(err.message, 'bad')));

  // Emissão e conclusão
  $('#registerServerBtn')?.addEventListener('click', event => retryPendingRecordRegistration(finalizedRecord, event.currentTarget));
  $('#sharePdfBtn')?.addEventListener('click', event => sharePdfRecord(finalizedRecord, event.currentTarget));
  $('#shareJsonBtn')?.addEventListener('click', event => shareJsonRecord(finalizedRecord, event.currentTarget));
  $('#printBtn')?.addEventListener('click', event => openOfficialPdf(finalizedRecord, event.currentTarget));
  $('#exportBtn')?.addEventListener('click', async () => {
    if (!finalizedRecord || !await ensureRecordReadyForOutput(finalizedRecord)) return;
    const files = await readOfficialFiles(finalizedRecord);
    if (files?.jsonText) downloadBlob(new Blob([files.jsonText], { type: 'application/json' }), files.jsonFilename || jsonFilename(finalizedRecord));
  });
  $('#newPetBtn')?.addEventListener('click', () => { startNewPet(); });

  // Conta
  $('#pwdToggleBtn')?.addEventListener('click', () => openPasswordPanel());
  $('#changeOwnPasswordBtn')?.addEventListener('click', () => changeOwnPassword().catch(err => notify('Erro ao alterar senha: ' + err.message, 'bad')));
  $('#logoutBtn')?.addEventListener('click', async () => {
    const ok = await askConfirm('Sair do sistema neste aparelho? O rascunho continua salvo para a sua conta.', { okLabel: 'Sair' });
    if (ok) logout();
  });
  $('#registerDeviceBtn')?.addEventListener('click', event => registerDevice(event.currentTarget).catch(err => notify('Erro ao solicitar autorização: ' + err.message, 'bad')));
  $('#refreshDevicesBtn')?.addEventListener('click', () => refreshDevices().then(() => notify('Situação atualizada.', 'info', 2000)));
  $('#exportPublicKey')?.addEventListener('click', exportPublicKey);
  $('#resetKey')?.addEventListener('click', () => resetLocalDeviceProtection().catch(err => notify('Não foi possível apagar a proteção local: ' + err.message, 'bad')));

  // Gestão
  $('#newUserToggle')?.addEventListener('click', () => toggleNewUserPanel());
  $('#createUserBtn')?.addEventListener('click', () => createUser().catch(err => notify('Erro ao cadastrar usuário: ' + err.message, 'bad')));
  $('#saveUserEditBtn')?.addEventListener('click', () => saveUserEdit().catch(err => notify('Erro ao atualizar usuário: ' + err.message, 'bad')));
  $('#confirmResetPasswordBtn')?.addEventListener('click', () => confirmResetPassword().catch(err => notify('Erro ao redefinir senha: ' + err.message, 'bad')));
  $$('[data-close-dialog]').forEach(btn => btn.addEventListener('click', () => $('#' + btn.dataset.closeDialog)?.close()));
  $('#usersList')?.addEventListener('click', event => {
    const el = event.target.closest('[data-user-edit], [data-user-reset], [data-user-delete]');
    if (!el) return;
    if (el.dataset.userEdit) openEditUser(el.dataset.userEdit);
    if (el.dataset.userReset) openResetPassword(el.dataset.userReset);
    if (el.dataset.userDelete) deleteUser(el.dataset.userDelete).catch(err => notify('Erro ao excluir acesso: ' + err.message, 'bad'));
  });
  $('#devicesList')?.addEventListener('click', async event => {
    const approve = event.target.closest('[data-device-approve]');
    const revoke = event.target.closest('[data-device-revoke]');
    if (approve) changeDeviceStatus(approve.dataset.deviceApprove, 'approve', approve).catch(err => notify(err.message, 'bad'));
    if (revoke) {
      const action = revoke.dataset.deviceAction || 'Revogar';
      const ok = await askConfirm(action === 'Rejeitar' ? 'Rejeitar esta solicitação de aparelho?' : 'Revogar a autorização deste aparelho? Ele não poderá mais emitir PETs.', { okLabel: action, danger: true });
      if (ok) changeDeviceStatus(revoke.dataset.deviceRevoke, 'revoke', revoke).catch(err => notify(err.message, 'bad'));
    }
  });
  $('#verifyFilesBtn')?.addEventListener('click', () => verifyFiles());
  $('#serverValidateBtn')?.addEventListener('click', () => validateHashOnServer());
  $('#recordsList')?.addEventListener('click', handleRecordAction);

  // Rascunho automático: qualquer alteração no formulário salva e atualiza a tela.
  const onFormEdited = debounce(() => { autoSaveDraft(); }, 400);
  $('#petForm')?.addEventListener('input', () => { refreshFormDerivedUi(); onFormEdited(); });
  $('#petForm')?.addEventListener('change', () => { refreshFormDerivedUi(); onFormEdited(); });

  // Ao sair do app ou trocar de aplicativo, grava na hora o que ainda estava esperando o atraso do rascunho.
  window.addEventListener('pagehide', () => autoSaveDraft());
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') autoSaveDraft(); });

  // Conexão
  window.addEventListener('online', () => { setOffline(false); refreshMe(); });
  window.addEventListener('offline', () => setOffline(true));
}

/** Salva o rascunho com pequeno atraso (digitação no editor da pessoa). */
let autoSaveTimer = null;
function autoSaveDraftDebounced() {
  clearTimeout(autoSaveTimer);
  autoSaveTimer = setTimeout(() => autoSaveDraft(), 400);
}

/**
 * Alterna a aba visível.
 * v1.2.0: abrir uma aba não recarrega mais o formulário (antes a aba Sistema fazia isso).
 */
function showTab(tabId) {
  const state = authState || loadAuthState();
  if (!state?.user) { renderAuthState(); return; }
  const canVerify = ['admin', 'gestor', 'verificador'].includes(state.user.role);
  if (tabId === 'manageTab' && !canVerify) tabId = 'formTab';
  $$('.tab').forEach(t => t.classList.remove('active'));
  const target = $('#' + tabId) || $('#formTab');
  target.classList.add('active');
  $$('#appTabs [data-tab]').forEach(button => {
    const active = button.dataset.tab === target.id;
    button.classList.toggle('active', active);
    button.setAttribute('aria-current', active ? 'page' : 'false');
  });
  updateStepBar();
  window.scrollTo({ top: 0 });
  if (target.id === 'recordsTab') renderRecords();
  if (target.id === 'accountTab') { renderAuthState(); refreshDevices(true); }
  if (target.id === 'manageTab') { refreshDevices(true); if (['admin', 'gestor'].includes(state.user.role)) refreshUsers(); }
  if (target.id === 'formTab' && currentFormStep === 6 && $('#doneView').classList.contains('hidden')) renderReview();
}
