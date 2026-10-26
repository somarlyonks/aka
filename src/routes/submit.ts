import {aliasExists, insertAlias} from '../db/repo'
import {contentAfterFirstSegment, isValidContent, isValidSecret, MAX_SECRET_CHARS, MIN_SECRET_CHARS} from '../lib/content'
import {encryptContent} from '../lib/content-crypto'
import {renderConfigPage, renderCreatedPage} from '../lib/html'
import {readJsonObject} from '../lib/json'
import {DEFAULT_MAX_AGE, MAX_MAX_AGE, expiresAtFor, nowSeconds, parseMaxAge} from '../lib/lifetime'
import {
    errorPage,
    htmlPage,
    invalidWordPage,
    jsonError,
    NO_STORE,
    redirectPage,
    WORD_RULE,
} from '../lib/respond'
import type {AppContext} from '../lib/respond'
import {hashSecret} from '../lib/secrets'
import {GENERATED_WORD, generateWord, parseWordParam} from '../lib/words'

const MAX_INSERT_ATTEMPTS = 5

const CONTENT_ERROR = 'Provide non-empty content of at most 8 KB.'
const MAX_AGE_RULE = `0 (one-time) or whole seconds up to ${MAX_MAX_AGE} (30 days); default ${DEFAULT_MAX_AGE} (7 days).`
const MAX_AGE_ERROR = `max-age must be ${MAX_AGE_RULE}`
const MAX_AGE_BODY_ERROR = `maxAge must be ${MAX_AGE_RULE}`
const SECRET_ERROR = `The secret must be between ${MIN_SECRET_CHARS} and ${MAX_SECRET_CHARS} characters.`

type SubmitFields = {
    content: unknown
    secret: unknown
    maxAge: unknown
}

type SubmitBody = {ok: true, form: boolean, fields: SubmitFields}
    | {ok: false, response: Response}

function isFormSubmission (c: AppContext): boolean {
    const contentType = c.req.header('content-type')?.toLowerCase() ?? ''
    return contentType.includes('application/x-www-form-urlencoded')
}

async function readSubmitBody (c: AppContext): Promise<SubmitBody> {
    if (!isFormSubmission(c)) {
        const parsed = await readJsonObject(c)
        if (!parsed.ok) return {ok: false, response: parsed.response}
        return {
            ok: true,
            form: false,
            fields: {
                content: parsed.body.content,
                secret: parsed.body.secret,
                maxAge: parsed.body.maxAge,
            },
        }
    }

    let body: Record<string, string>
    try {
        body = await c.req.parseBody() as Record<string, string>
    } catch {
        return {
            ok: false,
            response: await errorPage(c, 400),
        }
    }

    return {
        ok: true,
        form: true,
        fields: {
            content: body.content,
            secret: body.secret,
            maxAge: body['max-age'] ?? body.maxAge,
        },
    }
}

/**
 * Claims the first free candidate. The atomic INSERT both checks uniqueness and
 * stores the alias, so concurrent creates never claim the same word.
 */
async function claimWord (
    c: AppContext,
    chosen: string | undefined,
    content: string,
    maxAge: number,
    secret: string | null = null,
): Promise<string | null> {
    for (const word of wordCandidates(chosen)) {
        if (await saveAlias(c, word, content, maxAge, secret)) {
            return word
        }
    }
    return null

    function* wordCandidates (chosen?: string): Generator<string> {
        if (chosen !== undefined) {
            yield chosen
            return
        }
        for (let attempt = 0; attempt < MAX_INSERT_ATTEMPTS; attempt += 1) {
            yield generateWord(attempt)
        }
    }

    async function saveAlias (
        c: AppContext,
        word: string,
        content: string,
        maxAge: number,
        secret: string | null,
    ): Promise<boolean> {
        const now = nowSeconds()
        return insertAlias(c.env.DB, {
            word,
            content: await encryptContent(
                {salt: c.env.SECRET_SALT, word, secret},
                content,
            ),
            secret: secret === null
                ? null
                : await hashSecret(c.env.SECRET_SALT, word, secret),
            createdAt: now,
            expiresAt: expiresAtFor(maxAge, now),
        })
    }
}

async function createdPage (
    c: AppContext,
    word: string,
    {oneTime, privateAlias}: {oneTime: boolean, privateAlias: boolean},
): Promise<Response> {
    c.header('Location', `/${word}`)
    return htmlPage(
        c,
        await renderCreatedPage(c.env.ASSETS, {
            word,
            origin: new URL(c.req.url).origin,
            oneTime,
            privateAlias,
        }),
        201,
    )
}

/**
 * Shared creation path for `GET /:word/*`. A `-` word parameter asks the
 * server to generate a word; any other word is claimed as chosen.
 */
async function createFromPath (c: AppContext, chosen?: string): Promise<Response> {
    if (chosen !== undefined && await aliasExists(c.env.DB, chosen)) {
        return conflictResponse(c, true, chosen)
    }

    const content = contentAfterFirstSegment(c)
    if (content === null || !isValidContent(content)) {
        return errorPage(c, 422, {title: 'Invalid content', message: CONTENT_ERROR})
    }

    const queryMaxAge = c.req.query('max-age') ?? (c.req.query('0') === '' ? '0' : undefined)
    const maxAge = parseMaxAge(queryMaxAge)
    if (maxAge === undefined) {
        return errorPage(c, 422, {title: 'Invalid max-age', message: MAX_AGE_ERROR})
    }

    const word = await claimWord(c, chosen, content, maxAge)
    if (word === null) {
        return chosen === undefined
            ? exhaustedPage(c)
            : conflictResponse(c, true, chosen)
    }

    if (chosen === undefined || maxAge === 0) {
        return createdPage(c, word, {
            oneTime: maxAge === 0,
            privateAlias: false,
        })
    }
    return redirectPage(c, `/${word}`, 303, NO_STORE)

    function exhaustedPage (c: AppContext): Promise<Response> {
        c.header('Retry-After', '1')
        return errorPage(c, 503)
    }
}

export function pathCreate (c: AppContext): Promise<Response> {
    const param = parseWordParam(c.req.param('word') ?? '')
    if (param.kind === 'invalid') return invalidWordPage(c)

    return createFromPath(c, param.kind === 'chosen' ? param.word : undefined)
}

export async function submitWord (c: AppContext): Promise<Response> {
    const form = isFormSubmission(c)
    const param = parseWordParam(c.req.param('word') ?? '')
    if (param.kind === 'invalid') {
        return form
            ? invalidWordPage(c)
            : jsonError(c, 422, 'invalid_word', WORD_RULE)
    }
    const chosen = param.kind === 'chosen' ? param.word : undefined
    const word = chosen ?? GENERATED_WORD

    const parsed = await readSubmitBody(c)
    if (!parsed.ok) return parsed.response

    const fields = parsed.fields

    if (chosen !== undefined && await aliasExists(c.env.DB, chosen)) {
        return conflictResponse(c, form, chosen)
    }

    const content = typeof fields.content === 'string' ? fields.content : ''
    if (!isValidContent(content)) {
        return fieldError(c, form, word, fields, 'invalid_content', CONTENT_ERROR)
    }

    const maxAge = maxAgeFromBody(fields.maxAge)
    if (maxAge === undefined) {
        return fieldError(
            c,
            form,
            word,
            fields,
            'invalid_max_age',
            form ? MAX_AGE_ERROR : MAX_AGE_BODY_ERROR,
        )
    }

    if (fields.secret !== undefined && fields.secret !== null && typeof fields.secret !== 'string') {
        return fieldError(c, form, word, fields, 'invalid_secret', 'The secret must be a string.')
    }

    const secret = typeof fields.secret === 'string' && fields.secret !== ''
        ? fields.secret
        : null
    if (secret !== null && !isValidSecret(secret)) {
        return fieldError(c, form, word, fields, 'invalid_secret', SECRET_ERROR)
    }

    const claimed = await claimWord(c, chosen, content, maxAge, secret)
    if (claimed === null) {
        if (chosen === undefined) {
            c.header('Retry-After', '1')
            if (form) {
                return errorPage(c, 503)
            }
            return jsonError(
                c,
                503,
                'word_exhausted',
                'Could not allocate a word. Please try again in a moment.',
            )
        }
        return conflictResponse(c, form, chosen)
    }

    if (form) {
        return createdPage(c, claimed, {
            oneTime: maxAge === 0,
            privateAlias: secret !== null,
        })
    }

    c.header('Location', `/${claimed}`)
    c.header('Cache-Control', NO_STORE)
    return c.json({
        word: claimed,
        url: `${new URL(c.req.url).origin}/${claimed}`,
        oneTime: maxAge === 0,
        private: secret !== null,
    }, 201)

    function fieldError (
        c: AppContext,
        form: boolean,
        word: string,
        fields: SubmitFields,
        code: string,
        message: string,
    ): Response | Promise<Response> {
        if (!form) return jsonError(c, 422, code, message)
        return configPageWithError(c, word, fields, message)
    }

    function maxAgeFromBody (value: unknown): number | undefined {
        if (value === undefined || value === null) {
            return DEFAULT_MAX_AGE
        }
        if (typeof value !== 'number' && typeof value !== 'string') {
            return undefined
        }
        return parseMaxAge(String(value))
    }
}

async function configPageWithError (
    c: AppContext,
    word: string,
    fields: SubmitFields,
    message: string,
): Promise<Response> {
    return htmlPage(
        c,
        await renderConfigPage(c.env.ASSETS, {
            word,
            generated: word === GENERATED_WORD,
            content: typeof fields.content === 'string' ? fields.content : '',
            maxAge: typeof fields.maxAge === 'string' ? fields.maxAge : undefined,
            error: message,
        }),
        422,
    )
}

function conflictResponse (
    c: AppContext,
    form: boolean,
    word: string,
): Response | Promise<Response> {
    const message = `The word "${word}" has already been claimed. Words are immutable.`
    if (form) return errorPage(c, 409, {message})
    return jsonError(c, 409, 'word_exists', message)
}
