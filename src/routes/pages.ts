import {consumeOneTime, getAlias, reclaimExpiredAlias} from '../db/repo'
import {prefersHtml, prefersJson} from '../lib/accept'
import {bearerSecret} from '../lib/auth'
import {isHttpUrl, isValidSecret} from '../lib/content'
import {decryptContent} from '../lib/content-crypto'
import {renderAuthPage, renderConfigPage, renderContentPage} from '../lib/html'
import {isExpired, isOneTime, nowSeconds} from '../lib/lifetime'
import {
    errorPage,
    htmlPage,
    invalidWordPage,
    NO_STORE,
    publicCache,
    redirectPage,
    textPage,
    unauthorizedPage,
} from '../lib/respond'
import type {AppContext} from '../lib/respond'
import {verifySecret} from '../lib/secrets'
import {GENERATED_WORD, parseWordParam} from '../lib/words'

export async function showWord (c: AppContext): Promise<Response> {
    const param = parseWordParam(c.req.param('word') ?? '')
    if (param.kind === 'invalid') {
        return invalidWordPage(c)
    }
    if (param.kind === 'generated') {
        return htmlPage(
            c,
            await renderConfigPage(c.env.ASSETS, {
                word: GENERATED_WORD,
                generated: true,
            }),
        )
    }

    const word = param.word

    const row = await getAlias(c.env.DB, word)
    if (!row) return htmlPage(c, await renderConfigPage(c.env.ASSETS, {word}))

    const now = nowSeconds()
    if (isExpired(row.expires_at, now)) {
        await reclaimExpiredAlias(c.env.DB, word, now)
        return errorPage(c, 410)
    }

    const secretHash = row.secret
    let suppliedSecret: string | null = null
    if (secretHash !== null) {
        if (c.req.header('authorization') === undefined && prefersHtml(c.req.header('accept'))) {
            c.header('Vary', 'Authorization')
            return htmlPage(
                c,
                await renderAuthPage(c.env.ASSETS, {word}),
            )
        }
        suppliedSecret = await validSecret(c, word, secretHash)
        if (suppliedSecret === null) return unauthorizedPage(c)
        c.header('Vary', 'Authorization')
    }

    const content = await readAliasContent(c, row, suppliedSecret)
    if (content === null) {
        return errorPage(c, 404, {
            title: 'Alias consumed',
            message: 'This one-time alias has already been used.',
        })
    }
    if (suppliedSecret !== null && prefersJson(c.req.header('accept'))) {
        return jsonContent(c, content)
    }

    const stateful = suppliedSecret !== null || isOneTime(row.expires_at)
    const cacheControl = stateful ? NO_STORE : publicCache(row.expires_at, now)

    if (isHttpUrl(content)) {
        return redirectPage(c, content, stateful ? 302 : 301, cacheControl)
    }

    c.header('Vary', secretHash === null ? 'Accept' : 'Authorization, Accept')
    if (prefersHtml(c.req.header('accept'))) {
        return htmlPage(
            c,
            await renderContentPage(c.env.ASSETS, {word, content}),
            200,
            cacheControl,
        )
    }
    return textPage(c, content, 200, cacheControl)

    async function validSecret (
        c: AppContext,
        word: string,
        expected: string,
    ): Promise<string | null> {
        const supplied = bearerSecret(c)
        if (supplied === null || !isValidSecret(supplied)) return null
        const matches = await verifySecret(
            c.env.SECRET_SALT,
            word,
            supplied,
            expected,
        )
        return matches ? supplied : null
    }

    async function readAliasContent (
        c: AppContext,
        row: {word: string, content: string, expires_at: number | null},
        secret: string | null,
    ): Promise<string | null> {
        const context = {salt: c.env.SECRET_SALT, word: row.word, secret}
        if (isOneTime(row.expires_at)) {
            const consumed = await consumeOneTime(c.env.DB, row.word)
            return consumed === null ? null : decryptContent(context, consumed)
        }
        return row.expires_at === null
            ? row.content
            : decryptContent(context, row.content)
    }

    function jsonContent (c: AppContext, content: string): Response {
        c.header('Cache-Control', NO_STORE)
        c.header('X-Content-Type-Options', 'nosniff')
        return c.json({content})
    }
}
