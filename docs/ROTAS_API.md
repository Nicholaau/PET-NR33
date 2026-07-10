# Rotas da API v1.1.0

## Públicas

```text
GET  /health
GET  /db-test
POST /setup/admin
POST /auth/login
```

## Autenticadas

```text
POST /auth/logout
GET  /auth/me
POST /devices/register
GET  /devices
POST /pet-records
```

## Admin/gestor

```text
GET  /users
POST /users
PATCH /users/:id/status
POST /devices/:id/approve
POST /devices/:id/revoke
GET  /audit
```

## Verificador/gestor/admin

```text
POST /validate
GET  /pet-records/:numero_pet
```

## Sessão

O Worker retorna um token no login. O frontend envia:

```text
Authorization: Bearer <token>
```

O D1 guarda apenas o hash do token na tabela `auth_sessions`.
