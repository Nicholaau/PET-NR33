# Frontend — PET-Digital NR-33 v1.2.0

Publique **todos os arquivos desta pasta** no Cloudflare Pages, inclusive `_headers`.

## Ordem dos scripts

O `index.html` carrega apenas arquivos locais, nesta ordem:

1. `app-core.js` — constantes, armazenamento, criptografia, avisos na tela, tentativa pendente;
2. `app-system.js` — sessão, conta, aparelho, gestão e chamadas da API;
3. `app-form.js` — etapas, checklist, medições, equipe, assinatura, revisão e emissão;
4. `app-output.js` — PDF, arquivo de validação, Minhas PETs, validação e inicialização.

Não há bibliotecas externas.

## Dados no aparelho

- **Sessão:** `localStorage`, até a validade informada pelo servidor (8 h).
- **Rascunho:** `localStorage`, separado por usuário; salvo a cada alteração e ao sair do app.
- **Tentativa pendente:** ponteiro em `localStorage` (`petDigitalPendingAttemptV1:<usuário>`), para reenviar sem duplicar.
- **Minhas PETs:** até 30 referências compactas em `localStorage`.
- **PDF, arquivo de validação e cópia completa da PET:** IndexedDB, temporariamente.
- **Chave de assinatura:** IndexedDB, não exportável.

## Segurança

- `_headers` aplica CSP e demais cabeçalhos; `script-src` e `style-src` aceitam só `'self'` (por isso não há estilo inline).
- O Service Worker guarda apenas arquivos estáticos; respostas da API nunca ficam offline.
- Cache atual: `pet-digital-static-v1.2.0`.

## Regra do checklist

Os 22 itens exigem resposta. Sim, Não e N/A não bloqueiam a emissão por si só. N/A exige justificativa, sem mínimo de caracteres.
