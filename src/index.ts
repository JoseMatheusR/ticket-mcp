import { listen } from "./http.js";

const server = listen();

server.on("listening", () => {
  const address = server.address();
  const port = address && typeof address === "object" ? address.port : "";
  console.log(`ticket-mcp listening on ${port}`);
});
