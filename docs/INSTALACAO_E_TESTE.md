# Instalação e teste — PET-Digital v1.1.3

## 1. Worker/API

No Worker `pet-digital-api`, substitua o código atual pelo conteúdo de:

```text
worker/src/index.js
```

ou copie o arquivo avulso:

```text
worker-pet-digital-api-v1.1.3.js
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

Não há migration obrigatória nova da v1.1.0 para a v1.1.3.

Confirme apenas que as tabelas existem:

```sql
SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;
```

## 4. Teste funcional

1. Criar primeiro admin, se ainda não existir.
2. Fazer login.
3. Clicar em “Configurar e solicitar autorização” uma única vez.
4. Testar cadastro de usuário operacional/verificador.
5. Testar edição cadastral e redefinição de senha.
6. Confirmar que gestor não consegue editar gestor/admin.
7. Aprovar o dispositivo pendente e confirmar que a autorização é imediata.
8. Preencher uma PET fictícia.
9. Finalizar PET oficial e gerar PDF/comprovante.
10. Testar “Excluir acesso” em usuário fictício e confirmar preservação do histórico.

## 5. Observação

A v1.1.3 não guarda PDF, comprovante técnico, fotos ou assinaturas desenhadas no banco. O sistema registra apenas metadados, códigos técnicos e auditoria mínima.
