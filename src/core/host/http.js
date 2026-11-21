/* HTTP helpers shared by the plugin's host routes. */

/** Bound for a JSON request body; every route sends small objects. */
const DEFAULT_MAX_BODY_BYTES = 262144;

/** Accept only browser submissions from the page that hosts this server. */
export function isSameOrigin(request) {
  const origin = request.headers.origin;
  if (origin === undefined) return true;
  try {
    return new URL(origin).host === request.headers.host;
  } catch {
    return false;
  }
}

/** Read and parse one JSON body with a hard size bound. */
export function readJsonBody(request, maxBytes = DEFAULT_MAX_BODY_BYTES) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let settled = false;
    request.on("data", (chunk) => {
      if (settled) return;
      size += chunk.length;
      if (size > maxBytes) {
        settled = true;
        const error = new Error("request body is too large");
        error.status = 413;
        reject(error);
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("error", (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    });
    request.on("end", () => {
      if (settled) return;
      settled = true;
      try {
        const text = Buffer.concat(chunks).toString("utf8").trim();
        resolve(text === "" ? {} : JSON.parse(text));
      } catch (error) {
        const failure = new Error(`invalid JSON body: ${messageOf(error)}`);
        failure.status = 400;
        reject(failure);
      }
    });
  });
}

/** Answer one JSON response; `headers` adds route-specific fields. */
export function sendJson(response, status, body, headers = {}) {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "content-length": Buffer.byteLength(payload),
    ...headers,
  });
  response.end(payload);
}

/** Readable text for a thrown value without trusting its shape. */
export function messageOf(error) {
  if (error instanceof Error) return error.message;
  try {
    return String(error);
  } catch {
    return "unknown error";
  }
}
