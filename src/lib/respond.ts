import type {Context} from 'hono'
import type {ContentfulStatusCode, RedirectStatusCode} from 'hono/utils/http-status'
import type {Env} from '../types'
import {immutableTtl} from './lifetime'
import {renderErrorPage} from './html'
import {prefersJson} from './accept'

export type AppContext = Context<{Bindings: Env}>

export const NO_STORE = 'no-store'
export const NO_INDEX = 'noindex'
export const REFERRAL_POLICY = 'no-referrer'
export const WORD_RULE = 'Words must be 2-32 characters using lowercase letters, digits, dashes, or underscores.'

const HTML_HEADERS = {
    'X-Robots-Tag': NO_INDEX,
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Content-Security-Policy':
    'default-src \'none\'; style-src \'self\'; img-src \'self\'; font-src \'self\'; script-src \'self\'; connect-src \'self\'; form-action \'self\'; base-uri \'none\'; frame-ancestors \'none\'',
} as const

export function htmlPage (
    c: AppContext,
    body: string,
    status: ContentfulStatusCode = 200,
    cacheControl: string = NO_STORE,
): Response {
    for (const [name, value] of Object.entries(HTML_HEADERS)) {
        c.header(name, value)
    }
    c.header('Cache-Control', cacheControl)
    return c.html(body, status)
}

interface ErrorCopy {
    title: string
    ji: string
    message: string
}

const STATUS_MAP: Partial<Record<ContentfulStatusCode, ErrorCopy>> = {
    400: {
        title: 'Invalid form',
        ji: '无有定法，法不取说。',
        message: 'Could not read the form body.',
    },
    401: {
        title: 'Unauthorized',
        ji: '识自本心，见自本性。',
        message: 'This alias is private. Send Authorization: Bearer <secret>.',
    },
    404: {
        title: 'Not found',
        ji: '菩提本无树，明镜亦非台。',
        message: 'There is nothing at this address.',
    },
    409: {
        title: 'Word already exists',
        ji: '无复我相，无非法相。',
        message: 'The word has already been claimed. Words are immutable.',
    },
    410: {
        title: 'Alias expired',
        ji: '本有今无，本无今有。',
        message: 'This alias is no longer available.',
    },
    422: {
        title: 'Invalid request',
        ji: '凡所有相，皆是虚妄。',
        message: 'The request could not be accepted.',
    },
    429: {
        title: 'Too many requests',
        ji: '汝若作念，诸法断灭。',
        message: 'Slow down, then try again later.',
    },
    500: {
        title: 'Internal error',
        ji: '定慧等持，意中清净。',
        message: 'Something went wrong.',
    },
    503: {
        title: 'Could not allocate a word',
        ji: '天上天下，唯我独尊。',
        message: 'Please try again in a moment.',
    },
}

const FALLBACK_COPY: ErrorCopy = {
    title: 'Request failed',
    ji: '说法无法，是名说法。',
    message: 'Something went wrong.',
}

export async function errorPage (
    c: AppContext,
    statusCode: ContentfulStatusCode,
    copy: Partial<ErrorCopy> = {},
): Promise<Response> {
    const defaults = STATUS_MAP[statusCode] ?? FALLBACK_COPY
    return htmlPage(
        c,
        await renderErrorPage(c.env.ASSETS, {...defaults, ...copy}),
        statusCode,
    )
}

export function invalidWordPage (c: AppContext): Promise<Response> {
    return errorPage(c, 422, {title: 'Invalid word', message: WORD_RULE})
}

export function jsonError (
    c: AppContext,
    status: ContentfulStatusCode,
    code: string,
    message: string,
): Response {
    c.header('Cache-Control', NO_STORE)
    c.header('X-Content-Type-Options', 'nosniff')
    return c.json({error: {code, message}}, status)
}

export async function unauthorizedPage (c: AppContext): Promise<Response> {
    c.header('WWW-Authenticate', 'Bearer realm="aka"')
    c.header('Vary', 'Authorization')
    return errorPage(c, 401)
}

export async function rateLimitedPage (
    c: AppContext,
    retryAfterSeconds: number,
): Promise<Response> {
    c.header('Retry-After', String(retryAfterSeconds))
    if (prefersJson(c.req.header('accept'))) {
        return jsonError(c, 429, 'rate_limited', 'Too many requests. Try again later.')
    }
    return errorPage(c, 429)
}

export function textPage (
    c: AppContext,
    body: string,
    status: ContentfulStatusCode = 200,
    cacheControl: string = NO_STORE,
): Response {
    c.header('Cache-Control', cacheControl)
    c.header('X-Content-Type-Options', 'nosniff')
    return c.text(body, status)
}

export function redirectPage (
    c: AppContext,
    location: string,
    status: RedirectStatusCode,
    cacheControl: string = NO_STORE,
): Response {
    c.header('Cache-Control', cacheControl)
    c.header('X-Robots-Tag', NO_INDEX)
    return c.redirect(location, status)
}

export function publicCache (expiresAt: number | null, now: number): string {
    if (expiresAt === null) return 'public, max-age=3600'
    return `public, max-age=${immutableTtl(expiresAt, now)}, immutable`
}
