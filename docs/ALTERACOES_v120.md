# Alterações da v1.2.0

Base: v1.1.6 hotfix 2. Sem migration nova no D1.

## Correções

1. **Função ausente ao avançar com pendência.** `goToNextFormStep()` e `finalizeRecord()` chamavam `focusFirstFormIssue()`, que não existia desde a divisão do frontend em módulos. Substituída por `focusIssue()` (app-form.js), usada por “Ir para o primeiro” e pelos links de pendência da revisão.

2. **PET duplicada após falha de envio.**
   - Causa: `showTab('systemTab')` chamava `refreshMe()` → `loadUserWorkspace()` → `clearWorkspaceMemory()`, que zerava `finalizedRecord`. Um novo “Finalizar” gerava outro número.
   - Correção:
     - `loadUserWorkspace()` só recarrega quando o usuário muda (`workspaceUserId`);
     - abrir abas não recarrega mais o formulário;
     - ao gerar os arquivos, o app grava um ponteiro (`petDigitalPendingAttemptV1:<usuário>`) com o código da tentativa e a “impressão digital” do formulário; `restorePendingAttempt()` recupera a tentativa ao abrir o app ou entrar de novo;
     - em “Finalizar PET”, se há tentativa pendente e o formulário não mudou, o app só repete o envio (mesmo número, mesmos arquivos, mesma chave de idempotência); se mudou, pergunta se deve descartar a tentativa antiga, que fica como “Cancelada antes do registro” em Minhas PETs, sem botão de reenvio.

3. **Desconexão sem internet.**
   - `apiFetch()` agora marca o erro com `status` (HTTP) ou `network = true`.
   - `refreshMe()` só encerra a sessão em 401/403. Sem rede, o usuário continua dentro e aparece a faixa “Sem conexão”.
   - Resposta 401 em qualquer chamada leva ao login com aviso, sem apagar o rascunho.

4. **Sessão guardada no aparelho.** `loadAuthState()`/`saveAuthState()` usam `localStorage` com a validade (`expiresAt`) devolvida pelo `/auth/login`. Sessão vencida é descartada ao abrir. A sessão antiga do `sessionStorage` é migrada.

5. **PDF.**
   - Página 1: N/A marcado como `X*` e nota “as justificativas estão na página seguinte”.
   - Página 2: linha do detector (nº de série e validade), bloco “Justificativas dos itens N/A”, “Declaração de ciência” com emissor e data/hora, e emissor no quadro de integridade.
   - Se as justificativas não couberem, segue página extra “continuação”.
   - Situação das medições calculada aceitando vírgula (antes `Number('19,5')` virava inválido e saía “Fora dos limites”).

6. **Rascunho.** Gravado também ao sair do app ou trocar de aplicativo (`pagehide`/`visibilitychange`), para não perder os últimos segundos digitados. Nunca é regravado depois que a PET foi registrada.

7. **Arquivos já registrados.** Abrir/enviar PDF e JSON de PET registrada não exige mais consultar o servidor (funciona sem internet). A emissão continua exigindo internet e aparelho autorizado.

8. **Worker.**
   - CORS aceita lista de origens separadas por vírgula e os endereços de publicação de teste do mesmo projeto Pages (`https://<id>.pet-digital.pages.dev`). Desligável com `CORS_ALLOW_PREVIEWS = "false"`.
   - `/db-test` exige administrador.
   - `/health` e `/` informam `version: "1.2.0"`.

## Interface

- Login: botão Mostrar/Ocultar senha; “Esqueceu a senha? Procure o gestor do seu setor.”
- Topo: logotipo + selo do aparelho (autorizado, aguardando aprovação, não autorizado, revogado, sem conexão, troque a senha).
- Abas: Nova PET, Minhas PETs, Conta, Gestão (verificador/gestor/admin; mostra número de aparelhos aguardando aprovação).
- Barra fixa Voltar/Próxima; na etapa 5 vira “Revisar”, na 6 “Finalizar PET”.
- Erros só depois de tentar avançar; resumo com até 4 itens e “Ir para o primeiro”; o vermelho some ao corrigir.
- Etapa 1: data em linha própria; equipe de salvamento em botões; supervisor vindo da Equipe.
- Etapa 2: checklist em 4 grupos (Equipe/EPI/saúde; Isolamento/energias/acessos; Atmosfera/ventilação; Resgate), contador fixo, cores (Sim verde, Não amarelo, N/A cinza), rolagem automática, justificativa só no N/A.
- Etapa 3: indicação “Dentro/Fora do limite/Valor inválido” por campo; teclado numérico com vírgula; teste após ventilação automático quando necessário ou opcional pelo botão; campo geral “Observações das medições” removido (ficam as observações de cada teste).
- Etapa 4: lista com selos “Foto ok/Sem foto” e “Assinado/Sem assinatura”; editor por pessoa; câmera traseira; assinatura em tela cheia (ponteiro: dedo, caneta ou mouse) com “Confirmar assinatura”; supervisor primeiro.
- Etapa 5: declaração de ciência em cartão destacado.
- Etapa 6: revisão completa; pendências com link para a etapa; aviso de aparelho não autorizado; caixa “Envio pendente”.
- Conclusão: número, hora, Enviar PDF, Enviar arquivo de validação, Outras opções, Iniciar nova PET.
- Minhas PETs: situação (Registrada, Envio pendente, Cancelada antes do registro), ações conforme a situação.
- Conta: dados, sessão até HH:MM, versão do app, situação do aparelho, troca de senha recolhida, sair com confirmação.
- Gestão: aparelhos (pendentes primeiro), usuários (cadastro recolhido), validar PET recebida, consultar código.
- `alert()`/`confirm()` substituídos por avisos na tela (`notify`) e janela própria (`askConfirm`).

## Compatibilidade

- Mesmos nomes de campo do formulário: Worker, D1, rascunhos e arquivos de validação da v1.1.6 continuam válidos.
- `PAYLOAD_SCHEMA` passou a `PET-DIGITAL-NR33/v1.2.0` (apenas informativo; o Worker não restringe).
- Cache do Service Worker: `pet-digital-static-v1.2.0`.

## Testes

Novo diretório `testes/` com servidor local (Worker real + SQLite), testes da API e testes ponta a ponta no navegador. Resultados em `docs/TESTES_REALIZADOS_v120.md`.
