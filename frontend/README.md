# Frontend — PET-Digital NR-33 v1.1.6

Publique **todos os arquivos desta pasta** no Cloudflare Pages, inclusive `_headers`.

## Ordem dos scripts

O `index.html` carrega apenas arquivos locais:

1. `app-core.js`;
2. `app-system.js`;
3. `app-form.js`;
4. `app-output.js`.

Não existem bibliotecas externas de PDF nesta versão.

## Dados locais

- rascunho e referências de registros são separados por usuário;
- `localStorage` guarda no máximo 30 referências compactas;
- PDF, arquivo de validação (JSON) e snapshot completo ficam temporariamente no IndexedDB;
- chave privada não exportável fica no IndexedDB criptográfico;
- falhas de cota local são mostradas ao usuário;
- logout limpa o estado em memória.

## PDF

O PDF é desenhado com Canvas 2D e montado localmente como PDF 1.4. Nenhum script de CDN é necessário.

## Segurança do frontend

- `_headers` aplica CSP e demais cabeçalhos no Pages;
- `script-src` aceita somente `'self'`;
- Service Worker guarda apenas arquivos estáticos do próprio Pages;
- respostas da API e requisições com `Authorization` nunca são armazenadas offline.
