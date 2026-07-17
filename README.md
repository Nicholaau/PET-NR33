# PET-Digital NR-33 v1.1.2

Versão com fluxo mais próximo de produção para uso com **Cloudflare Pages + Cloudflare Worker + D1**.

## URLs configuradas

- Worker/API: `https://pet-digital-api.nicholas-dmae.workers.dev`
- Pages/frontend: `https://pet-digital.pages.dev`

## O que muda na v1.1.2

- O app agora abre em uma **tela inicial de login** antes de mostrar o formulário da PET.
- A PET oficial agora exige **login** antes da finalização.
- A geração do **PDF oficial** e do **comprovante técnico** fica bloqueada sem usuário conectado e dispositivo autorizado.
- A interface foi simplificada para o usuário final, evitando termos técnicos na tela principal.
- Termos técnicos foram recolhidos em áreas de “Detalhes técnicos”.
- O botão “Registrar hash no D1” foi trocado por “Registrar no sistema”.
- O “JSON” passou a ser apresentado como **comprovante técnico**.
- O Worker foi ajustado para `PBKDF2` com **100.000 iterações**, compatível com o limite do Cloudflare Workers.
- Inclui observação de que a foto deve mostrar **rosto do servidor com crachá funcional visível**.
- Mantém comentários no padrão **O quê / Como / Quando**.

## Fluxo de uso recomendado

1. Abrir o app no Cloudflare Pages.
2. Entrar com matrícula e senha.
3. Autorizar o dispositivo.
4. Aguardar aprovação, se o usuário for operacional/verificador.
5. Preencher a PET.
6. Capturar foto e assinatura dos participantes.
7. Finalizar a PET oficial.
8. Gerar/compartilhar o PDF oficial.
9. Salvar/compartilhar o comprovante técnico.
10. Enviar PDF + comprovante técnico ao supervisor imediato.

## Publicação

- Publique a pasta `frontend/` no Cloudflare Pages.
- No Worker `pet-digital-api`, substitua o código atual por `worker/src/index.js` ou pelo arquivo avulso `worker-pet-digital-api-v1.1.2.js`.
- Confirme se o binding do D1 continua como `DB`.

## Aviso operacional

Os dados da PET ficam armazenados temporariamente no dispositivo. Após gerar a PET, envie imediatamente o PDF e o comprovante técnico ao supervisor responsável. A limpeza do navegador, troca de aparelho ou atualização do sistema pode apagar registros locais.
