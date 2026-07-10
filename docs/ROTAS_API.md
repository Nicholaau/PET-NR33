# Rotas da API v1.1.1

Principais rotas do Worker:

```text
GET  /health
GET  /db-test
POST /setup/admin
POST /auth/login
POST /auth/logout
GET  /auth/me
POST /users
GET  /users
PATCH /users/:id/status
POST /devices/register
GET  /devices
POST /devices/:id/approve
POST /devices/:id/revoke
POST /pet-records
GET  /pet-records/:numero_pet
POST /validate
GET  /audit
```

A v1.1.1 mantém a mesma API da v1.1.0, com ajuste no fluxo do frontend e compatibilidade do PBKDF2 no Worker.
