import {Hono} from 'hono'
import type {Env} from './types'
import {prefersJson} from './lib/accept'
import {renderIndexPage} from './lib/html'
import {isRateLimited, RETRY_AFTER_SECONDS} from './lib/rate-limit'
import {errorPage, htmlPage, rateLimitedPage, redirectPage} from './lib/respond'
import {showWord} from './routes/pages'
import {pathCreate, submitWord} from './routes/submit'
import {removeWord} from './routes/remove'

const app = new Hono<{Bindings: Env}>()

app.use('*', async (c, next) => {
    c.header('Referrer-Policy', 'no-referrer')
    if (await isRateLimited(c)) {
        return rateLimitedPage(c, RETRY_AFTER_SECONDS)
    }
    if (c.req.method === 'HEAD') {
        c.header('Cache-Control', 'no-store')
        return c.body(null, 200)
    }
    if (c.req.method === 'OPTIONS') {
        c.header('Allow', 'GET, HEAD, POST, DELETE, OPTIONS')
        c.header('Cache-Control', 'no-store')
        return c.body(null, 204)
    }
    await next()
})

app.get('/', async (c) => {
    if (prefersJson(c.req.header('accept'))) {
        c.header('Cache-Control', 'no-store')
        return c.json({ok: true})
    }
    return htmlPage(c, await renderIndexPage(c.env.ASSETS))
})

app.get('/index.html', c => redirectPage(c, '/', 301, 'no-store'))

// `:word` accepts `-` as a generated-word wildcard on every route.
app.get('/:word', showWord)
app.get('/:word/*', pathCreate)
app.post('/:word', submitWord)
app.delete('/:word', removeWord)

app.notFound(c => errorPage(c, 404))

app.onError((_error, c) => errorPage(c, 500))

export default app
