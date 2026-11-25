# Alterações — v1.3.0

Foco: autorização de aparelhos mais clara e separação por unidade.

> **Exige a migration `0005_unidades_v130.sql`**, aplicada **antes** de publicar o Worker. Ver `INSTALACAO_E_TESTE.md`.

## 1. Aparelhos

### Nova aba “Aparelhos” (gestor e admin)

- Saiu da aba Gestão e ganhou tela própria.
- Quatro filtros com contador: **Pendentes**, **Ativos**, **Revogados** e **Sem uso** (ativo sem emitir PET há mais de 60 dias).
- Busca por nome, matrícula ou nome do aparelho.
- Paginação de 15 por página, feita no servidor.
- Pendentes aparecem do mais antigo para o mais novo.

### Cada pedido mostra o contexto

- Nome, matrícula, perfil e **unidade** de quem pediu.
- Nome do aparelho e **tipo detectado** (ex.: “Android · Chrome”, “iPhone · Safari”).
- Há quanto tempo o pedido foi feito.
- Se a pessoa **já tem outro aparelho ativo**: aviso com o nome dele e o último uso, e duas opções:
  - **Aprovar e revogar o anterior** (troca de celular, com motivo “Troca de aparelho”);
  - **Manter os dois**.

  Não há bloqueio: ter mais de um aparelho continua permitido.

### Recusar × revogar

- **Recusar** vale para o pedido pendente; **Revogar**, para o aparelho já autorizado.
- Os dois pedem o motivo numa lista curta, com a opção “Outro”:
  - recusa: Pedido não reconhecido, Aparelho não autorizado para o serviço, Pedido repetido, Outro;
  - revogação: Troca de aparelho, Perda ou roubo, Desligamento ou mudança de função, Outro.
- Na lista aparecem como **Recusado** ou **Revogado**, com data, responsável e motivo.
- Pedido recusado pode ser refeito pelo próprio usuário. Aparelho revogado depois de aprovado só volta por **Reativar**.

### Aviso para gestor e admin

- Número de pedidos pendentes no ícone da aba Aparelhos.
- Faixa “N aparelhos aguardando aprovação — **Ver agora**”, que leva direto aos pendentes.
- Atualizada no login, ao voltar para o app e a cada 3 minutos com o app aberto.

### Do lado do operador

- “Pedido enviado em DD/MM às HH:MM. A emissão fica liberada assim que o gestor aprovar; não é preciso repetir o pedido. Se for urgente, avise o gestor do seu setor.”
- Pedido recusado: mostra o motivo e oferece “Enviar novo pedido”.
- Aparelho revogado: mostra data e motivo, e orienta a pedir a reativação.
- Nome padrão do aparelho passa a ser o tipo detectado, quando o campo fica em branco.

## 2. Unidades

### Lista oficial no banco

- Tabela `units`: nome, tipo (**unidade**, **equipe** ou **núcleo**) e situação.
- Gestor e admin **criam, renomeiam, mudam o tipo e desativam** em Gestão → Unidades.
- O nome é único sem diferenciar maiúsculas, acentos e espaços repetidos: “manutencao de esgoto” não cria uma segunda “Manutenção de Esgoto”.
- **Não há exclusão.** Desativar exige que nenhum usuário com acesso esteja na unidade: o sistema pede para movê-los antes.
- Renomear vale daqui em diante; as PETs já emitidas guardam o nome da época.

### Usuários

- O campo de unidade virou **lista de escolha**, no cadastro e na edição.
- Operacional e verificador **precisam** de unidade.
- Gestor e admin podem ficar sem unidade, como “Empresa toda”.
- Lista de usuários com busca e filtro por unidade.
- Aviso quando há operacionais ou verificadores ainda sem unidade.

### Cadastros antigos (admin)

- Gestão → Unidades → **Cadastros antigos** lista os textos digitados à mão antes da padronização (ex.: “Esgoto”, “esgoto ”, “Manut. Esgoto”), com quantos usuários e PETs há em cada um.
- Para cada texto, o admin escolhe a unidade oficial e toca **Aplicar**, ou **Cria a unidade com esse nome** e aplica.
- Os usuários e as PETs deles passam para a unidade escolhida. Feito uma vez, o quadro some.

### PET

- O servidor grava na PET a **unidade do emissor** no momento do registro; o aparelho não escolhe.
- No formulário, “Nome da unidade” vem **preenchido e travado** com a unidade do cadastro. Quem não tem unidade (gestor/admin) continua digitando.
- O servidor passa a guardar também **data, local, trabalho e supervisor** da PET, só para a lista de conferência. Arquivos, fotos e assinaturas continuam fora do servidor.

## 3. Permissões

| Ação | Operacional | Verificador | Gestor | Admin |
|---|:-:|:-:|:-:|:-:|
| Emitir PET (aparelho autorizado) | ✔ | ✔ | ✔ | ✔ |
| Minhas PETs, pedir autorização do aparelho, trocar a própria senha | ✔ | ✔ | ✔ | ✔ |
| Lista de PETs registradas | — | Só da unidade | Todas, com filtro | Todas, com filtro |
| Consultar PET por número ou código | — | Só da unidade | Todas | Todas |
| Validar PDF + arquivo de validação | — | Unidade: completo · Outra: só autenticidade | Completo | Completo |
| Aparelhos: aprovar, recusar, revogar, reativar | — | — | Operacionais e verificadores | Todos |
| Usuários: cadastrar, editar, redefinir senha, excluir acesso | — | — | Operacionais e verificadores | Todos |
| Unidades: criar, renomear, desativar | — | — | ✔ | ✔ |
| Mapear cadastros antigos | — | — | — | ✔ |
| Auditoria | — | — | ✔ | ✔ |
| `/db-test` | — | — | — | ✔ |

- O verificador vê a aba com o nome **Conferência**: PETs da unidade, validação de documento e consulta por código.
- Gestor e admin veem **Gestão**, dividida em **PETs**, **Usuários** e **Unidades**.
- Todas as regras valem no Worker; a tela só esconde o que o perfil não usa.

## 4. Outras mudanças

- Gestor e admin têm cinco abas. No celular, “Minhas PETs” vira “Minhas” para caber em telas de 360 px.
- Validação de documento de outra unidade, para o verificador: “Documento autêntico”, sem emissor nem detalhes.
- “Consultar código de conferência” ficou recolhido em Gestão → PETs.
- O payload da PET passa a registrar `issuedBy.unitId` e `issuedBy.unitName` (esquema `PET-DIGITAL-NR33/v1.3.0`). PETs antigas continuam validando normalmente.
- Cache do aplicativo: `pet-digital-static-v1.3.0`, com o novo arquivo `app-gestao.js`.

## 5. Compatibilidade

- A migration só **acrescenta** tabela, colunas e índices. Nada é apagado; o texto antigo de unidade continua no banco.
- **Worker e Pages devem ser publicados juntos.** O aplicativo v1.2.0 não envia a unidade no cadastro de operacional/verificador e receberia erro.
- PETs registradas antes da v1.3.0 aparecem na lista com “data e local não ficaram no servidor”. Elas entram na unidade do emissor quando ele recebe uma unidade, pelo mapeamento ou pela edição do cadastro.
