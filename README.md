# PET Digital — NR-33 — DMAE

Versão: 1.0.5

Aplicação PWA estática para preenchimento de Permissão de Entrada e Trabalho (PET) em espaços confinados, com foto dos participantes, assinatura manuscrita em tela, hash SHA-256, assinatura criptográfica local ECDSA P-256, prova de geração do PDF e validação por dossiê JSON.


## Alterações da versão 1.0.5

- Adicionada verificação real do canvas antes de registrar assinatura: canvas vazio ou com marca acidental muito pequena não é aceito.
- Assinaturas agora salvam métricas mínimas de validação do traço, além do hash da imagem.
- Todos os entrantes/vigias adicionados passam a ser tratados como participantes obrigatórios da PET: nome, matrícula, foto e assinatura são exigidos para cada cartão exibido.
- Se o usuário alterar o formulário após finalizar a PET, os botões de PDF/JSON são desabilitados até nova validação/finalização, evitando compartilhar dossiê antigo.
- Incluídos avisos contra uso não intencional: matrícula repetida, divergência entre nome do supervisor no cabeçalho e no cartão de assinatura, detector sem identificação/calibração informada, e assinatura alterada no canvas sem novo registro.
- Cache do Service Worker atualizado para `v1.0.5`.

## Alterações da versão 1.0.4

- Incluídos botões de **Compartilhar PDF** e **Compartilhar JSON** usando a Web Share API quando suportada pelo navegador.
- O compartilhamento do JSON cria um arquivo `.json` em memória e abre a folha nativa de compartilhamento do celular.
- O compartilhamento do PDF tenta gerar um arquivo PDF real no navegador com `html2canvas`/`jsPDF`; se o navegador/rede não permitir, mantém o fallback de impressão/salvar PDF.
- O nome sugerido para o PDF foi customizado com número da PET, data, local e identificador do registro.
- O nome do JSON também foi padronizado para acompanhar o PDF.
- Ajustado o layout da aba **Chave** para quebrar hashes longos sem sair da tela.
- Ajustado o layout da aba **Registros** para quebrar hashes longos nos cartões.
- Ajustada a seção **Medições de gases perigosos** em celular: a tabela vira cartões verticais, eliminando rolagem lateral.
- Rodapé/interface com linguagem mais operacional, sem referência visual a ambiente de desenvolvimento.
- Cache do Service Worker atualizado para `v1.0.4`.

## Alterações da versão 1.0.3

- Incluída a logomarca do DMAE na interface e no PDF.
- Ajustada a apresentação visual para ficar mais próxima de ambiente operacional.
- Removidos textos de interface que tratavam a aplicação como ambiente preliminar.
- Incluído no dossiê JSON o padrão técnico de validação usado pelo aplicativo:
  - perfil de validação;
  - versão do schema;
  - regra de JSON canônico;
  - algoritmo de hash;
  - algoritmo de assinatura;
  - formato da chave pública;
  - formato das assinaturas e imagens.
- O padrão técnico passou a entrar no payload assinado, de modo que sua alteração posterior invalida o hash.
- O validador passou a conferir se o dossiê usa o padrão técnico aceito pela aplicação, sem confiar cegamente no algoritmo declarado no próprio arquivo.
- O PDF passou a exibir código de conferência e resumo do padrão de validação, reforçando que a verificação técnica completa exige o JSON correspondente.
- Cache do Service Worker atualizado para `v1.0.3`, incluindo a logomarca no app shell offline.

## Alterações da versão 1.0.2

- Incluída captura/seleção de foto para entrantes, vigias e supervisor.
- Foto, assinatura, data/hora da assinatura, nome e matrícula entram no hash do dossiê.
- O PDF exibe a foto do servidor ao lado da assinatura.
- O botão **Gerar PDF com prova** coleta data/hora, IP público e geolocalização no momento da geração do PDF.
- A prova de geração do PDF recebe hash SHA-256 próprio e assinatura criptográfica ECDSA P-256.
- A tela **Validar** verifica também o hash e a assinatura da prova de geração do PDF, quando ela existir no JSON.

Observação: IP público depende de conexão com internet. Geolocalização depende de HTTPS/localhost, permissão do usuário e disponibilidade do GPS/rede do dispositivo.

## Alterações da versão 1.0.1

- Removido o campo manual de número da PET; o número agora é gerado automaticamente ao finalizar o registro.
- Removido o campo de número do espaço confinado.
- Removida a coleta/campo de localização GPS no formulário.
- Relação de profissionais iniciando com 1 entrante, 1 vigia e 1 supervisor.
- Incluídos botões para adicionar novos entrantes e novos vigias conforme a necessidade da equipe.

## Arquivos incluídos

- `index.html`: tela principal do aplicativo.
- `styles.css`: layout responsivo e modelo de impressão A4 paisagem.
- `app.js`: regras de validação, assinaturas, hash, exportação JSON e verificação.
- `sw.js`: Service Worker com cache versionado para uso offline.
- `manifest.json`: manifesto PWA.
- `logo-dmae-2026.png`: logomarca utilizada na interface e no PDF.

## Como usar localmente

1. Extraia o ZIP.
2. Abra a pasta em um servidor local. Exemplo:
   ```bash
   python3 -m http.server 8080
   ```
3. Acesse `http://localhost:8080`.
4. Preencha a PET, registre as fotos, colete as assinaturas, clique em **Validar** e depois em **Finalizar e assinar PET**.
5. Clique em **Gerar PDF com prova**.
6. Exporte o **dossiê JSON** e salve o PDF gerado pelo navegador.

## Como publicar no Cloudflare Pages

1. Crie um projeto no Cloudflare Pages.
2. Faça upload desta pasta ou conecte a um repositório Git contendo estes arquivos.
3. Build command: deixe em branco.
4. Output directory: `/` ou a pasta que contém os arquivos.
5. Publique.

## Estrutura probatória

O aplicativo gera um dossiê JSON contendo:

- dados preenchidos da PET;
- checklist;
- medições de gases;
- fotos dos participantes;
- assinaturas manuscritas em Base64;
- data/hora das fotos e assinaturas;
- padrão técnico de validação;
- hash SHA-256 do payload;
- assinatura criptográfica ECDSA P-256 do hash;
- chave pública para verificação;
- prova de geração do PDF, com data/hora, IP público, geolocalização, hash próprio e assinatura criptográfica.

Na tela **Validar**, o aplicativo recalcula o hash do JSON, confere o padrão técnico declarado e verifica as assinaturas criptográficas. Se qualquer dado, foto, assinatura desenhada ou prova do PDF for alterado, a validação falha.

## Observações institucionais

Para conferência técnica completa, mantenha sempre o par:

- PDF: via visual do documento;
- JSON: dossiê probatório usado para validação.

A aplicação foi estruturada para funcionar sem login e sem banco de dados, adequada à publicação estática no Cloudflare Pages. A validação jurídica, de segurança do trabalho e de guarda documental deve ser feita pelas áreas competentes antes do uso oficial como procedimento institucional.
