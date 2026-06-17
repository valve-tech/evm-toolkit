/** Tiny request/response helpers for the plain-Node server. */
import type { IncomingMessage, ServerResponse } from 'node:http'

export async function readJsonBody<T>(req: IncomingMessage): Promise<T> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(chunk as Buffer)
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as T
}

/** Extract the Bearer token from the Authorization header, or null. */
export function bearerToken(req: IncomingMessage): string | null {
  const header = req.headers.authorization ?? ''
  return header.startsWith('Bearer ') ? header.slice(7) : null
}

export function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(JSON.stringify(body))
}

export function send401(res: ServerResponse, reason: string): void {
  sendJson(res, 401, { error: reason })
}
