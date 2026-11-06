import {insertAlias, liveAliasExists, reclaimExpiredAlias} from '../db/repo'
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
const SECRET_TYPE_ERROR = 'The secret must be a string.'
const SECRET_ERROR = `The secret must be between ${MIN_SECRET_CHARS} and ${MAX_SECRET_CHARS} characters.`

/** How the request reached us; decides error rendering and the success response. */
type Channel = 'path' | 'form' | 'json'

type SubmitFields = {
    content: unknown
    secret: unknown
    maxAge: unknown
}

type Draft = {
    content: string
    maxAge: number
    secret: string | null
}

/** The first field that failed validation. Copy for it lives in fieldCopy. */
type InvalidField = 'content' | 'maxAge' | 'secretType' | 'secretLength'

type Parsed<T> = {ok: true, value: T} | {ok: false, field: InvalidField}

type SubmitBody = {ok: true, fields: SubmitFields} | {ok: false, response: Response}

type Claim = {kind: 'claimed', word: string} | {kind: 'conflict', word: string} | {kind: 'exhausted'}

export async function pathCreate (c: AppContext): Promise<Response> {
    const param = parseWordParam(c.req.param('word') ?? '')
    if (param.kind === 'invalid') return invalidWordPage(c)

    if (param.kind === 'chosen') {
        if (await liveAliasExists(c.env.DB, param.word, nowSeconds())) {
            return conflictResponse(c, 'path', param.word)
        }
    }

    const chosen = param.kind === 'chosen' ? param.word : undefined
    const queryMaxAge = c.req.query('max-age') ?? (c.req.query('0') === '' ? '0' : undefined)
    return createFromDraft(c, 'path', chosen, {
        content: contentAfterFirstSegment(c),
        secret: undefined,
        maxAge: queryMaxAge,
    })
}

export async function submitWord (c: AppContext): Promise<Response> {
    const channel: Channel = isFormSubmission(c) ? 'form' : 'json'
    const param = parseWordParam(c.req.param('word') ?? '')
    if (param.kind === 'invalid') {
        return channel === 'form'
            ? invalidWordPage(c)
            : jsonError(c, 422, 'invalid_word', WORD_RULE)
    }
    const chosen = param.kind === 'chosen' ? param.word : undefined

    const body = await readSubmitBody(c, channel)
    if (!body.ok) return body.response

    if (chosen !== undefined && await liveAliasExists(c.env.DB, chosen, nowSeconds())) {
        return conflictResponse(c, channel, chosen)
    }

    return createFromDraft(c, channel, chosen, body.fields)

    function isFormSubmission (c: AppContext): boolean {
        const contentType = c.req.header('content-type')?.toLowerCase() ?? ''
        return contentType.includes('application/x-www-form-urlencoded')
    }
}

async function readSubmitBody (c: AppContext, channel: Channel): Promise<SubmitBody> {
    if (channel === 'json') {
        const parsed = await readJsonObject(c)
        if (!parsed.ok) return {ok: false, response: parsed.response}
        return {
            ok: true,
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
        return {ok: false, response: await errorPage(c, 400)}
    }

    return {
        ok: true,
        fields: {
            content: body.content,
            secret: body.secret,
            maxAge: body['max-age'] ?? body.maxAge,
        },
    }
}

async function createFromDraft (c: AppContext, channel: Channel, chosen: string | undefined, fields: SubmitFields): Promise<Response> {
    const parsed = readDraft(fields)
    if (!parsed.ok) {
        return fieldErrorResponse(c, channel, chosen ?? GENERATED_WORD, fields, parsed.field)
    }

    const draft = parsed.value
    const claim = await claimAlias(c, chosen, draft)
    if (claim.kind === 'exhausted') return exhaustedResponse(c, channel)
    if (claim.kind === 'conflict') return conflictResponse(c, channel, claim.word)
    return respondCreated(c, channel, chosen, claim.word, draft)

    function readDraft (fields: SubmitFields): Parsed<Draft> {
        const content = readContent(fields.content)
        if (!content.ok) return content

        const maxAge = readMaxAge(fields.maxAge)
        if (!maxAge.ok) return maxAge

        const secret = readSecret(fields.secret)
        if (!secret.ok) return secret

        return {
            ok: true,
            value: {content: content.value, maxAge: maxAge.value, secret: secret.value},
        }

        function readContent (raw: unknown): Parsed<string> {
            const content = typeof raw === 'string' ? raw : ''
            return isValidContent(content)
                ? {ok: true, value: content}
                : {ok: false, field: 'content'}
        }

        function readMaxAge (raw: unknown): Parsed<number> {
            if (raw === undefined || raw === null) return {ok: true, value: DEFAULT_MAX_AGE}
            if (typeof raw !== 'number' && typeof raw !== 'string') return {ok: false, field: 'maxAge'}

            const maxAge = parseMaxAge(String(raw))
            return maxAge === undefined ? {ok: false, field: 'maxAge'} : {ok: true, value: maxAge}
        }

        function readSecret (raw: unknown): Parsed<string | null> {
            if (raw === undefined || raw === null || raw === '') return {ok: true, value: null}
            if (typeof raw !== 'string') return {ok: false, field: 'secretType'}
            return isValidSecret(raw) ? {ok: true, value: raw} : {ok: false, field: 'secretLength'}
        }
    }

    async function fieldErrorResponse (
        c: AppContext,
        channel: Channel,
        word: string,
        fields: SubmitFields,
        field: InvalidField,
    ): Promise<Response> {
        const {code, title, message} = fieldCopy(field, channel)
        if (channel === 'json') return jsonError(c, 422, code, message)
        if (channel === 'form') return configPageWithError(c, word, fields, message)
        return errorPage(c, 422, {title, message})

        function fieldCopy (field: InvalidField, channel: Channel): {code: string, title: string, message: string} {
            switch (field) {
                case 'content':
                    return {code: 'invalid_content', title: 'Invalid content', message: CONTENT_ERROR}
                case 'maxAge':
                    return {
                        code: 'invalid_max_age',
                        title: 'Invalid max-age',
                        message: channel === 'json' ? MAX_AGE_BODY_ERROR : MAX_AGE_ERROR,
                    }
                case 'secretType':
                    return {code: 'invalid_secret', title: 'Invalid secret', message: SECRET_TYPE_ERROR}
                case 'secretLength':
                    return {code: 'invalid_secret', title: 'Invalid secret', message: SECRET_ERROR}
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
    }

    /**
     * Claims the first free candidate. The atomic INSERT both checks uniqueness and
     * stores the alias, so concurrent creates never claim the same word.
     */
    async function claimAlias (c: AppContext, chosen: string | undefined, draft: Draft): Promise<Claim> {
        if (chosen !== undefined) {
            return await storeAlias(c, chosen, draft)
                ? {kind: 'claimed', word: chosen}
                : {kind: 'conflict', word: chosen}
        }

        for (const word of generatedWords()) {
            if (await storeAlias(c, word, draft)) return {kind: 'claimed', word}
        }
        return {kind: 'exhausted'}

        function* generatedWords (): Generator<string> {
            for (let attempt = 0; attempt < MAX_INSERT_ATTEMPTS; attempt += 1) {
                yield generateWord(attempt)
            }
        }

        async function storeAlias (c: AppContext, word: string, draft: Draft): Promise<boolean> {
            const now = nowSeconds()
            const alias = {
                word,
                content: await encryptContent(
                    {salt: c.env.SECRET_SALT, word, secret: draft.secret},
                    draft.content,
                ),
                secret: draft.secret === null
                    ? null
                    : await hashSecret(c.env.SECRET_SALT, word, draft.secret),
                createdAt: now,
                expiresAt: expiresAtFor(draft.maxAge, now),
            }
            if (await insertAlias(c.env.DB, alias)) return true
            // The row still holding this word may have expired meanwhile.
            if (!(await reclaimExpiredAlias(c.env.DB, word, now))) return false
            return insertAlias(c.env.DB, alias)
        }
    }

    async function respondCreated (
        c: AppContext,
        channel: Channel,
        chosen: string | undefined,
        word: string,
        draft: Draft,
    ): Promise<Response> {
        if (channel === 'json') {
            c.header('Location', `/${word}`)
            c.header('Cache-Control', NO_STORE)
            return c.json({
                word,
                url: `${new URL(c.req.url).origin}/${word}`,
                oneTime: draft.maxAge === 0,
                private: draft.secret !== null,
            }, 201)
        }

        if (channel === 'path' && chosen !== undefined && draft.maxAge !== 0) {
            return redirectPage(c, `/${word}`, 303)
        }

        c.header('Location', `/${word}`)
        return htmlPage(
            c,
            await renderCreatedPage(c.env.ASSETS, {
                word,
                origin: new URL(c.req.url).origin,
                oneTime: draft.maxAge === 0,
                privateAlias: draft.secret !== null,
            }),
            201,
        )
    }

    function exhaustedResponse (c: AppContext, channel: Channel): Response | Promise<Response> {
        c.header('Retry-After', '1')
        if (channel === 'json') {
            return jsonError(
                c,
                503,
                'word_exhausted',
                'Could not allocate a word. Please try again in a moment.',
            )
        }
        return errorPage(c, 503)
    }
}

function conflictResponse (c: AppContext, channel: Channel, word: string): Response | Promise<Response> {
    const message = `The word "${word}" has already been claimed. Words are immutable.`
    if (channel === 'json') return jsonError(c, 409, 'word_exists', message)
    return errorPage(c, 409, {message})
}
