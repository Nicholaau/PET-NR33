# Instalação e teste — PET-Digital v1.1.0

## 1. Worker

Abra o Worker `pet-digital-api` no painel da Cloudflare e substitua o código pelo conteúdo de:

```text
worker/src/index.js
```

Depois faça deploy.

## 2. Conferir rotas de teste

Abra no navegador:

```text
https://pet-digital-api.nicholas-dmae.workers.dev/health
```

Depois:

```text
https://pet-digital-api.nicholas-dmae.workers.dev/db-test
```

## 3. Conferir variável CORS

No Worker, a variável deve ser:

```text
CORS_ALLOWED_ORIGIN = https://pet-digital.pages.dev
```

Sem barra final.

## 4. Primeiro admin

No app, vá em **Sistema → Primeiro administrador** e informe o `BOOTSTRAP_ADMIN_TOKEN` que você configurou como Secret no Worker.

Depois use a matrícula e senha cadastradas para fazer login.

## 5. Dispositivo/chave

Na aba **Sistema**, registre a chave pública do dispositivo.

- Admin/gestor: chave fica ativa automaticamente.
- Operacional/verificador: chave fica pendente e precisa aprovação de admin/gestor.

## 6. Registro de PET

Finalize a PET normalmente. Se estiver logado e a chave estiver ativa, o app tentará registrar automaticamente o hash no D1.

Também é possível usar o botão:

```text
Registrar hash no D1
```

## 7. O que fica no D1

Ficam salvos:

- usuário;
- chave pública e hash da chave;
- número da PET;
- hash do payload;
- hash da prova do PDF, quando houver;
- assinatura criptográfica em base64;
- IP e data/hora do servidor;
- hashes das fotos/assinaturas dos participantes;
- auditoria mínima.

Não ficam salvos:

- PDF;
- JSON completo;
- fotos;
- imagens de assinatura.
