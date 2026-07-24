'use strict';
/**
 * PET-Digital v1.1.5 — autenticação e administração.
 * O quê: login, sessão, usuários, dispositivos, permissões e chamadas da API.
 * Como: usa os utilitários do app-core.js e o Worker configurado em API_BASE_URL.
 * Quando: telas de acesso e Sistema.
 */

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

