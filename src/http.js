import { StringDecoder } from "node:string_decoder";

export class HttpError extends Error {
  constructor(status, message, details = null, code = null) {
    super(message);
    this.status = status;
    this.details = details;
    this.code = code || status;
  }
}

export function sendJson(res, status, payload) {
  const body = JSON.stringify(payload, null, 2);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  res.end(body);
}

export function notFound(res) {
  sendJson(res, 404, {
    code: 1002,
    message: "请求资源不存在",
    data: null
  });
}

export function handleError(res, error) {
  if (error instanceof HttpError) {
    sendJson(res, error.status, {
      code: error.code,
      message: error.message,
      data: null,
      details: error.details
    });
    return;
  }

  console.error(error);
  sendJson(res, 500, {
    code: 500,
    message: "服务器内部错误",
    data: null
  });
}

export function parseBody(req) {
  return new Promise((resolve, reject) => {
    const decoder = new StringDecoder("utf8");
    let raw = "";

    req.on("data", chunk => {
      raw += decoder.write(chunk);
      if (raw.length > 1024 * 1024) {
        reject(new HttpError(413, "请求体过大"));
        req.destroy();
      }
    });

    req.on("end", () => {
      raw += decoder.end();
      if (!raw.trim()) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new HttpError(400, "请求体必须是合法 JSON"));
      }
    });

    req.on("error", reject);
  });
}
