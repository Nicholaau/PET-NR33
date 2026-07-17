# PET-Digital NR-33 v1.1.3 — alterações

## Usuários
- Editar nome, matrícula, e-mail, unidade, perfil e situação.
- Redefinir senha com senha temporária e encerramento de sessões anteriores.
- Excluir acesso de forma lógica, preservando histórico probatório.
- Gestor administra somente operacional e verificador.
- Admin administra todos os perfis, inclusive outros admins.
- Proteção para impedir exclusão da própria conta e manter ao menos um admin ativo.

## Dispositivos
- Removida a aba duplicada “Dispositivo”.
- Um botão cria a proteção local e envia a solicitação.
- Operacional/verificador aguardam uma única aprovação de gestor/admin.
- Gestor/admin têm autorização automática para o próprio aparelho.
- Aprovação é imediata e idempotente; tentativas duplicadas não criam outro registro.
- Dispositivo vinculado a outro usuário é bloqueado.

## Senhas
- Usuário criado ou com senha redefinida deve alterar a senha temporária antes da emissão oficial.
