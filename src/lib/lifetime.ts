const DAY = 24 * 60 * 60
const WEEK = 7 * DAY
const MONTH = 30 * DAY

export const DEFAULT_MAX_AGE = WEEK
export const MAX_MAX_AGE = MONTH
export const DEFAULT_MAX_AGE_INPUT = String(DEFAULT_MAX_AGE)
export const MAX_MAX_AGE_INPUT = String(MAX_MAX_AGE)
export const IMMUTABLE_TTL = 365 * DAY

export function nowSeconds (): number {
    return Math.floor(Date.now() / 1000)
}

function allowedSeconds (value: number): boolean {
    return Number.isSafeInteger(value) && value >= 0 && value <= MAX_MAX_AGE
}

/**
 * Parses a lifetime into seconds. Accepts whole seconds only (`3600`); missing
 * and empty values mean the default. Returns undefined when the value is invalid
 * or above the 30-day maximum.
 */
export function parseMaxAge (raw: string | null | undefined): number | undefined {
    if (raw === null || raw === undefined || raw.trim() === '') {
        return DEFAULT_MAX_AGE
    }

    const value = raw.trim()
    if (!/^[0-9]+$/.test(value)) return undefined

    const seconds = Number(value)
    return allowedSeconds(seconds) ? seconds : undefined
}

export function expiresAtFor (maxAge: number, now = nowSeconds()): number {
    return maxAge === 0 ? 0 : now + maxAge
}

export function isOneTime (expiresAt: number | null): boolean {
    return expiresAt === 0
}

export function isExpired (expiresAt: number | null, now = nowSeconds()): boolean {
    return expiresAt !== null && expiresAt !== 0 && expiresAt <= now
}

export function immutableTtl (
    expiresAt: number | null,
    now = nowSeconds(),
): number {
    if (expiresAt === null) return IMMUTABLE_TTL
    if (expiresAt === 0) return 0
    return Math.max(0, Math.min(IMMUTABLE_TTL, expiresAt - now))
}
