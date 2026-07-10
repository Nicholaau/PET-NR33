# Instalação e teste — PET-Digital v1.1.1

## 1. Worker/API

No Worker `pet-digital-api`, substitua o código atual pelo conteúdo de:

```text
worker/src/index.js
```

ou copie o arquivo avulso:

```text
worker-pet-digital-api-v1.1.1.js
```

Faça o deploy.

Teste:

```text
https://pet-digital-api.nicholas-dmae.workers.dev/health
https://pet-digital-api.nicholas-dmae.workers.dev/db-test
```

## 2. Cloudflare Pages

Publique a pasta:

```text
frontend/
```

URL esperada:

```text
https://pet-digital.pages.dev
```

## 3. Banco D1

Não há migration obrigatória nova da v1.1.0 para a v1.1.1.

Confirme apenas que as tabelas existem:

```sql
SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;
```

## 4. Teste funcional

1. Criar primeiro admin, se ainda não existir.
2. Fazer login.
3. Autorizar o dispositivo.
4. Cadastrar usuário operacional, se necessário.
5. Preencher uma PET fictícia.
6. Tentar finalizar sem dispositivo aprovado para confirmar o bloqueio.
7. Aprovar o dispositivo.
8. Finalizar PET oficial.
9. Gerar PDF oficial.
10. Salvar/compartilhar o comprovante técnico.

## 5. Observação

A v1.1.1 não guarda PDF, comprovante técnico, fotos ou assinaturas desenhadas no banco. O sistema registra apenas metadados, códigos técnicos e auditoria mínima.
