# Rotas da API v1.1.6

## Públicas

- `GET /`
- `GET /health`
- `GET /db-test`
- `POST /setup/admin` — somente instalação inicial com token de bootstrap.
- `POST /auth/login`

## Sessão autenticada

- `POST /auth/logout`
- `GET /auth/me`
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
