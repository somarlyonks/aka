import type {AppContext} from './respond'

/** Matches the limiter window configured in wrangler.jsonc, so it is also the Retry-After value. */
export const RETRY_AFTER_SECONDS = 60
const UNKNOWN_CLIENT_KEY = 'unknown-client'

export function rateLimitKeyFor (address: string | null | undefined): string {
    const normalized = address?.trim().toLowerCase() ?? ''
    if (normalized.length === 0) return UNKNOWN_CLIENT_KEY
    const mapped = ipv4MappedAddress(normalized)
    if (mapped !== null) return mapped
    return normalized.includes(':') ? ipv6Prefix(normalized) : normalized

    function ipv4MappedAddress (address: string): string | null {
        const match = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(address)
        return match?.[1] ?? null
    }

    /**
     * An IPv6 client usually owns an entire /64, so counting every address
     * separately would let one client rotate through it for free.
     */
    function ipv6Prefix (address: string): string {
        const [head = '', tail = ''] = address.split('::')
        const headGroups = head.length > 0 ? head.split(':') : []
        const tailGroups = tail.length > 0 ? tail.split(':') : []
        const padding = address.includes('::')
            ? Array<string>(Math.max(8 - headGroups.length - tailGroups.length, 0)).fill('0')
            : []
        return [...headGroups, ...padding, ...tailGroups]
            .slice(0, 4)
            .map(group => group || '0')
            .join(':')
    }
}

export function clientKey (c: AppContext): string {
    return rateLimitKeyFor(c.req.header('cf-connecting-ip'))
}

/** Every request counts, whatever its method or route. */
export async function isRateLimited (c: AppContext): Promise<boolean> {
    const {success} = await c.env.RATE_LIMITER.limit({key: clientKey(c)})
    return !success
}
