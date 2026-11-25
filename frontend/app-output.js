'use strict';
/**
 * PET-Digital v1.3.0 — documentos, registros e inicialização.
 * O quê: PDF, arquivo de validação, compartilhamento, histórico local, validação e boot do app.
 * Como: usa snapshots do IndexedDB e registra somente hashes/metadados no Worker.
 * Quando: após a finalização ou ao abrir Registros/Validar.
 */

/** Monta o arquivo de validação da PET (JSON) exato que será exportado e cujo arquivo é hasheado. */
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

/** Envia PDF e arquivo de validação ao Worker apenas durante a validação; o D1 guarda somente hashes/metadados. */
async function registerRecordOnServer(record, fileHashes = {}) {
  if (!record || !authToken()) throw new Error('Sessão necessária para registrar a PET.');
  const proof = latestPdfProof(record);
  if (!proof) throw new Error('Prova do PDF ausente.');
  const pdfFile = fileHashes.pdfFile || (await readOfficialFiles(record))?.pdfFile;
  const jsonText = fileHashes.jsonText || (await readOfficialFiles(record))?.jsonText;
  if (!pdfFile || !jsonText) throw new Error('Arquivos oficiais ausentes para validação no servidor.');
  const body = {
    // O Worker extrai payload, assinaturas, prova e hashes diretamente do arquivo de validação,
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

/**
 * Repete somente o envio pendente, reutilizando número, arquivos e idempotência já criados.
 * Quando: botão "Repetir envio ao sistema" na revisão ou em Minhas PETs.
 */
async function retryPendingRecordRegistration(record, triggerButton) {
  record = normalizeFinalizationRecordStructure(await hydrateRecord(record));
  if (!record?.pendingOfficialRegistration) return;
  const files = await readOfficialFiles(record);
  if (!files?.pdfFile || !files?.jsonText || !record.output?.pdfHashSha256 || !record.output?.jsonHashSha256) {
    record.pendingOfficialRegistration = false;
    updateStoredRecord(record);
    clearPendingPointer();
    renderPendingAttempt();
    renderRecords();
    notify('A tentativa anterior foi interrompida antes de gerar os dois arquivos. Finalize a PET novamente.', 'bad');
    return;
  }
  const button = triggerButton;
  const original = button?.textContent || '';
  try {
    if (button) { button.disabled = true; button.textContent = 'Enviando...'; }
    setBusy(true, 'Enviando ao sistema', 'Registrando a PET já gerada, com o mesmo número e os mesmos arquivos.');
    await registerRecordOnServer(record, { pdfFile: files.pdfFile, jsonText: files.jsonText });
    if (record.recordId === finalizedRecord?.recordId || !finalizedRecord) {
      showTab('formTab');
      await completeRegistration(record, files.pdfFile, files.jsonText);
    } else {
      record.pendingOfficialRegistration = false;
      try { await saveOfficialFiles(record, files.pdfFile, files.jsonText); } catch {}
      updateStoredRecord(record);
      if (readPendingPointer()?.recordId === record.recordId) clearPendingPointer();
      renderRecords();
    }
    notify('Registro concluído, sem criar nova PET.', 'ok');
  } catch (err) {
    notify('O registro continua pendente: ' + err.message, 'bad');
  } finally {
    setBusy(false);
    if (button && !record.serverRegistration) { button.disabled = false; button.textContent = original || 'Repetir envio ao sistema'; }
  }
}

/** Abre o PDF oficial exato salvo no IndexedDB; não recria arquivo com hash diferente. */
async function openOfficialPdf(record, triggerButton) {
  if (!record) return;
  if (!await ensureRecordReadyForOutput(record)) return;
  const files = await readOfficialFiles(record);
  const button = triggerButton || $('#printBtn');
  const original = button?.textContent || '';
  try {
    if (button) { button.disabled = true; button.textContent = 'Abrindo PDF...'; }
    const url = URL.createObjectURL(files.pdfFile);
    const opened = window.open(url, '_blank', 'noopener');
    if (!opened) downloadBlob(files.pdfFile, files.pdfFilename || pdfFilename(record));
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  } finally { if (button) { button.disabled = false; button.textContent = original || 'Abrir PDF'; } }
}

/** Compartilha o JSON exato cujo hash foi registrado no D1. */
async function shareJsonRecord(record, triggerButton) {
  if (!record || !await ensureRecordReadyForOutput(record)) return;
  const files = await readOfficialFiles(record);
  const button = triggerButton || $('#shareJsonBtn');
  const original = button?.textContent || '';
  try {
    if (button) { button.disabled = true; button.textContent = 'Compartilhando...'; }
    const file = new File([files.jsonText], files.jsonFilename || jsonFilename(record), { type: 'application/json' });
    await shareFilesOrDownload([file], 'Arquivo de validação PET Digital NR-33', `Arquivo de validação da ${record.payload?.fields?.petNumero || record.recordId}.`);
  } catch (err) { if (err.name !== 'AbortError') notify('Não foi possível compartilhar: ' + err.message, 'bad'); }
  finally { if (button) { button.disabled = false; button.textContent = original || 'Enviar arquivo de validação'; } }
}

/** Compartilha o PDF exato cujo hash foi registrado no D1. */
async function sharePdfRecord(record, triggerButton) {
  if (!record || !await ensureRecordReadyForOutput(record)) return;
  const files = await readOfficialFiles(record);
  const button = triggerButton || $('#sharePdfBtn');
  const original = button?.textContent || '';
  try {
    if (button) { button.disabled = true; button.textContent = 'Abrindo compartilhamento...'; }
    const file = files.pdfFile instanceof File ? files.pdfFile : new File([files.pdfFile], files.pdfFilename || pdfFilename(record), { type: 'application/pdf' });
    await shareFilesOrDownload([file], 'PET Digital NR-33 — PDF', `PDF da ${record.payload?.fields?.petNumero || record.recordId}.`);
  } catch (err) { if (err.name !== 'AbortError') notify('Não foi possível compartilhar o PDF: ' + err.message, 'bad'); }
  finally { if (button) { button.disabled = false; button.textContent = original || 'Enviar PDF'; } }
}

/**
 * Geração de PDF nativa (desde a v1.1.6; ampliada na v1.2.0).
 * O quê: remove dependência de jsPDF/html2canvas e de qualquer CDN/biblioteca de terceiros.
 * Como: desenha páginas da PET em Canvas 2D usando somente APIs nativas do navegador e
 * monta um PDF simples que incorpora cada página como JPEG.
 * Quando: finalização oficial, antes de calcular o hash real do PDF.
 */
const PDF_PAGE_WIDTH = 1754;
const PDF_PAGE_HEIGHT = 1240;
const PDF_MARGIN = 42;

function createPdfCanvas() {
  const canvas = document.createElement('canvas');
  canvas.width = PDF_PAGE_WIDTH;
  canvas.height = PDF_PAGE_HEIGHT;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#111';
  ctx.textBaseline = 'top';
  return { canvas, ctx };
}

function canvasLines(ctx, text, maxWidth) {
  const source = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (!source) return [''];
  const words = source.split(' ');
  const lines = [];
  let line = '';
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (ctx.measureText(candidate).width <= maxWidth || !line) line = candidate;
    else { lines.push(line); line = word; }
  }
  if (line) lines.push(line);
  return lines;
}

function drawWrappedText(ctx, text, x, y, maxWidth, lineHeight = 24, maxLines = Infinity) {
  const lines = canvasLines(ctx, text, maxWidth).slice(0, maxLines);
  lines.forEach((line, index) => ctx.fillText(line, x, y + index * lineHeight));
  return y + lines.length * lineHeight;
}

function drawBox(ctx, x, y, w, h, label, value, options = {}) {
  ctx.strokeStyle = '#444';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(x, y, w, h);
  ctx.fillStyle = '#111';
  ctx.font = '700 13px Arial, sans-serif';
  ctx.fillText(label, x + 7, y + 6);
  ctx.font = `${options.bold ? '700' : '400'} 18px Arial, sans-serif`;
  drawWrappedText(ctx, value || '', x + 7, y + 25, w - 14, 21, options.maxLines || 2);
}

async function loadCanvasImage(src) {
  if (!src) return null;
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

function drawImageContain(ctx, image, x, y, w, h) {
  if (!image?.width || !image?.height) return;
  const ratio = Math.min(w / image.width, h / image.height);
  const dw = image.width * ratio;
  const dh = image.height * ratio;
  ctx.drawImage(image, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
}

function drawImageCover(ctx, image, x, y, w, h) {
  if (!image?.width || !image?.height) return;
  const ratio = Math.max(w / image.width, h / image.height);
  const sw = w / ratio;
  const sh = h / ratio;
  const sx = Math.max(0, (image.width - sw) / 2);
  const sy = Math.max(0, (image.height - sh) / 2);
  ctx.save();
  ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
  ctx.drawImage(image, sx, sy, sw, sh, x, y, w, h);
  ctx.restore();
}

async function drawPdfHeader(ctx, title = 'PET — PERMISSÃO DE ENTRADA E TRABALHO — ESPAÇO CONFINADO') {
  const logo = await loadCanvasImage('logo-dmae-2026.png');
  ctx.strokeStyle = '#333'; ctx.lineWidth = 2;
  ctx.strokeRect(PDF_MARGIN, 28, PDF_PAGE_WIDTH - PDF_MARGIN * 2, 88);
  if (logo) drawImageContain(ctx, logo, PDF_MARGIN + 12, 36, 330, 72);
  ctx.font = '700 26px Arial, sans-serif'; ctx.textAlign = 'center';
  ctx.fillText(title, PDF_PAGE_WIDTH / 2, 46);
  ctx.font = '700 18px Arial, sans-serif'; ctx.fillText('NBR 14787 / NR-33', PDF_PAGE_WIDTH / 2, 78);
  ctx.textAlign = 'left';
  ctx.font = '13px Arial, sans-serif';
  ctx.fillText('DMAE • PET Digital • Revisão 00/2025 • Modelo 01/2025', PDF_PAGE_WIDTH - 390, 91);
}

async function buildPdfChecklistPage(record) {
  const { canvas, ctx } = createPdfCanvas();
  await drawPdfHeader(ctx);
  const f = record.payload?.fields || {};
  const x = PDF_MARGIN, full = PDF_PAGE_WIDTH - PDF_MARGIN * 2;
  let y = 128;
  drawBox(ctx, x, y, full * .32, 62, '1 — UNIDADE', f.unidade);
  drawBox(ctx, x + full * .32, y, full * .34, 62, '2 — Nº DA PET', f.petNumero);
  drawBox(ctx, x + full * .66, y, full * .17, 62, '3 — DATA', formatDate(f.data));
  drawBox(ctx, x + full * .83, y, full * .17, 62, '4 — EMISSÃO', f.horaEmissao);
  y += 62;
  drawBox(ctx, x, y, full * .52, 62, '5 — LOCAL', f.local);
  drawBox(ctx, x + full * .52, y, full * .18, 62, '6 — TÉRMINO PREVISTO', f.horaTermino);
  drawBox(ctx, x + full * .70, y, full * .30, 62, '7 — SUPERVISOR', `${f.supervisorEntrada || ''}${f.supervisorMatricula ? ` • ${f.supervisorMatricula}` : ''}`);
  y += 62;
  drawBox(ctx, x, y, full * .62, 74, '8 — TRABALHO A SER REALIZADO', f.trabalho, { maxLines: 2 });
  drawBox(ctx, x + full * .62, y, full * .38, 74, '9 — EQUIPE DE SALVAMENTO', `${f.equipeSalvamento || ''} • ${f.telefoneSalvamento || ''}`);
  y += 84;

  const colNo = 52, colAnswer = 64, questionW = full - colNo - colAnswer * 3;
  const headerH = 40;
  ctx.fillStyle = '#d9d9d9'; ctx.fillRect(x, y, full, headerH); ctx.strokeStyle = '#333'; ctx.strokeRect(x, y, full, headerH);
  ctx.font = '700 14px Arial, sans-serif'; ctx.fillStyle = '#111';
  ctx.fillText('Nº', x + 15, y + 12); ctx.fillText('ITENS VERIFICADOS ANTES DA EMISSÃO', x + colNo + 8, y + 12);
  ['SIM','NÃO','N/A'].forEach((label,i)=>ctx.fillText(label, x + colNo + questionW + i*colAnswer + 12, y + 12));
  y += headerH;
  const rowH = 36;
  let hasNa = false;
  for (const item of record.payload?.checklist || []) {
    ctx.strokeStyle='#555'; ctx.strokeRect(x, y, full, rowH);
    [colNo, colNo + questionW, colNo + questionW + colAnswer, colNo + questionW + colAnswer*2].forEach(offset => { ctx.beginPath(); ctx.moveTo(x+offset,y); ctx.lineTo(x+offset,y+rowH); ctx.stroke(); });
    ctx.fillStyle='#111'; ctx.font='700 13px Arial, sans-serif'; ctx.fillText(item.number, x+15, y+10);
    ctx.font='12.5px Arial, sans-serif'; drawWrappedText(ctx, item.item, x+colNo+7, y+5, questionW-12, 14, 2);
    ctx.font='700 19px Arial, sans-serif';
    const ai = item.answer === 'S' ? 0 : item.answer === 'N' ? 1 : item.answer === 'NA' ? 2 : -1;
    if (ai >= 0) ctx.fillText(item.answer === 'NA' ? 'X*' : 'X', x + colNo + questionW + ai*colAnswer + (item.answer === 'NA' ? 20 : 24), y + 7);
    if (item.answer === 'NA') hasNa = true;
    y += rowH;
  }
  y += 8;
  ctx.font='700 13px Arial, sans-serif'; ctx.fillText('Observações:', x, y);
  ctx.font='12px Arial, sans-serif'; y=drawWrappedText(ctx, f.observacoes || '—', x+90, y, full-90, 15, 2)+4;
  ctx.font='11px Arial, sans-serif';
  if (hasNa) { ctx.font='700 11px Arial, sans-serif'; ctx.fillText('* Itens N/A: as justificativas estão na página seguinte.', x, y); y += 17; ctx.font='11px Arial, sans-serif'; }
  const validationCode = `${record.recordId}-${record.integrity?.payloadHashSha256?.slice(0,12)?.toUpperCase() || ''}`;
  drawWrappedText(ctx, `Código de conferência: ${validationCode} • Emissão técnica: ${formatDateTime(record.integrity?.finalizedAt)} • Validação oficial requer o PDF e o arquivo de validação da PET (JSON).`, x, Math.min(y, PDF_PAGE_HEIGHT-34), full, 14, 2);
  return canvas;
}

/** Interpreta medições digitadas com vírgula ou ponto (o PDF da v1.1.6 não aceitava vírgula). */
function pdfGasNumber(raw) {
  const text = String(raw ?? '').trim();
  if (!text) return null;
  const n = Number(text.replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

function pdfGasSituation(f, prefix) {
  if (!f[`${prefix}_hora`]) return 'Não realizado';
  const v = { o2: pdfGasNumber(f[`${prefix}_o2`]), lie: pdfGasNumber(f[`${prefix}_lie`]), h2s: pdfGasNumber(f[`${prefix}_h2s`]), co: pdfGasNumber(f[`${prefix}_co`]) };
  if (Object.values(v).some(n => n === null)) return 'Incompleto';
  return v.o2 > 19.5 && v.o2 < 23 && v.lie < 10 && v.h2s < 5 && v.co < 25 ? 'Dentro dos limites' : 'Fora dos limites';
}

/**
 * Página 2: medições, detector, justificativas de N/A, notas, declaração de ciência e registro técnico.
 * v1.2.0: inclui o detector, as justificativas de N/A e a declaração de ciência, que antes só
 * apareciam no arquivo de validação. Se as justificativas não couberem, seguem numa página extra.
 */
async function buildPdfAtmospherePages(record) {
  const pages = [];
  const { canvas, ctx } = createPdfCanvas();
  pages.push(canvas);
  await drawPdfHeader(ctx, 'PET — MEDIÇÕES, ORIENTAÇÕES E REGISTRO TÉCNICO');
  const f = record.payload?.fields || {};
  const x=PDF_MARGIN, full=PDF_PAGE_WIDTH-PDF_MARGIN*2;
  let y=132;
  ctx.fillStyle='#d9d9d9'; ctx.fillRect(x,y,full,34); ctx.strokeStyle='#333'; ctx.strokeRect(x,y,full,34);
  ctx.fillStyle='#111'; ctx.font='700 18px Arial, sans-serif'; ctx.textAlign='center'; ctx.fillText('MEDIÇÕES DE GASES PERIGOSOS', PDF_PAGE_WIDTH/2, y+7); ctx.textAlign='left'; y+=34;
  const cols=[260,170,220,210,190,full-1250,200];
  const headings=['Teste/Hora','O₂ (%) 19,5–23','% LIE (< 10)','H₂S ppm (< 5)','CO ppm (< 25)','Observações','Situação'];
  let cx=x; ctx.fillStyle='#ededed'; ctx.font='700 13px Arial, sans-serif';
  headings.forEach((h,i)=>{ctx.fillStyle='#ededed';ctx.fillRect(cx,y,cols[i],38);ctx.strokeRect(cx,y,cols[i],38);ctx.fillStyle='#111';drawWrappedText(ctx,h,cx+6,y+7,cols[i]-12,14,2);cx+=cols[i];});
  y+=38;
  const rows=[
    ['Teste inicial','gas_inicial'],
    ['Após ventilação','gas_ventilacao']
  ];
  for (const [label, prefix] of rows) {
    cx=x; ctx.font='14px Arial, sans-serif';
    const vals=[`${label} ${f[`${prefix}_hora`]||''}`, f[`${prefix}_o2`]||'—', f[`${prefix}_lie`]||'—', f[`${prefix}_h2s`]||'—', f[`${prefix}_co`]||'—', f[`${prefix}_obs`]||'—', pdfGasSituation(f, prefix)];
    vals.forEach((v,i)=>{ctx.strokeRect(cx,y,cols[i],56); drawWrappedText(ctx,String(v),cx+6,y+9,cols[i]-12,17,3); cx+=cols[i];});
    y+=56;
  }
  y+=10;
  ctx.font='700 14px Arial, sans-serif'; ctx.fillText('Detector de gases:', x, y);
  ctx.font='14px Arial, sans-serif'; ctx.fillText(`nº de série/patrimônio ${f.detectorId || '—'} • calibração válida até ${formatDate(f.detectorCalibracao) || '—'}`, x + 150, y);
  if (f.gasObservacoes) { y += 22; ctx.font='700 14px Arial, sans-serif'; ctx.fillText('Observações das medições:', x, y); ctx.font='14px Arial, sans-serif'; y = drawWrappedText(ctx, f.gasObservacoes, x + 205, y, full - 205, 18, 2) - 18; }
  y += 34;

  // Justificativas dos itens N/A (antes só no JSON).
  const naItems = (record.payload?.checklist || []).filter(c => c.answer === 'NA');
  const proofBoxH = 176;
  const notesH = 236;
  const limitY = PDF_PAGE_HEIGHT - proofBoxH - notesH - 40;
  let pendingNa = naItems.slice();
  const drawNaBlock = (context, startY, maxY, title) => {
    let yy = startY;
    context.font='700 16px Arial, sans-serif'; context.fillText(title, x, yy); yy += 26;
    while (pendingNa.length) {
      const c = pendingNa[0];
      context.font='13px Arial, sans-serif';
      const text = `${c.number} — ${c.item}  •  Justificativa: ${c.justification || '—'}`;
      const needed = canvasLines(context, text, full - 20).slice(0, 3).length * 17 + 6;
      if (yy + needed > maxY) break;
      context.fillStyle='#111';
      yy = drawWrappedText(context, text, x + 10, yy, full - 20, 17, 3) + 6;
      pendingNa.shift();
    }
    return yy;
  };
  if (naItems.length) y = drawNaBlock(ctx, y, limitY, `JUSTIFICATIVAS DOS ITENS N/A (${naItems.length})`) + 10;

  ctx.font='700 16px Arial, sans-serif'; ctx.fillText('NOTAS DE ORIENTAÇÃO',x,y); y+=24;
  ctx.font='13px Arial, sans-serif';
  const notes=[
    '1. O acesso ao espaço confinado só deve ocorrer após a emissão e endosso da PET.',
    '2. A PET deve ser encerrada ou cancelada ao término do serviço, condição não prevista, interrupção ou troca de equipe.',
    '3. A PET é válida somente para cada entrada.',
    '4. O vigia não pode realizar outras tarefas que comprometam o monitoramento dos trabalhadores autorizados.',
    '5. Não é permitido trabalho em espaço confinado de forma individual ou isolada.',
    '6. Compete ao supervisor emitir, encerrar/cancelar, realizar testes, conferir equipamentos e checar procedimentos.',
    '7. O portador do monitor de gás deve ser o último a sair; em caso de alarme, todos devem abandonar o local imediatamente.'
  ];
  for (const note of notes) y=drawWrappedText(ctx,note,x,y,full,17,2)+3;
  y+=6;
  const ciencia = f.declaracaoCiencia ? `Confirmada pelo emissor ${record.payload?.issuedBy?.name || ''} em ${formatDateTime(record.integrity?.finalizedAt)}.` : 'NÃO confirmada.';
  ctx.font='700 14px Arial, sans-serif'; ctx.fillText('DECLARAÇÃO DE CIÊNCIA:', x, y);
  ctx.font='14px Arial, sans-serif'; drawWrappedText(ctx, `As informações foram conferidas e a equipe tomou ciência das orientações da PET. ${ciencia}`, x + 200, y, full - 200, 18, 2);
  y += 42;

  const proof=latestPdfProof(record);
  const geo=proof?.geolocation?.available ? `${Number(proof.geolocation.latitude).toFixed(6)}, ${Number(proof.geolocation.longitude).toFixed(6)} ± ${Math.round(proof.geolocation.accuracyMeters||0)} m` : 'não obtida';
  const boxY = Math.max(y, PDF_PAGE_HEIGHT - proofBoxH - 24);
  ctx.fillStyle='#f5f7fa'; ctx.fillRect(x,boxY,full,proofBoxH); ctx.strokeStyle='#555'; ctx.strokeRect(x,boxY,full,proofBoxH); ctx.fillStyle='#111';
  ctx.font='700 15px Arial, sans-serif'; ctx.fillText('REGISTRO DE AUTENTICAÇÃO E INTEGRIDADE',x+10,boxY+10);
  ctx.font='12px Arial, sans-serif';
  const proofText=[
    `PET: ${f.petNumero || ''} • Código: ${record.recordId || ''} • Emitida por: ${record.payload?.issuedBy?.name || ''} (${record.payload?.issuedBy?.matricula || ''})`,
    `Gerado em: ${formatDateTime(proof?.generatedAt || record.integrity?.finalizedAt)} • IP observado: ${proof?.publicIp || 'não obtido'} • Geolocalização: ${geo}`,
    `Hash SHA-256 do conteúdo: ${record.integrity?.payloadHashSha256 || ''}`,
    `Código do dispositivo: ${record.integrity?.supervisorCryptographicSignature?.publicKeyHash || ''}`,
    'A validação oficial deve utilizar este PDF e o arquivo de validação da PET (JSON) correspondente.'
  ];
  let py=boxY+36; for(const line of proofText) py=drawWrappedText(ctx,line,x+10,py,full-20,16,2)+4;
  if (pendingNa.length) ctx.fillText('Justificativas N/A continuam na página seguinte.', x, boxY - 18);

  // Página extra apenas se as justificativas não couberem.
  while (pendingNa.length) {
    const extra = createPdfCanvas();
    await drawPdfHeader(extra.ctx, 'PET — JUSTIFICATIVAS DOS ITENS N/A (CONTINUAÇÃO)');
    const before = pendingNa.length;
    drawNaBlock(extra.ctx, 140, PDF_PAGE_HEIGHT - 60, 'JUSTIFICATIVAS DOS ITENS N/A (continuação)');
    if (pendingNa.length === before) pendingNa.shift();
    extra.ctx.font='11px Arial, sans-serif'; extra.ctx.fillText(`PET ${f.petNumero || ''}`, PDF_MARGIN, PDF_PAGE_HEIGHT-30);
    pages.push(extra.canvas);
  }
  return pages;
}

async function buildPdfParticipantPages(record) {
  const professionals = (record.payload?.professionals || []).filter(p => p.nome || p.matricula || p.required);
  const pages=[];
  const perPage=4;
  for(let start=0; start<professionals.length; start+=perPage){
    const {canvas,ctx}=createPdfCanvas();
    await drawPdfHeader(ctx,'PET — RELAÇÃO DE PROFISSIONAIS, FOTOS E ASSINATURAS');
    const subset=professionals.slice(start,start+perPage);
    const pageW=PDF_PAGE_WIDTH-PDF_MARGIN*2;
    const cardW=(pageW-20)/2;
    const cardH=490;
    for(let i=0;i<subset.length;i++){
      const p=subset[i]; const col=i%2,row=Math.floor(i/2);
      const x=PDF_MARGIN+col*(cardW+20), y=140+row*(cardH+20);
      ctx.strokeStyle='#444';ctx.lineWidth=1.5;ctx.strokeRect(x,y,cardW,cardH);
      ctx.fillStyle='#e8eef5';ctx.fillRect(x,y,cardW,44);ctx.fillStyle='#111';ctx.font='700 18px Arial, sans-serif';ctx.fillText(p.role||'',x+10,y+11);
      ctx.font='700 17px Arial, sans-serif';ctx.fillText(p.nome||'',x+10,y+58);
      ctx.font='14px Arial, sans-serif';ctx.fillText(`Matrícula: ${p.matricula||''}`,x+10,y+86);
      const photo=await loadCanvasImage(p.photoDataUrl); const sig=await loadCanvasImage(p.signatureDataUrl);
      const photoX=x+10, photoY=y+120, photoW=220, photoH=265;
      ctx.strokeRect(photoX,photoY,photoW,photoH); if(photo) drawImageCover(ctx,photo,photoX+2,photoY+2,photoW-4,photoH-4);
      ctx.font='11px Arial, sans-serif';drawWrappedText(ctx,`Foto: ${formatDateTime(p.photoCapturedAt)}`,photoX,photoY+photoH+8,photoW,14,2);
      const sigX=x+250,sigY=y+150,sigW=cardW-270,sigH=150;
      ctx.strokeRect(sigX,sigY,sigW,sigH); if(sig) drawImageContain(ctx,sig,sigX+5,sigY+5,sigW-10,sigH-10);
      ctx.font='700 13px Arial, sans-serif';ctx.fillText('Assinatura',sigX,sigY-24);
      ctx.font='11px Arial, sans-serif';drawWrappedText(ctx,`Registrada em: ${formatDateTime(p.signedAt)}`,sigX,sigY+sigH+8,sigW,14,2);
      drawWrappedText(ctx,`Hash da foto: ${p.photoHash||''}`,x+10,y+430,cardW-20,13,2);
      drawWrappedText(ctx,`Hash da assinatura: ${p.signatureHash||''}`,x+10,y+456,cardW-20,13,2);
    }
    ctx.font='11px Arial, sans-serif';ctx.fillText(`PET ${record.payload?.fields?.petNumero || ''} • página de profissionais ${Math.floor(start/perPage)+1}/${Math.ceil(professionals.length/perPage)}`,PDF_MARGIN,PDF_PAGE_HEIGHT-30);
    pages.push(canvas);
  }
  return pages;
}

function canvasToJpegBytes(canvas, quality = 0.82) {
  return new Promise((resolve, reject) => canvas.toBlob(async blob => {
    if (!blob) return reject(new Error('Não foi possível converter uma página do PDF.'));
    resolve(new Uint8Array(await blob.arrayBuffer()));
  }, 'image/jpeg', quality));
}

/** Monta um PDF mínimo e válido usando somente objetos nativos e imagens JPEG. */
function buildPdfFromJpegPages(jpegPages) {
  const encoder=new TextEncoder();
  const parts=[]; let length=0; const offsets=[0];
  const pushText=text=>{const b=encoder.encode(text);parts.push(b);length+=b.length;};
  const pushBytes=b=>{parts.push(b);length+=b.length;};
  pushText('%PDF-1.4\n%PET-Digital\n');
  const pageCount=jpegPages.length;
  const totalObjects=2+pageCount*3;
  const addObject=(num,head,bytes=null,tail='')=>{
    offsets[num]=length; pushText(`${num} 0 obj\n${head}`); if(bytes){pushBytes(bytes);} pushText(`${tail}\nendobj\n`);
  };
  addObject(1,'<< /Type /Catalog /Pages 2 0 R >>');
  const kids=Array.from({length:pageCount},(_,i)=>`${3+i*3} 0 R`).join(' ');
  addObject(2,`<< /Type /Pages /Count ${pageCount} /Kids [${kids}] >>`);
  for(let i=0;i<pageCount;i++){
    const pageObj=3+i*3, contentObj=pageObj+1, imageObj=pageObj+2;
    addObject(pageObj,`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 841.89 595.28] /Resources << /XObject << /Im0 ${imageObj} 0 R >> >> /Contents ${contentObj} 0 R >>`);
    const stream='q\n841.89 0 0 595.28 0 0 cm\n/Im0 Do\nQ\n';
    addObject(contentObj,`<< /Length ${encoder.encode(stream).length} >>\nstream\n${stream}endstream`);
    const img=jpegPages[i];
    addObject(imageObj,`<< /Type /XObject /Subtype /Image /Width ${PDF_PAGE_WIDTH} /Height ${PDF_PAGE_HEIGHT} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${img.length} >>\nstream\n`,img,'\nendstream');
  }
  const xref=length;
  pushText(`xref\n0 ${totalObjects+1}\n0000000000 65535 f \n`);
  for(let i=1;i<=totalObjects;i++) pushText(`${String(offsets[i]||0).padStart(10,'0')} 00000 n \n`);
  pushText(`trailer\n<< /Size ${totalObjects+1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`);
  const out=new Uint8Array(length); let pos=0; for(const part of parts){out.set(part,pos);pos+=part.length;}
  return out;
}

/** Cria o PDF oficial sem baixar código de terceiros em tempo de execução. */
async function createPdfFile(record) {
  const canvases=[await buildPdfChecklistPage(record), ...(await buildPdfAtmospherePages(record)), ...(await buildPdfParticipantPages(record))];
  if (!canvases.length) throw new Error('Nenhuma página foi gerada para o PDF.');
  const jpegPages=[];
  for(const canvas of canvases) jpegPages.push(await canvasToJpegBytes(canvas));
  const pdfBytes=buildPdfFromJpegPages(jpegPages);
  return new File([pdfBytes], pdfFilename(record), { type:'application/pdf' });
}

/**
 * Preenche os detalhes técnicos da tela de conclusão (código, hashes, prova do PDF).
 * Quando: ao mostrar a PET registrada.
 */
function renderIntegrity(record) {
  const panel = $('#integrityPanel');
  if (!panel || !record?.integrity) return;
  const proof = latestPdfProof(record);
  const geo = proof?.geolocation?.available
    ? `${Number(proof.geolocation.latitude).toFixed(6)}, ${Number(proof.geolocation.longitude).toFixed(6)} ± ${Math.round(proof.geolocation.accuracyMeters || 0)} m`
    : (proof?.geolocation?.error || 'não obtida');
  panel.innerHTML = `<p><strong>Código de conferência:</strong> ${escapeHtml(record.recordId)}</p>
    <p><strong>Finalizada em:</strong> ${escapeHtml(formatDateTime(record.integrity.finalizedAt))}</p>
    ${proof ? `<p><strong>IP observado:</strong> ${escapeHtml(proof.publicIp || 'não obtido')} · <strong>Localização:</strong> ${escapeHtml(geo)}</p>` : ''}
    <p><strong>Código técnico (hash):</strong><br><code>${escapeHtml(record.integrity.payloadHashSha256)}</code></p>
    <p><strong>Aparelho:</strong><br><code>${escapeHtml(record.integrity.supervisorCryptographicSignature?.publicKeyHash || '')}</code></p>`;
}

/**
 * Salva o rascunho atual no aparelho (separado por usuário).
 * Quando: automaticamente, a cada alteração (com pequeno atraso).
 */
function saveDraft() {
  const key = currentDraftKey();
  if (!key) return;
  // PET já registrada: o formulário na memória não é mais rascunho (evita reabrir uma PET emitida).
  if (finalizedRecord?.serverRegistration) return;
  const draft = { savedAt: new Date().toISOString(), appVersion: APP_VERSION, fields: serializeForm(), people: collectPeople() };
  const saved = safeLocalStorageSet(key, JSON.stringify(draft), 'o rascunho');
  if (saved) setDraftStatus(nowTime());
  return saved;
}

/** Tenta salvar o rascunho sem interromper a tela. */
function autoSaveDraft() {
  try { saveDraft(); } catch (err) { console.warn('Não foi possível salvar rascunho', err); }
}

/**
 * Restaura o rascunho do usuário.
 * Compatível com rascunhos da v1.1.6 (campos com o mesmo nome; a ordem da equipe é refeita).
 */
function loadDraft() {
  const key = currentDraftKey();
  if (!key) return false;
  const raw = localStorage.getItem(key);
  if (!raw) return false;
  try {
    const draft = JSON.parse(raw);
    restoreForm(draft.fields || {});
    if (Array.isArray(draft.people) && draft.people.length) {
      people = draft.people.map((p, idx) => ({ id: crypto.randomUUID ? crypto.randomUUID() : 'p-' + idx, ...p, _dirtySignature: undefined }));
      reindexPeople();
      renderPeople();
    }
    refreshFormDerivedUi();
    if (draft.savedAt) setDraftStatus(new Date(draft.savedAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }));
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
 * junto ao PDF e arquivo de validação, para reenvio com a mesma idempotência.
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
    pendingOfficialRegistration: Boolean(record.pendingOfficialRegistration),
    discardedAt: record.discardedAt || null
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

/** Situação de um registro local, em termos que o usuário entende. */
function recordStatus(r) {
  if (r.serverRegistration) return { key: 'reg', text: 'Registrada', cls: 'status-ok' };
  if (r.discardedAt) return { key: 'discarded', text: 'Cancelada antes do registro', cls: 'status-neutral' };
  if (r.pendingOfficialRegistration && r.output?.pdfHashSha256) return { key: 'pend', text: 'Envio pendente', cls: 'status-warn' };
  return { key: 'incomplete', text: 'Não concluída', cls: 'status-neutral' };
}

/**
 * Lista "Minhas PETs" deste aparelho.
 * Registrada: enviar PDF / enviar validação (e mais opções). Pendente: repetir envio.
 * Cancelada antes do registro: apenas referência (sem reenvio).
 */
function renderRecords() {
  const box = $('#recordsList');
  if (!box) return;
  const records = getRecords();
  if (!records.length) { box.innerHTML = '<p class="hint">Nenhuma PET emitida neste aparelho.</p>'; return; }
  box.innerHTML = records.map((r, idx) => {
    const st = recordStatus(r);
    const f = r.payload?.fields || {};
    const when = r.serverRegistration?.server_received_at || r.integrity?.finalizedAt;
    const actions = st.key === 'pend'
      ? `<button type="button" class="btn primary small block" data-record-action="registerServer" data-index="${idx}">Repetir envio ao sistema</button>`
      : st.key === 'reg'
        ? `<div class="two-cols">
            <button type="button" class="btn secondary small" data-record-action="sharePdf" data-index="${idx}">Enviar PDF</button>
            <button type="button" class="btn secondary small" data-record-action="shareJson" data-index="${idx}">Enviar validação</button>
          </div>
          <details class="details"><summary>Mais opções</summary><div class="actions-row">
            <button type="button" class="btn secondary small" data-record-action="print" data-index="${idx}">Abrir PDF</button>
            <button type="button" class="btn secondary small" data-record-action="export" data-index="${idx}">Salvar validação</button>
            <button type="button" class="btn danger-outline small" data-record-action="delete" data-index="${idx}">Excluir deste aparelho</button>
          </div></details>`
        : `<button type="button" class="link danger-text" data-record-action="delete" data-index="${idx}">Excluir deste aparelho</button>`;
    return `<div class="list-card">
      <div class="row-between"><span class="title">${escapeHtml(f.petNumero || r.recordId)}</span><span class="status-chip ${st.cls}">${escapeHtml(st.text)}</span></div>
      <span class="sub">${escapeHtml(f.local || '')}</span>
      <span class="meta">${escapeHtml(formatDateTime(when))}</span>
      ${actions}
    </div>`;
  }).join('');
}

/** Ações dos cartões de Minhas PETs (um único ouvinte, ligado em bindEvents). */
async function handleRecordAction(event) {
  const btn = event.target.closest('[data-record-action]');
  if (!btn) return;
  const compactRecord = getRecords()[Number(btn.dataset.index)];
  if (!compactRecord) return;
  const action = btn.dataset.recordAction;
  if (action === 'delete') {
    const ok = await askConfirm('Excluir esta PET apenas deste aparelho? O registro no sistema não é afetado.', { okLabel: 'Excluir', danger: true });
    if (!ok) return;
    const updated = getRecords().filter(r => r.recordId !== compactRecord.recordId);
    const key = currentRecordsKey();
    if (key) safeLocalStorageSet(key, JSON.stringify(updated), 'o histórico local');
    await deleteOfficialFiles(compactRecord.recordId);
    if (readPendingPointer()?.recordId === compactRecord.recordId) clearPendingPointer();
    renderRecords();
    return;
  }
  const rec = await hydrateRecord(compactRecord);
  if (!rec) return notify('Os arquivos completos desta PET não estão mais neste aparelho.', 'bad');
  if (action === 'print') await openOfficialPdf(rec, btn);
  if (action === 'sharePdf') await sharePdfRecord(rec, btn);
  if (action === 'shareJson') await shareJsonRecord(rec, btn);
  if (action === 'export' && await ensureRecordReadyForOutput(rec)) {
    const files = await readOfficialFiles(rec);
    downloadBlob(new Blob([files.jsonText], { type: 'application/json' }), files.jsonFilename || jsonFilename(rec));
  }
  if (action === 'registerServer') await retryPendingRecordRegistration(rec, btn);
}

/**
 * Valida simultaneamente o PDF e o arquivo de validação JSON, além de consultar o registro exato no Worker.
 * Sem os dois arquivos, a validação oficial não é concluída.
 */
async function verifyFiles() {
  const jsonFile = $('#verifyJsonFile')?.files?.[0];
  const pdfFile = $('#verifyPdfFile')?.files?.[0];
  const result = $('#verifyResult');
  result.classList.remove('hidden');
  if (!jsonFile || !pdfFile) {
    result.className = 'alert alert-warn';
    result.textContent = 'Selecione o PDF e o arquivo de validação (JSON) correspondentes.';
    return;
  }
  try {
    const state = currentUser();
    if (!['admin','gestor','verificador'].includes(state?.role)) throw new Error('Seu perfil não possui acesso à validação oficial.');
    const text = await jsonFile.text();
    const jsonHash = await sha256Hex(text);
    const pdfHash = await sha256BlobHex(pdfFile);
    const record = JSON.parse(text);
    if (!record.payload || !record.integrity || !record.fileIntegrity) throw new Error('O arquivo selecionado não é um arquivo de validação completo da PET Digital.');
    if (pdfHash !== record.fileIntegrity.pdfSha256) throw new Error('O PDF selecionado não corresponde ao hash gravado no arquivo de validação.');

    const standardCheck = validateSupportedProofStandard(record.payload.proofStandard, 'PET');
    const recalculated = await sha256Hex(record.payload);
    const hashMatches = recalculated === record.integrity.payloadHashSha256;
    const signatureOk = standardCheck.errors.length === 0 && await verifySignature(recalculated, record.integrity.supervisorCryptographicSignature);
    const proofs = record.integrity.pdfGenerationProofs || [];
    if (!proofs.length) throw new Error('Arquivo de validação sem prova de geração do PDF.');
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
    result.className = 'alert ' + (allOk ? 'alert-ok' : 'alert-bad');
    const technicalText = `Hash do PDF: ${pdfHash}
Hash do JSON: ${jsonHash}
Hash do payload: ${recalculated}
Integridade local: ${localOk ? 'OK' : 'FALHA'}
Registro exato no servidor: ${server.found ? 'ENCONTRADO' : 'NÃO ENCONTRADO'}
Chave autorizada na emissão: ${server.keyAuthorizedAtRegistration ? 'SIM' : 'NÃO'}
Assinaturas confirmadas no servidor: ${server.signaturesValid ? 'SIM' : 'NÃO'}
Emissor: ${server.limited ? 'RESTRITO (PET de outra unidade)' : server.issuer ? `${server.issuer.name} (${server.issuer.matricula})` : 'NÃO CONFIRMADO'}`;
    // v1.3.0: para o verificador, PET de outra unidade confirma só a autenticidade.
    const title = !allOk ? 'Documento não validado.'
      : server.limited ? `Documento autêntico: ${server.record?.numero_pet || ''}.`
      : 'Documento válido: PDF, arquivo de validação, emissor e aparelho confirmados.';
    result.innerHTML = `<strong>${escapeHtml(title)}</strong><span>${escapeHtml(server.message || server.reason || '')}</span><details class="details"><summary>Detalhes técnicos</summary><pre>${escapeHtml(technicalText)}</pre></details>`;
  } catch (err) {
    result.className = 'alert alert-bad';
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
  if (!box) return;
  const key = await readLocalKeyPair();
  if (!key) {
    box.innerHTML = '<p class="hint">A proteção local ainda não foi criada. Ela é criada automaticamente ao solicitar a autorização deste aparelho.</p>';
    return;
  }
  box.innerHTML = `<p><strong>Proteção local:</strong> criada em ${escapeHtml(formatDateTime(key.createdAt))}<br><strong>Algoritmo:</strong> ${escapeHtml(key.algorithm)}<br><strong>Código do aparelho:</strong><br><code>${escapeHtml(key.publicKeyHash)}</code></p>`;
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

/** Retorna o nome sugerido para o arquivo de validação da PET (JSON). */
function jsonFilename(record) { return `${recordFileStem(record)}_validacao.json`; }

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
 * Ativação: botões de compartilhamento de PDF/arquivo de validação da PET (JSON).
 * O que faz: tenta abrir a folha nativa de compartilhamento do celular; quando o navegador
 * não suporta arquivos, salva os arquivos localmente para o usuário encaminhar manualmente.
 */
async function shareFilesOrDownload(files, title, text) {
  if (navigator.share && navigator.canShare && navigator.canShare({ files })) {
    await navigator.share({ files, title, text });
    return;
  }
  files.forEach(file => downloadBlob(file, file.name));
  notify('Este navegador não permite compartilhar arquivos diretamente. O arquivo foi baixado para envio manual.', 'info', 6000);
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
 * v1.2.0: com sessão salva, o app abre direto (mesmo sem internet), carrega o rascunho uma
 * única vez e só depois reconfirma a sessão no servidor, em segundo plano.
 */
async function init() {
  renderChecklist();
  resetPeople();
  renderPeople();
  bindEvents();
  showFormStep(1);
  setDefaultDateTime();
  refreshFormDerivedUi();
  purgeLegacySharedStorage();
  loadAuthState();
  setOffline(navigator.onLine === false);
  renderAuthState();
  if (authToken()) {
    await loadUserWorkspace({ force: true });
    if (finalizedRecord?.pendingOfficialRegistration) notify('Há uma PET gerada e ainda não registrada. Abra a revisão para repetir o envio.', 'info', 6000);
    refreshMe();
  } else {
    setTimeout(() => $('#loginMatricula')?.focus(), 100);
  }
  updateKeyStatus();
  registerServiceWorker();
}

document.addEventListener('DOMContentLoaded', () => { init().catch(err => { console.error(err); notify('Erro ao iniciar o aplicativo: ' + err.message, 'bad'); }); });
