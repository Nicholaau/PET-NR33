# Instalação e teste — PET-Digital v1.1.6

## 1. D1

Se a v1.1.5 já está operando e `0004_hardening_v115.sql` foi executada, **não há migration nova**.

Confirmação rápida:

```sql
SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;
PRAGMA table_info(pet_records);
```

## 2. Worker

No Worker `pet-digital-api`, substitua o código atual por:

`worker-pet-digital-api-v1.1.6.js`

ou use `worker/src/index.js`.

Faça deploy e teste:

- `https://pet-digital-api.nicholas-dmae.workers.dev/health`
- `https://pet-digital-api.nicholas-dmae.workers.dev/db-test`

O `/health` deve indicar DB e secrets configurados.

## 3. Pages

Publique todo o conteúdo de `frontend/` em `https://pet-digital.pages.dev`.

Não publique somente `index.html`: são necessários os quatro arquivos `app-*.js`, `_headers`, `sw.js`, CSS, manifesto e logo.

## 4. Cache

O cache esperado é:

`pet-digital-static-v1.1.6`

A v1.1.6 remove caches anteriores durante instalação/ativação do Service Worker.

## 5. Roteiro de homologação

1. Login válido e inválido; verifique botão `Entrando...` e bloqueio de clique.
2. Preencha uma etapa parcialmente e clique em Próxima; confirme foco no primeiro erro.
3. Checklist: teste Sim, Não e N/A; N/A deve abrir justificativa.
4. Teste N em condição impeditiva: deve ser possível registrar/avançar com alerta, mas a emissão deve ser bloqueada no final.
5. Teste gases negativos: deve bloquear.
6. Teste detector vencido: deve bloquear.
7. Cadastre supervisor apenas na Equipe; confira preenchimento automático na Identificação/PDF.
8. Capture fotos com rosto e crachá e registre todas as assinaturas.
9. Finalize uma PET em rede estável; PDF + JSON devem ser gerados e registrados.
10. Simule falha de rede depois da geração dos arquivos; só então deve aparecer repetição pendente.
11. Tente clicar repetidamente em Finalizar; não deve criar nova PET.
12. Valide PDF + JSON em conta verificador/gestor/admin.
13. Confira visual do PDF com vários participantes.
14. Compartilhe PDF e JSON pelo menu nativo do celular.
