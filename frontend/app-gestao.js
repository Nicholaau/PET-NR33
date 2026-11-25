'use strict';
/**
 * PET-Digital v1.3.0 — aparelhos, unidades e PETs registradas.
 * O quê: aba Aparelhos (gestor/admin), aviso de pedidos pendentes, áreas PETs/Usuários/Unidades da Gestão,
 * lista de PETs da unidade (verificador) e unidade automática no formulário.
 * Como: usa apiFetch() do app-system.js e os utilitários do app-core.js e app-output.js.
 * Quando: carregado depois do app-system.js; as funções são chamadas pelos eventos ligados em bindGestaoEvents().
 */

// Unidades conhecidas (gestor/admin: todas, com contadores; demais perfis: só as ativas).
let unitsCache = [];
// Operacionais e verificadores ainda sem unidade oficial (aviso para gestor/admin).
let unmappedUsersCount = 0;
// Filtro, busca e página da aba Aparelhos.
const deviceView = { status: 'pending', q: '', page: 1 };
// Filtro, busca e página da lista de PETs registradas.
const petView = { unitId: '', q: '', page: 1 };
// Área visível da aba Gestão: pets | users | units.
let manageSection = 'pets';
// Página atual da aba Aparelhos e alvo da janela de recusa/revogação.
let deviceRows = [];
let deviceActionTarget = null;
let pendingDevicesCount = 0;
let pendingWatchTimer = null;

const DEVICE_REVOKE_REASONS = ['Troca de aparelho', 'Perda ou roubo', 'Desligamento ou mudança de função', 'Outro'];
const DEVICE_REFUSE_REASONS = ['Pedido não reconhecido', 'Aparelho não autorizado para o serviço', 'Pedido repetido', 'Outro'];
const UNIT_TYPE_LABELS = { unidade: 'Unidade', equipe: 'Equipe', nucleo: 'Núcleo' };

function isManagerUser(user = currentUser()) { return ['admin', 'gestor'].includes(user?.role); }
function canVerifyUser(user = currentUser()) { return ['admin', 'gestor', 'verificador'].includes(user?.role); }
function plural(n, one, many) { return `${n} ${n === 1 ? one : many}`; }

/* ===================== Textos auxiliares ===================== */

/** "Android · Chrome", "iPhone · Safari", "Computador Windows · Edge"... a partir do navegador. */
function deviceKind(ua) {
  const s = String(ua || '');
  if (!s) return '';
  let system = '';
  if (/iPhone/i.test(s)) system = 'iPhone';
  else if (/iPad/i.test(s) || (/Macintosh/i.test(s) && /Mobile/i.test(s))) system = 'iPad';
  else if (/Android/i.test(s)) system = /Mobile/i.test(s) ? 'Android' : 'Tablet Android';
  else if (/Windows/i.test(s)) system = 'Computador Windows';
  else if (/Macintosh|Mac OS X/i.test(s)) system = 'Mac';
  else if (/CrOS/i.test(s)) system = 'Chromebook';
  else if (/Linux/i.test(s)) system = 'Computador Linux';
  let browser = '';
  if (/SamsungBrowser/i.test(s)) browser = 'Samsung Internet';
  else if (/Edg\//i.test(s)) browser = 'Edge';
  else if (/OPR\//i.test(s)) browser = 'Opera';
  else if (/Firefox|FxiOS/i.test(s)) browser = 'Firefox';
  else if (/CriOS|Chrome/i.test(s)) browser = 'Chrome';
  else if (/Safari/i.test(s)) browser = 'Safari';
  return [system, browser].filter(Boolean).join(' · ');
}

/** "agora há pouco", "há 5 min", "há 3 h", "ontem", "há 4 dias" ou a data. */
function timeAgo(iso) {
  const t = Date.parse(iso || '');
  if (!Number.isFinite(t)) return '';
  const diff = Math.max(0, Date.now() - t);
  const min = Math.round(diff / 60000);
  if (min < 2) return 'agora há pouco';
  if (min < 60) return `há ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `há ${h} h`;
  const d = Math.floor(h / 24);
  if (d === 1) return 'ontem';
  if (d < 30) return `há ${d} dias`;
  return 'em ' + shortDate(iso);
}
function shortDate(iso) {
  try { return new Date(iso).toLocaleDateString('pt-BR'); } catch { return ''; }
}
function shortDateTime(iso) {
  try { return new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }); } catch { return ''; }
}
function daysSince(iso) {
  const t = Date.parse(iso || '');
  return Number.isFinite(t) ? Math.floor((Date.now() - t) / 86400000) : null;
}

/* ===================== Unidades ===================== */

/** Busca as unidades e atualiza as listas de escolha. */
async function loadUnits() {
  const user = currentUser();
  if (!user) return [];
  const data = await apiFetch(isManagerUser(user) ? '/units?all=1' : '/units');
  unitsCache = data.units || [];
  unmappedUsersCount = Number(data.unmappedUsers || 0);
  fillUnitSelects();
  return unitsCache;
}

function activeUnits() { return unitsCache.filter(u => u.status === 'active'); }
function unitById(id) { return unitsCache.find(u => u.id === id) || null; }
function unitOptionLabel(u) { return u.status === 'active' ? u.name : `${u.name} (desativada)`; }

/** Preenche os campos de unidade do cadastro e os filtros. */
function fillUnitSelects() {
  updateNewUserUnitOptions();
  const filterOptions = (allLabel) => [`<option value="">${allLabel}</option>`]
    .concat(unitsCache.map(u => `<option value="${escapeAttr(u.id)}">${escapeHtml(unitOptionLabel(u))}</option>`))
    .concat('<option value="none">Sem unidade</option>').join('');
  const petFilter = $('#petUnitFilter');
  if (petFilter) { petFilter.innerHTML = filterOptions('Todas as unidades'); petFilter.value = petView.unitId; }
  const userFilter = $('#userUnitFilter');
  if (userFilter) { const v = userFilter.value; userFilter.innerHTML = filterOptions('Todas as unidades'); userFilter.value = v; }
}

/** Opções da unidade no cadastro novo; gestor/admin podem ficar sem unidade (empresa toda). */
function updateNewUserUnitOptions() {
  const select = $('#newUserUnitId');
  if (!select) return;
  const role = $('#newUserRole')?.value || 'operacional';
  const optional = ['gestor', 'admin'].includes(role);
  const current = select.value;
  select.innerHTML = `<option value="">${optional ? 'Sem unidade (empresa toda)' : 'Escolha a unidade'}</option>`
    + activeUnits().map(u => `<option value="${escapeAttr(u.id)}">${escapeHtml(u.name)}</option>`).join('');
  if (activeUnits().some(u => u.id === current)) select.value = current;
}

/** Opções da unidade na edição: inclui a unidade atual mesmo que esteja desativada. */
function fillEditUserUnitSelect(user) {
  const select = $('#editUserUnitId');
  if (!select) return;
  const optional = ['gestor', 'admin'].includes(user.role);
  const options = activeUnits().slice();
  const current = user.unitId ? unitById(user.unitId) : null;
  if (current && current.status !== 'active') options.unshift(current);
  const legacy = !user.unitId && user.legacyUnit ? ` — antes: “${user.legacyUnit}”` : '';
  select.innerHTML = `<option value="">${optional ? 'Sem unidade (empresa toda)' : 'Escolha a unidade' + escapeHtml(legacy)}</option>`
    + options.map(u => `<option value="${escapeAttr(u.id)}">${escapeHtml(unitOptionLabel(u))}</option>`).join('');
  select.value = user.unitId || '';
}

/** Aplica filtro de unidade e busca à lista de usuários (feito no aparelho; a lista é pequena). */
function filterUsersForView(users) {
  const unit = $('#userUnitFilter')?.value || '';
  const q = normalizeText($('#userSearch')?.value || '').toLowerCase();
  return (users || []).filter(u => {
    if (unit === 'none' && u.unitId) return false;
    if (unit && unit !== 'none' && u.unitId !== unit) return false;
    if (q && !`${u.name} ${u.matricula}`.toLowerCase().includes(q)) return false;
    return true;
  });
}

/** Aviso de usuários ainda sem unidade, na área Usuários. */
function renderUnmappedNotice() {
  const box = $('#unmappedUsersNotice');
  if (!box) return;
  const show = isManagerUser() && unmappedUsersCount > 0;
  box.classList.toggle('hidden', !show);
  if (!show) return;
  const isAdmin = currentUser()?.role === 'admin';
  box.textContent = `${plural(unmappedUsersCount, 'operacional ou verificador ainda está', 'operacionais ou verificadores ainda estão')} sem unidade definida. As PETs deles não aparecem para os verificadores. `
    + (isAdmin ? 'Use Unidades → Cadastros antigos, ou defina em Editar.' : 'Defina a unidade em Editar.');
}

/** Lista de unidades com contadores e ações. */
function renderUnits() {
  const box = $('#unitsList');
  if (!box) return;
  const showInactive = $('#showInactiveUnits')?.checked;
  const list = unitsCache.filter(u => showInactive || u.status === 'active');
  box.innerHTML = list.map(u => {
    const inactive = u.status !== 'active';
    return `<div class="list-card">
      <div class="title-row">
        <div class="stack-tight"><span class="unit-type">${escapeHtml(UNIT_TYPE_LABELS[u.type] || 'Unidade')}</span><span class="title">${escapeHtml(u.name)}</span></div>
        ${inactive ? '<span class="status-chip status-neutral">Desativada</span>' : ''}
      </div>
      <span class="meta">${plural(Number(u.user_count || 0), 'usuário', 'usuários')} · ${plural(Number(u.pet_count || 0), 'PET registrada', 'PETs registradas')}</span>
      <div class="actions-row">
        <button type="button" class="btn secondary small" data-unit-edit="${escapeAttr(u.id)}">Editar</button>
        ${inactive
          ? `<button type="button" class="btn secondary small" data-unit-status="${escapeAttr(u.id)}" data-unit-next="active">Reativar</button>`
          : `<button type="button" class="btn danger-outline small" data-unit-status="${escapeAttr(u.id)}" data-unit-next="inactive">Desativar</button>`}
      </div>
    </div>`;
  }).join('') || '<p class="empty-state">Nenhuma unidade cadastrada ainda. Toque em “+ Nova” para criar a primeira.</p>';
}

function toggleNewUnitPanel(open) {
  const panel = $('#newUnitPanel');
  const toggle = $('#newUnitToggle');
  if (!panel || !toggle) return;
  const willOpen = open ?? panel.classList.contains('hidden');
  panel.classList.toggle('hidden', !willOpen);
  toggle.setAttribute('aria-expanded', String(willOpen));
  toggle.textContent = willOpen ? 'Fechar' : '+ Nova';
  if (willOpen) setTimeout(() => $('#newUnitName')?.focus(), 50);
}

async function createUnitFromPanel() {
  const name = normalizeText($('#newUnitName').value);
  const type = $('input[name="newUnitType"]:checked')?.value || 'unidade';
  if (name.length < 2) return notify('Informe o nome da unidade.', 'bad');
  const data = await apiFetch('/units', { method: 'POST', body: { name, type } });
  $('#newUnitName').value = '';
  toggleNewUnitPanel(false);
  await loadUnits();
  renderUnits();
  if (currentUser()?.role === 'admin') refreshLegacyUnits();
  notify(data.message || 'Unidade criada.', 'ok');
}

function openUnitEdit(id) {
  const unit = unitById(id);
  if (!unit) return;
  $('#unitEditId').value = unit.id;
  $('#unitEditName').value = unit.name;
  $('#unitEditType').value = unit.type;
  $('#unitEditDialog').showModal();
}

async function saveUnitEdit() {
  const id = $('#unitEditId').value;
  const name = normalizeText($('#unitEditName').value);
  if (name.length < 2) return notify('Informe o nome da unidade.', 'bad');
  const data = await apiFetch(`/units/${encodeURIComponent(id)}`, { method: 'PATCH', body: { name, type: $('#unitEditType').value } });
  $('#unitEditDialog').close();
  await loadUnits();
  renderUnits();
  notify(data.message || 'Unidade atualizada.', 'ok');
}

async function changeUnitStatus(id, next) {
  const unit = unitById(id);
  if (!unit) return;
  if (next === 'inactive') {
    const ok = await askConfirm(`Desativar “${unit.name}”?\nEla deixa de aparecer nos cadastros novos. As PETs e o histórico continuam.`, { okLabel: 'Desativar', danger: true });
    if (!ok) return;
  }
  const data = await apiFetch(`/units/${encodeURIComponent(id)}`, { method: 'PATCH', body: { status: next } });
  await loadUnits();
  renderUnits();
  notify(data.message, 'ok');
}

/** Textos de unidade dos cadastros antigos (somente administrador). */
async function refreshLegacyUnits() {
  const card = $('#legacyUnitsCard');
  const box = $('#legacyUnitsList');
  if (!card || !box) return;
  if (currentUser()?.role !== 'admin') { card.classList.add('hidden'); return; }
  try {
    const data = await apiFetch('/units/legacy');
    const items = data.items || [];
    card.classList.toggle('hidden', !items.length);
    const options = activeUnits().map(u => `<option value="${escapeAttr(u.id)}">${escapeHtml(u.name)}</option>`).join('');
    box.innerHTML = items.map((item, index) => {
      const label = item.text ? `“${item.text}”` : 'Sem unidade informada';
      const names = item.names.length > 120 ? item.names.slice(0, 117) + '...' : item.names;
      const key = unitKey(item.text);
      const exists = item.text && unitsCache.some(u => unitKey(u.name) === key);
      return `<div class="legacy-row" data-legacy-index="${index}">
        <span class="title">${escapeHtml(label)}</span>
        <span class="meta">${plural(item.userCount, 'usuário', 'usuários')}: ${escapeHtml(names)}${item.petCount ? ` · ${plural(item.petCount, 'PET', 'PETs')}` : ''}</span>
        <div class="row-actions">
          <label class="field"><span class="visually-hidden">Unidade oficial para ${escapeAttr(label)}</span>
            <select data-legacy-select><option value="">Escolha a unidade</option>${options}</select>
          </label>
          <button type="button" class="btn primary small" data-legacy-apply="${index}">Aplicar</button>
        </div>
        ${item.text && !exists ? `<button type="button" class="link" data-legacy-create="${index}">Criar a unidade “${escapeHtml(item.text)}” e aplicar</button>` : ''}
      </div>`;
    }).join('');
    box.dataset.items = JSON.stringify(items);
    // Sugere a unidade de mesmo nome, quando já existir.
    $$('.legacy-row', box).forEach(row => {
      const item = items[Number(row.dataset.legacyIndex)];
      const match = unitsCache.find(u => u.status === 'active' && unitKey(u.name) === unitKey(item.text));
      if (match) $('[data-legacy-select]', row).value = match.id;
    });
  } catch (err) {
    card.classList.remove('hidden');
    box.innerHTML = `<div class="alert alert-bad">${escapeHtml(err.message)}</div>`;
  }
}

function unitKey(name) { return String(name || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim(); }

async function applyLegacyMapping(index, { create = false } = {}) {
  const box = $('#legacyUnitsList');
  const items = JSON.parse(box?.dataset.items || '[]');
  const item = items[index];
  if (!item) return;
  let unitId = $(`.legacy-row[data-legacy-index="${index}"] [data-legacy-select]`)?.value;
  if (create) {
    const created = await apiFetch('/units', { method: 'POST', body: { name: item.text, type: 'unidade' } });
    unitId = created.unit.id;
  }
  if (!unitId) return notify('Escolha a unidade oficial antes de aplicar.', 'bad');
  const data = await apiFetch('/units/legacy-map', { method: 'POST', body: { text: item.text, unitId } });
  await loadUnits();
  renderUnits();
  await refreshLegacyUnits();
  notify(data.message, 'ok');
}

/* ===================== Gestão: áreas ===================== */

/** Mostra a área PETs, Usuários ou Unidades e carrega o que ela precisa. */
async function setManageSection(section) {
  if (!isManagerUser()) section = 'pets';
  manageSection = section;
  $$('[data-manage-section]').forEach(btn => {
    const on = btn.dataset.manageSection === section;
    btn.classList.toggle('active', on);
    btn.setAttribute('aria-selected', String(on));
  });
  $('#managePets')?.classList.toggle('hidden', section !== 'pets');
  $('#manageUsers')?.classList.toggle('hidden', section !== 'users');
  $('#manageUnits')?.classList.toggle('hidden', section !== 'units');
  await refreshManageSection();
}

async function refreshManageSection() {
  try { await loadUnits(); } catch (err) { if (!err.network) notify(err.message, 'bad'); }
  if (manageSection === 'pets') return refreshPetList();
  if (manageSection === 'users') { renderUnmappedNotice(); return refreshUsers(); }
  if (manageSection === 'units') { renderUnits(); return refreshLegacyUnits(); }
}

/* ===================== PETs registradas ===================== */

const ROLE_TEAM_LABELS = { supervisor: 'Supervisor', entrante: 'Entrantes', vigia: 'Vigias' };

function teamLine(team) {
  if (!team?.length) return '';
  const groups = { supervisor: [], entrante: [], vigia: [] };
  team.forEach(p => groups[p.role]?.push(p.name));
  return Object.entries(groups).filter(([, names]) => names.length)
    .map(([role, names]) => `${ROLE_TEAM_LABELS[role]}: ${names.join(', ')}`).join(' · ');
}

function petCardHtml(p, showUnit) {
  const hasMeta = p.pet_date || p.pet_local;
  const status = p.status === 'accepted' ? '<span class="status-chip status-ok">Registrada</span>'
    : p.status === 'cancelled' ? '<span class="status-chip status-neutral">Cancelada</span>'
    : '<span class="status-chip status-bad">Inválida</span>';
  const team = teamLine(p.team);
  return `<div class="list-card">
    <div class="title-row"><span class="title">${escapeHtml(p.numero_pet)}</span>${status}</div>
    ${hasMeta
      ? `<span class="sub">${escapeHtml([formatDate(p.pet_date || ''), p.pet_local].filter(Boolean).join(' · '))}</span>`
      : '<span class="meta">Registrada antes da versão 1.3.0: data e local não ficaram no servidor.</span>'}
    ${p.pet_trabalho ? `<span class="meta">${escapeHtml(p.pet_trabalho)}</span>` : ''}
    <div class="kv">
      <span>Emitida por <b>${escapeHtml(p.created_by_name || '—')}</b>${p.created_by_matricula ? ` (${escapeHtml(p.created_by_matricula)})` : ''} em ${escapeHtml(shortDateTime(p.server_received_at))}</span>
      ${showUnit ? `<span>Unidade: <b>${escapeHtml(p.unit_name || 'sem unidade')}</b></span>` : ''}
    </div>
    ${team ? `<span class="team-line">${escapeHtml(team)}</span>` : ''}
  </div>`;
}

async function refreshPetList() {
  const user = currentUser();
  const box = $('#petList');
  if (!box || !canVerifyUser(user)) return;
  const manager = isManagerUser(user);
  $('#petUnitFilterField')?.classList.toggle('hidden', !manager);
  $('#petListTitle').textContent = manager ? 'PETs registradas' : 'PETs da unidade';
  const params = new URLSearchParams({ page: String(petView.page), pageSize: '15' });
  if (petView.q) params.set('q', petView.q);
  if (manager && petView.unitId) params.set('unitId', petView.unitId);
  try {
    const data = await apiFetch('/pet-records?' + params);
    if (!data.items.length && data.page > 1 && data.total) { petView.page = data.pages; return refreshPetList(); }
    const scope = $('#petListScope');
    if (scope) {
      const text = manager ? ''
        : data.scope?.missingUnit ? 'Seu cadastro ainda não tem unidade definida. Peça ao gestor para definir; até lá a lista fica vazia.'
        : `${data.scope?.unitName || ''}. Você vê somente as PETs desta unidade.`;
      scope.textContent = text;
      scope.classList.toggle('hidden', !text);
    }
    $('#petListCount').textContent = data.total ? plural(data.total, 'PET', 'PETs') : '';
    box.innerHTML = data.items.map(p => petCardHtml(p, manager)).join('')
      || `<p class="empty-state">${petView.q ? 'Nenhuma PET encontrada para essa busca.' : 'Nenhuma PET registrada ainda.'}</p>`;
    renderPager('pet', data.page, data.pages);
  } catch (err) {
    box.innerHTML = `<div class="alert alert-bad">${escapeHtml(err.network ? 'Sem conexão. A lista de PETs registradas precisa de internet.' : err.message)}</div>`;
    renderPager('pet', 1, 1);
  }
}

/** Barra "Anterior · Página x de y · Próxima". */
function renderPager(prefix, page, pages) {
  const pager = $(`#${prefix}Pager`);
  if (!pager) return;
  pager.classList.toggle('hidden', pages <= 1);
  $(`#${prefix}PageLabel`).textContent = `Página ${page} de ${pages}`;
  $(`#${prefix}Prev`).disabled = page <= 1;
  $(`#${prefix}Next`).disabled = page >= pages;
}

/* ===================== Aparelhos (gestor/admin) ===================== */

const DEVICE_FILTER_HINTS = {
  pending: 'Pedidos mais antigos primeiro. Confira nome e matrícula antes de aprovar.',
  active: 'Aparelhos que podem emitir PETs agora.',
  revoked: 'Aparelhos revogados e pedidos recusados. O histórico fica guardado.',
  inactive: 'Aparelhos autorizados que não emitem PET há mais de 60 dias. Avalie se ainda são necessários.'
};

async function refreshDeviceAdmin({ silent = false } = {}) {
  if (!isManagerUser()) return;
  const box = $('#devicesList');
  const params = new URLSearchParams({ view: 'manage', status: deviceView.status, page: String(deviceView.page), pageSize: '15' });
  if (deviceView.q) params.set('q', deviceView.q);
  try {
    const data = await apiFetch('/devices?' + params);
    if (!data.devices.length && data.page > 1 && data.total) { deviceView.page = data.pages; return refreshDeviceAdmin({ silent }); }
    deviceRows = data.devices || [];
    renderDeviceCounts(data.counts || {});
    setPendingDevicesCount(Number(data.counts?.pending || 0));
    $('#deviceFilterHint').textContent = DEVICE_FILTER_HINTS[deviceView.status] || '';
    const empty = deviceView.q ? 'Nenhum aparelho encontrado para essa busca.'
      : { pending: 'Nenhum pedido aguardando aprovação.', active: 'Nenhum aparelho ativo.', revoked: 'Nenhum aparelho revogado.', inactive: 'Nenhum aparelho parado há mais de 60 dias.' }[deviceView.status];
    if (box) box.innerHTML = deviceRows.map(deviceCardHtml).join('') || `<p class="empty-state">${escapeHtml(empty)}</p>`;
    renderPager('devices', data.page, data.pages);
  } catch (err) {
    if (silent) return;
    if (box) box.innerHTML = `<div class="alert alert-bad">${escapeHtml(err.network ? 'Sem conexão. A lista de aparelhos precisa de internet.' : err.message)}</div>`;
  }
}

function renderDeviceCounts(counts) {
  $$('[data-device-count]').forEach(el => { el.textContent = String(counts[el.dataset.deviceCount] ?? 0); });
  $$('[data-device-filter]').forEach(btn => {
    const on = btn.dataset.deviceFilter === deviceView.status;
    btn.classList.toggle('active', on);
    btn.setAttribute('aria-pressed', String(on));
    btn.classList.toggle('has-pending', btn.dataset.deviceFilter === 'pending' && Number(counts.pending || 0) > 0);
  });
}

function deviceStatusChip(d) {
  if (d.status === 'pending') return '<span class="status-chip status-warn">Pendente</span>';
  if (d.status === 'active') return '<span class="status-chip status-ok">Ativo</span>';
  if (d.refused) return '<span class="status-chip status-neutral">Recusado</span>';
  return '<span class="status-chip status-bad">Revogado</span>';
}

function deviceCardHtml(d) {
  const kind = deviceKind(d.request_user_agent);
  const who = [`Matrícula ${d.user_matricula || '—'}`, roleLabel(d.user_role), d.user_unit_name || 'sem unidade'].join(' · ');
  const id = escapeAttr(d.id);
  const lines = [`<span>Aparelho: <b>${escapeHtml(d.device_label || '—')}</b>${kind ? ` · ${escapeHtml(kind)}` : ''}</span>`];
  let note = '';
  let actions = '';
  if (d.status === 'pending') {
    lines.push(`<span title="${escapeAttr(shortDateTime(d.created_at))}">Pedido ${escapeHtml(timeAgo(d.created_at))} (${escapeHtml(shortDateTime(d.created_at))})</span>`);
    if (d.other_active_count > 0) {
      const last = d.other_active_last_used ? `, último uso ${timeAgo(d.other_active_last_used)}` : ', ainda sem PET emitida';
      note = `<div class="device-note warn">Já tem ${d.other_active_count === 1 ? 'um aparelho ativo' : `${d.other_active_count} aparelhos ativos`}: “${escapeHtml(d.other_active_label || '')}”${escapeHtml(last)}. Se for troca de celular, aprove e revogue o anterior.</div>`;
      actions = `<button type="button" class="btn primary small" data-device-approve="${id}" data-revoke-others="1">Aprovar e revogar o anterior</button>
        <button type="button" class="btn secondary small" data-device-approve="${id}">Manter os dois</button>
        <button type="button" class="btn danger-outline small" data-device-refuse="${id}">Recusar</button>`;
    } else {
      actions = `<button type="button" class="btn primary small" data-device-approve="${id}">Aprovar</button>
        <button type="button" class="btn danger-outline small" data-device-refuse="${id}">Recusar</button>`;
    }
  } else if (d.status === 'active') {
    lines.push(`<span>Aprovado em ${escapeHtml(shortDate(d.approved_at))}${d.approved_by_name ? ` por ${escapeHtml(d.approved_by_name)}` : ''}</span>`);
    lines.push(`<span>Último uso: <b>${d.last_used_at ? escapeHtml(timeAgo(d.last_used_at)) : 'nenhuma PET emitida ainda'}</b></span>`);
    const idle = daysSince(d.last_used_at || d.approved_at);
    if (idle != null && idle > 60) note = `<div class="device-note neutral">Sem emitir PET há ${idle} dias.</div>`;
    else if (d.other_active_count > 0) note = `<div class="device-note neutral">Esta pessoa tem outro aparelho ativo: “${escapeHtml(d.other_active_label || '')}”.</div>`;
    actions = `<button type="button" class="btn danger-outline small" data-device-revoke="${id}">Revogar</button>`;
  } else {
    const verb = d.refused ? 'Recusado' : 'Revogado';
    lines.push(`<span>${verb} em ${escapeHtml(shortDate(d.revoked_at))}${d.revoked_by_name ? ` por ${escapeHtml(d.revoked_by_name)}` : ''}</span>`);
    if (d.revoke_reason) lines.push(`<span>Motivo: <b>${escapeHtml(d.revoke_reason)}</b></span>`);
    actions = `<button type="button" class="btn secondary small" data-device-approve="${id}">${d.refused ? 'Aprovar' : 'Reativar'}</button>`;
  }
  return `<div class="list-card">
    <div class="title-row"><span class="title">${escapeHtml(d.user_name || '—')}</span>${deviceStatusChip(d)}</div>
    <span class="meta">${escapeHtml(who)}</span>
    <div class="kv">${lines.join('')}</div>
    ${note}
    <div class="actions-row">${actions}</div>
  </div>`;
}

/** Aprova (ou reativa). Com revokeOthers, revoga os outros aparelhos ativos da pessoa. */
async function approveDeviceRequest(id, revokeOthers, button) {
  const d = deviceRows.find(r => r.id === id);
  if (d && ['revoked', 'lost'].includes(d.status)) {
    const ok = await askConfirm(`${d.refused ? 'Aprovar' : 'Reativar'} o aparelho “${d.device_label}” de ${d.user_name}?\nEle volta a poder emitir PETs.`, { okLabel: d.refused ? 'Aprovar' : 'Reativar' });
    if (!ok) return;
  }
  if (button) button.disabled = true;
  try {
    const data = await apiFetch(`/devices/${encodeURIComponent(id)}/approve`, { method: 'POST', body: { revokeOthers: Boolean(revokeOthers) } });
    notify(data.message || 'Aparelho autorizado.', 'ok', 5000);
    await refreshDeviceAdmin();
    if (d?.user_id === currentUser()?.id) refreshDevices(true);
  } finally {
    if (button) button.disabled = false;
  }
}

/** Abre a janela de recusa (pedido pendente) ou revogação (aparelho ativo) com a lista de motivos. */
function openDeviceAction(id, mode) {
  const d = deviceRows.find(r => r.id === id);
  if (!d) return;
  deviceActionTarget = { id, mode };
  const refusing = mode === 'refuse';
  $('#deviceActionTitle').textContent = refusing ? 'Recusar pedido' : 'Revogar aparelho';
  $('#deviceActionWho').textContent = `${d.user_name} · “${d.device_label}”. ${refusing ? 'A pessoa poderá enviar um novo pedido, se for o caso.' : 'O aparelho deixa de emitir PETs na hora.'}`;
  const reasons = refusing ? DEVICE_REFUSE_REASONS : DEVICE_REVOKE_REASONS;
  const fieldset = $('#deviceActionReasons');
  fieldset.innerHTML = '<legend class="field-legend">Motivo</legend>' + reasons.map((r, i) =>
    `<label class="reason-option"><input type="radio" name="deviceActionReason" value="${escapeAttr(r)}"${i === 0 ? ' checked' : ''} />${escapeHtml(r)}</label>`).join('');
  $('#deviceActionOther').value = '';
  $('#deviceActionOtherField').classList.add('hidden');
  $('#deviceActionConfirm').textContent = refusing ? 'Recusar' : 'Revogar';
  $('#deviceActionDialog').showModal();
}

async function confirmDeviceAction() {
  if (!deviceActionTarget) return;
  let reason = $('input[name="deviceActionReason"]:checked')?.value || '';
  if (reason === 'Outro') {
    reason = normalizeText($('#deviceActionOther').value);
    if (!reason) return notify('Descreva o motivo.', 'bad');
  }
  const button = $('#deviceActionConfirm');
  button.disabled = true;
  try {
    const target = deviceActionTarget;
    const data = await apiFetch(`/devices/${encodeURIComponent(target.id)}/revoke`, { method: 'POST', body: { reason } });
    $('#deviceActionDialog').close();
    deviceActionTarget = null;
    notify(data.message, 'ok');
    await refreshDeviceAdmin();
  } finally {
    button.disabled = false;
  }
}

/* ===================== Aviso de pedidos pendentes ===================== */

function setPendingDevicesCount(n) {
  pendingDevicesCount = Number(n || 0);
  const badge = $('#devicesBadge');
  if (badge) { badge.textContent = String(pendingDevicesCount); badge.classList.toggle('hidden', !pendingDevicesCount); }
  updatePendingBanner();
}

/** Faixa "N aparelhos aguardando aprovação — Ver agora", fora da própria aba Aparelhos. */
function updatePendingBanner() {
  const banner = $('#pendingDevicesBanner');
  if (!banner) return;
  const onDevicesTab = $('#devicesTab')?.classList.contains('active');
  const show = Boolean(currentUser()) && isManagerUser() && pendingDevicesCount > 0 && !onDevicesTab;
  banner.classList.toggle('hidden', !show);
  if (show) $('#pendingDevicesText').textContent = pendingDevicesCount === 1 ? '1 aparelho aguardando aprovação' : `${pendingDevicesCount} aparelhos aguardando aprovação`;
}

async function refreshPendingDevicesCount() {
  if (!isManagerUser() || !authToken()) { setPendingDevicesCount(0); return; }
  try {
    const data = await apiFetch('/devices?view=manage&status=pending&pageSize=1');
    setPendingDevicesCount(Number(data.counts?.pending || 0));
  } catch { /* sem internet: mantém o último número */ }
}

/** Reconfere os pedidos ao voltar para o app e a cada 3 minutos com o app aberto. */
function startPendingWatch() {
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') refreshPendingDevicesCount(); });
  clearInterval(pendingWatchTimer);
  pendingWatchTimer = setInterval(() => { if (document.visibilityState === 'visible') refreshPendingDevicesCount(); }, 180000);
}

/* ===================== Formulário: unidade automática ===================== */

/** O campo "Nome da unidade" vem do cadastro e fica travado; quem não tem unidade digita. */
function applyUserUnitToForm() {
  const input = $('#petUnidadeInput');
  if (!input) return;
  const name = currentUser()?.unitName || '';
  input.readOnly = Boolean(name);
  $('#petUnidadeHint')?.classList.toggle('hidden', !name);
  if (name && input.value !== name) {
    input.value = name;
    input.classList.remove('is-invalid');
  }
}

/** Limpa as listas de gestão ao sair. */
function resetGestaoState() {
  unitsCache = [];
  unmappedUsersCount = 0;
  deviceRows = [];
  Object.assign(deviceView, { status: 'pending', q: '', page: 1 });
  Object.assign(petView, { unitId: '', q: '', page: 1 });
  manageSection = 'pets';
  ['#devicesList', '#petList', '#unitsList', '#legacyUnitsList'].forEach(sel => { const el = $(sel); if (el) el.innerHTML = ''; });
  if ($('#deviceSearch')) $('#deviceSearch').value = '';
  if ($('#petSearch')) $('#petSearch').value = '';
  setPendingDevicesCount(0);
}

/* ===================== Eventos ===================== */

function bindGestaoEvents() {
  const onError = prefix => err => notify(prefix + err.message, 'bad');

  // Aparelhos
  $('#pendingDevicesGo')?.addEventListener('click', () => { deviceView.status = 'pending'; deviceView.page = 1; showTab('devicesTab'); });
  $('#devicesRefreshBtn')?.addEventListener('click', () => refreshDeviceAdmin());
  $$('[data-device-filter]').forEach(btn => btn.addEventListener('click', () => {
    deviceView.status = btn.dataset.deviceFilter;
    deviceView.page = 1;
    refreshDeviceAdmin();
  }));
  const onDeviceSearch = debounce(() => { deviceView.q = normalizeText($('#deviceSearch').value); deviceView.page = 1; refreshDeviceAdmin(); }, 350);
  $('#deviceSearch')?.addEventListener('input', onDeviceSearch);
  $('#devicesPrev')?.addEventListener('click', () => { deviceView.page = Math.max(1, deviceView.page - 1); refreshDeviceAdmin(); });
  $('#devicesNext')?.addEventListener('click', () => { deviceView.page += 1; refreshDeviceAdmin(); });
  $('#devicesList')?.addEventListener('click', event => {
    const approve = event.target.closest('[data-device-approve]');
    const refuse = event.target.closest('[data-device-refuse]');
    const revoke = event.target.closest('[data-device-revoke]');
    if (approve) approveDeviceRequest(approve.dataset.deviceApprove, approve.dataset.revokeOthers === '1', approve).catch(onError(''));
    if (refuse) openDeviceAction(refuse.dataset.deviceRefuse, 'refuse');
    if (revoke) openDeviceAction(revoke.dataset.deviceRevoke, 'revoke');
  });
  $('#deviceActionReasons')?.addEventListener('change', () => {
    const other = $('input[name="deviceActionReason"]:checked')?.value === 'Outro';
    $('#deviceActionOtherField').classList.toggle('hidden', !other);
    if (other) setTimeout(() => $('#deviceActionOther')?.focus(), 30);
  });
  $('#deviceActionConfirm')?.addEventListener('click', () => confirmDeviceAction().catch(onError('')));

  // Gestão: áreas
  $$('[data-manage-section]').forEach(btn => btn.addEventListener('click', () => setManageSection(btn.dataset.manageSection)));

  // PETs registradas
  $('#petUnitFilter')?.addEventListener('change', () => { petView.unitId = $('#petUnitFilter').value; petView.page = 1; refreshPetList(); });
  const onPetSearch = debounce(() => { petView.q = normalizeText($('#petSearch').value); petView.page = 1; refreshPetList(); }, 350);
  $('#petSearch')?.addEventListener('input', onPetSearch);
  $('#petPrev')?.addEventListener('click', () => { petView.page = Math.max(1, petView.page - 1); refreshPetList(); });
  $('#petNext')?.addEventListener('click', () => { petView.page += 1; refreshPetList(); });

  // Usuários
  $('#newUserRole')?.addEventListener('change', updateNewUserUnitOptions);
  const rerenderUsers = () => { try { renderUsers(JSON.parse($('#usersList')?.dataset.users || '[]')); } catch {} };
  $('#userUnitFilter')?.addEventListener('change', rerenderUsers);
  $('#userSearch')?.addEventListener('input', debounce(rerenderUsers, 200));

  // Unidades
  $('#newUnitToggle')?.addEventListener('click', () => toggleNewUnitPanel());
  $('#createUnitBtn')?.addEventListener('click', () => createUnitFromPanel().catch(onError('Não foi possível criar: ')));
  $('#showInactiveUnits')?.addEventListener('change', renderUnits);
  $('#unitsList')?.addEventListener('click', event => {
    const edit = event.target.closest('[data-unit-edit]');
    const status = event.target.closest('[data-unit-status]');
    if (edit) openUnitEdit(edit.dataset.unitEdit);
    if (status) changeUnitStatus(status.dataset.unitStatus, status.dataset.unitNext).catch(onError(''));
  });
  $('#unitEditSave')?.addEventListener('click', () => saveUnitEdit().catch(onError('Não foi possível salvar: ')));
  $('#legacyUnitsList')?.addEventListener('click', event => {
    const apply = event.target.closest('[data-legacy-apply]');
    const create = event.target.closest('[data-legacy-create]');
    if (apply) applyLegacyMapping(Number(apply.dataset.legacyApply)).catch(onError(''));
    if (create) applyLegacyMapping(Number(create.dataset.legacyCreate), { create: true }).catch(onError(''));
  });

  startPendingWatch();
}
