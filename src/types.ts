export interface Env {
    DB: D1Database
    ASSETS: Fetcher
    SECRET_SALT: string
    RATE_LIMITER: RateLimit
}

declare global {
    // eslint-disable-next-line @typescript-eslint/no-namespace
    namespace Cloudflare {
        interface Env {
            DB: D1Database
            ASSETS: Fetcher
            SECRET_SALT: string
            RATE_LIMITER: RateLimit
        }
    }
}

export interface AliasRow {
    word: string
    content: string
    secret: string | null
    created_at: number
    expires_at: number | null
}
