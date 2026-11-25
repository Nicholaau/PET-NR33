# Como testar a PET-Digital

Os testes funcionam em quatro camadas. Cada uma pega um tipo diferente de problema; nenhuma substitui as outras.

| Camada | Onde roda | O que pega | Quando usar |
|---|---|---|---|
| 1. Testes automáticos | Computador, sem internet e sem Cloudflare | Erros de programação, regras quebradas, permissões, PET duplicada, sessão, PDF | Antes de publicar **qualquer** versão |
| 2. Servidor local | Computador | Testar à mão uma tela ou um ajuste, sem risco | Durante ajustes |
| 3. Homologação na Cloudflare | Celulares reais, banco separado | Câmera, assinatura, GPS, rede, compartilhamento | Antes de liberar para a equipe |
| 4. Teste de campo | Serviço real acompanhado | Uso real, dúvidas dos supervisores | Primeiras semanas de uso |

---

## 1. Testes automáticos

Ficam em `testes/`. Usam o **mesmo código** do Worker e do frontend, com um banco SQLite temporário no lugar do D1.

### Preparação (uma vez)

Requisitos: Node.js 22 ou mais recente.

```bash
cd testes
npm install
npx playwright install chromium
```

### Rodar

```bash
cd testes
npm test            # tudo (API + navegador), cerca de 1 minuto
npm run test:api    # só regras do Worker (segundos)
npm run test:app    # só o aplicativo no navegador
```

Resultado esperado: `pass 27` e `fail 0`. O cenário 3 a 6 inclui, desde a v1.3.1, o compartilhamento com a regra do Chrome do Android (recusa `.json`). Qualquer `fail` mostra o teste e a linha que falhou.

Para guardar capturas de tela de cada passo: `PET_SCREENSHOTS=capturas npm run test:app` (Linux/Mac) ou `set PET_SCREENSHOTS=capturas && npm run test:app` (Windows).

### O que é testado

**API (`api.test.mjs`)**
- versão; primeiro administrador só com token e só uma vez;
- validade da sessão no login; bloqueio após senhas erradas;
- CORS: endereço principal e publicações de teste aceitos, outros sites recusados;
- `/db-test` só para administrador;
- hierarquia (gestor não cria admin; operacional não lista usuários);
- aparelho de operacional pendente até aprovação;
- registro de PET exige sessão e rejeita arquivo inválido;
- sessão revogada recebe 401;
- unidades: nome repetido recusado (sem diferenciar acento e maiúscula); só gestor e admin criam; operacional e verificador exigem unidade; desativar exige mover os usuários; reativar;
- cadastros antigos: texto livre ligado à unidade oficial, com as PETs; admin e gestor sem unidade ficam de fora;
- PETs: verificador lista e consulta só a própria unidade; outra unidade por código mostra só número e situação; gestor filtra por unidade e busca; operacional não lista;
- aparelhos: contadores, paginação de 15, busca por nome e matrícula; gestor não vê aparelhos de gestor/admin;
- aparelhos: “aprovar e revogar o anterior”, aviso de outro aparelho ativo, motivo gravado, reativação;
- aparelhos: recusa diferente de revogação; pedido recusado pode ser refeito; revogado após aprovação não.

**Aplicativo (`e2e.test.mjs`)**, em tela de celular:
1. Primeiro administrador, login, “Mostrar senha”, aparelho autorizado.
2. Campos vermelhos só depois de tentar avançar; “Ir para o primeiro” leva ao campo.
3. PET completa com medição inicial fora do limite (valores com vírgula), teste após ventilação, Sim/Não/N/A com justificativa, fotos, assinaturas em tela cheia, revisão e emissão.
4. Download do PDF e do arquivo de validação; conferência do conteúdo; validação oficial na aba Gestão.
5. Queda de internet no envio: PET fica pendente, sobrevive a recarregar o app e a trocar de aba, é reenviada **com o mesmo número** e fica registrada **uma única vez**.
6. Sem internet: usuário continua conectado e o rascunho continua lá.
7. Sessão recusada pelo servidor: volta ao login e o rascunho é mantido.
8. Admin cria unidades (nome repetido recusado) e cadastra operacional e verificador com unidade; filtro por unidade.
9. Operacional: troca obrigatória da senha, unidade preenchida e travada no formulário, “Pedido enviado em … às …”.
10. Admin: faixa “1 aparelho aguardando aprovação”, número na aba Aparelhos, “Ver agora”, aprovação.
11. Operacional emite PET; verificador da mesma unidade vê só ela na aba Conferência, com local e equipe; PET de fora da unidade é validada como “Documento autêntico”, sem o nome do emissor.
12. Aba Aparelhos: contador de ativos, revogação com motivo “Perda ou roubo” e registro em Revogados.
13. Nenhum erro de JavaScript em todo o percurso.

> Quando um problema novo for encontrado em campo, o ideal é criar um teste que o reproduza antes de corrigir. Assim ele não volta numa versão futura.

---

## 2. Servidor local (teste manual sem Cloudflare)

```bash
node testes/servidor-local.mjs
```

- Abra `http://localhost:8788` no navegador do computador.
- Na primeira vez, crie o administrador em “Configuração inicial do sistema” com o token `token-de-teste-local`.
- Os dados ficam em `testes/.dados-locais.sqlite`. Apague o arquivo para começar do zero.
- Para simular celular no Chrome: F12 → ícone de celular (Ctrl+Shift+M).
- Para simular queda de internet: F12 → aba Rede (Network) → “Offline”.

---

## 3. Ambiente de homologação na Cloudflare

Serve para testar em **celulares reais** sem misturar PETs de teste com as oficiais.

### 3.1 Banco e Worker de homologação (uma vez)

1. **D1:** crie um banco `pet_digital_homolog` e rode, no Console, as migrations `0001`, `0003`, `0004` e `0005`, nessa ordem. Se o banco de homologação já existe, rode só a `0005`.
2. **Worker:** crie um Worker `pet-digital-api-homolog` com o mesmo código (`worker-pet-digital-api-v1.3.0.js`):
   - binding `DB` → `pet_digital_homolog`;
   - variáveis iguais às do `wrangler.toml`, com `APP_ENV = "homologacao"` e `CORS_ALLOWED_ORIGIN = "https://pet-digital.pages.dev"`;
   - secrets **diferentes** dos de produção: `SESSION_SECRET`, `PASSWORD_PEPPER`, `BOOTSTRAP_ADMIN_TOKEN`.
3. Anote o endereço, por exemplo `https://pet-digital-api-homolog.<sua-conta>.workers.dev`.

### 3.2 Frontend de homologação (a cada versão)

O frontend tem o endereço da API fixo. Para não editar arquivos à mão, use:

```bash
node testes/preparar-homologacao.mjs https://pet-digital-api-homolog.<sua-conta>.workers.dev
```

O comando cria a pasta `frontend-homologacao/`, com a API trocada e uma faixa “HOMOLOGAÇÃO” no topo. Publique essa pasta no projeto Pages `pet-digital` como **publicação de teste** (branch `homologacao`). O endereço fica `https://homologacao.pet-digital.pages.dev`, que o Worker já aceita.

> A produção (`https://pet-digital.pages.dev`) não é afetada: publicações de teste não substituem a principal.

---

## 4. Roteiro de campo (homologação com celulares reais)

Marque cada item em pelo menos um Android e, se a equipe usar, um iPhone.

| # | Ação | Resultado esperado |
|---|---|---|
| 1 | Entrar com matrícula e senha | Abre em “Nova PET”; selo do aparelho no topo |
| 2 | Fechar o app e abrir de novo | Continua conectado (até 8 h) |
| 3 | Operador sem autorização: Conta → Solicitar autorização | Selo “Aguardando aprovação”; “Pedido enviado em … às …” |
| 4 | Gestor entra no app | Faixa “1 aparelho aguardando aprovação”; número na aba Aparelhos |
| 4a | Gestor toca “Ver agora” e aprova | Selo do operador muda para “Aparelho autorizado” ao atualizar |
| 5 | Tentar avançar etapa vazia | Campos em vermelho e lista “Faltam N informações” |
| 6 | Checklist com Sim, Não e N/A | Nenhum bloqueio; N/A pede justificativa; tela rola para o próximo item |
| 7 | Medição inicial fora do limite (ex.: O₂ 19,1) | Aviso amarelo e teste após ventilação aparece |
| 8 | Teste após ventilação ainda fora do limite | Não deixa avançar: “A entrada não pode ser autorizada” |
| 9 | Detector com calibração vencida | Não deixa avançar |
| 10 | Foto de cada pessoa | Abre câmera traseira; foto aparece na lista |
| 11 | Assinatura em tela cheia, celular deitado | Traço sem distorção; “Assinado” na lista |
| 12 | Revisão | Itens NÃO e N/A em destaque; “Corrigir” leva à etapa |
| 13 | Finalizar com internet boa | Tela “PET registrada” com número |
| 14 | Enviar PDF e arquivo de validação por WhatsApp/e-mail | Os dois chegam; o arquivo de validação chega como `..._validacao.txt` |
| 14a | Validar com o `.txt` recebido no item 14 | “Documento válido” |
| 15 | Abrir o PDF | Página 2 mostra detector, justificativas N/A e declaração de ciência |
| 16 | Modo avião logo antes de tocar “Finalizar PET” | “Envio pendente”; ao voltar a internet, “Repetir envio” registra **o mesmo número** |
| 17 | Com envio pendente, fechar e abrir o app | O envio pendente continua lá |
| 18 | Ficar sem internet e abrir o app | Continua conectado; faixa “Sem conexão”; dá para preencher |
| 19 | Validar PET recebida (Gestão) com PDF + JSON | “Documento válido” |
| 20 | Negar a localização quando o celular pedir | A PET é emitida; o PDF mostra “Geolocalização: não obtida” |
| 21 | Operador da unidade abre a etapa 1 | “Nome da unidade” preenchido com a unidade do cadastro, sem poder editar |
| 22 | Operador com aparelho ativo pede outro aparelho | Gestor vê o aviso “Já tem um aparelho ativo” e as opções “Aprovar e revogar o anterior” e “Manter os dois” |
| 23 | Gestor recusa um pedido com motivo | Operador vê o motivo e o botão “Enviar novo pedido” |
| 24 | Gestor revoga um aparelho com motivo | Aparece em Revogados com data, responsável e motivo; o operador vê a orientação de pedir reativação |
| 25 | Verificador abre Conferência | Só PETs da própria unidade; busca por número, local ou emissor |
| 26 | Verificador valida PDF + JSON de outra unidade | “Documento autêntico”, sem nome do emissor |
| 27 | Gestor tenta desativar unidade com usuários | Mensagem pedindo para mover os usuários antes |

---

## 5. Como relatar um problema

Copie e preencha (mandar junto um print da tela ajuda muito):

```text
Versão do app (aba Conta):
Celular (marca/modelo) e sistema (Android/iOS):
Usuário (matrícula) e perfil:
Etapa ou tela:
O que foi feito, passo a passo:
O que aconteceu:
O que era esperado:
Mensagem exibida (se houver):
Data e hora aproximadas:
Número da PET (se houver):
Internet no momento (boa, fraca, sem sinal):
```
