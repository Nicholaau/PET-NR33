'use strict';
/**
 * PET-Digital v1.1.5 — documentos, registros e inicialização.
 * O quê: PDF, comprovante, compartilhamento, histórico local, validação e boot do app.
 * Como: usa snapshots do IndexedDB e registra somente hashes/metadados no Worker.
 * Quando: após a finalização ou ao abrir Registros/Validar.
 */

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
  record = await hydrateRecord(record);
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
    try {
      await saveOfficialFiles(record, files.pdfFile, files.jsonText);
    } catch (localError) {
      showStorageNotice('O servidor aceitou a PET, mas a cópia temporária do aparelho não pôde ser atualizada. Compartilhe os arquivos imediatamente.', 'warn');
      console.warn('Falha ao atualizar snapshot local após repetição aceita', localError);
    }
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
 * Confere as bibliotecas locais/carregadas com SRI antes de gerar o PDF.
 * Elas são declaradas no HTML com `integrity` e CSP; o app não injeta scripts em tempo de execução.
 */
async function ensurePdfLibraries() {
  if (!window.html2canvas || !window.jspdf?.jsPDF) {
    throw new Error('Bibliotecas de geração de PDF indisponíveis. Atualize a página com conexão e tente novamente.');
  }
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
  return safeLocalStorageSet(key, JSON.stringify(draft), 'o rascunho');
}

/**
 * Tenta salvar rascunho silenciosamente.
 * Ativação: eventos de input/change, alteração de foto, assinatura e lista de pessoas.
 * O que faz: chama `saveDraft()` sem interromper a tela; a rotina de armazenamento
 * devolve `false` e exibe aviso visível quando a cota local estiver cheia.
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
 * localizar os arquivos exatos no IndexedDB; tentativas pendentes também ficam compactas; o snapshot completo permanece no IndexedDB
 * junto ao PDF e comprovante, para reenvio com a mesma idempotência.
 * Quando: toda gravação/atualização do histórico local.
 */
function recordForLocalStorage(record) {
  // O histórico síncrono nunca recebe fotos, assinaturas nem o dossiê completo.
  // O snapshot necessário para ações/reenvio fica no IndexedDB junto aos arquivos.
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
    pendingOfficialRegistration: Boolean(record.pendingOfficialRegistration)
  };
}

/**
 * Salva uma PET finalizada no histórico local.
 * Ativação: finalização da PET.
 * O que faz: coloca o novo registro no início da lista e mantém no máximo 30 referências recentes
 * no localStorage para evitar crescimento indefinido.
 */
function saveRecord(record) {
  const storedRecord = recordForLocalStorage(record);
  const records = getRecords().filter(r => r.recordId !== record.recordId);
  records.unshift(storedRecord);
  const limited = records.slice(0, MAX_LOCAL_RECORDS);
  const key = currentRecordsKey();
  if (!key) return;
  return safeLocalStorageSet(key, JSON.stringify(limited), 'o histórico local');
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
  return safeLocalStorageSet(key, JSON.stringify(records.slice(0, MAX_LOCAL_RECORDS)), 'o histórico local');
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
    const compactRecord = getRecords()[Number(btn.dataset.index)];
    if (!compactRecord) return;
    const rec = await hydrateRecord(compactRecord);
    if (!rec) return alert('Os arquivos completos deste registro não estão mais disponíveis neste aparelho.');
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
      if (key) safeLocalStorageSet(key, JSON.stringify(updated), 'o histórico local');
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
    if (!record.payload || !record.integrity || !record.fileIntegrity) throw new Error('Arquivo não é um comprovante oficial v1.1.5 completo.');
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
  const date = (fields.data || '').replace(/-/g, '') || todayISO(new Date(record?.integrity?.finalizedAt || Date.now())).replace(/-/g, '');
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
  showFormStep(1);
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
