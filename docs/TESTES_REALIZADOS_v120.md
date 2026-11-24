# Testes realizados — v1.2.0

Ambiente: Node.js 22, Chromium (Playwright) em tela de celular 390×844, Worker v1.2.0 executado localmente com banco SQLite (migrations 0001, 0003 e 0004).

## Resultado

`npm test` executado três vezes seguidas: **17 aprovados, 0 falhas** em todas.

## Testes da API (10)

- versão 1.2.0 no `/health`;
- primeiro administrador exige token e só pode ser criado uma vez;
- login devolve `expiresAt` com 8 h de validade;
- bloqueio após senhas erradas repetidas (429);
- CORS: principal e publicações de teste aceitos; outros sites, outro projeto e subdomínio duplo recusados; `CORS_ALLOW_PREVIEWS = "false"` bloqueia publicações de teste;
- `/db-test`: 401 sem login, 200 para administrador;
- hierarquia de perfis;
- aparelho de operacional pendente até aprovação do gestor;
- `/pet-records` exige sessão e recusa arquivo inválido;
- sessão revogada recebe 401.

## Testes do aplicativo (7 cenários)

1. Primeiro administrador, login, “Mostrar senha”, aparelho autorizado.
2. Nenhum campo vermelho antes de tentar avançar; resumo de pendências; “Ir para o primeiro” coloca o cursor no campo; vermelho some ao preencher.
3. PET completa com O₂ 19,1 e H₂S 7 (com vírgula) → teste após ventilação → Sim/Não/N/A com justificativa → fotos → assinaturas em tela cheia → revisão → emissão. PDF e JSON baixados; conteúdo conferido; validação oficial “Documento válido”; 1 registro no banco.
4. Queda de internet no envio: “Envio pendente”; recarregar o app e trocar de aba mantêm a tentativa; reenvio com o **mesmo número**; registro **único** no banco.
5. Sem internet: continua conectado, faixa “Sem conexão”, rascunho preservado; trocar de aba não apaga o formulário.
6. Sessão revogada no servidor: volta ao login e o rascunho continua após entrar.
7. Operacional: senha temporária, troca obrigatória, aparelho aguardando, número na aba Gestão, aprovação e aparelho autorizado.

Nenhum erro de JavaScript registrado durante os cenários.

## Conferência visual

- Capturas de tela de todas as etapas em tamanho de celular e da tela em computador.
- PDF: página 1 com `X*` no item N/A e nota de rodapé; página 2 com situação “Fora dos limites/Dentro dos limites” correta para valores com vírgula, detector, justificativa do N/A, notas, declaração de ciência e quadro de integridade com o emissor.

## Não coberto pelos testes automáticos

Câmera e assinatura em aparelhos reais, permissão de localização negada no celular, compartilhamento por WhatsApp/e-mail e rede móvel instável real. Esses itens estão no roteiro de campo de `docs/COMO_TESTAR.md`.
