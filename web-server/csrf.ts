import { ProxyRequestError } from "./proxy-common.js";

const CSRF_FIELD_NAMES = new Set(["csrf", "csrf_token"]);
const MULTIPART_BOUNDARY_PATTERN = /^[0-9A-Za-z'()+_,./:=?-]{1,70}$/;
const SAFE_CSRF_PATTERN = /^[0-9A-Za-z_-]{1,256}$/;

function assertSafeCsrf(csrf: string) {
  if (!SAFE_CSRF_PATTERN.test(csrf)) throw new ProxyRequestError("Web session has an invalid CSRF token", 401);
}

function multipartBoundary(contentType: string) {
  const match = /(?:^|;)\s*boundary=(?:"([^"]+)"|([^;\s]+))/i.exec(contentType);
  const boundary = match?.[1] ?? match?.[2];
  if (!boundary || !MULTIPART_BOUNDARY_PATTERN.test(boundary)) {
    throw new ProxyRequestError("multipart request has an invalid boundary", 400);
  }
  return boundary;
}

function multipartFieldName(part: Buffer) {
  const headerEnd = part.indexOf("\r\n\r\n");
  if (headerEnd < 0) throw new ProxyRequestError("multipart request has malformed headers", 400);

  const headers = part.subarray(0, headerEnd).toString("latin1");
  const disposition = /(?:^|\r\n)content-disposition:\s*([^\r\n]+)/i.exec(headers)?.[1];
  if (!disposition) return undefined;

  const name = /(?:^|;)\s*name=(?:"((?:\\.|[^"])*)"|([^;\s]+))/i.exec(disposition);
  if (!name) return undefined;
  return name[1]?.replace(/\\(.)/g, "$1") ?? name[2];
}

function injectMultipartCsrf(body: Buffer, contentType: string, csrf: string) {
  const boundary = multipartBoundary(contentType);
  const delimiter = Buffer.from(`--${boundary}`);
  const nextDelimiter = Buffer.from(`\r\n--${boundary}`);
  if (body.indexOf(delimiter) !== 0)
    throw new ProxyRequestError("multipart request has an invalid opening boundary", 400);

  const retained: Buffer[] = [];
  let cursor = delimiter.length;
  let closed = false;

  while (cursor <= body.length) {
    if (body.subarray(cursor, cursor + 2).equals(Buffer.from("--"))) {
      closed = true;
      break;
    }
    if (!body.subarray(cursor, cursor + 2).equals(Buffer.from("\r\n"))) {
      throw new ProxyRequestError("multipart request has a malformed boundary", 400);
    }

    const partStart = cursor + 2;
    const next = body.indexOf(nextDelimiter, partStart);
    if (next < 0) throw new ProxyRequestError("multipart request is missing its closing boundary", 400);

    const part = body.subarray(partStart, next);
    if (!CSRF_FIELD_NAMES.has(multipartFieldName(part) ?? "")) retained.push(part);
    cursor = next + nextDelimiter.length;
  }

  if (!closed) throw new ProxyRequestError("multipart request is missing its closing boundary", 400);

  const chunks: Buffer[] = [];
  for (const part of retained) chunks.push(delimiter, Buffer.from("\r\n"), part, Buffer.from("\r\n"));
  for (const name of CSRF_FIELD_NAMES) {
    chunks.push(delimiter, Buffer.from(`\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${csrf}\r\n`));
  }
  chunks.push(delimiter, Buffer.from("--\r\n"));
  return Buffer.concat(chunks);
}

export function findCsrfInCookieHeader(cookieHeader: string) {
  for (const rawCookie of cookieHeader.split(";")) {
    const separator = rawCookie.indexOf("=");
    if (separator <= 0 || rawCookie.slice(0, separator).trim() !== "bili_jct") continue;

    const csrf = rawCookie.slice(separator + 1).trim();
    assertSafeCsrf(csrf);
    return csrf;
  }
  return undefined;
}

export function readCsrfFromCookieHeader(cookieHeader: string) {
  const csrf = findCsrfInCookieHeader(cookieHeader);
  if (!csrf) throw new ProxyRequestError("Web session does not contain a CSRF token", 401);
  return csrf;
}

export function injectCsrfIntoQuery(target: URL, csrf: string) {
  assertSafeCsrf(csrf);
  target.searchParams.set("csrf", csrf);
  target.searchParams.set("csrf_token", csrf);
}

export function injectCsrfIntoBody(body: Buffer, contentType: string | undefined, csrf: string) {
  assertSafeCsrf(csrf);
  const mime = contentType?.split(";", 1)[0]?.trim().toLowerCase();

  if (mime === "application/json") {
    let parsed: unknown;
    try {
      parsed = JSON.parse(body.toString("utf8"));
    } catch {
      throw new ProxyRequestError("JSON request body is invalid", 400);
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new ProxyRequestError("JSON request body must be an object", 400);
    }
    return Buffer.from(JSON.stringify({ ...parsed, csrf, csrf_token: csrf }));
  }

  if (mime === "application/x-www-form-urlencoded") {
    const params = new URLSearchParams(body.toString("utf8"));
    params.set("csrf", csrf);
    params.set("csrf_token", csrf);
    return Buffer.from(params.toString());
  }

  if (mime === "multipart/form-data") return injectMultipartCsrf(body, contentType ?? "", csrf);

  throw new ProxyRequestError("CSRF injection requires JSON, form-urlencoded, or multipart body", 415);
}
