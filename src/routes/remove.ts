import {deleteAlias, getAlias, reclaimExpiredAlias} from '../db/repo'
import {readJsonObject} from '../lib/json'
import {isExpired, nowSeconds} from '../lib/lifetime'
import {jsonError, NO_STORE} from '../lib/respond'
import type {AppContext} from '../lib/respond'
import {verifySecret} from '../lib/secrets'
import {parseWordParam} from '../lib/words'

export async function removeWord (c: AppContext): Promise<Response> {
    const param = parseWordParam(c.req.param('word') ?? '')

    if (param.kind === 'invalid' || param.kind === 'generated') return jsonError(c, 422, 'invalid_word', 'Invalid word.')
    const {word} = param

    const parsed = await readJsonObject(c)
    if (!parsed.ok) return parsed.response

    const secret = parsed.body.secret
    if (typeof secret !== 'string' || secret.length === 0) {
        return jsonError(c, 403, 'forbidden', 'A secret is required.')
    }

    const row = await getAlias(c.env.DB, word)
    if (!row) {
        return jsonError(c, 404, 'not_found', 'Alias not found.')
    }

    const now = nowSeconds()
    if (isExpired(row.expires_at, now)) {
        await reclaimExpiredAlias(c.env.DB, word, now)
        return jsonError(c, 410, 'expired', 'Alias expired.')
    }

    if (row.secret === null) {
        return jsonError(c, 403, 'forbidden', 'Public aliases cannot be deleted.')
    }

    if (!(await verifySecret(c.env.SECRET_SALT, word, secret, row.secret))) {
        return jsonError(c, 403, 'forbidden', 'Invalid secret.')
    }

    await deleteAlias(c.env.DB, word)
    c.header('Cache-Control', NO_STORE)
    return c.body(null, 204)
}
