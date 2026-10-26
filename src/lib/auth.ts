import type {AppContext} from './respond'

const BEARER_RE = /^Bearer[ \t]+(.+)$/i

export function bearerSecret (c: AppContext): string | null {
    const header = c.req.header('authorization')
    if (!header) {
        return null
    }
    const match = BEARER_RE.exec(header)
    const value = match?.[1]?.trim()
    return value ? value : null
}
