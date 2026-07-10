# Mapa do Código — PET-Digital NR-33 v1.1.0 comentado

Este documento complementa os comentários dentro dos arquivos. A ideia é facilitar a revisão antes de subir a versão no Cloudflare Pages/Worker.

## 1. Frontend — `frontend/app.js`

É o aplicativo que roda no celular/navegador. Ele cuida de:

- preenchimento da PET;
- captura de foto e assinatura;
- validação de campos e medições;
- geração do payload/dossiê;
- cálculo de hashes;
- assinatura com chave privada local;
- geração/compartilhamento de PDF e JSON;
- login e chamadas à API Worker;
- registro do hash da PET no D1.

Fluxo principal:

```text
init()
↓
bindEvents()
↓
usuário preenche PET
↓
validateCurrentForm()
↓
finalizeRecord()
↓
buildPayload() + sha256Hex() + signPayloadHash()
↓
saveRecord()
↓
print/share/export
↓
registerRecordOnServer()
```

## 2. Worker/API — `worker/src/index.js`

É o backend que roda na Cloudflare. Ele cuida de:

- CORS;
- login;
- cadastro de usuário;
- sessão;
- cadastro/aprovação/revogação de chave pública;
- validação de assinatura criptográfica;
- gravação de hash da PET;
- consulta de validação;
- auditoria.

Fluxo principal:

```text
fetch(request, env)
↓
route(request, env, url)
↓
/auth, /users, /devices, /pet-records, /validate ou /audit
↓
D1 pelo binding env.DB
```

## 3. Chave privada e chave pública

- A chave privada fica no dispositivo do usuário, em IndexedDB, como CryptoKey não exportável.
- A chave pública vai para o D1 em `device_keys`.
- O Worker não precisa conhecer a chave privada.
- O Worker valida a assinatura recebida com a chave pública previamente aprovada.

## 4. O que vai para o D1

O D1 guarda somente dados mínimos:

- usuário;
- sessão;
- chave pública e hash da chave pública;
- hash da PET;
- hash do PDF/JSON/prova, quando houver;
- assinatura criptográfica em Base64;
- IP/data/hora/user-agent;
- auditoria.

Não guarda PDF, JSON, foto ou imagem de assinatura.

## 5. Arquivos importantes

- `frontend/index.html`: estrutura da tela.
- `frontend/styles.css`: aparência e responsividade.
- `frontend/app.js`: regra de negócio do app.
- `frontend/sw.js`: cache/offline.
- `worker/src/index.js`: API real do Worker.
- `worker-pet-digital-api-v1.1.0.js`: cópia única para colar no painel do Worker.
- `migrations/*.sql`: estrutura do banco D1.
