/**
 * PET-Digital NR-33 v1.1.3 — Worker/API Cloudflare comentado.
 *
 * O que é este arquivo?
 * - É a API backend do PET-Digital. Ele roda no Cloudflare Worker.
 * - O frontend do Cloudflare Pages chama esta API para login, cadastro de usuários,
 *   registro de chaves públicas, registro dos hashes da PET e validação futura.
 * - O Worker conversa com o D1 pelo binding `env.DB`.
 *
 * Como o fluxo funciona?
 * 1. O usuário faz login pelo frontend.
 * 2. O Worker valida a senha e cria uma sessão temporária.
 * 3. O dispositivo registra a chave pública; a chave privada nunca sai do aparelho.
 * 4. Uma conta gestor/admin aprova essa chave pública.
 * 5. Ao finalizar a PET, o frontend assina o hash com a chave privada local.
 * 6. O Worker confere a assinatura usando a chave pública aprovada.
 * 7. Se estiver correto, grava no D1 apenas metadados, hashes e auditoria.
 *
 * Quando cada parte é ativada?
 * - `fetch()` é ativado em toda requisição HTTP recebida pelo Worker.
 * - `route()` decide qual função chamar com base no método e caminho da URL.
 * - Funções de autenticação são chamadas pelas telas de Sistema/Login.
 * - Funções de dispositivo são chamadas no cadastro/aprovação de chaves.
 * - Funções de PET são chamadas ao registrar ou validar hashes.
 *
 * Segurança básica adotada:
 * - Senhas não são salvas em texto puro: usa PBKDF2 + salt + pepper.
 * - Tokens de sessão não são salvos puros no D1: salva-se somente o hash.
 * - Chave privada fica local no navegador/dispositivo e não vai para o banco.
 * - D1 não armazena PDF, JSON, fotos ou assinatura desenhada; armazena hashes.
 */

// Quantidade de iterações do PBKDF2 para dificultar ataque de força bruta em senhas.
const PASSWORD_ITERATIONS = 100000;
// Tamanho do token de sessão aleatório em bytes. 32 bytes = token forte para uso temporário.
const SESSION_BYTES = 32;
// Tempo padrão de sessão em segundos, usado se a variável SESSION_TTL_SECONDS não existir.
const SESSION_TTL_DEFAULT = 28800;
// Tempo padrão para desafios criptográficos, reservado para evoluções de assinatura/desafio.
const CHALLENGE_TTL_DEFAULT = 300;
// Expressão que valida SHA-256 em hexadecimal: 64 caracteres de 0-9/a-f.
const HASH_RE = /^[a-f0-9]{64}$/i;

export default {
  /**
     * O quê: ponto de entrada do Worker para qualquer requisição HTTP.
     * Como: monta cabeçalhos CORS, responde preflight OPTIONS e encaminha para `route()`.
     * Quando: sempre que o navegador/app chama a API, por exemplo `/auth/login` ou `/pet-records`.
     */
  async fetch(request, env) {
    const url = new URL(request.url);
    const corsHeaders = buildCorsHeaders(request, env);

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders });

    try {
      const response = await route(request, env, url);
      return withCors(response, corsHeaders);
    } catch (error) {
      const status = error.status || 500;
      const body = { ok: false, error: error.publicMessage || error.message || 'Erro interno.' };
      return json(body, status, corsHeaders);
    }
  }
};

/**
 * O quê: roteador central da API.
 * Como: normaliza o caminho da URL, confere método HTTP e chama a função responsável.
 * Quando: chamado por `fetch()` depois do tratamento inicial de CORS e erros.
 */
async function route(request, env, url) {
  const path = normalizePath(url.pathname);

  if (request.method === 'GET' && path === '/') {
    return json({ ok: true, app: env.APP_NAME || 'PET-DIGITAL-NR33', message: 'API PET-Digital NR-33 ativa.', routes: ['/health', '/db-test'] });
  }

  if (request.method === 'GET' && path === '/health') {
    return json({
      ok: true,
      app: env.APP_NAME || null,
      environment: env.APP_ENV || null,
      validationProfile: env.VALIDATION_PROFILE || null,
      dbBindingConfigured: !!env.DB,
      sessionSecretConfigured: !!env.SESSION_SECRET,
      passwordPepperConfigured: !!env.PASSWORD_PEPPER,
      bootstrapTokenConfigured: !!env.BOOTSTRAP_ADMIN_TOKEN
    });
  }

  if (request.method === 'GET' && path === '/db-test') {
    const result = await env.DB.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all();
    return json({ ok: true, tables: result.results.map(r => r.name) });
  }

  if (request.method === 'POST' && path === '/setup/admin') return setupAdmin(request, env);
  if (request.method === 'POST' && path === '/auth/login') return login(request, env);
  if (request.method === 'POST' && path === '/auth/logout') return logout(request, env);
  if (request.method === 'GET' && path === '/auth/me') return me(request, env);
  if (request.method === 'POST' && path === '/auth/change-password') return changeOwnPassword(request, env);

  if (request.method === 'GET' && path === '/users') return listUsers(request, env);
  if (request.method === 'POST' && path === '/users') return createUser(request, env);
  if (request.method === 'PATCH' && /^\/users\/[^/]+$/.test(path)) return updateUser(request, env, path.split('/')[2]);
  if (request.method === 'PATCH' && path.startsWith('/users/') && path.endsWith('/status')) return updateUserStatus(request, env, path.split('/')[2]);
  if (request.method === 'POST' && path.startsWith('/users/') && path.endsWith('/reset-password')) return resetUserPassword(request, env, path.split('/')[2]);
  if (request.method === 'DELETE' && /^\/users\/[^/]+$/.test(path)) return deleteUserAccess(request, env, path.split('/')[2]);

  if (request.method === 'POST' && path === '/devices/register') return registerDevice(request, env);
  if (request.method === 'GET' && path === '/devices') return listDevices(request, env);
  if (request.method === 'POST' && path.startsWith('/devices/') && path.endsWith('/approve')) return approveDevice(request, env, path.split('/')[2]);
  if (request.method === 'POST' && path.startsWith('/devices/') && path.endsWith('/revoke')) return revokeDevice(request, env, path.split('/')[2]);

  if (request.method === 'POST' && path === '/pet-records') return createPetRecord(request, env);
  if (request.method === 'GET' && path.startsWith('/pet-records/')) return getPetRecord(request, env, decodeURIComponent(path.split('/')[2] || ''));
  if (request.method === 'POST' && path === '/validate') return validateHash(request, env);
  if (request.method === 'GET' && path === '/audit') return listAudit(request, env, url);

  return json({ ok: false, error: 'Rota não encontrada.', path }, 404);
}

/**
 * O quê: cria o primeiro usuário administrador do sistema.
 * Como: exige o BOOTSTRAP_ADMIN_TOKEN, valida dados, gera hash da senha e grava no D1.
 * Quando: usado apenas na primeira configuração, antes de existir qualquer admin cadastrado.
 */
async function setupAdmin(request, env) {
  const body = await readJson(request);
  if (!constantTimeEqual(String(body.token || ''), String(env.BOOTSTRAP_ADMIN_TOKEN || ''))) throw httpError(403, 'Token de bootstrap inválido.');
  assertText(body.name, 'Nome obrigatório.');
  assertText(body.matricula, 'Matrícula obrigatória.');
  assertPassword(body.password);

  const exists = await env.DB.prepare("SELECT COUNT(*) AS count FROM app_users WHERE role = 'admin'").first();
  if ((exists?.count || 0) > 0) throw httpError(409, 'O primeiro admin já foi criado.');

  const password = await hashPassword(body.password, env);
  const id = crypto.randomUUID();
  await env.DB.prepare(`INSERT INTO app_users (id, name, matricula, email, role, unit, status, password_hash, password_salt, password_alg, must_change_password, created_at)
    VALUES (?, ?, ?, ?, 'admin', ?, 'active', ?, ?, ?, 0, ?)`)
    .bind(id, clean(body.name), clean(body.matricula), clean(body.email || null), clean(body.unit || null), password.hash, password.salt, password.alg, nowIso()).run();
  await audit(env, null, 'setup_admin', 'app_users', id, 'success', request, { matricula: clean(body.matricula) });
  return json({ ok: true, user: publicUser({ id, name: clean(body.name), matricula: clean(body.matricula), email: clean(body.email || null), role: 'admin', status: 'active' }) }, 201);
}

/**
 * O quê: autentica usuário por matrícula e senha.
 * Como: busca usuário ativo no D1, verifica PBKDF2 da senha, cria token aleatório e salva só o hash do token.
 * Quando: chamado pela tela de login do frontend em `POST /auth/login`.
 */
async function login(request, env) {
  const body = await readJson(request);
  const matricula = clean(body.matricula);
  const password = String(body.password || '');
  if (!matricula || !password) throw httpError(400, 'Informe matrícula e senha.');

  const user = await env.DB.prepare('SELECT * FROM app_users WHERE matricula = ?').bind(matricula).first();
  if (!user || user.status !== 'active') {
    await audit(env, user?.id || null, 'auth_login', 'app_users', user?.id || null, 'failure', request, { reason: 'inactive_or_not_found', matricula });
    throw httpError(401, 'Matrícula ou senha inválida.');
  }
  const ok = await verifyPassword(password, user, env);
  if (!ok) {
    await audit(env, user.id, 'auth_login', 'app_users', user.id, 'failure', request, { reason: 'bad_password' });
    throw httpError(401, 'Matrícula ou senha inválida.');
  }

  const token = randomToken(SESSION_BYTES);
  const sessionHash = await sha256Hex(`session:${token}:${env.SESSION_SECRET}`);
  const ttl = Number(env.SESSION_TTL_SECONDS || SESSION_TTL_DEFAULT);
  const expiresAt = new Date(Date.now() + ttl * 1000).toISOString();
  const sessionId = crypto.randomUUID();
  await env.DB.prepare(`INSERT INTO auth_sessions (id, user_id, session_hash, created_at, expires_at, ip_address, user_agent)
    VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .bind(sessionId, user.id, sessionHash, nowIso(), expiresAt, clientIp(request), request.headers.get('user-agent') || '').run();
  await env.DB.prepare('UPDATE app_users SET last_login_at = ? WHERE id = ?').bind(nowIso(), user.id).run();
  await audit(env, user.id, 'auth_login', 'auth_sessions', sessionId, 'success', request, {});

  return json({ ok: true, token, expiresAt, user: publicUser(user) });
}

/**
 * O quê: encerra uma sessão ativa.
 * Como: exige sessão válida e grava `revoked_at` em `auth_sessions`.
 * Quando: chamado quando o usuário clica em sair ou troca de operador.
 */
async function logout(request, env) {
  const auth = await requireAuth(request, env);
  await env.DB.prepare('UPDATE auth_sessions SET revoked_at = ? WHERE id = ?').bind(nowIso(), auth.session.id).run();
  await audit(env, auth.user.id, 'auth_logout', 'auth_sessions', auth.session.id, 'success', request, {});
  return json({ ok: true });
}

/**
 * O quê: retorna os dados públicos do usuário logado.
 * Como: valida o token Bearer e devolve usuário/perfil/expiração da sessão.
 * Quando: usado pelo frontend para confirmar se a sessão ainda está válida.
 */
async function me(request, env) {
  const auth = await requireAuth(request, env);
  return json({ ok: true, user: publicUser(auth.user), session: { expires_at: auth.session.expires_at } });
}


/**
 * O quê: permite que o próprio usuário altere a senha.
 * Como: confirma a senha atual, gera novo PBKDF2, limpa a exigência de troca e revoga as demais sessões.
 * Quando: primeiro acesso com senha temporária, redefinição administrativa ou troca voluntária.
 */
async function changeOwnPassword(request, env) {
  const auth = await requireAuth(request, env);
  const body = await readJson(request);
  const currentPassword = String(body.currentPassword || '');
  const newPassword = String(body.newPassword || '');
  if (!currentPassword) throw httpError(400, 'Informe a senha atual.');
  assertPassword(newPassword);
  if (currentPassword === newPassword) throw httpError(400, 'A nova senha deve ser diferente da senha atual.');

  const stored = await env.DB.prepare('SELECT * FROM app_users WHERE id = ?').bind(auth.user.id).first();
  if (!stored || !(await verifyPassword(currentPassword, stored, env))) throw httpError(401, 'Senha atual incorreta.');

  const password = await hashPassword(newPassword, env);
  await env.DB.prepare(`UPDATE app_users SET password_hash = ?, password_salt = ?, password_alg = ?, must_change_password = 0, updated_at = ? WHERE id = ?`)
    .bind(password.hash, password.salt, password.alg, nowIso(), auth.user.id).run();
  await env.DB.prepare('UPDATE auth_sessions SET revoked_at = ? WHERE user_id = ? AND id <> ? AND revoked_at IS NULL')
    .bind(nowIso(), auth.user.id, auth.session.id).run();
  await audit(env, auth.user.id, 'password_change_own', 'app_users', auth.user.id, 'success', request, {});
  const updated = await env.DB.prepare('SELECT * FROM app_users WHERE id = ?').bind(auth.user.id).first();
  return json({ ok: true, user: publicUser(updated) });
}

/**
 * O quê: lista usuários cadastrados.
 * Como: exige admin ou gestor e devolve dados públicos, incluindo a indicação de troca de senha.
 * Quando: tela de administração de usuários.
 */
async function listUsers(request, env) {
  const auth = await requireRole(request, env, ['admin', 'gestor']);
  const rows = await env.DB.prepare(`SELECT id, name, matricula, email, role, unit, status, must_change_password, created_at, updated_at, last_login_at FROM app_users ORDER BY CASE role WHEN 'admin' THEN 1 WHEN 'gestor' THEN 2 WHEN 'verificador' THEN 3 ELSE 4 END, name`).all();
  await audit(env, auth.user.id, 'users_list', 'app_users', null, 'success', request, {});
  return json({ ok: true, users: rows.results.map(publicUser) });
}

/**
 * O quê: cadastra um novo usuário.
 * Como: admin pode escolher qualquer perfil; gestor somente operacional ou verificador.
 * Quando: inclusão de servidor no PET-Digital.
 */
async function createUser(request, env) {
  const auth = await requireRole(request, env, ['admin', 'gestor']);
  const body = await readJson(request);
  assertText(body.name, 'Nome obrigatório.');
  assertText(body.matricula, 'Matrícula obrigatória.');
  assertPassword(body.password);
  const role = clean(body.role || 'operacional');
  assertRoleAllowedForActor(auth.user, role);

  const password = await hashPassword(body.password, env);
  const id = crypto.randomUUID();
  try {
    await env.DB.prepare(`INSERT INTO app_users (id, name, matricula, email, role, unit, status, password_hash, password_salt, password_alg, must_change_password, created_at)
      VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, 1, ?)`)
      .bind(id, clean(body.name), clean(body.matricula), clean(body.email || null), role, clean(body.unit || null), password.hash, password.salt, password.alg, nowIso()).run();
  } catch (e) {
    throw httpError(409, 'Não foi possível cadastrar. Verifique se matrícula ou e-mail já estão em uso.');
  }
  await audit(env, auth.user.id, 'user_create', 'app_users', id, 'success', request, { role, matricula: clean(body.matricula) });
  const created = await env.DB.prepare('SELECT * FROM app_users WHERE id = ?').bind(id).first();
  return json({ ok: true, user: publicUser(created) }, 201);
}

/**
 * O quê: atualiza nome, matrícula, e-mail, unidade, perfil e situação do usuário.
 * Como: aplica hierarquia: gestor só gerencia operacional/verificador; admin gerencia todos.
 * Quando: correção cadastral, mudança de perfil ou suspensão/reativação.
 */
async function updateUser(request, env, userId) {
  const auth = await requireRole(request, env, ['admin', 'gestor']);
  const target = await getUserOr404(env, userId);
  assertCanManageTarget(auth.user, target);
  const body = await readJson(request);

  const name = clean(body.name ?? target.name);
  const matricula = clean(body.matricula ?? target.matricula);
  const email = body.email !== undefined ? (clean(body.email) || null) : (target.email || null);
  const unit = body.unit !== undefined ? (clean(body.unit) || null) : (target.unit || null);
  const role = clean(body.role ?? target.role);
  const status = clean(body.status ?? target.status);
  assertText(name, 'Nome obrigatório.');
  assertText(matricula, 'Matrícula obrigatória.');
  assertRoleAllowedForActor(auth.user, role);
  if (!['pending', 'active', 'suspended', 'disabled'].includes(status)) throw httpError(400, 'Situação inválida.');

  if (target.role === 'admin' && (role !== 'admin' || status !== 'active')) await ensureAnotherActiveAdmin(env, target.id);
  if (target.id === auth.user.id && status !== 'active') throw httpError(400, 'Não é permitido desativar a própria conta durante a sessão.');

  try {
    await env.DB.prepare(`UPDATE app_users SET name = ?, matricula = ?, email = ?, role = ?, unit = ?, status = ?, updated_at = ? WHERE id = ?`)
      .bind(name, matricula, email, role, unit, status, nowIso(), userId).run();
  } catch (e) {
    throw httpError(409, 'Não foi possível atualizar. Verifique se matrícula ou e-mail já estão em uso.');
  }
  if (status !== 'active') await revokeUserSessions(env, userId);
  await audit(env, auth.user.id, 'user_update', 'app_users', userId, 'success', request, { role, status, matricula });
  const updated = await getUserOr404(env, userId);
  return json({ ok: true, user: publicUser(updated) });
}

/**
 * O quê: mantém compatibilidade com a rota antiga de alteração de situação.
 * Como: delega à mesma hierarquia e proteções da edição completa.
 * Quando: clientes anteriores que ainda chamam `/users/:id/status`.
 */
async function updateUserStatus(request, env, userId) {
  const auth = await requireRole(request, env, ['admin', 'gestor']);
  const target = await getUserOr404(env, userId);
  assertCanManageTarget(auth.user, target);
  const body = await readJson(request);
  const status = clean(body.status);
  if (!['pending', 'active', 'suspended', 'disabled'].includes(status)) throw httpError(400, 'Situação inválida.');
  if (target.role === 'admin' && status !== 'active') await ensureAnotherActiveAdmin(env, target.id);
  if (target.id === auth.user.id && status !== 'active') throw httpError(400, 'Não é permitido desativar a própria conta durante a sessão.');
  await env.DB.prepare('UPDATE app_users SET status = ?, updated_at = ? WHERE id = ?').bind(status, nowIso(), userId).run();
  if (status !== 'active') await revokeUserSessions(env, userId);
  await audit(env, auth.user.id, 'user_status_update', 'app_users', userId, 'success', request, { status });
  return json({ ok: true });
}

/**
 * O quê: redefine a senha de outro usuário para uma senha temporária.
 * Como: respeita a hierarquia, grava novo hash, exige troca no próximo acesso e encerra sessões antigas.
 * Quando: senha esquecida ou recuperação administrativa.
 */
async function resetUserPassword(request, env, userId) {
  const auth = await requireRole(request, env, ['admin', 'gestor']);
  const target = await getUserOr404(env, userId);
  assertCanManageTarget(auth.user, target);
  if (target.id === auth.user.id) throw httpError(400, 'Para alterar a própria senha, use a opção “Alterar minha senha”.');
  const body = await readJson(request);
  const temporaryPassword = String(body.temporaryPassword || '');
  assertPassword(temporaryPassword);
  const password = await hashPassword(temporaryPassword, env);
  await env.DB.prepare(`UPDATE app_users SET password_hash = ?, password_salt = ?, password_alg = ?, must_change_password = 1, updated_at = ? WHERE id = ?`)
    .bind(password.hash, password.salt, password.alg, nowIso(), userId).run();
  await revokeUserSessions(env, userId);
  await audit(env, auth.user.id, 'user_password_reset', 'app_users', userId, 'success', request, {});
  return json({ ok: true, message: 'Senha temporária definida. O usuário deverá alterá-la no próximo acesso.' });
}

/**
 * O quê: exclui o acesso de um usuário sem apagar o histórico probatório.
 * Como: aplica exclusão lógica (`disabled`), encerra sessões e revoga dispositivos ativos.
 * Quando: desligamento, cadastro indevido ou retirada definitiva de acesso.
 */
async function deleteUserAccess(request, env, userId) {
  const auth = await requireRole(request, env, ['admin', 'gestor']);
  const target = await getUserOr404(env, userId);
  assertCanManageTarget(auth.user, target);
  if (target.id === auth.user.id) throw httpError(400, 'Não é permitido excluir o próprio acesso.');
  if (target.role === 'admin') await ensureAnotherActiveAdmin(env, target.id);

  const timestamp = nowIso();
  await env.DB.batch([
    env.DB.prepare(`UPDATE app_users SET status = 'disabled', updated_at = ? WHERE id = ?`).bind(timestamp, userId),
    env.DB.prepare(`UPDATE auth_sessions SET revoked_at = COALESCE(revoked_at, ?) WHERE user_id = ?`).bind(timestamp, userId),
    env.DB.prepare(`UPDATE device_keys SET status = 'revoked', revoked_by = ?, revoked_at = ?, revoke_reason = 'Acesso do usuário excluído' WHERE user_id = ? AND status <> 'revoked'`).bind(auth.user.id, timestamp, userId)
  ]);
  await audit(env, auth.user.id, 'user_delete_access', 'app_users', userId, 'success', request, { previousRole: target.role });
  return json({ ok: true, message: 'Acesso excluído. O histórico foi preservado.' });
}

/**
 * O quê: configura e solicita autorização do dispositivo atual em uma única operação.
 * Como: valida a chave pública; cria registro pending para operacional/verificador e active para gestor/admin.
 * Quando: clique em “Configurar e solicitar autorização”. A criação da chave local é automática no frontend.
 */
async function registerDevice(request, env) {
  const auth = await requireAuth(request, env);
  const body = await readJson(request);
  assertText(body.deviceLabel, 'Nome do dispositivo obrigatório.');
  if (!body.publicKeyJwk || typeof body.publicKeyJwk !== 'object') throw httpError(400, 'Chave pública inválida.');
  const publicKeyHash = clean(body.publicKeyHash).toLowerCase();
  if (!HASH_RE.test(publicKeyHash)) throw httpError(400, 'Código do dispositivo inválido.');
  const recalculated = await sha256HexCanonical(body.publicKeyJwk);
  if (recalculated !== publicKeyHash) throw httpError(400, 'Código do dispositivo não confere.');

  const existing = await env.DB.prepare('SELECT * FROM device_keys WHERE public_key_hash = ?').bind(publicKeyHash).first();
  if (existing) {
    if (existing.user_id !== auth.user.id) throw httpError(409, 'Este dispositivo já está vinculado a outro usuário. Um gestor/admin deve revogar o vínculo anterior.');
    await env.DB.prepare('UPDATE device_keys SET device_label = ? WHERE id = ?').bind(clean(body.deviceLabel), existing.id).run();
    const refreshed = await env.DB.prepare('SELECT * FROM device_keys WHERE id = ?').bind(existing.id).first();
    if (['revoked', 'lost'].includes(refreshed.status)) throw httpError(409, 'Este dispositivo já foi revogado. Solicite a reativação a um gestor/admin; não é necessário cadastrá-lo novamente.');
    return json({ ok: true, device: refreshed, alreadyExists: true, message: refreshed.status === 'active' ? 'Dispositivo já autorizado.' : 'Solicitação já enviada e aguardando aprovação.' });
  }

  const status = ['admin', 'gestor'].includes(auth.user.role) ? 'active' : 'pending';
  const id = crypto.randomUUID();
  await env.DB.prepare(`INSERT INTO device_keys (id, user_id, device_label, public_key_jwk, public_key_hash, algorithm, status, created_at, approved_by, approved_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(id, auth.user.id, clean(body.deviceLabel), JSON.stringify(body.publicKeyJwk), publicKeyHash, clean(body.algorithm || 'ECDSA-P256-SHA256'), status, nowIso(), status === 'active' ? auth.user.id : null, status === 'active' ? nowIso() : null).run();
  await audit(env, auth.user.id, 'device_register', 'device_keys', id, 'success', request, { status, publicKeyHash });
  const device = await env.DB.prepare('SELECT * FROM device_keys WHERE id = ?').bind(id).first();
  return json({ ok: true, device, message: status === 'active' ? 'Dispositivo configurado e autorizado.' : 'Dispositivo configurado. A solicitação foi enviada para aprovação.' }, 201);
}

/**
 * O quê: lista dispositivos.
 * Como: admin/gestor veem a equipe; operacional/verificador veem somente os próprios.
 * Quando: atualização do status do aparelho ou gestão das autorizações pendentes.
 */
async function listDevices(request, env) {
  const auth = await requireAuth(request, env);
  const canSeeAll = ['admin', 'gestor'].includes(auth.user.role);
  const sql = `SELECT dk.id, dk.user_id, u.name AS user_name, u.matricula AS user_matricula, u.status AS user_status, dk.device_label, dk.public_key_hash, dk.algorithm, dk.status, dk.created_at, dk.approved_at, dk.revoked_at, dk.last_used_at
    FROM device_keys dk LEFT JOIN app_users u ON u.id = dk.user_id ${canSeeAll ? '' : 'WHERE dk.user_id = ?'} ORDER BY CASE dk.status WHEN 'pending' THEN 1 WHEN 'active' THEN 2 ELSE 3 END, dk.created_at DESC`;
  const stmt = env.DB.prepare(sql);
  const rows = canSeeAll ? await stmt.all() : await stmt.bind(auth.user.id).all();
  return json({ ok: true, devices: rows.results });
}

/**
 * O quê: aprova ou reativa um dispositivo.
 * Como: admin/gestor clicam uma única vez; o status passa imediatamente para active.
 * Quando: solicitação pendente ou reativação deliberada de aparelho revogado.
 */
async function approveDevice(request, env, deviceId) {
  const auth = await requireRole(request, env, ['admin', 'gestor']);
  const device = await env.DB.prepare(`SELECT dk.*, u.status AS user_status FROM device_keys dk JOIN app_users u ON u.id = dk.user_id WHERE dk.id = ?`).bind(deviceId).first();
  if (!device) throw httpError(404, 'Dispositivo não encontrado.');
  if (device.user_status !== 'active') throw httpError(400, 'O usuário deste dispositivo não está ativo.');
  if (device.status === 'active') return json({ ok: true, alreadyActive: true, message: 'O dispositivo já estava autorizado.' });
  await env.DB.prepare(`UPDATE device_keys SET status = 'active', approved_by = ?, approved_at = ?, revoked_by = NULL, revoked_at = NULL, revoke_reason = NULL WHERE id = ?`).bind(auth.user.id, nowIso(), deviceId).run();
  await audit(env, auth.user.id, 'device_approve', 'device_keys', deviceId, 'success', request, { previousStatus: device.status });
  return json({ ok: true, message: 'Dispositivo autorizado. Não há outra etapa necessária.' });
}

/**
 * O quê: revoga ou rejeita um dispositivo.
 * Como: admin/gestor marcam como revoked e registram motivo, data e responsável.
 * Quando: perda/troca de aparelho, solicitação indevida ou encerramento de acesso.
 */
async function revokeDevice(request, env, deviceId) {
  const auth = await requireRole(request, env, ['admin', 'gestor']);
  const body = await readJson(request).catch(() => ({}));
  const device = await env.DB.prepare('SELECT * FROM device_keys WHERE id = ?').bind(deviceId).first();
  if (!device) throw httpError(404, 'Dispositivo não encontrado.');
  if (device.status === 'revoked') return json({ ok: true, alreadyRevoked: true, message: 'O dispositivo já estava revogado.' });
  await env.DB.prepare(`UPDATE device_keys SET status = 'revoked', revoked_by = ?, revoked_at = ?, revoke_reason = ? WHERE id = ?`).bind(auth.user.id, nowIso(), clean(body.reason || (device.status === 'pending' ? 'Solicitação rejeitada' : 'Revogação manual')), deviceId).run();
  await audit(env, auth.user.id, 'device_revoke', 'device_keys', deviceId, 'success', request, { previousStatus: device.status });
  return json({ ok: true, message: device.status === 'pending' ? 'Solicitação rejeitada.' : 'Dispositivo revogado.' });
}

/**
 * O quê: registra no D1 o rastro técnico de uma PET finalizada.
 * Como: valida hash, confere se a chave pública está ativa, verifica a assinatura ECDSA e grava apenas hashes/metadados.
 * Quando: após finalizar a PET no frontend e gerar o PDF/JSON localmente.
 */
async function createPetRecord(request, env) {
  const auth = await requireAuth(request, env);
  if (auth.user.mustChangePassword) throw httpError(403, 'Altere a senha temporária antes de registrar uma PET oficial.');
  const body = await readJson(request);
  const payloadHash = clean(body.payloadHash).toLowerCase();
  if (!HASH_RE.test(payloadHash)) throw httpError(400, 'Hash do payload inválido.');
  assertText(body.numeroPet, 'Número da PET obrigatório.');
  assertText(body.petSignatureB64, 'Assinatura criptográfica obrigatória.');
  const publicKeyHash = clean(body.publicKeyHash).toLowerCase();
  if (!HASH_RE.test(publicKeyHash)) throw httpError(400, 'Hash da chave pública inválido.');

  const device = await env.DB.prepare(`SELECT * FROM device_keys WHERE user_id = ? AND public_key_hash = ? AND status = 'active'`).bind(auth.user.id, publicKeyHash).first();
  if (!device) throw httpError(403, 'Chave pública não está ativa para este usuário. Registre e aprove o dispositivo antes de registrar PETs no D1.');

  const publicKeyJwk = JSON.parse(device.public_key_jwk);
  const signatureOk = await verifyEcdsaSignature(publicKeyJwk, payloadHash, body.petSignatureB64);
  if (!signatureOk) {
    await audit(env, auth.user.id, 'pet_record_create', 'pet_records', null, 'blocked', request, { reason: 'signature_invalid', payloadHash, publicKeyHash });
    throw httpError(400, 'Assinatura criptográfica do payload não confere com a chave pública ativa.');
  }

  const existing = await env.DB.prepare('SELECT id, numero_pet, payload_hash, status, server_received_at FROM pet_records WHERE payload_hash = ? OR numero_pet = ?').bind(payloadHash, clean(body.numeroPet)).first();
  if (existing) return json({ ok: true, petRecord: existing, alreadyExists: true });

  const id = crypto.randomUUID();
  const geo = body.geo && body.geo.available ? body.geo : null;
  await env.DB.prepare(`INSERT INTO pet_records (
    id, numero_pet, created_by_user_id, signing_key_id, validation_profile, schema_version,
    payload_hash, pdf_hash, json_hash, pdf_proof_hash, pet_signature_b64, pdf_proof_signature_b64,
    client_generated_at, server_received_at, client_timezone, ip_address, user_agent, geo_lat, geo_lng, geo_accuracy_m, status, notes
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'accepted', ?)`)
    .bind(
      id,
      clean(body.numeroPet),
      auth.user.id,
      device.id,
      clean(body.validationProfile || env.VALIDATION_PROFILE || 'PET-DIGITAL-NR33-v1'),
      clean(body.schemaVersion || ''),
      payloadHash,
      nullableHash(body.pdfHash),
      nullableHash(body.jsonHash),
      nullableHash(body.pdfProofHash),
      clean(body.petSignatureB64),
      clean(body.pdfProofSignatureB64 || null),
      clean(body.clientGeneratedAt || null),
      nowIso(),
      clean(body.clientTimezone || null),
      clientIp(request),
      request.headers.get('user-agent') || '',
      geo ? Number(geo.latitude) : null,
      geo ? Number(geo.longitude) : null,
      geo ? Number(geo.accuracyMeters || geo.accuracy || 0) : null,
      clean(body.notes || null)
    ).run();

  const participants = Array.isArray(body.participants) ? body.participants : [];
  for (const p of participants) {
    await env.DB.prepare(`INSERT INTO pet_participant_hashes (id, pet_record_id, participant_role, name, matricula, photo_hash, signature_image_hash, signed_at_client)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(crypto.randomUUID(), id, clean(p.participantRole || p.type || 'entrante'), clean(p.name), clean(p.matricula), nullableHash(p.photoHash), nullableHash(p.signatureImageHash), clean(p.signedAtClient || null)).run();
  }

  await env.DB.prepare('UPDATE device_keys SET last_used_at = ? WHERE id = ?').bind(nowIso(), device.id).run();
  await audit(env, auth.user.id, 'pet_record_create', 'pet_records', id, 'success', request, { numeroPet: clean(body.numeroPet), payloadHash, publicKeyHash });
  const record = await env.DB.prepare('SELECT id, numero_pet, payload_hash, status, server_received_at FROM pet_records WHERE id = ?').bind(id).first();
  return json({ ok: true, petRecord: record }, 201);
}

/**
 * O quê: consulta um registro de PET por número ou hash.
 * Como: exige perfil verificador/gestor/admin e retorna metadados gravados, sem arquivos sensíveis.
 * Quando: auditoria ou conferência posterior de uma PET recebida em PDF/JSON.
 */
async function getPetRecord(request, env, numeroPet) {
  await requireRole(request, env, ['admin', 'gestor', 'verificador']);
  const record = await env.DB.prepare(`SELECT pr.id, pr.numero_pet, pr.payload_hash, pr.pdf_hash, pr.json_hash, pr.pdf_proof_hash, pr.validation_profile, pr.schema_version, pr.server_received_at, pr.client_generated_at, pr.ip_address, pr.geo_lat, pr.geo_lng, pr.geo_accuracy_m, pr.status, u.name AS created_by_name, u.matricula AS created_by_matricula, dk.public_key_hash
    FROM pet_records pr LEFT JOIN app_users u ON u.id = pr.created_by_user_id LEFT JOIN device_keys dk ON dk.id = pr.signing_key_id WHERE pr.numero_pet = ? OR pr.payload_hash = ?`).bind(numeroPet, numeroPet).first();
  if (!record) return json({ ok: true, found: false });
  const participants = await env.DB.prepare('SELECT participant_role, name, matricula, photo_hash, signature_image_hash, signed_at_client FROM pet_participant_hashes WHERE pet_record_id = ?').bind(record.id).all();
  return json({ ok: true, found: true, record, participants: participants.results });
}

/**
 * O quê: verifica se um hash de payload foi registrado no D1.
 * Como: exige perfil verificador/gestor/admin e procura em `pet_records`.
 * Quando: conferência rápida para saber se o dossiê recebido corresponde a um registro aceito.
 */
async function validateHash(request, env) {
  await requireRole(request, env, ['admin', 'gestor', 'verificador']);
  const body = await readJson(request);
  const payloadHash = clean(body.payloadHash).toLowerCase();
  if (!HASH_RE.test(payloadHash)) throw httpError(400, 'Hash inválido.');
  const record = await env.DB.prepare(`SELECT pr.id, pr.numero_pet, pr.payload_hash, pr.status, pr.server_received_at, pr.client_generated_at, u.name AS created_by_name, u.matricula AS created_by_matricula, dk.public_key_hash
    FROM pet_records pr LEFT JOIN app_users u ON u.id = pr.created_by_user_id LEFT JOIN device_keys dk ON dk.id = pr.signing_key_id WHERE pr.payload_hash = ?`).bind(payloadHash).first();
  return json({ ok: true, found: !!record, record: record || null });
}

/**
 * O quê: lista eventos de auditoria recentes.
 * Como: exige admin/gestor e retorna ações, resultados, IP, usuário e detalhes em JSON.
 * Quando: investigação, suporte, acompanhamento de cadastros e trilha de uso.
 */
async function listAudit(request, env, url) {
  await requireRole(request, env, ['admin', 'gestor']);
  const limit = Math.min(200, Math.max(1, Number(url.searchParams.get('limit') || 50)));
  const rows = await env.DB.prepare(`SELECT al.id, al.actor_user_id, u.name AS actor_name, al.action, al.entity_type, al.entity_id, al.result, al.ip_address, al.detail_json, al.created_at FROM audit_logs al LEFT JOIN app_users u ON u.id = al.actor_user_id ORDER BY al.created_at DESC LIMIT ?`).bind(limit).all();
  return json({ ok: true, audit: rows.results });
}

/**
 * O quê: protege rotas que exigem usuário logado.
 * Como: lê token Bearer, recalcula o hash da sessão, confere expiração/revogação e status do usuário.
 * Quando: chamado no início das rotas privadas da API.
 */
async function requireAuth(request, env) {
  const header = request.headers.get('authorization') || '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) throw httpError(401, 'Sessão ausente. Faça login.');
  const token = match[1].trim();
  const sessionHash = await sha256Hex(`session:${token}:${env.SESSION_SECRET}`);
  const row = await env.DB.prepare(`SELECT s.*, u.id AS u_id, u.name, u.matricula, u.email, u.role, u.unit, u.status AS user_status, u.must_change_password
    FROM auth_sessions s JOIN app_users u ON u.id = s.user_id
    WHERE s.session_hash = ? AND s.revoked_at IS NULL`).bind(sessionHash).first();
  if (!row) throw httpError(401, 'Sessão inválida.');
  if (row.expires_at <= nowIso()) throw httpError(401, 'Sessão expirada. Faça login novamente.');
  if (row.user_status !== 'active') throw httpError(403, 'Usuário não está ativo.');
  return {
    session: { id: row.id, expires_at: row.expires_at },
    user: { id: row.u_id, name: row.name, matricula: row.matricula, email: row.email, role: row.role, unit: row.unit, status: row.user_status, mustChangePassword: Boolean(Number(row.must_change_password || 0)) }
  };
}

/**
 * O quê: protege rotas por perfil de acesso.
 * Como: chama `requireAuth()` e verifica se o perfil do usuário está na lista permitida.
 * Quando: usado em rotas administrativas ou de verificação de hash.
 */
async function requireRole(request, env, roles) {
  const auth = await requireAuth(request, env);
  if (!roles.includes(auth.user.role)) throw httpError(403, 'Perfil sem permissão para esta operação.');
  return auth;
}

/** O quê: busca usuário por ID; Como: consulta D1 e retorna 404 se não existir; Quando: edição/reset/exclusão. */
async function getUserOr404(env, userId) {
  const user = await env.DB.prepare('SELECT * FROM app_users WHERE id = ?').bind(userId).first();
  if (!user) throw httpError(404, 'Usuário não encontrado.');
  return user;
}

/** O quê: aplica hierarquia de administração; Como: gestor só alcança operacional/verificador; Quando: qualquer ação sobre outro usuário. */
function assertCanManageTarget(actor, target) {
  if (actor.role === 'admin') return;
  if (actor.role === 'gestor' && ['operacional', 'verificador'].includes(target.role)) return;
  throw httpError(403, 'Gestor pode administrar somente usuários operacionais e verificadores. Usuários gestor/admin exigem um administrador.');
}

/** O quê: valida perfil que o ator pode atribuir; Como: admin todos, gestor somente níveis inferiores; Quando: cadastro e edição. */
function assertRoleAllowedForActor(actor, role) {
  const all = ['admin', 'gestor', 'verificador', 'operacional'];
  if (!all.includes(role)) throw httpError(400, 'Perfil inválido.');
  if (actor.role === 'gestor' && !['verificador', 'operacional'].includes(role)) throw httpError(403, 'Gestor só pode atribuir os perfis operacional ou verificador.');
}

/** O quê: impede que o sistema fique sem administrador ativo; Como: conta outros admins ativos; Quando: remoção, suspensão ou rebaixamento de admin. */
async function ensureAnotherActiveAdmin(env, excludedUserId) {
  const row = await env.DB.prepare(`SELECT COUNT(*) AS count FROM app_users WHERE role = 'admin' AND status = 'active' AND id <> ?`).bind(excludedUserId).first();
  if (Number(row?.count || 0) < 1) throw httpError(400, 'A operação deixaria o sistema sem outro administrador ativo.');
}

/** O quê: encerra todas as sessões de um usuário; Como: marca revoked_at; Quando: reset de senha, suspensão ou exclusão. */
async function revokeUserSessions(env, userId) {
  await env.DB.prepare('UPDATE auth_sessions SET revoked_at = COALESCE(revoked_at, ?) WHERE user_id = ?').bind(nowIso(), userId).run();
}

/**
 * O quê: gera hash seguro de senha para armazenamento.
 * Como: cria salt aleatório e aplica PBKDF2-SHA256 usando PASSWORD_PEPPER do Worker.
 * Quando: cadastro do primeiro admin e criação de novos usuários.
 */
async function hashPassword(password, env) {
  const saltBytes = crypto.getRandomValues(new Uint8Array(16));
  const salt = bytesToHex(saltBytes);
  const hash = await pbkdf2(password, salt, env.PASSWORD_PEPPER || '', PASSWORD_ITERATIONS);
  return { hash, salt, alg: `PBKDF2-SHA256:${PASSWORD_ITERATIONS}` };
}

/**
 * O quê: confere se a senha digitada corresponde ao hash salvo.
 * Como: recalcula PBKDF2 com salt/pepper/iterações e compara em tempo constante.
 * Quando: login do usuário.
 */
async function verifyPassword(password, user, env) {
  if (!user.password_hash || !user.password_salt) return false;
  const iterations = parseIterations(user.password_alg) || PASSWORD_ITERATIONS;
  const expected = await pbkdf2(password, user.password_salt, env.PASSWORD_PEPPER || '', iterations);
  return constantTimeEqual(expected, user.password_hash);
}

/**
 * O quê: função criptográfica de derivação de chave usada para senhas.
 * Como: WebCrypto aplica PBKDF2 com SHA-256 sobre senha + pepper e salt individual.
 * Quando: chamada por `hashPassword()` e `verifyPassword()`.
 */
async function pbkdf2(password, saltHex, pepper, iterations) {
  const keyMaterial = await crypto.subtle.importKey('raw', new TextEncoder().encode(String(password) + ':' + String(pepper)), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: hexToBytes(saltHex), iterations, hash: 'SHA-256' }, keyMaterial, 256);
  return bytesToHex(new Uint8Array(bits));
}

/**
 * O quê: extrai a quantidade de iterações gravada no campo `password_alg`.
 * Como: lê o número depois de dois-pontos em strings como PBKDF2-SHA256:100000.
 * Quando: validação de senha, permitindo migrar iterações no futuro.
 */
function parseIterations(alg) {
  const m = String(alg || '').match(/:(\d+)$/);
  return m ? Number(m[1]) : null;
}

/**
 * O quê: valida assinatura digital ECDSA enviada pelo frontend.
 * Como: importa a chave pública JWK e usa WebCrypto para verificar assinatura sobre o hash.
 * Quando: antes de aceitar um registro de PET no D1.
 */
async function verifyEcdsaSignature(publicKeyJwk, messageHashHex, signatureBase64) {
  try {
    const key = await crypto.subtle.importKey('jwk', publicKeyJwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    return await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, base64ToBytes(signatureBase64), new TextEncoder().encode(messageHashHex));
  } catch {
    return false;
  }
}

/**
 * O quê: grava trilha de auditoria no D1.
 * Como: insere ação, usuário, entidade, resultado, IP, navegador e detalhes JSON.
 * Quando: chamadas importantes como login, cadastro, aprovação, revogação e registro de PET.
 */
async function audit(env, actorUserId, action, entityType, entityId, result, request, detail = {}) {
  try {
    await env.DB.prepare(`INSERT INTO audit_logs (id, actor_user_id, action, entity_type, entity_id, result, ip_address, user_agent, detail_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(crypto.randomUUID(), actorUserId, action, entityType, entityId, result, clientIp(request), request.headers.get('user-agent') || '', JSON.stringify(detail), nowIso()).run();
  } catch (e) {
    // Auditoria não deve derrubar a operação principal.
  }
}

/**
 * O quê: monta cabeçalhos CORS da API.
 * Como: compara a origem da requisição com CORS_ALLOWED_ORIGIN e libera métodos/cabeçalhos necessários.
 * Quando: em toda requisição, antes de responder ao navegador.
 */
function buildCorsHeaders(request, env) {
  const origin = request.headers.get('origin') || '';
  const allowed = String(env.CORS_ALLOWED_ORIGIN || '').replace(/\/$/, '');
  const allowOrigin = allowed === '*' ? '*' : (origin && origin.replace(/\/$/, '') === allowed ? origin : allowed || '*');
  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
    'Content-Type': 'application/json; charset=utf-8'
  };
}

/**
 * O quê: adiciona CORS a uma resposta já criada.
 * Como: copia os cabeçalhos da resposta e injeta os cabeçalhos CORS padronizados.
 * Quando: após `route()` retornar uma resposta normal.
 */
function withCors(response, corsHeaders) {
  const headers = new Headers(response.headers);
  for (const [k, v] of Object.entries(corsHeaders)) headers.set(k, v);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

/**
 * O quê: cria resposta HTTP em JSON.
 * Como: serializa objeto com indentação e define Content-Type correto.
 * Quando: usada por praticamente todas as rotas.
 */
function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data, null, 2), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', ...extraHeaders } });
}

/**
 * O quê: lê e valida corpo JSON da requisição.
 * Como: chama `request.json()` e transforma erro de parse em resposta 400 amigável.
 * Quando: rotas POST/PATCH que recebem dados do frontend.
 */
async function readJson(request) {
  try { return await request.json(); }
  catch { throw httpError(400, 'JSON inválido.'); }
}

/**
 * O quê: padroniza o caminho da URL.
 * Como: remove barras finais, exceto quando o caminho é só `/`.
 * Quando: antes de comparar rotas no roteador.
 */
function normalizePath(path) {
  return path.length > 1 ? path.replace(/\/+$/, '') : path;
}

/** O quê: retorna data/hora atual UTC em ISO; Como: `new Date().toISOString()`; Quando: timestamps de sessão, auditoria e registros. */
function nowIso() { return new Date().toISOString(); }
/** O quê: normaliza valores textuais; Como: converte null para null e aplica trim; Quando: antes de gravar/comparar dados. */
function clean(value) { return value == null ? null : String(value).trim(); }
/** O quê: exige campo textual obrigatório; Como: lança erro 400 se vazio; Quando: validação de payloads de API. */
function assertText(value, message) { if (!clean(value)) throw httpError(400, message); }
/** O quê: aplica regra mínima de senha; Como: exige 8 caracteres; Quando: criação/cadastro de usuário. */
function assertPassword(value) { if (String(value || '').length < 8) throw httpError(400, 'A senha deve ter pelo menos 8 caracteres.'); }
/** O quê: valida hash opcional; Como: aceita vazio como null e exige SHA-256 hex quando preenchido; Quando: registro de PET e arquivos. */
function nullableHash(value) { const v = clean(value); if (!v) return null; if (!HASH_RE.test(v)) throw httpError(400, 'Hash inválido.'); return v.toLowerCase(); }
/** O quê: remove campos sensíveis do usuário; Como: devolve só dados públicos; Quando: respostas de login/cadastro/me. */
function publicUser(u) { return { id: u.id, name: u.name, matricula: u.matricula, email: u.email || null, role: u.role, unit: u.unit || null, status: u.status || u.user_status || null, mustChangePassword: u.mustChangePassword ?? Boolean(Number(u.must_change_password || 0)), createdAt: u.created_at || null, updatedAt: u.updated_at || null, lastLoginAt: u.last_login_at || null }; }
/** O quê: identifica IP do cliente; Como: lê CF-Connecting-IP ou x-forwarded-for; Quando: auditoria e registro de PET. */
function clientIp(request) { return request.headers.get('CF-Connecting-IP') || request.headers.get('x-forwarded-for') || ''; }

/** O quê: cria erro HTTP controlado; Como: adiciona status e mensagem pública; Quando: validações e bloqueios de segurança. */
function httpError(status, message) {
  const e = new Error(message);
  e.status = status;
  e.publicMessage = message;
  return e;
}

/** O quê: gera token aleatório seguro; Como: usa crypto.getRandomValues e Base64URL; Quando: criação de sessão de login. */
function randomToken(bytes = 32) {
  const arr = crypto.getRandomValues(new Uint8Array(bytes));
  return btoa(String.fromCharCode(...arr)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

/** O quê: calcula SHA-256 hexadecimal de texto; Como: WebCrypto digest; Quando: sessão, hashes auxiliares e conferências. */
async function sha256Hex(text) {
  const data = new TextEncoder().encode(String(text));
  const hash = await crypto.subtle.digest('SHA-256', data);
  return bytesToHex(new Uint8Array(hash));
}

/** O quê: calcula SHA-256 de objeto com JSON canônico; Como: usa stableStringify; Quando: hash da chave pública JWK. */
async function sha256HexCanonical(value) {
  const data = new TextEncoder().encode(stableStringify(value));
  const hash = await crypto.subtle.digest('SHA-256', data);
  return bytesToHex(new Uint8Array(hash));
}

/** O quê: serializa JSON em ordem estável; Como: ordena chaves alfabeticamente recursivamente; Quando: hashing canônico. */
function stableStringify(obj) {
  if (obj === null || typeof obj !== 'object') return JSON.stringify(obj);
  if (Array.isArray(obj)) return '[' + obj.map(stableStringify).join(',') + ']';
  const keys = Object.keys(obj).sort();
  return '{' + keys.map(k => JSON.stringify(k) + ':' + stableStringify(obj[k])).join(',') + '}';
}

/** O quê: converte bytes para hexadecimal; Como: percorre cada byte e usa padStart; Quando: retorno de SHA-256/PBKDF2. */
function bytesToHex(bytes) { return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join(''); }
/** O quê: converte hexadecimal para bytes; Como: lê pares de caracteres; Quando: salt PBKDF2. */
function hexToBytes(hex) {
  const arr = new Uint8Array(hex.length / 2);
  for (let i = 0; i < arr.length; i++) arr[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return arr;
}
/** O quê: converte assinatura Base64 em bytes; Como: usa atob e Uint8Array; Quando: validação ECDSA. */
function base64ToBytes(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
/** O quê: compara strings sem vazar posição da diferença; Como: XOR caractere a caractere; Quando: token bootstrap e hash de senha. */
function constantTimeEqual(a, b) {
  a = String(a || ''); b = String(b || '');
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}
