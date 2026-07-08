(() => {
  'use strict';

  /**
   * PET Digital NR-33 v1.0.5.
   *
   * Visão geral do arquivo:
   * - Este app é um PWA estático: não depende de servidor próprio para preencher, assinar,
   *   validar, imprimir e exportar a PET.
   * - O estado temporário fica em memória (`people` e `finalizedRecord`) e o rascunho/
   *   registros finalizados são persistidos no `localStorage` do dispositivo.
   * - O fluxo principal é: preencher formulário -> validar -> finalizar/assinar hash ->
   *   gerar prova de PDF -> imprimir/salvar PDF -> exportar JSON probatório.
   * - Foto, assinatura desenhada, dados do formulário e prova de geração do PDF entram
   *   no material que é hasheado e assinado criptograficamente.
   *
   * Observação: os comentários abaixo foram mantidos para facilitar auditoria,
   * revisão técnica e evolução controlada do código.
   */

  // Versão funcional gravada no dossiê e exibida nos elementos de prova.
  const APP_VERSION = '1.0.5';

  // Perfil técnico aceito pelo próprio validador. Esses valores padronizam como o hash
  // é calculado, qual algoritmo assina o registro e como outro validador deve conferir.
  const VALIDATION_PROFILE = 'PET-DIGITAL-NR33-PROOF/v1';
  const PAYLOAD_SCHEMA = 'PET-DIGITAL-NR33/v1.0.5';
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
  const STORAGE_DRAFT = 'petDigitalDraftV5';
  const STORAGE_RECORDS = 'petDigitalRecordsV1';
  const STORAGE_KEYPAIR = 'petDigitalKeyPairV1';

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

  /**
   * Garante que exista uma chave criptográfica local.
   * Ativação: chamada sempre que o app precisa assinar um hash.
   * O que faz: tenta carregar a chave ECDSA do localStorage; se não existir, cria uma nova.
   */
  async function ensureKeyPair() {
    const stored = localStorage.getItem(STORAGE_KEYPAIR);
    if (stored) return JSON.parse(stored);
    return createKeyPair();
  }

  /**
   * Cria uma nova chave ECDSA P-256 para assinatura local.
   * Ativação: botão 'Gerar chave' ou primeira finalização sem chave existente.
   * O que faz: gera par público/privado via WebCrypto, exporta em JWK, calcula o hash
   * da chave pública e salva tudo no localStorage do dispositivo.
   */
  async function createKeyPair() {
    const keyPair = await crypto.subtle.generateKey(
      { name: 'ECDSA', namedCurve: 'P-256' },
      true,
      ['sign', 'verify']
    );
    const publicKey = await crypto.subtle.exportKey('jwk', keyPair.publicKey);
    const privateKey = await crypto.subtle.exportKey('jwk', keyPair.privateKey);
    const publicKeyHash = await sha256Hex(publicKey);
    const stored = {
      algorithm: SIGNATURE_ALGORITHM,
      createdAt: new Date().toISOString(),
      publicKey,
      privateKey,
      publicKeyHash
    };
    localStorage.setItem(STORAGE_KEYPAIR, JSON.stringify(stored));
    updateKeyStatus();
    return stored;
  }

  /**
   * Importa a chave privada JWK para uso pelo WebCrypto.
   * Ativação: chamada por `signPayloadHash`.
   * O que faz: transforma o JSON da chave privada em objeto criptográfico apto a assinar.
   */
  async function importPrivateKey(jwk) {
    return crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
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
    const privateKey = await importPrivateKey(keyPair.privateKey);
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
   * Ativação: tela 'Validar' ao importar um dossiê JSON.
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
   * Ativação: botão 'Gerar PDF com prova', dentro de `buildPdfGenerationProof`.
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
   * Ativação: botão 'Gerar PDF com prova', dentro de `buildPdfGenerationProof`.
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
        'Comparar o hash recalculado com payloadHashSha256 salvo no dossiê.',
        'Verificar a assinatura ECDSA P-256/SHA-256 com a chave pública salva no JSON.',
        'Repetir a validação para cada prova de geração de PDF registrada.'
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
    if (standard.validationProfile !== VALIDATION_PROFILE) errors.push(`${contextLabel}: perfil de validação incompatível.`);
    if (standard.canonicalizationAlgorithm !== CANONICALIZATION_ALGORITHM) errors.push(`${contextLabel}: regra de JSON canônico incompatível.`);
    if (standard.hashAlgorithm !== HASH_ALGORITHM) errors.push(`${contextLabel}: algoritmo de hash incompatível.`);
    if (standard.signatureAlgorithm !== SIGNATURE_ALGORITHM) errors.push(`${contextLabel}: algoritmo de assinatura incompatível.`);
    return { errors, warnings };
  }

  /**
   * Monta a prova de geração do PDF.
   * Ativação: clique no botão 'Gerar PDF com prova'.
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
   * Renderiza a tabela de checklist na tela.
   * Ativação: durante a inicialização do aplicativo.
   * O que faz: transforma cada item de `checklistItems` em uma linha com rádio S/N/N/A
   * e nomes de campo padronizados (`check_01`, `check_02` etc.).
   */
  function renderChecklist() {
    const tbody = $('#checklistTable tbody');
    tbody.innerHTML = checklistItems.map((item, index) => {
      const n = String(index + 1).padStart(2, '0');
      return `<tr>
        <td>${n}</td>
        <td>${escapeHtml(item)}</td>
        <td><input required type="radio" name="check_${n}" value="S" aria-label="${n} Sim" /></td>
        <td><input required type="radio" name="check_${n}" value="N" aria-label="${n} Não" /></td>
        <td><input required type="radio" name="check_${n}" value="NA" aria-label="${n} Não se aplica" /></td>
      </tr>`;
    }).join('');
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
   * O que faz: desabilita PDF/JSON da finalização anterior para evitar que o usuário
   * compartilhe um dossiê antigo após ter modificado dados na tela.
   */
  function markFinalizedRecordStale() {
    if (!finalizedRecord) return;
    finalizedRecord = null;
    ['#printBtn', '#sharePdfBtn', '#exportBtn', '#shareJsonBtn'].forEach(selector => {
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
    const box = $('#validationBox');
    if (box) {
      box.className = 'validation-box warn';
      box.textContent = 'O formulário foi alterado após a última finalização. Valide e finalize novamente para gerar PDF/JSON atualizados.';
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

    // Botões principais do formulário e ações de rascunho/finalização/exportação.
    $('#addEntrante').addEventListener('click', () => addProfessional('entrante'));
    $('#addVigia').addEventListener('click', () => addProfessional('vigia'));
    $('#saveDraft').addEventListener('click', () => { saveDraft(); alert('Rascunho salvo neste dispositivo.'); });
    $('#clearDraft').addEventListener('click', () => {
      if (!confirm('Deseja limpar o formulário e apagar o rascunho local?')) return;
      localStorage.removeItem(STORAGE_DRAFT);
      finalizedRecord = null;
      $('#petForm').reset();
      setDefaultDateTime();
      resetPeople();
      renderPeople();
      $('#validationBox').className = 'validation-box';
      $('#validationBox').textContent = 'Preencha o formulário e clique em “Validar”.';
      $('#integrityPanel').classList.add('hidden');
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
    $('#printBtn').addEventListener('click', event => printRecordWithProof(finalizedRecord, event.currentTarget));
    $('#sharePdfBtn').addEventListener('click', event => sharePdfRecord(finalizedRecord, event.currentTarget));
    $('#exportBtn').addEventListener('click', () => {
      if (!finalizedRecord) return;
      downloadJson(finalizedRecord, jsonFilename(finalizedRecord));
    });
    $('#shareJsonBtn').addEventListener('click', event => shareJsonRecord(finalizedRecord, event.currentTarget));

    // Eventos das abas auxiliares: histórico local, validador de JSON e gerenciamento da chave.
    $('#refreshRecords').addEventListener('click', renderRecords);
    $('#verifyFile').addEventListener('change', verifyFile);
    $('#createKey').addEventListener('click', async () => { await createKeyPair(); alert('Chave local gerada.'); });
    $('#exportPublicKey').addEventListener('click', exportPublicKey);
    $('#resetKey').addEventListener('click', () => {
      if (!confirm('Apagar a chave local? Registros já assinados continuarão verificáveis pelo JSON exportado, mas esta instalação não poderá assinar com a chave antiga.')) return;
      localStorage.removeItem(STORAGE_KEYPAIR);
      updateKeyStatus();
    });

    // Autosave com debounce para evitar perda de preenchimento durante o uso em campo.
    // Qualquer alteração após finalizar invalida os botões PDF/JSON até nova finalização.
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
    $$('.tab').forEach(t => t.classList.remove('active'));
    $('#' + tabId).classList.add('active');
    if (tabId === 'recordsTab') renderRecords();
    if (tabId === 'settingsTab') updateKeyStatus();
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
      return { number: n, item, answer: selected ? selected.value : '' };
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
   * Monta o payload que será hasheado e assinado.
   * Ativação: clique em 'Finalizar e assinar PET', após validação sem impedimentos.
   * O que faz: junta campos, número automático, checklist, profissionais e aviso normativo
   * em uma estrutura única e estável para fins de integridade.
   */
  function buildPayload() {
    const fields = collectFormFields();
    fields.petNumero = generatePetNumber(fields);
    fields.petNumeroGeradoAutomaticamente = 'Sim';
    return {
      schema: PAYLOAD_SCHEMA,
      proofStandard: buildProofStandard('PET_PAYLOAD'),
      fields,
      checklist: collectChecklist(),
      professionals: collectPeople(),
      regulatoryNotice: {
        nr33: 'Permissão de Entrada e Trabalho para espaços confinados; registros devem ser mantidos pela organização.',
        validationCriteria: 'O2 > 19,5 e < 23; LIE < 10; H2S < 5 ppm; CO < 25 ppm; respostas do checklist sem impeditivos.'
      }
    };
  }

  /**
   * Executa as validações automáticas antes da finalização.
   * Ativação: botão 'Validar' e também antes de finalizar.
   * O que faz: verifica campos obrigatórios, checklist, condição IPVS, compatibilidade de
   * ar mandado, medições de gases, foto/assinatura dos participantes e suporte a WebCrypto.
   */
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
    // Regra geral do modelo: respostas negativas em itens de controle bloqueiam a entrada.
    // Exceções lógicas do próprio formulário: item 12 deve ser NÃO para indicar ausência de IPVS;
    // itens 15 e 20 indicam necessidade de controles específicos e podem ser NÃO/N/A conforme avaliação técnica.
    const negativeBlocking = checklist.filter(c => c.answer === 'N' && !['12', '15', '20'].includes(c.number));
    if (negativeBlocking.length) {
      errors.push(`Há ${negativeBlocking.length} item(ns) de controle marcado(s) como “NÃO”. A entrada deve ser bloqueada até correção técnica.`);
      negativeBlocking.slice(0, 6).forEach(c => warnings.push(`Item ${c.number}: ${c.item}`));
    }

    const ipvsAnswer = checklist.find(c => c.number === '12')?.answer;
    if (ipvsAnswer === 'S') errors.push('Item 12 indica atmosfera IPVS. Não libere entrada sem procedimento específico e medidas compatíveis.');
    if (ipvsAnswer === 'NA') warnings.push('Item 12 marcado como N/A. Confira se a avaliação de atmosfera perigosa/IPVS foi registrada corretamente.');

    const arMandado = checklist.find(c => c.number === '15')?.answer;
    const linhaAr = checklist.find(c => c.number === '19')?.answer;
    if (arMandado === 'S' && linhaAr !== 'S') errors.push('Item 15 indica necessidade de ar mandado, mas o item 19 não confirma linha de ar instalada e operando.');
    if (checklist.find(c => c.number === '20')?.answer === 'S') warnings.push('Item 20: há necessidade de ferramentas elétricas intrinsecamente seguras. Confira especificação e liberação antes da entrada.');

    const detectorOk = checklist.find(c => c.number === '10')?.answer;
    if (detectorOk === 'S' && !form.elements.detectorCalibracao.value) warnings.push('Item 10 marcado como SIM, mas a data de validade/calibração do detector não foi informada.');
    if (detectorOk === 'S' && !normalizeText(form.elements.detectorId.value)) warnings.push('Item 10 marcado como SIM, mas o identificador do detector não foi informado.');

    const gasChecks = checkGasMeasurements();
    errors.push(...gasChecks.errors);
    warnings.push(...gasChecks.warnings);

    const typeCounts = people.reduce((acc, p) => {
      acc[p.type] = (acc[p.type] || 0) + 1;
      return acc;
    }, {});
    if (!typeCounts.entrante) errors.push('Inclua pelo menos um entrante.');
    if (!typeCounts.vigia) errors.push('Inclua pelo menos um vigia.');
    if (!typeCounts.supervisor) errors.push('Inclua o supervisor de entrada.');

    // Todos os cartões exibidos são tratados como participantes efetivos da PET.
    // Se um entrante/vigia adicional foi incluído por engano, ele deve ser removido antes de finalizar.
    people.forEach(p => {
      if (!normalizeText(p.nome)) errors.push(`${p.role}: nome obrigatório.`);
      if (!normalizeText(p.matricula)) errors.push(`${p.role}: matrícula obrigatória.`);
      if (!p.photoDataUrl) errors.push(`${p.role}: foto obrigatória para vincular a assinatura ao participante.`);
      if (!p.signatureDataUrl) errors.push(`${p.role}: assinatura obrigatória.`);
      if (p._dirtySignature) errors.push(`${p.role}: assinatura foi alterada no canvas, mas ainda não foi registrada. Clique em “Registrar assinatura”.`);
      if (p.signatureDataUrl && p.signatureMetrics && !p.signatureMetrics.isSigned) errors.push(`${p.role}: assinatura inválida ou vazia. Limpe e assine novamente.`);
    });

    const matriculas = new Map();
    people.forEach(p => {
      const mat = normalizeText(p.matricula).toLowerCase();
      if (!mat) return;
      const list = matriculas.get(mat) || [];
      list.push(p.role);
      matriculas.set(mat, list);
    });
    matriculas.forEach((roles, mat) => {
      if (roles.length > 1) warnings.push(`Matrícula repetida (${mat}) em: ${roles.join(', ')}. Confira se não houve duplicidade de cadastro.`);
    });

    const supervisorCard = people.find(p => p.type === 'supervisor');
    const supervisorField = normalizeText(form.elements.supervisorEntrada.value).toLowerCase();
    const supervisorName = normalizeText(supervisorCard?.nome).toLowerCase();
    if (supervisorField && supervisorName && supervisorField !== supervisorName) {
      warnings.push('O nome do “Supervisor de entrada” na identificação está diferente do nome informado no cartão de assinatura do supervisor.');
    }

    const emission = form.elements.horaEmissao.value;
    const termino = form.elements.horaTermino.value;
    if (emission && termino && termino <= emission) warnings.push('Hora de término igual ou anterior à emissão. Confira se o serviço passa da meia-noite ou ajuste o horário.');

    if (!crypto?.subtle) errors.push('Este navegador não oferece WebCrypto. A assinatura criptográfica não está disponível.');

    return { ok: errors.length === 0, errors, warnings };
  }

  /**
   * Valida as medições de gases perigosos.
   * Ativação: chamada por `validateCurrentForm`.
   * O que faz: lê O₂, %LIE, H₂S e CO de cada linha preenchida, aplica os limites do modelo
   * e alerta sobre calibração vencida do detector, quando informada.
   */
  function checkGasMeasurements() {
    const form = $('#petForm');
    const errors = [];
    const warnings = [];
    // Helper local: converte o conteúdo do input de gás em número ou `null` se vazio/inválido.
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
      const values = {
        o2: val(`gas_${row.key}_o2`),
        lie: val(`gas_${row.key}_lie`),
        h2s: val(`gas_${row.key}_h2s`),
        co: val(`gas_${row.key}_co`)
      };
      const any = Object.values(values).some(v => v !== null) || form.elements[`gas_${row.key}_hora`]?.value;
      if (row.required || any) {
        Object.entries(values).forEach(([k, v]) => { if (v === null) errors.push(`${row.label}: campo ${k.toUpperCase()} não preenchido.`); });
        if (values.o2 !== null && !(values.o2 > 19.5 && values.o2 < 23)) errors.push(`${row.label}: O₂ fora do intervalo seguro informado no modelo.`);
        if (values.lie !== null && !(values.lie < 10)) errors.push(`${row.label}: inflamável (%LIE) igual ou acima de 10%.`);
        if (values.h2s !== null && !(values.h2s < 5)) errors.push(`${row.label}: H₂S igual ou acima de 5 ppm.`);
        if (values.co !== null && !(values.co < 25)) errors.push(`${row.label}: CO igual ou acima de 25 ppm.`);
      }
    });
    const detectorCal = form.elements.detectorCalibracao.value;
    if (detectorCal && detectorCal < todayISO()) warnings.push('A validade/calibração do detector está vencida conforme a data informada.');
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
   * Finaliza a PET e cria o dossiê probatório.
   * Ativação: clique no botão 'Finalizar e assinar PET'.
   * O que faz: valida, monta payload, calcula hash SHA-256, assina o hash, gera recordId,
   * salva localmente, renderiza painel/área de impressão e libera PDF/JSON.
   */
  async function finalizeRecord() {
    const validation = validateCurrentForm();
    showValidation(validation);
    if (!validation.ok) {
      alert('Não é possível finalizar enquanto houver impedimentos automáticos.');
      return;
    }
    const payload = buildPayload();
    const payloadHash = await sha256Hex(payload);
    const signature = await signPayloadHash(payloadHash);
    const recordId = payloadHash.slice(0, 16).toUpperCase();
    finalizedRecord = {
      recordType: RECORD_TYPE,
      recordId,
      payload,
      integrity: {
        payloadHashSha256: payloadHash,
        supervisorCryptographicSignature: signature,
        finalizedAt: new Date().toISOString(),
        validationWarnings: validation.warnings
      }
    };
    saveRecord(finalizedRecord);
    renderIntegrity(finalizedRecord);
    renderPrintArea(finalizedRecord);
    $('#printBtn').disabled = false;
    $('#sharePdfBtn').disabled = false;
    $('#exportBtn').disabled = false;
    $('#shareJsonBtn').disabled = false;
    localStorage.removeItem(STORAGE_DRAFT);
    alert('PET finalizada, assinada e salva neste dispositivo. Exporte o JSON e salve o PDF para arquivamento.');
  }

  /**
   * Anexa uma nova prova de geração de PDF ao registro.
   * Ativação: impressão, compartilhamento de PDF e compartilhamento de pacote com PDF.
   * O que faz: coleta IP/GPS/data/hora, assina a prova, atualiza o registro local e redesenha
   * a área de impressão com os dados probatórios mais recentes.
   */
  async function appendPdfProofAndRender(record) {
    const proof = await buildPdfGenerationProof(record);
    record.integrity.pdfGenerationProofs = record.integrity.pdfGenerationProofs || [];
    record.integrity.pdfGenerationProofs.push(proof);
    record.integrity.latestPdfProofHashSha256 = proof.pdfProofHashSha256;
    finalizedRecord = record;
    updateStoredRecord(record);
    renderIntegrity(record);
    renderPrintArea(record);
    return proof;
  }

  /**
   * Gera a prova de PDF e chama a impressão do navegador.
   * Ativação: botão 'Gerar PDF com prova' ou botão PDF em registros salvos.
   * O que faz: coleta IP/GPS/data/hora, assina a prova, atualiza o registro local, prepara
   * um nome de arquivo mais específico no título do documento e executa `window.print()`.
   */
  async function printRecordWithProof(record, triggerButton, options = {}) {
    if (!record) return;
    const button = triggerButton || $('#printBtn');
    const originalText = button ? button.textContent : '';
    const originalTitle = document.title;
    try {
      if (button) {
        button.disabled = true;
        button.textContent = options.skipProof ? 'Preparando PDF...' : 'Coletando prova do PDF...';
      }
      if (!options.skipProof) await appendPdfProofAndRender(record);
      else renderPrintArea(record);

      // Muitos navegadores usam document.title como sugestão de nome ao salvar como PDF.
      document.title = pdfFilename(record).replace(/\.pdf$/i, '');
      const restoreTitle = () => { document.title = originalTitle; };
      window.addEventListener('afterprint', restoreTitle, { once: true });
      window.print();
      setTimeout(restoreTitle, 1500);
    } finally {
      if (button) {
        button.disabled = false;
        button.textContent = originalText || 'Gerar PDF com prova';
      }
    }
  }

  /**
   * Compartilha o dossiê JSON pela folha nativa de compartilhamento do celular/navegador.
   * Ativação: botão 'Compartilhar JSON' da PET finalizada ou da aba Registros.
   * O que faz: cria um arquivo JSON em memória e usa a Web Share API; se o navegador não
   * suportar compartilhamento de arquivos, faz o download como fallback.
   */
  async function shareJsonRecord(record, triggerButton) {
    if (!record) return;
    const button = triggerButton || $('#shareJsonBtn');
    const originalText = button ? button.textContent : '';
    try {
      if (button) { button.disabled = true; button.textContent = 'Compartilhando JSON...'; }
      const file = createJsonFile(record);
      await shareFilesOrDownload([file], 'Dossiê PET Digital NR-33', `Dossiê JSON da ${record.payload?.fields?.petNumero || record.recordId}.`);
    } catch (err) {
      if (err.name !== 'AbortError') alert('Não foi possível compartilhar o JSON: ' + err.message);
    } finally {
      if (button) { button.disabled = false; button.textContent = originalText || 'Compartilhar JSON'; }
    }
  }

  /**
   * Compartilha o PDF pela folha nativa de compartilhamento do celular/navegador.
   * Ativação: botão 'Compartilhar PDF' da PET finalizada ou da aba Registros.
   * O que faz: adiciona uma prova de geração do PDF, tenta gerar um PDF real no navegador
   * usando bibliotecas carregadas sob demanda e compartilha o arquivo. Se não for possível,
   * mantém o fallback seguro de impressão/salvar PDF pelo navegador.
   */
  async function sharePdfRecord(record, triggerButton) {
    if (!record) return;
    const button = triggerButton || $('#sharePdfBtn');
    const originalText = button ? button.textContent : '';
    try {
      if (button) { button.disabled = true; button.textContent = 'Gerando PDF...'; }
      await appendPdfProofAndRender(record);
      const pdfFile = await createPdfFile(record);
      if (button) button.textContent = 'Abrindo compartilhamento...';
      await shareFilesOrDownload([pdfFile], 'PET Digital NR-33 — PDF', `PDF da ${record.payload?.fields?.petNumero || record.recordId}.`);
    } catch (err) {
      if (err.name === 'AbortError') return;
      alert('Não foi possível gerar o PDF para compartilhamento direto. O aplicativo abrirá a tela de impressão/salvar PDF do navegador. Motivo: ' + err.message);
      await printRecordWithProof(record, button, { skipProof: true });
    } finally {
      if (button) { button.disabled = false; button.textContent = originalText || 'Compartilhar PDF'; }
    }
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
    const proofText = proof ? `<br><strong>Última prova de PDF:</strong><br>
      Data/hora: ${formatDateTime(proof.generatedAt)}<br>
      IP: ${escapeHtml(proof.publicIp || 'não obtido')}<br>
      Geolocalização: ${proof.geolocation?.available ? `${escapeHtml(String(proof.geolocation.latitude))}, ${escapeHtml(String(proof.geolocation.longitude))} ± ${escapeHtml(String(Math.round(proof.geolocation.accuracyMeters || 0)))} m` : escapeHtml(proof.geolocation?.error || 'não obtida')}<br>
      Hash da prova: <code>${escapeHtml(proof.pdfProofHashSha256)}</code>` : '';
    panel.classList.remove('hidden');
    const standard = record.payload?.proofStandard || {};
    panel.innerHTML = `<strong>Registro:</strong> ${escapeHtml(record.recordId)}<br>
      <strong>Perfil de validação:</strong> ${escapeHtml(standard.validationProfile || VALIDATION_PROFILE)}<br>
      <strong>JSON canônico:</strong> ${escapeHtml(standard.canonicalizationAlgorithm || CANONICALIZATION_ALGORITHM)}<br>
      <strong>Hash SHA-256 do dossiê/payload:</strong><br><code>${escapeHtml(record.integrity.payloadHashSha256)}</code><br>
      <strong>Assinatura criptográfica:</strong> ${escapeHtml(record.integrity.supervisorCryptographicSignature.algorithm)}<br>
      <strong>Chave pública:</strong> ${escapeHtml(record.integrity.supervisorCryptographicSignature.publicKeyHash)}<br>
      <strong>Finalizado em:</strong> ${formatDateTime(record.integrity.finalizedAt)}${proofText}`;
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
    const validationInfoHtml = `<strong>Código de conferência:</strong> ${escapeHtml(validationCode)} • <strong>Perfil:</strong> ${escapeHtml(p.proofStandard?.validationProfile || VALIDATION_PROFILE)} • <strong>Hash:</strong> ${escapeHtml(p.proofStandard?.hashAlgorithm || HASH_ALGORITHM)} • <strong>Assinatura:</strong> ${escapeHtml(p.proofStandard?.signatureAlgorithm || SIGNATURE_ALGORITHM)} • <strong>JSON canônico:</strong> ${escapeHtml(p.proofStandard?.canonicalizationAlgorithm || CANONICALIZATION_ALGORITHM)} • <strong>Validação:</strong> exige o dossiê JSON correspondente.`;

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
    localStorage.setItem(STORAGE_DRAFT, JSON.stringify(draft));
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
    const raw = localStorage.getItem(STORAGE_DRAFT);
    if (!raw) return false;
    try {
      const draft = JSON.parse(raw);
      restoreForm(draft.fields || {});
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
   * Salva uma PET finalizada no histórico local.
   * Ativação: finalização da PET.
   * O que faz: coloca o novo registro no início da lista e mantém no máximo 200 registros
   * no localStorage para evitar crescimento indefinido.
   */
  function saveRecord(record) {
    const records = getRecords();
    records.unshift(record);
    const limited = records.slice(0, 200);
    localStorage.setItem(STORAGE_RECORDS, JSON.stringify(limited));
  }

  /**
   * Atualiza um registro já salvo no histórico local.
   * Ativação: após gerar prova de PDF para um registro existente.
   * O que faz: procura pelo recordId, substitui o registro, ou insere no início se não achar.
   */
  function updateStoredRecord(record) {
    const records = getRecords();
    const idx = records.findIndex(r => r.recordId === record.recordId);
    if (idx >= 0) records[idx] = record;
    else records.unshift(record);
    localStorage.setItem(STORAGE_RECORDS, JSON.stringify(records.slice(0, 200)));
  }

  /**
   * Lê os registros finalizados salvos neste dispositivo.
   * Ativação: aba Registros, atualização de registro e impressão/exportação.
   * O que faz: interpreta o JSON do localStorage e devolve array vazio em caso de erro.
   */
  function getRecords() {
    try { return JSON.parse(localStorage.getItem(STORAGE_RECORDS) || '[]'); }
    catch { return []; }
  }

  /**
   * Renderiza a lista de PETs finalizadas neste dispositivo.
   * Ativação: abrir aba Registros ou clicar em 'Atualizar lista'.
   * O que faz: monta cartões com número/local/hash e cria ações para PDF, JSON e exclusão
   * local de cada registro.
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
      Finalizado: ${formatDateTime(r.integrity?.finalizedAt)}<br><small class="record-hash">Hash: ${escapeHtml(r.integrity?.payloadHashSha256 || '')}</small></div>
      <div class="actions">
        <button type="button" class="small secondary" data-record-action="print" data-index="${idx}">PDF</button>
        <button type="button" class="small secondary" data-record-action="sharePdf" data-index="${idx}">Compartilhar PDF</button>
        <button type="button" class="small secondary" data-record-action="export" data-index="${idx}">JSON</button>
        <button type="button" class="small secondary" data-record-action="shareJson" data-index="${idx}">Compartilhar JSON</button>
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
        await printRecordWithProof(rec, btn);
      }
      if (btn.dataset.recordAction === 'sharePdf') {
        finalizedRecord = rec;
        await sharePdfRecord(rec, btn);
      }
      if (btn.dataset.recordAction === 'export') downloadJson(rec, jsonFilename(rec));
      if (btn.dataset.recordAction === 'shareJson') await shareJsonRecord(rec, btn);
      if (btn.dataset.recordAction === 'delete') {
        if (!confirm('Excluir este registro apenas deste dispositivo?')) return;
        const updated = getRecords();
        updated.splice(Number(btn.dataset.index), 1);
        localStorage.setItem(STORAGE_RECORDS, JSON.stringify(updated));
        renderRecords();
      }
    };
  }

  /**
   * Valida um dossiê JSON importado pelo usuário.
   * Ativação: seleção de arquivo na aba 'Validar'.
   * O que faz: recalcula o hash do payload, verifica a assinatura da PET e também valida
   * cada prova de PDF existente, exibindo o resultado na tela.
   */
  async function verifyFile(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    const result = $('#verifyResult');
    try {
      const text = await file.text();
      const record = JSON.parse(text);
      if (!record.payload || !record.integrity) throw new Error('Arquivo não parece ser um dossiê PET Digital válido.');

      const standardCheck = validateSupportedProofStandard(record.payload.proofStandard, 'PET');
      const standardOk = standardCheck.errors.length === 0;
      const recalculated = await sha256Hex(record.payload);
      const hashMatches = recalculated === record.integrity.payloadHashSha256;
      const signatureOk = standardOk && await verifySignature(recalculated, record.integrity.supervisorCryptographicSignature);

      const proofLines = [];
      const proofs = record.integrity.pdfGenerationProofs || [];
      let allProofsOk = true;
      for (const [idx, proof] of proofs.entries()) {
        const proofStandardCheck = validateSupportedProofStandard(proof.proofStandard || proof, `Prova PDF ${idx + 1}`);
        const proofHash = await sha256Hex(proofHashInput(proof));
        const proofHashOk = proofHash === proof.pdfProofHashSha256;
        const proofSignatureOk = proofStandardCheck.errors.length === 0 && await verifySignature(proofHash, proof.cryptographicSignature);
        allProofsOk = allProofsOk && proofHashOk && proofSignatureOk && proofStandardCheck.errors.length === 0;
        proofLines.push(`\nProva PDF ${idx + 1}:`);
        proofLines.push(`  Perfil: ${proof.validationProfile || proof.proofStandard?.validationProfile || '-'}`);
        proofLines.push(`  Data/hora: ${formatDateTime(proof.generatedAt)}`);
        proofLines.push(`  IP: ${proof.publicIp || 'não obtido'}`);
        proofLines.push(`  Geolocalização: ${proof.geolocation?.available ? `${proof.geolocation.latitude}, ${proof.geolocation.longitude} ± ${Math.round(proof.geolocation.accuracyMeters || 0)} m` : (proof.geolocation?.error || 'não obtida')}`);
        proofLines.push(`  Hash informado: ${proof.pdfProofHashSha256}`);
        proofLines.push(`  Hash recalculado: ${proofHash}`);
        proofLines.push(`  Hash confere: ${proofHashOk ? 'SIM' : 'NÃO'}`);
        proofLines.push(`  Assinatura da prova confere: ${proofSignatureOk ? 'SIM' : 'NÃO'}`);
        if (proofStandardCheck.errors.length) proofLines.push(`  Padrão incompatível: ${proofStandardCheck.errors.join(' | ')}`);
        if (proofStandardCheck.warnings.length) proofLines.push(`  Avisos: ${proofStandardCheck.warnings.join(' | ')}`);
      }
      const allOk = standardOk && hashMatches && signatureOk && allProofsOk;
      result.className = 'validation-box ' + (allOk ? 'ok' : 'bad');
      result.textContent = `${allOk ? 'Dossiê íntegro e assinatura criptográfica válida.' : 'Falha de validação.'}\n\n` +
        `Registro: ${record.recordId || '-'}\n` +
        `Perfil de validação: ${record.payload.proofStandard?.validationProfile || '-'}\n` +
        `JSON canônico: ${record.payload.proofStandard?.canonicalizationAlgorithm || CANONICALIZATION_ALGORITHM}\n` +
        `Hash: ${record.payload.proofStandard?.hashAlgorithm || HASH_ALGORITHM}\n` +
        `Assinatura: ${record.payload.proofStandard?.signatureAlgorithm || SIGNATURE_ALGORITHM}\n` +
        (standardCheck.errors.length ? `Padrão incompatível: ${standardCheck.errors.join(' | ')}\n` : '') +
        (standardCheck.warnings.length ? `Avisos: ${standardCheck.warnings.join(' | ')}\n` : '') +
        `Hash informado: ${record.integrity.payloadHashSha256}\n` +
        `Hash recalculado: ${recalculated}\n` +
        `Hash confere: ${hashMatches ? 'SIM' : 'NÃO'}\n` +
        `Assinatura confere: ${signatureOk ? 'SIM' : 'NÃO'}\n` +
        `Finalizado em: ${formatDateTime(record.integrity.finalizedAt)}` +
        (proofs.length ? `\n${proofLines.join('\n')}` : '\n\nSem prova de geração de PDF registrada no JSON.');
    } catch (err) {
      result.className = 'validation-box bad';
      result.textContent = 'Não foi possível validar: ' + err.message;
    } finally {
      event.target.value = '';
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
    downloadJson({ algorithm: key.algorithm, createdAt: key.createdAt, publicKeyHash: key.publicKeyHash, publicKey: key.publicKey }, 'chave_publica_pet_digital.json');
  }

  /**
   * Atualiza a visualização da chave criptográfica local.
   * Ativação: abrir aba Chave, criar/apagar chave e inicialização.
   * O que faz: mostra se há chave local e, quando houver, exibe algoritmo, data de criação,
   * hash da chave pública e o JSON público.
   */
  async function updateKeyStatus() {
    const box = $('#keyStatus');
    const raw = localStorage.getItem(STORAGE_KEYPAIR);
    if (!raw) {
      box.innerHTML = '<p class="hint">Nenhuma chave local criada. A chave será gerada automaticamente na primeira finalização.</p>';
      return;
    }
    const key = JSON.parse(raw);
    box.innerHTML = `<p><strong>Chave ativa:</strong> ${escapeHtml(key.algorithm)}<br><strong>Criada em:</strong> ${formatDateTime(key.createdAt)}<br><strong>Hash da chave pública:</strong> <span class="hash-text">${escapeHtml(key.publicKeyHash)}</span></p><pre>${escapeHtml(JSON.stringify({ publicKeyHash: key.publicKeyHash, publicKey: key.publicKey }, null, 2))}</pre>`;
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

  /** Retorna o nome sugerido para o dossiê JSON da PET. */
  function jsonFilename(record) { return `${recordFileStem(record)}_dossie.json`; }

  /** Cria um File JSON em memória para compartilhamento nativo. */
  function createJsonFile(record) {
    return new File([JSON.stringify(record, null, 2)], jsonFilename(record), { type: 'application/json' });
  }

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
   * Ativação: botões de compartilhamento de PDF/JSON.
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
    loadDraft();
    updateKeyStatus();
    registerServiceWorker();
  }

  document.addEventListener('DOMContentLoaded', init);
})();
