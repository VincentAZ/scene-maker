// Minimal stdio MCP server used to verify the studio engineer's MCP wiring.
import { createInterface } from "node:readline";
const send = (message) => process.stdout.write(JSON.stringify(message) + "\n");
createInterface({ input: process.stdin }).on("line", (line) => {
  if (!line.trim()) return;
  const message = JSON.parse(line);
  const reply = (result) => send({ jsonrpc: "2.0", id: message.id, result });
  switch (message.method) {
    case "initialize":
      return reply({
        protocolVersion: message.params?.protocolVersion || "2025-06-18",
        capabilities: { tools: {} },
        serverInfo: { name: "fixture", version: "1.0.0" },
      });
    case "ping":
      return reply({});
    case "tools/list":
      return reply({
        tools: [
          {
            name: "echo",
            description: "Echo text back.",
            inputSchema: {
              type: "object",
              properties: { text: { type: "string" } },
              required: ["text"],
            },
          },
        ],
      });
    case "tools/call":
      return reply({
        content: [{ type: "text", text: `echo: ${message.params.arguments.text}` }],
      });
    default:
      if (message.id !== undefined)
        send({ jsonrpc: "2.0", id: message.id, error: { code: -32601, message: "Unknown method" } });
  }
});
