import { randomUUID } from "node:crypto";

import {
  TicketApiError,
  TicketClient,
  assertText,
  type AdminTicket,
  type AdminTicketPage,
  type AdminTicketQuery,
  type ContentBlock,
  type RelatedPerson,
  type TicketDetail,
  type UpdateTicketBody,
} from "./client.js";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const ADMIN_PAGE_SIZE = 50;

export function protocolKey(value: string): string {
  return value.trim().replace(/^#/, "").toUpperCase();
}

export function isUuid(value: string): boolean {
  return UUID.test(value.trim());
}

export async function resolveTicketId(
  client: TicketClient,
  ticket: string,
): Promise<string> {
  const trimmed = ticket.trim();
  if (isUuid(trimmed)) return trimmed;

  const wanted = protocolKey(trimmed);
  const mine = await client.listMyTickets();
  const own = mine.tickets.find(
    (item) => protocolKey(item.protocol) === wanted,
  );
  if (own) return own.id;

  const me = await client.me();
  if (me.role !== "agent") {
    throw new TicketApiError("Protocolo não encontrado", 404, "NOT_FOUND");
  }

  const found = await findInAdminPages(client, wanted);
  if (!found) {
    throw new TicketApiError("Protocolo não encontrado", 404, "NOT_FOUND");
  }
  return found;
}

async function findInAdminPages(
  client: TicketClient,
  wanted: string,
): Promise<string | null> {
  let page = 1;
  let seen = 0;
  let total = 0;

  do {
    const data = await client.listAdminTickets({
      page,
      pageSize: ADMIN_PAGE_SIZE,
    });
    const hit = data.tickets.find(
      (item) => protocolKey(item.protocol) === wanted,
    );
    if (hit) return hit.id;
    seen += data.tickets.length;
    total = data.total;
    if (data.tickets.length === 0) break;
    page += 1;
  } while (seen < total);

  return null;
}

export function listMyRequests(data: {
  tickets: {
    protocol: string;
    subject: string;
    status: string;
    createdAt: string;
    assignee: { name: string } | null;
  }[];
  stats: Record<string, number>;
}) {
  return {
    tickets: data.tickets.map((ticket) => ({
      protocol: ticket.protocol,
      subject: ticket.subject,
      status: ticket.status,
      assignee: ticket.assignee?.name ?? null,
      createdAt: ticket.createdAt,
    })),
    stats: data.stats,
  };
}

export function textFromBlocks(blocks: ContentBlock[] | undefined): string {
  if (!blocks?.length) return "";
  return blocks
    .map((block) =>
      block.type === "text" && "content" in block ? block.content : "há mídia",
    )
    .join("\n");
}

export function presentTicket(ticket: TicketDetail) {
  return {
    protocol: ticket.protocol,
    type: ticket.type,
    status: ticket.status,
    priority: ticket.priority ?? null,
    subject: ticket.subject,
    requester: ticket.requester?.name ?? null,
    assignee: ticket.assignee?.name ?? null,
    relatedPeople: (ticket.relatedPeople ?? []).map((person) => ({
      id: person.id,
      name: person.name,
    })),
    description: textFromBlocks(ticket.blocks),
    comments: (ticket.comments ?? []).map((comment) => ({
      author: comment.author.name,
      role: comment.author.role,
      createdAt: comment.createdAt,
      text: comment.blocks?.length
        ? textFromBlocks(comment.blocks)
        : comment.content,
    })),
    events: (ticket.events ?? []).map((event) => ({
      title: event.title,
      description: event.description,
      createdAt: event.createdAt,
    })),
  };
}

export function presentAdminTicket(ticket: AdminTicket) {
  return {
    id: ticket.id,
    protocol: ticket.protocol,
    type: ticket.type,
    status: ticket.status,
    priority: ticket.priority,
    subject: ticket.subject,
    createdAt: ticket.createdAt,
    requester: ticket.requester,
    assignee: ticket.assignee,
  };
}

export function presentAdminPage(page: AdminTicketPage) {
  return {
    tickets: page.tickets.map(presentAdminTicket),
    total: page.total,
    page: page.page,
    pageSize: page.pageSize,
  };
}

export function textBlock(content: string) {
  return { id: randomUUID(), type: "text" as const, content };
}

export async function getTicket(client: TicketClient, ticket: string) {
  const id = await resolveTicketId(client, ticket);
  const detail = await client.getTicket(id);
  return presentTicket(detail);
}

export async function createTicket(
  client: TicketClient,
  input: { type: string; text: string; relatedPeople?: RelatedPerson[] },
) {
  const content = assertText(input.text, "Descrição vazia");
  const relatedPeople = input.relatedPeople ?? [];
  if (relatedPeople.length > 20) {
    throw new TicketApiError(
      "No máximo 20 pessoas relacionadas",
      400,
      "TOO_MANY_PEOPLE",
    );
  }

  const created = await client.createTicket({
    type: input.type,
    blocks: [textBlock(content)],
    ...(relatedPeople.length > 0 ? { relatedPeople } : {}),
  });

  return {
    id: created.id,
    protocol: created.protocol,
    type: created.type,
    status: created.status,
    subject: created.subject,
    createdAt: created.createdAt,
  };
}

export async function commentOnTicket(
  client: TicketClient,
  input: { ticket: string; text: string },
) {
  const content = assertText(input.text, "Resposta vazia");
  const id = await resolveTicketId(client, input.ticket);
  return client.comment(id, { blocks: [textBlock(content)] });
}

export async function listAssignedToMe(client: TicketClient) {
  const me = await client.me();
  const tickets: AdminTicket[] = [];
  let page = 1;
  let seen = 0;
  let total = 0;

  do {
    const data = await client.listAdminTickets({
      assigneeId: me.id,
      page,
      pageSize: ADMIN_PAGE_SIZE,
    });
    tickets.push(...data.tickets);
    seen += data.tickets.length;
    total = data.total;
    if (data.tickets.length === 0) break;
    page += 1;
  } while (seen < total);

  return { tickets: tickets.map(presentAdminTicket) };
}

export async function listTickets(
  client: TicketClient,
  filters: AdminTicketQuery,
) {
  const page = await client.listAdminTickets({
    ...filters,
    page: filters.page ?? 1,
    pageSize: Math.min(50, Math.max(1, filters.pageSize ?? 10)),
  });
  return presentAdminPage(page);
}

export async function updateTicket(
  client: TicketClient,
  input: { ticket: string } & UpdateTicketBody,
) {
  const { ticket, ...patch } = input;
  const fields = [
    patch.status,
    patch.priority,
    patch.assigneeId,
    patch.gitBranch,
  ];
  if (fields.every((field) => field === undefined)) {
    throw new TicketApiError(
      "Informe ao menos um campo para atualizar",
      400,
      "EMPTY_UPDATE",
    );
  }
  if (patch.gitBranch && patch.gitBranch.length > 200) {
    throw new TicketApiError(
      "Branch excede 200 caracteres",
      400,
      "BRANCH_TOO_LONG",
    );
  }
  if (patch.assigneeId) {
    const { agents } = await client.listAgents();
    const known = agents.some((agent) => agent.id === patch.assigneeId);
    if (!known) {
      throw new TicketApiError(
        "Responsável não encontrado. Consulte list_agents.",
        400,
        "UNKNOWN_ASSIGNEE",
      );
    }
  }

  const id = await resolveTicketId(client, ticket);
  return client.updateTicket(id, patch);
}

export async function listAgents(client: TicketClient) {
  const { agents } = await client.listAgents();
  return {
    agents: agents.map((agent) => ({
      id: agent.id,
      name: agent.name,
      initials: agent.initials,
    })),
  };
}

export async function searchPeople(client: TicketClient, name: string) {
  const { users } = await client.searchPeople(name);
  return {
    users: users.map((user) => ({ id: user.id, name: user.name })),
  };
}
