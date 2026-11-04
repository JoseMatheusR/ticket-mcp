import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { readBearerToken } from "./auth.js";
import { TicketApiError, TicketClient, assertText } from "./client.js";
import { loadConfig } from "./config.js";
import {
  createTicket,
  getTicket,
  listAssignedToMe,
  presentTicket,
  protocolKey,
  resolveTicketId,
  updateTicket,
} from "./operations.js";

const TOKEN = "tk_test-token";
const BASE = "http://helpdesk.test";

const AGENT_ID = "11111111-1111-4111-8111-111111111111";
const TICKET_ID = "22222222-2222-4222-8222-222222222222";
const OTHER_ID = "33333333-3333-4333-8333-333333333333";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function client(
  handler: (url: string, init: RequestInit | undefined) => Response | Promise<Response>,
) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    calls.push({ url, init });
    return handler(url, init);
  };
  return {
    calls,
    api: new TicketClient({ baseUrl: BASE, token: TOKEN, fetchImpl }),
  };
}

describe("config e token", () => {
  it("exige TICKET_API_URL e tira a barra final", () => {
    assert.equal(
      loadConfig({ TICKET_API_URL: "http://localhost:3000/" }).ticketApiUrl,
      "http://localhost:3000",
    );
    assert.throws(() => loadConfig({}), /TICKET_API_URL/);
  });

  it("aceita só Bearer tk_", () => {
    assert.equal(readBearerToken(undefined), null);
    assert.equal(readBearerToken("Bearer hbt_abc"), null);
    assert.equal(readBearerToken("Bearer tk_abc"), "tk_abc");
  });
});

describe("protocolo", () => {
  it("compara sem #", () => {
    assert.equal(protocolKey("#CH-0001"), protocolKey("ch-0001"));
  });

  it("acha o chamado aberto pela pessoa", async () => {
    const { api, calls } = client((url) => {
      assert.match(url, /\/api\/tickets$/);
      return json({
        data: {
          tickets: [
            {
              id: TICKET_ID,
              protocol: "#CH-0007",
              type: "erro",
              status: "backlog",
              subject: "Tela branca",
              createdAt: "01/01/2026",
              assignee: null,
            },
          ],
          stats: {},
        },
      });
    });

    assert.equal(await resolveTicketId(api, "CH-0007"), TICKET_ID);
    assert.equal(calls.length, 1);
  });

  it("não chama o detalhe quando o protocolo não existe", async () => {
    const { api } = client((url) => {
      if (url.endsWith("/api/tickets")) {
        return json({ data: { tickets: [], stats: {} } });
      }
      if (url.endsWith("/api/me")) {
        return json({
          data: {
            id: AGENT_ID,
            name: "Ana",
            email: "ana@habit.com",
            role: "requester",
          },
        });
      }
      throw new Error(`não deveria chamar ${url}`);
    });

    await assert.rejects(
      () => resolveTicketId(api, "#CH-9999"),
      (error: unknown) => {
        assert.ok(error instanceof TicketApiError);
        assert.equal(error.message, "Protocolo não encontrado");
        return true;
      },
    );
  });

  it("agente procura nas páginas do painel", async () => {
    const { api } = client((url) => {
      if (url.endsWith("/api/tickets")) {
        return json({ data: { tickets: [], stats: {} } });
      }
      if (url.endsWith("/api/me")) {
        return json({
          data: {
            id: AGENT_ID,
            name: "Ana",
            email: "ana@habit.com",
            role: "agent",
          },
        });
      }
      if (url.includes("page=2")) {
        return json({
          data: {
            tickets: [
              adminTicket(OTHER_ID, "#CH-0002"),
            ],
            total: 51,
            page: 2,
            pageSize: 50,
          },
        });
      }
      return json({
        data: {
          tickets: [adminTicket(TICKET_ID, "#CH-0001")],
          total: 51,
          page: 1,
          pageSize: 50,
        },
      });
    });

    assert.equal(await resolveTicketId(api, "#CH-0002"), OTHER_ID);
  });
});

describe("cliente HTTP", () => {
  it("repassa Bearer e devolve error.message", async () => {
    const { api, calls } = client(() =>
      json(
        { error: { code: "FORBIDDEN", message: "Acesso restrito a agentes" } },
        403,
      ),
    );

    await assert.rejects(() => api.listAgents(), (error: unknown) => {
      assert.ok(error instanceof TicketApiError);
      assert.equal(error.message, "Acesso restrito a agentes");
      assert.equal(error.status, 403);
      return true;
    });

    const headers = calls[0].init?.headers as Record<string, string>;
    assert.equal(headers.Authorization, `Bearer ${TOKEN}`);
    assert.equal(headers.Accept, "application/json");
  });

  it("recusa texto vazio ou acima de 2000", () => {
    assert.throws(() => assertText("   ", "Descrição vazia"), /Descrição vazia/);
    assert.throws(
      () => assertText("a".repeat(2001), "Descrição vazia"),
      /2000/,
    );
  });
});

describe("chamados", () => {
  it("omite URL de issue e descreve mídia sem baixar", () => {
    const view = presentTicket({
      id: TICKET_ID,
      protocol: "#CH-0001",
      type: "erro",
      status: "backlog",
      priority: "alta",
      subject: "Anexo",
      createdAt: "01/01/2026",
      requester: { name: "José" },
      assignee: { name: "Ana" },
      relatedPeople: [{ id: AGENT_ID, name: "Ana" }],
      blocks: [
        { type: "text", content: "Olha isso" },
        { type: "image", url: "https://cdn.example/signed" },
      ],
      comments: [
        {
          id: "c1",
          content: "resumo",
          createdAt: "02/01/2026",
          author: { name: "Ana", role: "agent" },
          blocks: [{ type: "video", url: "https://cdn.example/video" }],
        },
      ],
      events: [
        {
          title: "Chamado criado",
          description: "José abriu",
          createdAt: "01/01/2026",
        },
      ],
      githubIssueUrl: "https://github.com/habit/ticket/issues/1",
      gitBranch: "feat/x",
    });

    const encoded = JSON.stringify(view);
    assert.equal(view.description, "Olha isso\nhá mídia");
    assert.equal(view.comments[0].text, "há mídia");
    assert.doesNotMatch(encoded, /github\.com|cdn\.example|feat\/x/);
  });

  it("get_ticket usa o uuid resolvido", async () => {
    const { api, calls } = client((url) => {
      if (url.endsWith("/api/tickets")) {
        return json({
          data: {
            tickets: [
              {
                id: TICKET_ID,
                protocol: "#CH-0004",
                type: "duvida",
                status: "backlog",
                subject: "Dúvida",
                createdAt: "01/01/2026",
                assignee: null,
              },
            ],
            stats: { backlog: 1 },
          },
        });
      }
      return json({
        data: {
          id: TICKET_ID,
          protocol: "#CH-0004",
          type: "duvida",
          status: "backlog",
          subject: "Dúvida",
          createdAt: "01/01/2026",
          requester: { name: "José" },
          assignee: null,
          blocks: [{ type: "text", content: "Como faço?" }],
          comments: [],
          events: [],
        },
      });
    });

    const detail = await getTicket(api, "#CH-0004");
    assert.equal(detail.protocol, "#CH-0004");
    assert.equal(detail.description, "Como faço?");
    assert.match(calls[1].url, new RegExp(`/api/tickets/${TICKET_ID}$`));
  });

  it("create_ticket manda um bloco de texto e não chama a API se o texto estoura", async () => {
    const { api, calls } = client(async (_url, init) => {
      const body = JSON.parse(String(init?.body)) as {
        type: string;
        blocks: { id: string; type: string; content: string }[];
        priority?: string;
      };
      assert.equal(body.type, "erro");
      assert.equal(body.priority, undefined);
      assert.equal(body.blocks.length, 1);
      assert.equal(body.blocks[0].type, "text");
      assert.equal(body.blocks[0].content, "Caiu a tela");
      assert.match(
        body.blocks[0].id,
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      );
      return json({
        data: {
          id: TICKET_ID,
          protocol: "#CH-0010",
          type: "erro",
          status: "backlog",
          subject: "Caiu a tela",
          createdAt: "01/01/2026",
        },
      });
    });

    const created = await createTicket(api, {
      type: "erro",
      text: "Caiu a tela",
    });
    assert.equal(created.protocol, "#CH-0010");
    assert.equal(calls.length, 1);

    await assert.rejects(() =>
      createTicket(api, { type: "erro", text: "x".repeat(2001) }),
    );
    assert.equal(calls.length, 1);
  });

  it("pagina atribuídos até cobrir o total", async () => {
    const pages: number[] = [];
    const { api } = client((url) => {
      if (url.endsWith("/api/me")) {
        return json({
          data: {
            id: AGENT_ID,
            name: "Ana",
            email: "ana@habit.com",
            role: "agent",
          },
        });
      }
      const page = Number(new URL(url).searchParams.get("page"));
      pages.push(page);
      const first = page === 1;
      return json({
        data: {
          tickets: [
            adminTicket(first ? TICKET_ID : OTHER_ID, first ? "#CH-0001" : "#CH-0002"),
          ],
          total: 2,
          page,
          pageSize: 50,
          githubIssueUrl: "https://github.com/habit/ticket/issues/9",
        },
      });
    });

    const result = await listAssignedToMe(api);
    assert.deepEqual(pages, [1, 2]);
    assert.equal(result.tickets.length, 2);
    assert.equal(JSON.stringify(result).includes("github.com"), false);
  });

  it("recusa responsável que não está em list_agents", async () => {
    let patched = false;
    const { api } = client((url, init) => {
      if (url.endsWith("/api/admin/agents")) {
        return json({
          data: {
            agents: [
              {
                id: AGENT_ID,
                name: "Ana",
                initials: "AN",
                githubUsername: "ana",
              },
            ],
          },
        });
      }
      if (init?.method === "PATCH") patched = true;
      return json({ data: { tickets: [], stats: {} } });
    });

    await assert.rejects(
      () =>
        updateTicket(api, {
          ticket: TICKET_ID,
          assigneeId: OTHER_ID,
        }),
      /list_agents/,
    );
    assert.equal(patched, false);
  });
});

function adminTicket(id: string, protocol: string) {
  return {
    id,
    protocol,
    type: "erro",
    status: "em_progresso",
    priority: "media",
    subject: protocol,
    createdAt: "01/01/2026",
    requester: { name: "José" },
    assignee: { id: AGENT_ID, name: "Ana" },
    githubIssueUrl: "https://github.com/habit/ticket/issues/1",
  };
}
