'use strict';
/**
 * PET-Digital v1.2.0 — autenticação, aparelho e gestão.
 * O quê: login, sessão, situação do aparelho, usuários, aprovação de aparelhos e chamadas da API.
 * Como: usa os utilitários do app-core.js e o Worker configurado em API_BASE_URL.
 * Quando: tela de login e abas Conta e Gestão.
 *
 * Mudanças da v1.2.0:
 * - a sessão fica guardada no aparelho (localStorage) até expirar no servidor (8 h);
 * - falta de internet não desconecta mais o usuário; só 401/403 encerram a sessão;
 * - a situação do aparelho aparece num selo no topo da tela;
 * - avisos usam `notify()`/`askConfirm()` em vez de alert/confirm do navegador.
 */

// Situação do aparelho atual: unknown | none | unregistered | pending | active | revoked | offline.
let deviceState = 'unknown';
let isOffline = typeof navigator !== 'undefined' && navigator.onLine === false;

/* ===================== Sessão ===================== */

/**
 * Carrega a sessão salva no aparelho.
 * O quê: lê token, usuário e validade.
 * Como: v1.2.0 usa localStorage (sobrevive ao fechamento do app); migra a sessão antiga do
 * sessionStorage e descarta sessões vencidas pela data informada pelo servidor.
 * Quando: abertura do app e antes de qualquer chamada autenticada.
 */
function loadAuthState() {
  let state = null;
  try { state = JSON.parse(localStorage.getItem(STORAGE_AUTH) || 'null'); } catch { state = null; }
  if (!state) {
    try {
      const legacy = JSON.parse(sessionStorage.getItem(STORAGE_AUTH) || 'null');
      if (legacy?.token) { state = legacy; safeLocalStorageSet(STORAGE_AUTH, JSON.stringify(legacy), 'a sessão'); }
      sessionStorage.removeItem(STORAGE_AUTH);
    } catch {}
  }
  if (state?.expiresAt && Date.parse(state.expiresAt) <= Date.now()) {
    localStorage.removeItem(STORAGE_AUTH);
    state = null;
  }
  authState = state;
  return authState;
}

/** Salva ou apaga a sessão no aparelho e redesenha a tela. */
function saveAuthState(state) {
  authState = state || null;
  if (authState) safeLocalStorageSet(STORAGE_AUTH, JSON.stringify(authState), 'a sessão');
  else localStorage.removeItem(STORAGE_AUTH);
  try { sessionStorage.removeItem(STORAGE_AUTH); } catch {}
  renderAuthState();
}

/** Retorna o token Bearer atual, se houver. */
function authToken() { return authState?.token || loadAuthState()?.token || ''; }

/**
 * Chamada padronizada para a API Worker.
 * v1.2.0: o erro devolvido carrega `status` (HTTP) ou `network = true` quando não houve
 * resposta. Isso permite tratar "sem internet" sem derrubar a sessão.
 */
async function apiFetch(path, options = {}) {
  const headers = new Headers(options.headers || {});
  headers.set('Content-Type', 'application/json');
  const token = authToken();
  if (token) headers.set('Authorization', `Bearer ${token}`);
  let response;
  try {
    response = await fetch(API_BASE_URL + path, {
      method: options.method || 'GET',
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined,
      cache: 'no-store'
    });
  } catch (cause) {
    const error = new Error('Sem conexão com o servidor. Verifique a internet e tente novamente.');
    error.network = true;
    error.cause = cause;
    setOffline(true);
    throw error;
  }
  setOffline(false);
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
  if (!response.ok || data?.ok === false) {
    const error = new Error(data?.error || `Erro HTTP ${response.status}`);
    error.status = response.status;
    error.data = data;
    if (response.status === 401 && path !== '/auth/login' && path !== '/auth/change-password') handleSessionRejected();
    throw error;
  }
  return data;
}

/** O servidor recusou a sessão (expirada ou revogada): volta ao login sem apagar rascunhos. */
function handleSessionRejected() {
  if (!authState) return;
  workspaceUserId = null;
  saveAuthState(null);
  notify('Sua sessão terminou. Entre novamente; o rascunho continua salvo neste aparelho.', 'bad');
}

/** Liga/desliga o aviso de "sem conexão". */
function setOffline(value) {
  isOffline = Boolean(value);
  $('#offlineBanner')?.classList.toggle('hidden', !isOffline || !authState?.user);
  if (isOffline && deviceState === 'unknown') updateDeviceChip();
}

/* ===================== Tela conforme a sessão ===================== */

/**
 * Mostra login ou aplicativo, e ajusta abas e textos conforme o perfil.
 * Quando: abertura, login, logout e confirmação da sessão.
 */
function renderAuthState() {
  const state = authState || loadAuthState();
  const user = state?.user;
  const isLogged = !!user;
  $('#loginScreen')?.classList.toggle('hidden', isLogged);
  ['#appShell', '#appTopbar', '#appTabs'].forEach(sel => $(sel)?.classList.toggle('hidden', !isLogged));
  $('#offlineBanner')?.classList.toggle('hidden', !isLogged || !isOffline);
  const apiLabel = $('#apiBaseLabel');
  if (apiLabel) apiLabel.textContent = API_BASE_URL;

  const canVerify = ['admin', 'gestor', 'verificador'].includes(user?.role);
  const isManager = ['admin', 'gestor'].includes(user?.role);
  $('#manageTabBtn')?.classList.toggle('hidden', !canVerify);
  $('#userManagementSection')?.classList.toggle('hidden', !isManager);
  $('#teamDevicesSection')?.classList.toggle('hidden', !isManager);
  configureRoleSelects();

  if (isLogged) {
    $('#accountName').textContent = user.name || '';
    $('#accountInfo').textContent = `Matrícula ${user.matricula || ''} · ${roleLabel(user.role)}`;
    $('#appVersionLabel').textContent = `PET Digital versão ${APP_VERSION} — informe este número ao relatar um problema.`;
    const until = state.expiresAt ? new Date(state.expiresAt).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '';
    $('#accountSession').textContent = until ? `Sessão ativa neste aparelho até ${until}` : 'Sessão ativa neste aparelho';
  }
  const passwordNotice = $('#passwordChangeNotice');
  if (passwordNotice) {
    passwordNotice.classList.toggle('hidden', !user?.mustChangePassword);
    passwordNotice.textContent = user?.mustChangePassword ? 'Sua senha atual é temporária. Altere-a abaixo antes de emitir uma PET.' : '';
    if (user?.mustChangePassword) openPasswordPanel(true);
  }
  updateDeviceChip();
  if (typeof updateStepBar === 'function') updateStepBar();
}

/** Abre ou fecha o bloco de troca de senha na aba Conta. */
function openPasswordPanel(open) {
  const panel = $('#pwdPanel');
  const toggle = $('#pwdToggleBtn');
  if (!panel || !toggle) return;
  const willOpen = open ?? panel.classList.contains('hidden');
  panel.classList.toggle('hidden', !willOpen);
  toggle.setAttribute('aria-expanded', String(willOpen));
  toggle.textContent = willOpen ? 'Fechar troca de senha' : 'Alterar minha senha';
}

/**
 * Atualiza o selo do topo com a situação do aparelho.
 * O quê: "Aparelho autorizado", "Aguardando aprovação", "Aparelho não autorizado" etc.
 * Quando: sempre que `deviceState` muda e após login/logout.
 */
function updateDeviceChip() {
  const chip = $('#deviceChip');
  const text = $('#deviceChipText');
  if (!chip || !text) return;
  const user = (authState || loadAuthState())?.user;
  const map = {
    active: ['chip-ok', 'Aparelho autorizado'],
    pending: ['chip-warn', 'Aguardando aprovação'],
    revoked: ['chip-bad', 'Autorização revogada'],
    none: ['chip-warn', 'Aparelho não autorizado'],
    unregistered: ['chip-warn', 'Aparelho não autorizado'],
    unknown: ['chip-neutral', isOffline ? 'Sem conexão' : 'Verificando aparelho'],
    offline: ['chip-neutral', 'Sem conexão']
  };
  let [cls, label] = map[deviceState] || map.unknown;
  if (user?.mustChangePassword) { cls = 'chip-warn'; label = 'Troque a senha'; }
  chip.className = `chip ${cls}`;
  text.textContent = label;
  const blocked = $('#deviceBlockedNotice');
  if (blocked) {
    const msg = user?.mustChangePassword
      ? 'Sua senha é temporária. Altere-a na aba Conta antes de emitir a PET.'
      : deviceState === 'pending' ? 'Aparelho aguardando aprovação. Você pode revisar a PET, mas a emissão só será liberada depois que um gestor aprovar este aparelho.'
      : ['none', 'unregistered'].includes(deviceState) ? 'Este aparelho ainda não foi autorizado. Solicite a autorização na aba Conta antes de emitir.'
      : deviceState === 'revoked' ? 'A autorização deste aparelho foi revogada. Procure o gestor do seu setor.'
      : '';
    blocked.textContent = msg;
    blocked.classList.toggle('hidden', !msg);
  }
}

/* ===================== Acesso à emissão ===================== */

/**
 * Confere se a conta e o aparelho podem emitir documento oficial.
 * O quê: exige login, senha definitiva, conexão e aparelho com status ativo.
 * Como: consulta /devices, prepara a chave local se preciso e compara o hash da chave.
 * Quando: antes de finalizar e antes de abrir/compartilhar arquivos oficiais.
 */
async function ensureOfficialAccessOrGuide(actionLabel = 'continuar') {
  const state = authState || loadAuthState();
  if (!state?.user || !authToken()) {
    notify(`Faça login para ${actionLabel}.`, 'bad');
    renderAuthState();
    return false;
  }
  if (state.user.mustChangePassword) {
    notify('Por segurança, altere a senha temporária na aba Conta antes de emitir a PET.', 'bad');
    showTab('accountTab');
    openPasswordPanel(true);
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
    if (err.network) notify(`Sem conexão. Para ${actionLabel} é preciso internet. O preenchimento continua salvo.`, 'bad');
    else notify('Não foi possível conferir este aparelho: ' + err.message, 'bad');
    return false;
  }
  const own = devices.filter(d => d.public_key_hash === key.publicKeyHash && (!d.user_id || d.user_id === state.user.id));
  if (own.some(d => d.status === 'active')) { deviceState = 'active'; updateDeviceChip(); return true; }
  if (own.some(d => d.status === 'pending')) {
    deviceState = 'pending'; updateDeviceChip();
    notify('Este aparelho ainda aguarda aprovação de um gestor.', 'bad');
    return false;
  }
  deviceState = own.some(d => ['revoked', 'lost'].includes(d.status)) ? 'revoked' : 'unregistered';
  updateDeviceChip();
  notify('Antes de emitir, solicite a autorização deste aparelho na aba Conta.', 'bad');
  showTab('accountTab');
  return false;
}

/**
 * Garante que o documento já foi gerado e registrado como um conjunto único.
 * Quando: antes de abrir, baixar ou compartilhar PDF/arquivo de validação.
 */
async function ensureRecordReadyForOutput(record) {
  if (!record) return false;
  if (!record.serverRegistration || !record.output?.pdfHashSha256 || !record.output?.jsonHashSha256) {
    notify('Esta PET ainda não foi registrada no sistema. Use “Repetir envio ao sistema” antes de enviar os arquivos.', 'bad');
    return false;
  }
  const files = await readOfficialFiles(record);
  if (!files?.pdfFile || !files?.jsonText) {
    notify('Os arquivos desta PET não estão mais neste aparelho. Use a via já enviada ao supervisor; não é seguro recriar o PDF.', 'bad');
    return false;
  }
  return true;
}

/* ===================== Login e conta ===================== */

/** Cria o primeiro admin usando o token de instalação configurado no Worker. */
async function setupFirstAdmin() {
  const body = {
    token: normalizeText($('#setupToken').value),
    name: normalizeText($('#setupName').value),
    matricula: normalizeText($('#setupMatricula').value),
    email: normalizeText($('#setupEmail').value),
    password: $('#setupPassword').value
  };
  if (!body.token || !body.name || !body.matricula || !body.password) return notify('Informe token, nome, matrícula e senha inicial.', 'bad');
  const data = await apiFetch('/setup/admin', { method: 'POST', body });
  notify('Primeiro administrador criado. Agora entre com a matrícula e a senha cadastradas.', 'ok');
  $('#loginMatricula').value = body.matricula;
  $('#setupToken').value = $('#setupPassword').value = '';
  return data;
}

/** Faz login no Worker e guarda a sessão no aparelho até a validade informada pelo servidor. */
async function login() {
  const button = $('#loginBtn');
  if (button?.disabled) return;
  const matricula = normalizeText($('#loginMatricula').value);
  const password = $('#loginPassword').value;
  if (!matricula || !password) return notify('Informe matrícula e senha.', 'bad');
  const original = button?.textContent || 'Entrar';
  if (button) { button.disabled = true; button.setAttribute('aria-busy', 'true'); button.textContent = 'Entrando...'; }
  try {
    const data = await apiFetch('/auth/login', { method: 'POST', body: { matricula, password } });
    saveAuthState({ token: data.token, user: data.user, expiresAt: data.expiresAt || null, loggedAt: new Date().toISOString() });
    $('#loginPassword').value = '';
    purgeLegacySharedStorage();
    await loadUserWorkspace({ force: true });
    refreshDevices(true);
    if (data.user.mustChangePassword) {
      showTab('accountTab');
      openPasswordPanel(true);
      notify('Antes de emitir uma PET, altere a senha temporária.', 'info', 6000);
    } else {
      showTab('formTab');
    }
  } finally {
    if (button) { button.disabled = false; button.removeAttribute('aria-busy'); button.textContent = original; }
  }
}

/** Encerra a sessão, limpa a tela e impede que a próxima conta veja a área anterior. */
async function logout() {
  try { if (authToken()) await apiFetch('/auth/logout', { method: 'POST', body: {} }); } catch {}
  clearWorkspaceMemory();
  workspaceUserId = null;
  deviceState = 'unknown';
  saveAuthState(null);
  if ($('#devicesList')) $('#devicesList').innerHTML = '';
  if ($('#usersList')) $('#usersList').innerHTML = '';
  setTimeout(() => $('#loginMatricula')?.focus(), 100);
}

/**
 * Reconfirma a sessão no servidor sem mexer no formulário.
 * O quê: atualiza dados do usuário; só recarrega o rascunho se a conta mudou.
 * Como: 401/403 encerram a sessão; falta de internet mantém o usuário dentro (modo offline).
 * Quando: abertura do app e ao voltar a ficar online.
 */
async function refreshMe() {
  if (!authToken()) { renderAuthState(); return; }
  try {
    const data = await apiFetch('/auth/me');
    const previousId = authState?.user?.id;
    saveAuthState({ ...authState, user: data.user, expiresAt: data.session?.expires_at || authState?.expiresAt || null });
    purgeLegacySharedStorage();
    if (previousId !== data.user.id) await loadUserWorkspace({ force: true });
    await refreshDevices(true);
  } catch (err) {
    if (err.status === 401 || err.status === 403) { workspaceUserId = null; saveAuthState(null); return; }
    // Sem conexão ou erro temporário: o usuário continua dentro e pode preencher o rascunho.
    renderAuthState();
  }
}

/** Define quais perfis aparecem nos formulários conforme a conta logada. */
function configureRoleSelects(selected = {}) {
  const actorRole = (authState || loadAuthState())?.user?.role;
  const roles = actorRole === 'admin'
    ? [['operacional', 'Operacional'], ['verificador', 'Verificador'], ['gestor', 'Gestor'], ['admin', 'Administrador']]
    : [['operacional', 'Operacional'], ['verificador', 'Verificador']];
  [['#newUserRole', selected.newRole], ['#editUserRole', selected.editRole]].forEach(([selector, value]) => {
    const select = $(selector);
    if (!select) return;
    const desired = value || select.value || 'operacional';
    select.innerHTML = roles.map(([v, label]) => `<option value="${v}">${label}</option>`).join('');
    if (roles.some(([v]) => v === desired)) select.value = desired;
  });
}

/** Altera a senha da própria conta. */
async function changeOwnPassword() {
  const currentPassword = $('#currentPassword').value;
  const newPassword = $('#newOwnPassword').value;
  const confirmation = $('#confirmOwnPassword').value;
  if (!currentPassword || newPassword.length < 8) return notify('Informe a senha atual e uma nova senha com pelo menos 8 caracteres.', 'bad');
  if (newPassword !== confirmation) return notify('A confirmação da nova senha não coincide.', 'bad');
  const data = await apiFetch('/auth/change-password', { method: 'POST', body: { currentPassword, newPassword } });
  saveAuthState({ ...authState, user: data.user });
  $('#currentPassword').value = $('#newOwnPassword').value = $('#confirmOwnPassword').value = '';
  openPasswordPanel(false);
  notify('Senha alterada.', 'ok');
}

/* ===================== Usuários ===================== */

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
  if (!body.name || !body.matricula || !body.password) return notify('Informe nome, matrícula e senha temporária.', 'bad');
  await apiFetch('/users', { method: 'POST', body });
  notify('Usuário cadastrado. No primeiro acesso ele deverá trocar a senha temporária.', 'ok');
  ['#newUserName', '#newUserMatricula', '#newUserEmail', '#newUserUnit', '#newUserPassword'].forEach(sel => { const el = $(sel); if (el) el.value = ''; });
  configureRoleSelects({ newRole: 'operacional' });
  toggleNewUserPanel(false);
  await refreshUsers();
}

function toggleNewUserPanel(open) {
  const panel = $('#newUserPanel');
  const toggle = $('#newUserToggle');
  if (!panel || !toggle) return;
  const willOpen = open ?? panel.classList.contains('hidden');
  panel.classList.toggle('hidden', !willOpen);
  toggle.setAttribute('aria-expanded', String(willOpen));
  toggle.textContent = willOpen ? 'Fechar' : '+ Cadastrar';
}

/** Retorna se a conta logada pode administrar o usuário-alvo. */
function canManageUser(target) {
  const actor = (authState || loadAuthState())?.user;
  if (!actor) return false;
  if (actor.role === 'admin') return true;
  return actor.role === 'gestor' && ['operacional', 'verificador'].includes(target.role);
}

/** Traduz perfis e situações para termos amigáveis. */
function roleLabel(role) { return ({ admin: 'Administrador', gestor: 'Gestor', verificador: 'Verificador', operacional: 'Operacional' }[role] || role || ''); }
function statusLabel(status) { return ({ active: 'Ativo', pending: 'Pendente', suspended: 'Suspenso', disabled: 'Acesso excluído', revoked: 'Revogado', lost: 'Extraviado' }[status] || status || ''); }

/** Renderiza usuários e ações permitidas pela hierarquia. */
function renderUsers(users) {
  const box = $('#usersList');
  if (!box) return;
  const selfId = (authState || loadAuthState())?.user?.id;
  box.innerHTML = (users || []).map(u => {
    const manageable = canManageUser(u);
    const isSelf = u.id === selfId;
    const actions = manageable
      ? `<div class="actions-row">
          <button type="button" class="btn secondary small" data-user-edit="${escapeAttr(u.id)}">Editar</button>
          ${isSelf ? '' : `<button type="button" class="btn secondary small" data-user-reset="${escapeAttr(u.id)}">Redefinir senha</button>
          <button type="button" class="btn danger-outline small" data-user-delete="${escapeAttr(u.id)}">Excluir acesso</button>`}
        </div>`
      : '<span class="muted small-text">Somente administrador altera este perfil.</span>';
    return `<div class="list-card">
      <span class="title">${escapeHtml(u.name)}</span>
      <span class="meta">Matrícula ${escapeHtml(u.matricula)} · ${escapeHtml(roleLabel(u.role))} · ${escapeHtml(statusLabel(u.status))}${u.unit ? ' · ' + escapeHtml(u.unit) : ''}</span>
      ${u.mustChangePassword ? '<span class="status-chip status-warn">Senha temporária: troca pendente</span>' : ''}
      ${isSelf ? '<span class="muted small-text">Sua conta. Altere a senha na aba Conta.</span>' : ''}
      ${actions}
    </div>`;
  }).join('') || '<p class="hint">Nenhum usuário encontrado.</p>';
}

/** Lista usuários cadastrados. */
async function refreshUsers() {
  const box = $('#usersList');
  if (!box || !['admin', 'gestor'].includes((authState || loadAuthState())?.user?.role)) return;
  try {
    const data = await apiFetch('/users');
    box.dataset.users = JSON.stringify(data.users || []);
    renderUsers(data.users || []);
  } catch (err) {
    box.innerHTML = `<div class="alert alert-bad">${escapeHtml(err.message)}</div>`;
  }
}

function cachedUser(userId) {
  try { return JSON.parse($('#usersList')?.dataset.users || '[]').find(u => u.id === userId) || null; }
  catch { return null; }
}

function openEditUser(userId) {
  const user = cachedUser(userId);
  if (!user || !canManageUser(user)) return notify('Você não tem permissão para editar este usuário.', 'bad');
  $('#editUserId').value = user.id;
  $('#editUserName').value = user.name || '';
  $('#editUserMatricula').value = user.matricula || '';
  $('#editUserEmail').value = user.email || '';
  $('#editUserUnit').value = user.unit || '';
  configureRoleSelects({ editRole: user.role });
  $('#editUserStatus').value = user.status || 'active';
  $('#editUserDialog').showModal();
}

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
  if (!body.name || !body.matricula) return notify('Nome e matrícula são obrigatórios.', 'bad');
  const data = await apiFetch(`/users/${encodeURIComponent(id)}`, { method: 'PATCH', body });
  $('#editUserDialog').close();
  if (id === (authState || loadAuthState())?.user?.id) saveAuthState({ ...authState, user: data.user });
  await refreshUsers();
  notify('Cadastro atualizado.', 'ok');
}

function openResetPassword(userId) {
  const user = cachedUser(userId);
  if (!user || !canManageUser(user)) return notify('Você não tem permissão para redefinir a senha deste usuário.', 'bad');
  $('#resetPasswordUserId').value = user.id;
  $('#resetPasswordUserLabel').textContent = `${user.name} — matrícula ${user.matricula}`;
  $('#temporaryPassword').value = $('#temporaryPasswordConfirm').value = '';
  $('#resetPasswordDialog').showModal();
}

async function confirmResetPassword() {
  const id = $('#resetPasswordUserId').value;
  const password = $('#temporaryPassword').value;
  const confirmation = $('#temporaryPasswordConfirm').value;
  if (password.length < 8) return notify('A senha temporária deve ter pelo menos 8 caracteres.', 'bad');
  if (password !== confirmation) return notify('As senhas temporárias não coincidem.', 'bad');
  await apiFetch(`/users/${encodeURIComponent(id)}/reset-password`, { method: 'POST', body: { temporaryPassword: password } });
  $('#resetPasswordDialog').close();
  await refreshUsers();
  notify('Senha redefinida. Informe a senha temporária ao usuário por canal seguro.', 'ok');
}

/** Exclui logicamente o acesso, preservando histórico. */
async function deleteUser(userId) {
  const user = cachedUser(userId);
  if (!user || !canManageUser(user)) return notify('Você não tem permissão para excluir este acesso.', 'bad');
  const ok = await askConfirm(`Excluir o acesso de ${user.name}?\nAs PETs e a auditoria são preservadas; sessões e aparelhos do usuário são encerrados.`, { okLabel: 'Excluir acesso', danger: true });
  if (!ok) return;
  await apiFetch(`/users/${encodeURIComponent(userId)}`, { method: 'DELETE' });
  await refreshUsers();
  await refreshDevices(true);
  notify('Acesso excluído e histórico preservado.', 'ok');
}

/* ===================== Aparelho ===================== */

/** Apaga a proteção local sem deixar uma autorização ativa órfã no sistema. */
async function resetLocalDeviceProtection() {
  const key = await readLocalKeyPair();
  if (!key) return notify('Este aparelho não possui proteção local para apagar.');
  if (authToken()) {
    const data = await apiFetch('/devices');
    const state = authState || loadAuthState();
    const linked = (data.devices || []).find(d => d.public_key_hash === key.publicKeyHash && d.user_id === state?.user?.id);
    if (linked && ['active', 'pending'].includes(linked.status)) {
      notify(linked.status === 'active'
        ? 'Antes de apagar a proteção local, um gestor precisa revogar a autorização deste aparelho.'
        : 'Antes de apagar a proteção local, um gestor precisa rejeitar a solicitação pendente.', 'bad');
      return;
    }
  }
  const ok = await askConfirm('Apagar definitivamente a proteção local deste aparelho? Depois será necessário solicitar nova autorização.', { okLabel: 'Apagar', danger: true });
  if (!ok) return;
  await deleteLocalKeyPair();
  await updateKeyStatus();
  await refreshDevices(true);
}

/** Prepara a chave local e solicita autorização em um único toque. */
async function registerDevice(button) {
  if (!authToken()) return notify('Faça login antes de configurar este aparelho.', 'bad');
  if (button) button.disabled = true;
  try {
    const key = await ensureKeyPair();
    const body = {
      deviceLabel: normalizeText($('#deviceLabel').value) || `Aparelho ${new Date().toLocaleDateString('pt-BR')}`,
      publicKeyJwk: key.publicKey,
      publicKeyHash: key.publicKeyHash,
      algorithm: SIGNATURE_ALGORITHM
    };
    const data = await apiFetch('/devices/register', { method: 'POST', body });
    notify(data.message || (data.device?.status === 'active' ? 'Aparelho autorizado.' : 'Solicitação enviada. Agora basta um gestor aprovar.'), 'ok', 5000);
    await refreshDevices(true);
    await updateKeyStatus();
  } finally {
    if (button) button.disabled = false;
  }
}

/** Renderiza a lista de aparelhos da equipe (gestor/admin), pendentes primeiro. */
function renderDevicesList(devices) {
  const box = $('#devicesList');
  const actor = (authState || loadAuthState())?.user;
  const isManager = ['admin', 'gestor'].includes(actor?.role);
  const pendingCount = isManager ? (devices || []).filter(d => d.status === 'pending').length : 0;
  const badge = $('#manageBadge');
  if (badge) { badge.textContent = String(pendingCount); badge.classList.toggle('hidden', !pendingCount); }
  const count = $('#devicesCount');
  if (count) { count.textContent = pendingCount ? `${pendingCount} aguardando` : ''; count.classList.toggle('hidden', !pendingCount); }
  if (!box) return;
  if (!isManager) { box.innerHTML = ''; return; }
  const order = { pending: 0, active: 1, revoked: 2, lost: 3 };
  const sorted = [...(devices || [])].sort((a, b) => (order[a.status] ?? 9) - (order[b.status] ?? 9));
  box.innerHTML = sorted.map(d => {
    const chip = d.status === 'active' ? 'status-ok' : d.status === 'pending' ? 'status-warn' : 'status-bad';
    const primary = d.status === 'pending'
      ? `<button type="button" class="btn primary small" data-device-approve="${escapeAttr(d.id)}">Aprovar</button>`
      : ['revoked', 'lost'].includes(d.status)
        ? `<button type="button" class="btn secondary small" data-device-approve="${escapeAttr(d.id)}">Reativar</button>` : '';
    const revoke = d.status === 'active'
      ? `<button type="button" class="btn danger-outline small" data-device-revoke="${escapeAttr(d.id)}" data-device-action="Revogar">Revogar</button>`
      : d.status === 'pending'
        ? `<button type="button" class="btn danger-outline small" data-device-revoke="${escapeAttr(d.id)}" data-device-action="Rejeitar">Rejeitar</button>` : '';
    return `<div class="list-card">
      <div class="row-between"><span class="title">${escapeHtml(d.device_label)}</span><span class="status-chip ${chip}">${escapeHtml(statusLabel(d.status))}</span></div>
      <span class="meta">${escapeHtml(d.user_name || d.user_id || '')}${d.user_matricula ? ' · matrícula ' + escapeHtml(d.user_matricula) : ''}</span>
      <div class="actions-row">${revoke}${primary}</div>
    </div>`;
  }).join('') || '<p class="hint">Nenhum aparelho cadastrado.</p>';
}

/**
 * Consulta a situação do aparelho atual e, para gestores/admins, a fila da equipe.
 * Atualiza o selo do topo, o quadro "Este aparelho" e o botão de solicitação.
 */
async function refreshDevices(silent = false) {
  const state = authState || loadAuthState();
  if (!state?.user) return;
  try {
    const data = await apiFetch('/devices');
    renderDevicesList(data.devices || []);
    await migrateLegacyKeyForCurrentUser(data.devices || []);
    const key = await readLocalKeyPair();
    const mine = key ? (data.devices || []).filter(d => d.public_key_hash === key.publicKeyHash && d.user_id === state.user.id) : [];
    const box = $('#deviceRegistrationStatus');
    const button = $('#registerDeviceBtn');
    const labelField = $('#deviceLabelField');
    const setBox = (kind, text) => { if (box) { box.className = `alert alert-${kind}`; box.textContent = text; } };
    let showRegister = true;
    if (!key) {
      deviceState = 'none';
      setBox('warn', 'Este aparelho ainda não foi autorizado. Toque no botão abaixo; o aplicativo prepara a proteção e envia a solicitação.');
      if (button) { button.disabled = false; button.textContent = 'Solicitar autorização deste aparelho'; }
    } else if (mine.some(d => d.status === 'active')) {
      deviceState = 'active';
      setBox('ok', 'Este aparelho pode finalizar e assinar PETs. Se trocar ou perder o celular, avise o gestor para revogar a autorização.');
      showRegister = false;
    } else if (mine.some(d => d.status === 'pending')) {
      deviceState = 'pending';
      setBox('warn', 'Solicitação enviada. Assim que um gestor aprovar, a emissão fica liberada. Você não precisa repetir nenhuma ação.');
      showRegister = false;
    } else if (mine.some(d => ['revoked', 'lost'].includes(d.status))) {
      deviceState = 'revoked';
      setBox('bad', 'A autorização deste aparelho foi revogada. Peça a reativação a um gestor; não faça novo cadastro.');
      showRegister = false;
    } else {
      deviceState = 'unregistered';
      setBox('warn', 'A proteção local existe, mas a solicitação ainda não foi enviada. Toque no botão abaixo uma única vez.');
      if (button) { button.disabled = false; button.textContent = 'Enviar solicitação de autorização'; }
    }
    button?.classList.toggle('hidden', !showRegister);
    labelField?.classList.toggle('hidden', !showRegister);
    updateDeviceChip();
    await updateKeyStatus();
  } catch (err) {
    if (err.network) { if (deviceState === 'unknown') updateDeviceChip(); return; }
    if (!silent) notify(err.message, 'bad');
  }
}

/** Aprova, reativa, rejeita ou revoga e atualiza a lista imediatamente. */
async function changeDeviceStatus(id, action, button) {
  if (button) button.disabled = true;
  try {
    const data = await apiFetch(`/devices/${encodeURIComponent(id)}/${action}`, { method: 'POST', body: {} });
    await refreshDevices();
    notify(data.message || 'Situação do aparelho atualizada.', 'ok');
  } finally {
    if (button) button.disabled = false;
  }
}

/** Mostra a situação do registro no servidor dentro da etapa de revisão. */
function renderServerPanel(message, type = 'warn') {
  const panel = $('#serverPanel');
  if (!panel) return;
  panel.className = `alert alert-${type}`;
  panel.textContent = message;
  panel.classList.remove('hidden');
}

/** Consulta um código técnico já registrado no sistema. */
async function validateHashOnServer(hash) {
  const payloadHash = normalizeText(hash || $('#serverHashInput').value).toLowerCase();
  const result = $('#serverValidateResult');
  if (!/^[a-f0-9]{64}$/.test(payloadHash)) return notify('Informe um código técnico válido com 64 caracteres.', 'bad');
  try {
    const data = await apiFetch('/validate', { method: 'POST', body: { payloadHash } });
    result.className = 'alert ' + (data.found ? 'alert-ok' : 'alert-warn');
    result.textContent = data.found
      ? `Registro encontrado. Nº PET: ${data.record.numero_pet}. Recebido em ${formatDateTime(data.record.server_received_at)}. Situação: ${data.record.status}.`
      : 'Registro não encontrado no sistema.';
  } catch (err) {
    result.className = 'alert alert-bad';
    result.textContent = err.message;
  }
}
