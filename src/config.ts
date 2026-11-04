export type Config = {
  ticketApiUrl: string;
  port: number;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const ticketApiUrl = env.TICKET_API_URL?.trim().replace(/\/$/, "");
  if (!ticketApiUrl) {
    throw new Error("TICKET_API_URL é obrigatório");
  }

  const port = Number(env.PORT ?? 3000);
  if (!Number.isInteger(port) || port <= 0) {
    throw new Error("PORT inválida");
  }

  return { ticketApiUrl, port };
}
