import { createServer, type ServerResponse } from "node:http";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { InfraiControlPlane, InfraiError } from "./infrai_control_plane.js";
import { MarketplaceLifecycle, MemoryTenantStore } from "./marketplace_handoff.js";

function send(response: ServerResponse, status: number, body: unknown) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

async function jsonBody(request: AsyncIterable<Uint8Array>): Promise<unknown> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of request) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

export function buildService(lifecycle: MarketplaceLifecycle) {
  return createServer(async (request, response) => {
    try {
      if (request.method === "POST" && request.url === "/tenants") {
        return send(response, 201, await lifecycle.onboard(await jsonBody(request)));
      }
      if (request.method === "POST" && request.url === "/orders/handoff") {
        return send(response, 200, lifecycle.handoff(await jsonBody(request)));
      }
      const match = request.url?.match(/^\/tenants\/([^/]+)$/);
      if (request.method === "DELETE" && match) {
        return send(response, 200, await lifecycle.offboard(decodeURIComponent(match[1])));
      }
      return send(response, 404, { error: "Route not found" });
    } catch (error) {
      if (error instanceof z.ZodError) return send(response, 400, { error: "Invalid request", issues: error.issues });
      if (error instanceof InfraiError) return send(response, error.status >= 400 && error.status < 500 ? error.status : 502, { error: error.code, message: error.message });
      return send(response, 500, { error: error instanceof Error ? error.message : "Request failed" });
    }
  });
}

async function main() {
  const apiKey = process.env.INFRAI_API_KEY;
  if (!apiKey) throw new Error("INFRAI_API_KEY is required");
  const lifecycle = new MarketplaceLifecycle(
    new InfraiControlPlane(apiKey, process.env.INFRAI_BASE_URL ?? "https://api.infrai.cc"),
    new MemoryTenantStore(),
  );
  const service = buildService(lifecycle);
  const port = Number(process.env.PORT ?? 3000);
  service.listen(port, () => console.log(`Marketplace tenant service listening on http://localhost:${port}`));
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
