# PET-Digital NR-33 v1.1.0

Esta versão adiciona integração com **Cloudflare Worker + D1**, mantendo o aplicativo visual no **Cloudflare Pages**.

## URLs configuradas

- Worker/API: `https://pet-digital-api.nicholas-dmae.workers.dev`
- Pages/frontend: `https://pet-digital.pages.dev`

## O que muda na v1.1.0

- Login simples por matrícula/senha.
- Perfis: `admin`, `gestor`, `verificador`, `operacional`.
- Chave privada local **não exportável**, armazenada via Web Crypto + IndexedDB.
- Registro da chave pública do dispositivo no D1.
- Aprovação/revogação de dispositivos por admin/gestor.
- Registro no D1 de hashes e auditoria mínima.
- Não salva PDF, JSON, foto ou assinatura desenhada no D1.
- O PDF e JSON continuam sendo compartilhados manualmente com o supervisor.

## Pastas

```text
frontend/    App para publicar no Cloudflare Pages
worker/      API para colar/deployar no Worker pet-digital-api
migrations/  SQL auxiliar para ajustar perfis do D1, se necessário
docs/        Orientações de configuração e teste
```

## Fluxo recomendado

1. Substitua o código do Worker por `worker/src/index.js`.
2. Confirme no Worker:
   - binding D1 `DB` → `pet_digital_db`;
   - variables;
   - secrets.
3. Se necessário, rode `migrations/0002_roles_v110.sql` no console do D1.
4. Publique a pasta `frontend/` no Cloudflare Pages.
5. Acesse o app → aba **Sistema** → crie o primeiro admin.
6. Faça login.
7. Gere a chave do dispositivo e registre a chave pública.
8. Aprove a chave, se ela ficar pendente.
9. Finalize uma PET e registre o hash no D1.

## Aviso operacional recomendado

Os dados da PET ficam armazenados temporariamente no dispositivo. Após gerar a PET, envie imediatamente o PDF e o JSON ao supervisor responsável. A limpeza do navegador, troca de aparelho ou atualização do sistema pode apagar registros locais.


## Versão comentada

Esta variação mantém a lógica da v1.1.0, mas adiciona comentários no padrão **O quê / Como / Quando** no frontend, Worker, HTML, CSS, Service Worker e um mapa em `docs/MAPA_DO_CODIGO_v110_COMENTADO.md`.
