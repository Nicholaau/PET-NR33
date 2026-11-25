# Testes realizados — v1.3.0

Ambiente: Node.js 22, Chromium (Playwright) em tela de celular 390×844, Worker v1.3.0 executado localmente com banco SQLite (migrations 0001, 0003, 0004 e 0005).

## Resultado

`npm test` executado quatro vezes seguidas (três antes e uma depois do último ajuste de texto): **27 aprovados, 0 falhas** em todas.

## Testes da API (18)

Mantidos da v1.2.0 (10): versão, primeiro administrador, validade da sessão, bloqueio por senha errada, CORS, `/db-test`, hierarquia, aparelho pendente até aprovação, registro de PET protegido, sessão revogada.

Novos (8):

- **Unidades:** nome repetido recusado sem diferenciar acento, maiúscula e espaços; tipo inválido recusado; operacional não cria; gestor cria; operacional vê só as ativas, sem contadores.
- **Unidade obrigatória:** verificador sem unidade recusado; gestor sem unidade aceito; `unitId`/`unitName` no cadastro e no `/auth/me`.
- **Desativação:** recusada com usuários na unidade (“Mova…”); aceita depois de mover; unidade desativada some da lista e não pode ser escolhida; reativação.
- **Cadastros antigos:** só admin; textos agrupados com contagem de usuários e PETs; gestor/admin sem texto ficam de fora; mapeamento move usuários e PETs.
- **PETs por unidade:** verificador lista e consulta só a própria unidade, mesmo pedindo outra; por código, outra unidade responde `limited` sem emissor; gestor vê todas, filtra por unidade e busca por local; operacional recebe 403.
- **Aparelhos — lista:** 17 pedidos → contador 17, página 1 com 15, página 2 com 2; busca por nome e por matrícula; gestor não vê aparelhos de gestor/admin.
- **Aparelhos — troca:** aviso de outro aparelho ativo com o nome; “aprovar e revogar o anterior” revoga o antigo com motivo “Troca de aparelho”; revogação com motivo e responsável; reativação.
- **Aparelhos — recusa:** recusa marcada como `refused`; novo pedido aceito depois da recusa; aparelho revogado depois de aprovado não pede de novo (409, orienta reativação).

## Testes do aplicativo (9 cenários)

Mantidos da v1.2.0 (6): primeiro admin e login; erros só ao avançar; PET completa com medição fora do limite, PDF e validação; falha no envio sem duplicar; sem internet; sessão recusada.

Acréscimo no cenário 3: a PET aparece em Gestão → PETs com data e local gravados no servidor; PET do admin fica sem unidade.

Novos (3):

11. Admin cria “Manutenção de Esgoto” (unidade) e “ETA Sucupira” (equipe); “manutencao de esgoto” é recusado. Cadastro sem unidade recusado na tela. Operacional e verificador cadastrados com unidade; filtro por unidade na lista. Operacional troca a senha, vê a unidade na conta, pede o aparelho e recebe “Pedido enviado em … às …”; “Nome da unidade” vem preenchido e travado. Admin vê a faixa “1 aparelho aguardando aprovação” e o número 1 na aba; “Ver agora” abre os pendentes; o cartão mostra nome, unidade e aparelho; aprovação zera o número. Operacional vê “Aparelho autorizado”.
12. Operacional emite PET; o servidor grava a unidade. Verificadora vê a aba **Conferência**, sem Usuários/Unidades e sem Aparelhos; a lista tem só a PET da unidade, com local e equipe. Validação do PDF + JSON da PET do admin (sem unidade): “Documento autêntico”, com aviso de outra unidade e sem o nome do emissor.
13. Aba Aparelhos: contador de ativos; revogação com o motivo “Perda ou roubo” escolhido na janela; aparelho aparece em Revogados com data e motivo.

Nenhum erro de JavaScript registrado durante os cenários.

## Conferência visual

- Capturas em 390×844 de: Unidades, Usuários, Conta do operador com pedido pendente, faixa de aviso no formulário, Aparelhos pendentes, Conferência do verificador, validação de outra unidade, janela de revogação e lista de revogados.
- Abas de gestor/admin conferidas em 360, 390 e 412 px de largura, sem rolagem lateral.
- Aba Aparelhos conferida em computador (1280 px), com aviso de aparelho ativo e os três botões.

## v1.3.1

- Compartilhamento simulando a regra do Chrome do Android: `.json` recusado com “Permission denied”; o app envia `..._validacao.txt`, `text/plain`, com conteúdo idêntico ao registrado.
- O `.txt` compartilhado, usado na validação junto com o PDF: “Documento válido”.
- Celular recusando o compartilhamento: o `.json` é salvo e aparece o aviso “salvo em Downloads”.
- Suíte completa: 27 aprovados, 0 falhas.

## Não coberto pelos testes automáticos

- Mapeamento dos cadastros antigos com os dados reais da produção (testado com dados simulados).
- Comportamento da faixa de aviso ao voltar de outro aplicativo no celular real.
- Detecção do tipo de aparelho nos modelos usados pela equipe (o teste usa o navegador do Playwright).
- Itens anteriores continuam valendo: câmera, assinatura em telas reais, geolocalização negada, compartilhamento por WhatsApp/e-mail.
