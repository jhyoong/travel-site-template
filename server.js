// Serves the timeline page and the event-drafting endpoint.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { draftEvent, RequestError, DraftError, UpstreamError } from "./lib/draft.js";

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || "127.0.0.1";
const PAGE = fileURLToPath(new URL("./travel-timeline.html", import.meta.url));
const MAX_BODY = 512 * 1024;

function send(res, status, body, type = "application/json; charset=utf-8") {
  res.writeHead(status, { "Content-Type": type, "Cache-Control": "no-store" });
  res.end(typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw new RequestError("That plan is too large to send.");
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw new RequestError("Send valid JSON."); }
}

// Maps failures to a status and a message that is safe to show in the page.
function describeError(err) {
  if (err instanceof RequestError) return [400, err.message];
  if (err instanceof DraftError) return [502, err.message];
  if (err instanceof UpstreamError) return [err.status, err.message];
  return [500, "Something went wrong on the server. Check its log."];
}

const server = createServer(async (req, res) => {
  const { pathname } = new URL(req.url, "http://localhost");
  try {
    if (req.method === "GET" && (pathname === "/" || pathname === "/travel-timeline.html")) {
      return send(res, 200, await readFile(PAGE), "text/html; charset=utf-8");
    }
    if (pathname === "/api/draft-event") {
      if (req.method !== "POST") return send(res, 405, { error: "Use POST." });
      return send(res, 200, await draftEvent(await readJson(req)));
    }
    send(res, 404, { error: "Not found." });
  } catch (err) {
    const [status, message] = describeError(err);
    if (err instanceof UpstreamError) console.error(err.message, err.detail ?? "");
    else if (status >= 500) console.error(err);
    send(res, status, { error: message });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Travel timeline running at http://${HOST}:${PORT}`);
  if (!process.env.LLM_MODEL) console.warn("LLM_MODEL is not set. The page works, but drafting events from text will fail until you add it to .env.");
});
