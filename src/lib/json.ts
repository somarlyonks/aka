import {jsonError} from './respond'
import type {AppContext} from './respond'

export type JsonBody = {ok: true, body: Record<string, unknown>}
    | {ok: false, response: Response}

/** Parses a JSON object body for API routes, returning a ready error response. */
export async function readJsonObject (c: AppContext): Promise<JsonBody> {
    const contentType = c.req.header('content-type')?.toLowerCase() ?? ''
    if (!contentType.includes('application/json')) {
        return {
            ok: false,
            response: jsonError(c, 400, 'invalid_body', 'Expected a JSON body.'),
        }
    }

    let body: unknown
    try {
        body = await c.req.json()
    } catch {
        return {
            ok: false,
            response: jsonError(c, 400, 'invalid_body', 'Expected a JSON body.'),
        }
    }

    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
        return {
            ok: false,
            response: jsonError(c, 400, 'invalid_body', 'Expected a JSON object.'),
        }
    }

    return {ok: true, body: body as Record<string, unknown>}
}
