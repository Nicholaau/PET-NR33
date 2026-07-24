'use strict';
/**
 * PET-Digital v1.1.5 — formulário e emissão.
 * O quê: fotos, assinaturas, checklist, medições, etapas, validação e finalização.
 * Como: coleta o formulário, aplica regras locais e prepara o dossiê assinado.
 * Quando: preenchimento e finalização da PET.
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
  const counts = people.reduce((acc, p) => { acc[p.type] = (acc[p.type] || 0) + 1; return acc; }, {});
  if (people.length >= MAX_PARTICIPANTS) return alert(`Limite total de ${MAX_PARTICIPANTS} participantes atingido.`);
  if (type === 'entrante' && (counts.entrante || 0) >= MAX_ENTRANTES) return alert(`Limite de ${MAX_ENTRANTES} entrantes atingido.`);
  if (type === 'vigia' && (counts.vigia || 0) >= MAX_VIGIAS) return alert(`Limite de ${MAX_VIGIAS} vigias atingido.`);
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
  $('#saveDraft').addEventListener('click', () => {
    const saved = saveDraft();
    if (saved) alert('Rascunho salvo neste dispositivo.');
    else alert('O rascunho não pôde ser salvo. Consulte o aviso exibido na tela.');
  });
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
    showFormStep(1, { focus: true });
    $('#storageNotice')?.classList.add('hidden');
  });

  $('#validateBtn').addEventListener('click', () => {
    const result = validateCurrentForm();
    showValidation(result);
    if (!result.ok) focusFirstFormIssue(result);
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
  $('#setupAdminForm')?.addEventListener('submit', event => {
    event.preventDefault();
    setupFirstAdmin().catch(err => alert('Erro ao criar admin: ' + err.message));
  });
  $('#loginForm')?.addEventListener('submit', event => {
    event.preventDefault();
    login().catch(err => alert('Erro no login: ' + err.message));
  });
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

  $('#formPrevBtn')?.addEventListener('click', () => showFormStep(currentFormStep - 1, { focus: true }));
  $('#formNextBtn')?.addEventListener('click', () => showFormStep(currentFormStep + 1, { focus: true }));
  $('#formStepButtons')?.addEventListener('click', event => {
    const button = event.target.closest('[data-form-step-target]');
    if (button) showFormStep(Number(button.dataset.formStepTarget), { focus: true });
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
function showFormStep(step, options = {}) {
  const normalized = Math.min(FORM_STEPS.length, Math.max(1, Number(step) || 1));
  currentFormStep = normalized;
  $$('[data-form-step]').forEach(section => section.classList.toggle('form-step-hidden', Number(section.dataset.formStep) !== normalized));
  $$('[data-form-step-target]').forEach(button => {
    const active = Number(button.dataset.formStepTarget) === normalized;
    button.classList.toggle('active', active);
    button.setAttribute('aria-current', active ? 'step' : 'false');
  });
  const progress = $('#formProgressBar');
  if (progress) progress.value = normalized;
  const label = $('#formProgressLabel');
  if (label) label.textContent = `Etapa ${normalized} de ${FORM_STEPS.length}: ${FORM_STEPS[normalized - 1].label}`;
  const prev = $('#formPrevBtn');
  const next = $('#formNextBtn');
  if (prev) prev.disabled = normalized === 1;
  if (next) { next.disabled = normalized === FORM_STEPS.length; next.textContent = normalized === FORM_STEPS.length ? 'Última etapa' : 'Próxima etapa'; }
  if (options.focus) {
    const target = $(`[data-form-step="${normalized}"]`);
    target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    target?.querySelector('input, textarea, select, button')?.focus({ preventScroll: true });
  }
}

function stepForElement(element) {
  return Number(element?.closest?.('[data-form-step]')?.dataset.formStep || 1);
}

function focusFirstFormIssue(result = {}) {
  const form = $('#petForm');
  let target = result.firstInvalid || form.querySelector(':invalid');
  if (!target) {
    const unanswered = $$('#checklistTable tbody tr').find(row => !row.querySelector('input[type="radio"]:checked'));
    target = unanswered?.querySelector('input') || null;
  }
  if (!target && result.errors?.some(error => /participante|entrante|vigia|supervisor|matrícula|foto|assinatura/i.test(error))) target = $('#peopleList');
  if (!target && result.errors?.some(error => /gás|atmosfera|O₂|LIE|H₂S|CO/i.test(error))) target = $('#gasTable input');
  if (!target) target = $('#validationBox');
  showFormStep(stepForElement(target), { focus: false });
  setTimeout(() => {
    target?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    if (typeof target?.focus === 'function') target.focus({ preventScroll: true });
  }, 60);
}

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
  const now = new Date();
  const timePart = `${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`;
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
  if (people.length > MAX_PARTICIPANTS) errors.push(`A equipe excede o limite de ${MAX_PARTICIPANTS} participantes.`);
  if ((typeCounts.entrante || 0) > MAX_ENTRANTES) errors.push(`A equipe excede o limite de ${MAX_ENTRANTES} entrantes.`);
  if ((typeCounts.vigia || 0) > MAX_VIGIAS) errors.push(`A equipe excede o limite de ${MAX_VIGIAS} vigias.`);
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
  return { ok: errors.length === 0, errors, warnings, firstInvalid: form.querySelector(':invalid') };
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
  if (!validation.ok) { focusFirstFormIssue(validation); return alert('Não é possível finalizar enquanto houver impedimentos automáticos.'); }

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
    // A aceitação do Worker é a autoridade. Uma falha local posterior não pode transformar
    // uma PET já aceita em emissão pendente; apenas informa que o aparelho não conseguiu
    // atualizar sua cópia temporária.
    try {
      await saveOfficialFiles(record, pdfFile, jsonText);
    } catch (localError) {
      showStorageNotice('A PET foi aceita no servidor, mas o aparelho não conseguiu atualizar a cópia local. Compartilhe imediatamente o PDF e o comprovante.', 'warn');
      console.warn('Falha ao atualizar snapshot local após registro oficial', localError);
    }
    updateStoredRecord(record);
    localStorage.removeItem(currentDraftKey());
    renderIntegrity(record);
    renderPrintArea(record);
    ['#printBtn','#sharePdfBtn','#exportBtn','#shareJsonBtn'].forEach(sel => { const b=$(sel); if (b) b.disabled=false; });
    $('#registerServerBtn').disabled = true;
    $('#registerServerBtn').classList.add('hidden');
    if (button) { button.disabled = true; button.textContent = 'PET finalizada'; }
    updateFormAccessStatus('PET oficial gerada e registrada. Envie o PDF e o comprovante ao supervisor.', 'ok');
    const historySaved = saveRecord(record);
    if (!historySaved) {
      showStorageNotice('A PET foi aceita no servidor, mas a referência não coube no histórico local. Compartilhe agora o PDF e o comprovante com o supervisor.', 'warn');
    }
    alert('PET oficial concluída. O PDF e o comprovante foram vinculados ao registro do servidor. Envie os dois arquivos ao supervisor.');
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

