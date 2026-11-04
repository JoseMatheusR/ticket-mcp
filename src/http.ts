import { createServer, type Server } from "node:http";

import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express, { type Express } from "express";

import { readBearerToken } from "./auth.js";
import { TicketClient } from "./client.js";
import { loadConfig, type Config } from "./config.js";
import { createMcpServer } from "./tools.js";

const METHOD_NOT_ALLOWED = {
  jsonrpc: "2.0",
  error: {
    code: -32000,
    message: "Method not allowed. Use POST for MCP requests.",
  },
  id: null,
};

export function createApp(config: Config): Express {
  const app = express();
  app.use(express.json());

  app.get("/health", (_request, response) => {
    response.json({ status: "ok" });
  });

  app.post("/mcp", async (request, response) => {
    const token = readBearerToken(request.header("authorization"));
    if (!token) {
      response.status(401).json({
        jsonrpc: "2.0",
        error: { code: -32001, message: "Token ausente ou inválido" },
        id: null,
      });
      return;
    }

    const client = new TicketClient({
      baseUrl: config.ticketApiUrl,
      token,
    });
    const server = createMcpServer(client);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });

    response.on("close", () => {
      void transport.close();
      void server.close();
    });

    try {
      await server.connect(transport);
      await transport.handleRequest(request, response, request.body);
    } catch (error) {
      if (response.headersSent) return;
      const message = error instanceof Error ? error.message : "Falha no MCP";
      response.status(500).json({
        jsonrpc: "2.0",
        error: { code: -32603, message },
        id: null,
      });
    }
  });

  const methodNotAllowed = (_request: express.Request, response: express.Response) => {
    response.status(405).json(METHOD_NOT_ALLOWED);
  };
  app.get("/mcp", methodNotAllowed);
  app.delete("/mcp", methodNotAllowed);

  return app;
}

export function listen(config: Config = loadConfig()): Server {
  return createServer(createApp(config)).listen(config.port);
}
