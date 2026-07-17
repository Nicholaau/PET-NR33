# PET-Digital NR-33 v1.1.3

Versão com fluxo mais próximo de produção para uso com **Cloudflare Pages + Cloudflare Worker + D1**.

## URLs configuradas

- Worker/API: `https://pet-digital-api.nicholas-dmae.workers.dev`
- Pages/frontend: `https://pet-digital.pages.dev`

## O que muda na v1.1.3

- Administração de usuários com **editar cadastro**, **redefinir senha** e **excluir acesso**.
- Gestor administra somente usuários **operacional** e **verificador**.
- Admin administra todos os perfis, inclusive outros gestores e administradores.
- Exclusão de acesso é lógica: preserva histórico, encerra sessões e revoga dispositivos.
- Usuário novo ou com senha redefinida deve trocar a senha temporária antes de emitir PET oficial.
- Autorização do aparelho foi consolidada em uma única tela e em um único botão.
- O botão prepara a proteção local e envia a solicitação automaticamente.
- Para operacional/verificador, basta uma aprovação do gestor/admin; não há segunda etapa para o usuário.
- Proteções contra cadastro duplicado de dispositivo e contra apagar a chave local enquanto houver autorização ativa.
- Mantém login obrigatório, PDF/comprovante vinculados ao dispositivo autorizado e foto com rosto + crachá visível.
- Código comentado no padrão **O quê / Como / Quando**.

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
- No Worker `pet-digital-api`, substitua o código atual por `worker/src/index.js` ou pelo arquivo avulso `worker-pet-digital-api-v1.1.3.js`.
- Confirme se o binding do D1 continua como `DB`.

## Aviso operacional

Os dados da PET ficam armazenados temporariamente no dispositivo. Após gerar a PET, envie imediatamente o PDF e o comprovante técnico ao supervisor responsável. A limpeza do navegador, troca de aparelho ou atualização do sistema pode apagar registros locais.
