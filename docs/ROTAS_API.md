# Rotas da API v1.2.0

> CORS: aceita a origem de `CORS_ALLOWED_ORIGIN` (uma ou mais, separadas por vírgula) e, salvo `CORS_ALLOW_PREVIEWS = "false"`, as publicações de teste do mesmo projeto Pages (`https://<id>.pet-digital.pages.dev`).

## Públicas

- `GET /`
- `GET /health` — informa também `version`.
- `POST /setup/admin` — somente instalação inicial com token de bootstrap.
- `POST /auth/login` — devolve `token`, `user` e `expiresAt` (o app guarda a sessão até essa data).

## Sessão autenticada

- `GET /db-test` — **somente administrador** (v1.2.0); lista as tabelas do D1.

- `POST /auth/logout`
- `GET /auth/me` — devolve o usuário e `session.expires_at`; 401 quando a sessão venceu ou foi revogada (o app volta ao login sem apagar o rascunho).
- `GET /client-context`
- `POST /auth/change-password`

## Usuários

- `GET /users`
- `POST /users`
- `PATCH /users/:id`
- `PATCH /users/:id/status`
- `POST /users/:id/reset-password`
- `DELETE /users/:id`

Admin administra todos os perfis. Gestor administra somente operacional/verificador.

## Dispositivos

- `POST /devices/register`
- `GET /devices`
- `POST /devices/:id/approve`
- `POST /devices/:id/revoke`

A autorização respeita a mesma hierarquia de perfis.

## PET / validação

- `POST /pet-records` — recebe temporariamente PDF + arquivo de validação (JSON), recalcula hashes, verifica assinatura/dispositivo/regras e grava metadados.
- `GET /pet-records/:numero_pet`
- `POST /validate` — consulta simples de registro/hash.
- `POST /validate-document` — validação oficial conjunta de PDF + JSON contra o D1.

## Auditoria

- `GET /audit`
