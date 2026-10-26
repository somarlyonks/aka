import type {AppContext} from './respond'

export const MAX_CONTENT_BYTES = 8 * 1024
export const MIN_SECRET_CHARS = 2
export const MAX_SECRET_CHARS = 256

export function contentAfterFirstSegment (c: AppContext): string | null {
    const path = new URL(c.req.url).pathname
    const slash = path.indexOf('/', 1)
    if (slash === -1) {
        return null
    }
    const raw = path.slice(slash + 1)
    if (raw.length === 0) {
        return null
    }
    try {
        return decodeURIComponent(raw)
    } catch {
        return null
    }
}

export function isHttpUrl (content: string): boolean {
    try {
        const url = new URL(content)
        return url.protocol === 'http:' || url.protocol === 'https:'
    } catch {
        return false
    }
}

export function isValidContent (content: string): boolean {
    return (
        content.length > 0
        && new TextEncoder().encode(content).byteLength <= MAX_CONTENT_BYTES
    )
}

export function isValidSecret (secret: string): boolean {
    return secret.length >= MIN_SECRET_CHARS && secret.length <= MAX_SECRET_CHARS
}
