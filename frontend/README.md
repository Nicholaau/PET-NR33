# Frontend — PET-Digital NR-33 v1.1.5

Publique **todos os arquivos desta pasta** no Cloudflare Pages, inclusive `_headers`.

## Ordem dos scripts

O `index.html` carrega:

1. bibliotecas de PDF com SRI;
2. `app-core.js`;
3. `app-system.js`;
4. `app-form.js`;
5. `app-output.js`.

Não altere a ordem dos quatro módulos sem revisar as dependências compartilhadas.

## Dados locais

- rascunho e referências de registros são separados por usuário;
- `localStorage` guarda no máximo 30 referências compactas;
- PDF, comprovante e snapshot completo ficam no IndexedDB;
- chave privada não exportável fica no IndexedDB criptográfico;
- qualquer falha de cota local é mostrada ao usuário;
- logout limpa o estado em memória.

## Segurança do frontend

- `_headers` aplica CSP e outros cabeçalhos no Pages;
- bibliotecas externas possuem SRI;
- Service Worker guarda apenas arquivos estáticos do próprio Pages;
- nenhuma resposta da API ou requisição com Authorization é armazenada offline.
