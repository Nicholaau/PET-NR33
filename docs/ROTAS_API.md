# Rotas da API v1.3.0

> CORS: aceita a origem de `CORS_ALLOWED_ORIGIN` (uma ou mais, separadas por vírgula) e, salvo `CORS_ALLOW_PREVIEWS = "false"`, as publicações de teste do mesmo projeto Pages (`https://<id>.pet-digital.pages.dev`).

Perfis: **O** operacional · **V** verificador · **G** gestor · **A** admin.

## Públicas

- `GET /`
- `GET /health` — informa também `version`.
- `POST /setup/admin` — somente instalação inicial, com token de bootstrap.
- `POST /auth/login` — devolve `token`, `user` (com `unitId`, `unitName`) e `expiresAt`.

## Sessão

| Rota | Perfis | Observação |
|---|---|---|
| `POST /auth/logout` | todos | |
| `GET /auth/me` | todos | 401 quando a sessão venceu ou foi revogada |
| `GET /client-context` | todos | |
| `POST /auth/change-password` | todos | |
| `GET /db-test` | A | lista as tabelas do D1 |

## Unidades (v1.3.0)

| Rota | Perfis | Observação |
|---|---|---|
| `GET /units` | todos | O/V: só ativas (id, nome, tipo). G/A com `?all=1`: todas, com `user_count`, `pet_count` e `unmappedUsers` |
| `POST /units` | G, A | `{ name, type }`; `type` = `unidade`, `equipe` ou `nucleo`; nome único sem acento/maiúscula |
| `PATCH /units/:id` | G, A | `{ name?, type?, status? }`; `status: inactive` exige unidade sem usuários com acesso |
| `GET /units/legacy` | A | textos de unidade dos cadastros antigos, com quantidade de usuários e PETs |
| `POST /units/legacy-map` | A | `{ text, unitId }`; move usuários com esse texto, e as PETs deles, para a unidade |

## Usuários

| Rota | Perfis | Observação |
|---|---|---|
| `GET /users` | G, A | inclui `unitId`, `unitName` e `legacyUnit` |
| `POST /users` | G, A | `unitId` obrigatório para operacional e verificador |
| `PATCH /users/:id` | G, A | idem; ao receber unidade pela primeira vez, as PETs antigas da pessoa vão junto |
| `PATCH /users/:id/status` | G, A | |
| `POST /users/:id/reset-password` | G, A | |
| `DELETE /users/:id` | G, A | exclusão lógica |

Gestor administra somente operacional e verificador; admin administra todos.

## Aparelhos

| Rota | Perfis | Observação |
|---|---|---|
| `POST /devices/register` | todos | O/V: pendente; G/A: ativo. Pedido recusado pode ser refeito; revogado após aprovação exige reativação (409) |
| `GET /devices?mine=1` | todos | aparelhos do próprio usuário (O/V recebem sempre só os próprios) |
| `GET /devices?view=manage` | G, A | `status` = `pending` · `active` · `revoked` · `inactive` · `all`; `q`; `page`; `pageSize` (padrão 15). Devolve `counts`, `total`, `pages` |
| `POST /devices/:id/approve` | G, A | `{ revokeOthers: true }` revoga os demais ativos da pessoa (“Troca de aparelho”) |
| `POST /devices/:id/revoke` | G, A | `{ reason }`. Em pedido pendente, é a recusa |

Cada aparelho vem com `refused` (revogado sem nunca ter sido aprovado), `other_active_count`, `other_active_label`, `user_unit_name`, `request_user_agent`, `approved_by_name` e `revoked_by_name`.

`GET /devices` sem parâmetros mantém o formato antigo (lista completa), por compatibilidade.

## PET e validação

| Rota | Perfis | Observação |
|---|---|---|
| `POST /pet-records` | todos, com aparelho ativo | grava também `unit_id`/`unit_name` do emissor, data, local, trabalho e supervisor |
| `GET /pet-records` | V, G, A | V: só a própria unidade. G/A: todas, `unitId` (ou `none`). `q` busca número, local, emissor, matrícula ou supervisor. Paginação de 15 |
| `GET /pet-records/:numero` | V, G, A | V: PET de outra unidade responde `found: false` |
| `POST /validate` | V, G, A | V: PET de outra unidade responde `limited: true`, só número e situação |
| `POST /validate-document` | V, G, A | V: PET de outra unidade responde `limited: true`, com `valid`, sem emissor nem detalhes |

## Auditoria

- `GET /audit` — G, A. Ações novas: `unit_create`, `unit_update`, `unit_legacy_map`, `device_refuse`.
