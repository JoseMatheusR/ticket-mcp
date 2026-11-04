# MCP Help Desk

Servidor MCP que opera o Help Desk em nome de uma pessoa. Cada ferramenta chama a API HTTP do app. Este processo não acessa o banco e não guarda um token único.

## Configuração

```bash
cp .env.example .env
```

- `TICKET_API_URL`: origem do Help Desk, sem barra no final.
- `PORT`: porta deste processo. O padrão é `3000`.

O token é o `tk_...` que cada pessoa gera em `/integracao`. O bot guarda esse token ligado ao usuário do chat e envia em toda chamada:

```http
POST /mcp
Authorization: Bearer tk_...
Accept: application/json, text/event-stream
Content-Type: application/json
```

Sem `Bearer tk_`, a resposta é 401 e a API do Help Desk não é chamada. `GET /health` só diz se o processo está no ar. `GET` e `DELETE` em `/mcp` respondem 405.

```bash
npm install
npm test
npm run dev
```

## Ferramentas

| Tool | Quem | API |
| --- | --- | --- |
| `list_my_requests` | quem autenticou | `GET /api/tickets` |
| `get_ticket` | solicitante no que pode ver; agente em qualquer um | `GET /api/tickets/:id` |
| `create_ticket` | quem autenticou | `POST /api/tickets` |
| `search_people` | quem autenticou | `GET /api/erp/users/basic?name=` |
| `comment_on_ticket` | quem acessa o chamado | `POST /api/tickets/:id/comments` |
| `list_assigned_to_me` | agente | `GET /api/me` e `GET /api/admin/tickets?assigneeId=` |
| `list_tickets` | agente | `GET /api/admin/tickets` |
| `update_ticket` | agente | `PATCH /api/admin/tickets/:id` |
| `list_agents` | agente | `GET /api/admin/agents` |

O argumento `ticket` aceita o uuid ou o protocolo (`#CH-0001` ou `CH-0001`). Se não for uuid, o servidor procura em `list_my_requests` e, para agente, nas páginas do painel.

Texto de descrição ou comentário tem no máximo 2000 caracteres. `create_ticket` e `comment_on_ticket` aceitam até 5 anexos em base64, de 5 MB cada. O servidor pede a URL assinada em `POST /api/media/upload-url` e envia o arquivo para o storage. Na leitura, o texto usa `[mídia 1]`, `[mídia 2]` na ordem dos blocos e `get_ticket` devolve a URL temporária em `media` com o mesmo índice. Essa URL do Spaces vale 1 hora. Não há ferramenta de issue no GitHub nem de gerar ou revogar token.

Papel vem do token. Quando a API responde 403 ou 404, a ferramenta devolve `error.message`.

`list_assigned_to_me` depende de `GET /api/me` no Help Desk, que devolve `{ data: { id, name, email, role } }`.
