import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { TicketClient } from "./client.js";
import {
  commentOnTicket,
  createTicket,
  getTicket,
  listAgents,
  listAssignedToMe,
  listMyRequests,
  listTickets,
  searchPeople,
  updateTicket,
} from "./operations.js";

const ticketTypes = ["duvida", "erro", "sugestao", "implementacao"] as const;
const statuses = [
  "backlog",
  "aguardando_requisito",
  "aguardando_disponibilidade",
  "em_progresso",
  "em_revisao",
  "desenvolvimento",
  "concluido",
] as const;
const priorities = ["alta", "media", "baixa"] as const;
const sorts = [
  "created_desc",
  "created_asc",
  "updated_desc",
  "updated_asc",
] as const;

const attachmentSchema = z
  .object({
    fileName: z.string().min(1),
    mimeType: z.string().min(1),
    base64: z.string().min(1).describe("Conteúdo do arquivo em base64"),
  })
  .describe("Até 5 arquivos, 5 MB cada. Imagem, vídeo, áudio ou documento.");

const relatedPerson = z.object({
  id: z
    .string()
    .uuid()
    .describe("uuid do usuário no ERP, vindo de search_people"),
  name: z.string().min(1).max(200),
});

function ok(data: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data) }],
  };
}

function fail(error: unknown) {
  const message = error instanceof Error ? error.message : "Falha na API";
  return {
    isError: true,
    content: [{ type: "text" as const, text: message }],
  };
}

export function registerTools(server: McpServer, client: TicketClient): void {
  server.registerTool(
    "list_my_requests",
    {
      title: "Meus chamados",
      description:
        "Lista os chamados que a pessoa autenticada abriu. Devolve protocolo, assunto, status, responsável e data.",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () => {
      try {
        return ok(listMyRequests(await client.listMyTickets()));
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.registerTool(
    "get_ticket",
    {
      title: "Detalhe do chamado",
      description:
        "Detalhe de um chamado pelo uuid ou pelo protocolo (#CH-0001 ou CH-0001). Solicitante só vê o que abriu ou em que foi marcado. Agente vê qualquer um. Mídia vem em media com uma URL temporária, que vale 1 hora.",
      inputSchema: {
        ticket: z.string().min(1).describe("uuid do chamado ou protocolo"),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ ticket }) => {
      try {
        return ok(await getTicket(client, ticket));
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.registerTool(
    "create_ticket",
    {
      title: "Abrir chamado",
      description:
        "Abre um chamado com um bloco de texto de até 2000 caracteres. attachments é opcional: até 5 arquivos em base64, 5 MB cada (imagem, vídeo, áudio ou documento). Não envia prioridade. relatedPeople usa o id do ERP retornado por search_people, no máximo 20.",
      inputSchema: {
        type: z.enum(ticketTypes),
        text: z.string().describe("Descrição do chamado"),
        relatedPeople: z.array(relatedPerson).max(20).optional(),
        attachments: z.array(attachmentSchema).max(5).optional(),
      },
    },
    async ({ type, text, relatedPeople, attachments }) => {
      try {
        return ok(
          await createTicket(client, { type, text, relatedPeople, attachments }),
        );
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.registerTool(
    "search_people",
    {
      title: "Buscar pessoas",
      description:
        "Busca usuários ativos do ERP por nome para preencher relatedPeople. Devolve id e name.",
      inputSchema: {
        name: z.string().min(1).describe("Parte do nome"),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ name }) => {
      try {
        return ok(await searchPeople(client, name));
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.registerTool(
    "comment_on_ticket",
    {
      title: "Comentar chamado",
      description:
        "Comenta em um chamado acessível. ticket é uuid ou protocolo. Texto até 2000 caracteres. attachments é opcional: até 5 arquivos em base64, 5 MB cada.",
      inputSchema: {
        ticket: z.string().min(1),
        text: z.string(),
        attachments: z.array(attachmentSchema).max(5).optional(),
      },
    },
    async ({ ticket, text, attachments }) => {
      try {
        return ok(await commentOnTicket(client, { ticket, text, attachments }));
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.registerTool(
    "list_assigned_to_me",
    {
      title: "Chamados atribuídos a mim",
      description:
        "Lista todos os chamados atribuídos ao agente autenticado. Solicitante recebe o erro da API.",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () => {
      try {
        return ok(await listAssignedToMe(client));
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.registerTool(
    "list_tickets",
    {
      title: "Painel de chamados",
      description:
        "Lista paginada do painel, só para agente. status aceita um status real ou em_andamento. assigneeId aceita uuid ou unassigned. sort padrão é created_desc.",
      inputSchema: {
        q: z.string().optional(),
        requester: z.string().optional(),
        assigneeId: z.string().optional().describe("uuid ou unassigned"),
        priority: z.enum(priorities).optional(),
        type: z.enum(ticketTypes).optional(),
        status: z.enum([...statuses, "em_andamento"]).optional(),
        sort: z.enum(sorts).optional(),
        page: z.number().int().positive().default(1),
        pageSize: z.number().int().positive().max(50).default(10),
      },
      annotations: { readOnlyHint: true },
    },
    async (filters) => {
      try {
        return ok(await listTickets(client, filters));
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.registerTool(
    "update_ticket",
    {
      title: "Atualizar chamado",
      description:
        "Atualiza status, prioridade, responsável ou branch. Só agente. Pelo menos um campo. assigneeId tem de existir em list_agents; null desatribui. Não cria issue no GitHub.",
      inputSchema: {
        ticket: z.string().min(1).describe("uuid ou protocolo"),
        status: z.enum(statuses).optional(),
        priority: z.enum(priorities).nullable().optional(),
        assigneeId: z.string().uuid().nullable().optional(),
        gitBranch: z.string().max(200).nullable().optional(),
      },
    },
    async (input) => {
      try {
        return ok(await updateTicket(client, input));
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.registerTool(
    "list_agents",
    {
      title: "Listar agentes",
      description:
        "Agentes do help desk (id, name, initials) para atribuir um chamado. Ignora vínculo com GitHub.",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () => {
      try {
        return ok(await listAgents(client));
      } catch (error) {
        return fail(error);
      }
    },
  );
}

export function createMcpServer(client: TicketClient): McpServer {
  const server = new McpServer(
    { name: "ticket-helpdesk", version: "0.1.0" },
    {
      capabilities: { tools: {} },
      instructions:
        "Opera o Help Desk em nome de quem enviou o Bearer tk_. Protocolo #CH-0001 ou CH-0001 vira o uuid nas rotas. Não crie issue no GitHub. Texto de chamado ou comentário tem no máximo 2000 caracteres. Anexos vão em base64, no máximo 5 arquivos de 5 MB.",
    },
  );
  registerTools(server, client);
  return server;
}
