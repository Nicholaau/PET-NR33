# PET-Digital NR-33 v1.2.0 — Cloudflare comentado

Permissão de Entrada e Trabalho em espaço confinado, digital, com assinatura, foto, geolocalização e validação por PDF + arquivo de validação (JSON).

A v1.2.0 traz a **nova interface** aprovada no protótipo, corrige os problemas encontrados na leitura do código da v1.1.6 hotfix 2 e inclui um **kit de testes automáticos** que roda sem Cloudflare.

> **Não há migration nova no D1.** Basta publicar o Worker e o frontend (ver “Instalação”).

---

## 1. O que mudou na v1.2.0

Detalhes em `docs/ALTERACOES_v120.md`. Resumo:

### Correções

| Problema na v1.1.6 | Situação na v1.2.0 |
|---|---|
| A função que leva ao campo com erro (`focusFirstFormIssue`) não existia; o app parava com erro ao avançar com pendência. | Função recriada (`focusIssue`); o botão “Ir para o primeiro” leva ao campo. |
| Depois de uma falha no envio, abrir a aba Sistema ou fazer login de novo esquecia a tentativa; ao finalizar outra vez surgia **outra PET com outro número**. | A tentativa pendente é guardada e recuperada (até depois de fechar o app). Finalizar de novo **reaproveita o mesmo número e os mesmos arquivos**. Se o formulário mudou, o app pergunta se deve descartar a tentativa antiga. |
| Sem internet ao abrir o app, o usuário era desconectado. | Falta de internet não desconecta mais. Só uma recusa do servidor (sessão expirada/revogada) leva ao login, e o rascunho é mantido. |
| A sessão acabava ao fechar o app. | A sessão fica guardada no aparelho até vencer no servidor (8 h). |
| O PDF não mostrava justificativas de N/A, detector nem declaração de ciência. | Página 2 do PDF traz detector, justificativas de N/A (marcadas com `X*` no checklist) e a declaração de ciência com nome e hora. |
| O PDF marcava “Fora dos limites” quando a medição era digitada com vírgula. | Vírgula e ponto aceitos no PDF, como já eram no Worker. |
| Endereços de publicação de teste (`https://<id>.pet-digital.pages.dev`) não conseguiam falar com a API. | O Worker aceita esses endereços do mesmo projeto (pode ser desligado). |
| `/db-test` era público. | Exige login de administrador. |
| Documentação dizia que “Não”/N/A em item crítico bloqueava a emissão. | Documentação alinhada à regra atual. |

### Nova interface (protótipo aprovado)

- Cabeçalho compacto com selo da situação do aparelho; abas **Nova PET**, **Minhas PETs**, **Conta** e **Gestão**.
- Barra fixa **Voltar / Próxima** no rodapé.
- Campos ficam vermelhos **só depois** de tentar avançar, com resumo “Faltam N informações” e “Ir para o primeiro”.
- Checklist agrupado por assunto, com contador, cores nas respostas e rolagem automática para o próximo item.
- Medições com “Dentro/Fora do limite” ao lado de cada campo; teste após ventilação aparece sozinho quando o inicial sai do limite.
- Equipe em lista compacta; editor por pessoa; câmera traseira; **assinatura em tela cheia** com “Confirmar assinatura”.
- Etapa 6 virou **Revisão**, com “Corrigir” em cada bloco e itens NÃO/N/A em destaque.
- Tela de conclusão com **Enviar PDF** e **Enviar arquivo de validação**.
- Avisos na própria tela no lugar das janelas `alert/confirm` do navegador.
- Rascunho automático com “Rascunho salvo às HH:MM”; “Descartar” pede confirmação.
- A aba Conta mostra a versão do app (útil para relatar problemas).

### Regra do checklist (inalterada desde o hotfix 2)

- Os 22 itens são obrigatórios.
- **Sim**, **Não** e **N/A** são aceitos e **nenhuma resposta bloqueia a emissão** por si só.
- **N/A exige justificativa**, sem mínimo de caracteres.
- Na revisão, itens NÃO e N/A aparecem em destaque para conferência.
- Continuam bloqueando: medições fora do limite (sem teste após ventilação seguro), detector com calibração vencida, equipe incompleta, falta de foto/assinatura e falta da declaração de ciência.

---

## 2. Arquitetura (sem mudança)

- **Cloudflare Pages:** interface (`frontend/`).
- **Cloudflare Worker:** autenticação, autorização, validação, registro e auditoria (`worker/src/index.js`).
- **Cloudflare D1:** usuários, sessões, aparelhos autorizados, hashes, participantes e auditoria.
- **Aparelho do usuário:** rascunho, chave privada não exportável, sessão e cópias temporárias do PDF/JSON.

O D1 não guarda PDF, JSON, fotos ou assinaturas: só hashes e metadados.

---

## 3. Instalação

1. **D1:** nada a fazer (a v1.2.0 usa as mesmas tabelas da v1.1.5/v1.1.6).
2. **Worker:** substitua o código por `worker-pet-digital-api-v1.2.0.js` (ou `worker/src/index.js`) e publique.
   - Opcional: variável `CORS_ALLOW_PREVIEWS = "false"` bloqueia os endereços de publicação de teste do Pages. Sem ela, ficam liberados.
   - Confira `/health`: deve mostrar `"version": "1.2.0"`.
3. **Pages:** publique **todo** o conteúdo de `frontend/`.
4. Reabra o app no celular. O cache novo (`pet-digital-static-v1.2.0`) substitui o antigo. Se aparecer “Nova versão disponível”, toque em **Atualizar agora**.

Passo a passo completo e roteiro de homologação: `docs/INSTALACAO_E_TESTE.md`.

> Usuários já logados na v1.1.6 precisarão entrar de novo uma vez (a sessão passou a ser guardada em outro lugar). Rascunhos são mantidos.

---

## 4. Como testar (novo)

Guia completo: `docs/COMO_TESTAR.md`. Resumo:

1. **Testes automáticos** (antes de publicar qualquer versão):
   ```bash
   cd testes
   npm install            # instala o Playwright (uma vez)
   npx playwright install chromium   # baixa o navegador de teste (uma vez)
   npm test               # API + navegador em tamanho de celular
   ```
2. **Servidor local** para testar à mão, sem Cloudflare: `node testes/servidor-local.mjs` e abra `http://localhost:8788`.
3. **Ambiente de homologação** na Cloudflare (Worker + D1 separados), para testar no celular sem tocar a produção.
4. **Roteiro de campo** e **modelo de relato de problema** em `docs/COMO_TESTAR.md`.

---

## 5. Estrutura

```text
pet-digital-v1.2.0/
├── frontend/                 → publicar no Cloudflare Pages
│   ├── index.html            telas
│   ├── styles.css            aparência
│   ├── app-core.js           constantes, armazenamento, criptografia, avisos
│   ├── app-system.js         sessão, conta, aparelho, gestão, API
│   ├── app-form.js           etapas, checklist, medições, equipe, revisão, emissão
│   ├── app-output.js         PDF, arquivo de validação, Minhas PETs, validação, início
│   ├── sw.js, _headers, manifest.json, logo-dmae-2026.png
├── worker/                   → código do Worker (src/index.js, wrangler.toml)
├── worker-pet-digital-api-v1.2.0.js   cópia do Worker para colar no painel
├── migrations/               esquema do D1 (sem novidade nesta versão)
├── testes/                   kit de testes automáticos e servidor local
└── docs/                     alterações, instalação, testes, rotas e mapa do código
```

Todo o código segue comentado no padrão **O quê / Como / Quando**. Mapa: `docs/MAPA_DO_CODIGO_v120_COMENTADO.md`.

---

## 6. Pontos que ainda exigem homologação em campo

- Câmera e assinatura nos modelos de celular usados pela equipe (Android e iPhone).
- Geolocalização permitida e negada.
- Rede instável durante a finalização (o envio deve ficar pendente e ser repetido sem gerar outra PET).
- Compartilhamento do PDF e do JSON por WhatsApp, e-mail e aplicativo corporativo.
- PDFs com 1, 5, 10 e 20 participantes e com muitos itens N/A.

> Os arquivos no aparelho são temporários. Depois da emissão, o PDF e o arquivo de validação devem ser enviados ao supervisor responsável.

Histórico de versões anteriores: `docs/ALTERACOES_v114.md`, `v115` e `v116`.
