import {
    SELF,
    createExecutionContext,
    createScheduledController,
    env,
    waitOnExecutionContext,
} from 'cloudflare:test'
import {describe, expect, it} from 'vitest'
import {insertAlias} from '../src/db/repo'
import worker from '../src/index'
import {decryptContent} from '../src/lib/content-crypto'
import {DEFAULT_MAX_AGE, MAX_MAX_AGE} from '../src/lib/lifetime'

const BASE = 'https://aka.test'

let nextClientIp = 0

/** Every test request comes from its own client IP so one test never spends another's budget. */
function uniqueClientIp (): string {
    nextClientIp += 1
    return `10.${Math.floor(nextClientIp / 65536) % 256}.${Math.floor(nextClientIp / 256) % 256}.${nextClientIp % 256}`
}

function request (path: string, init: RequestInit = {}): Promise<Response> {
    const headers = new Headers(init.headers)
    if (!headers.has('cf-connecting-ip')) {
        headers.set('cf-connecting-ip', uniqueClientIp())
    }
    return SELF.fetch(`${BASE}${path}`, {redirect: 'manual', ...init, headers})
}

function get (path: string): Promise<Response> {
    return request(path)
}

function getWithAuth (path: string, secret: string): Promise<Response> {
    return request(path, {
        headers: {authorization: `Bearer ${secret}`},
    })
}

function postJson (path: string, body: Record<string, unknown>): Promise<Response> {
    return request(path, {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify(body),
    })
}

function postForm (path: string, fields: Record<string, string>): Promise<Response> {
    return request(path, {
        method: 'POST',
        headers: {'content-type': 'application/x-www-form-urlencoded'},
        body: new URLSearchParams(fields).toString(),
    })
}

function deleteAlias (word: string, secret: string): Promise<Response> {
    return request(`/${word}`, {
        method: 'DELETE',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({secret}),
    })
}

async function aliasRow (word: string): Promise<{
    content: string
    secret: string | null
    created_at: number
    expires_at: number | null
} | null> {
    return env.DB.prepare(
        'SELECT content, secret, created_at, expires_at FROM aliases WHERE word = ?',
    )
        .bind(word)
        .first()
}

function expectNoReferrer (response: Response): void {
    expect(response.headers.get('referrer-policy')).toBe('no-referrer')
}

async function runScheduledRetention (): Promise<void> {
    const controller = createScheduledController({
        scheduledTime: Date.now(),
        cron: '0 3 * * *',
    })
    const context = createExecutionContext()
    await worker.scheduled(controller, env, context)
    await waitOnExecutionContext(context)
}

// HTML rendering is covered by the Playwright smoke tests in e2e/.
function expectHtml (response: Response, status = 200): void {
    expect(response.status).toBe(status)
    expect(response.headers.get('content-type')).toContain('text/html')
}

describe('aka worker', () => {
    it('serves the index page to browsers', async () => {
        const response = await get('/')
        expectHtml(response)
        expectNoReferrer(response)
    })

    it('renders the shared header and footer on index and form pages', async () => {
        const index = await (await get('/')).text()
        expect(index).toContain('class="site-header"')
        expect(index).toContain('<footer class="site-footer')
        expect(index).not.toContain('{{>')

        const config = await (await get('/shared-partials')).text()
        expect(config).toContain('class="site-header"')
        expect(config).toContain('<footer class="site-footer')
        expect(config).not.toContain('{{>')
    })

    it('redirects /index.html to the canonical index page', async () => {
        const response = await get('/index.html')
        expect(response.status).toBe(301)
        expect(response.headers.get('location')).toBe('/')
        expect(response.headers.get('cache-control')).toBe('no-store')
    })

    it('serves JSON status when JSON is preferred', async () => {
        const response = await request('/', {
            headers: {accept: 'application/json'},
        })
        expect(response.status).toBe(200)
        expect(await response.json()).toEqual({ok: true})
        expectNoReferrer(response)
    })

    it('keeps HTML when both formats are equally acceptable', async () => {
        const response = await request('/', {
            headers: {accept: 'text/html,application/json'},
        })
        expect(response.headers.get('content-type')).toContain('text/html')
    })

    it('uses quality values to pick JSON when it is preferred', async () => {
        const response = await request('/', {
            headers: {accept: 'application/json;q=1,text/html;q=0.5'},
        })
        expect(await response.json()).toEqual({ok: true})
    })

    it('serves CSS from static assets with security headers', async () => {
        const css = await env.ASSETS.fetch(
            new Request('https://assets.local/style.css'),
        )
        expect(css.status).toBe(200)
        expect(css.headers.get('content-type')).toContain('text/css')
        expect(css.headers.get('referrer-policy')).toBe('no-referrer')
    })

    it('does not expose template files directly', async () => {
        for (const path of ['/_templates/config.html', '/_templates/index.html']) {
            const response = await get(path)
            expect(response.status).toBe(422)
            expect(response.headers.get('content-type')).toContain('text/html')
        }
    })

    it('allows `templates` to be used as an ordinary word', async () => {
        const created = await get('/templates/https://example.com/templates')
        expect(created.status).toBe(303)
        expect(created.headers.get('location')).toBe('/templates')

        const resolved = await get('/templates')
        expect(resolved.status).toBe(301)
        expect(resolved.headers.get('location')).toBe('https://example.com/templates')
    })

    it('allows `api` as an ordinary word and keeps only `/` special', async () => {
        expectHtml(await get('/api'))

        const created = await get('/api/https://example.com/api')
        expect(created.status).toBe(303)
        expect(created.headers.get('location')).toBe('/api')

        const resolved = await get('/api')
        expect(resolved.status).toBe(301)
        expect(resolved.headers.get('location')).toBe('https://example.com/api')
    })

    it('serves the terms-of-use alias inserted by the initial migration', async () => {
        const stored = await aliasRow('terms-of-use')
        expect(stored).not.toBeNull()
        expect(stored?.secret).toBeNull()
        expect(stored?.expires_at).toBeNull()

        const terms = await get('/terms-of-use')
        expect(terms.status).toBe(200)
        expect(terms.headers.get('content-type')).toContain('text/plain')
        expect(terms.headers.get('cache-control')).toBe('public, max-age=3600')
        const body = await terms.text()
        expect(body).toContain('TERMS OF USE')
        expect(body).toContain('Last updated')
        expect(body.length).toBeGreaterThan(1000)
        expect(stored?.content).toBe(body)

        const normalized = await get('/Terms-Of-Use')
        expect(normalized.status).toBe(200)
        expect(await normalized.text()).toBe(body)

        expectHtml(await get('/terms-of-use/https://example.com'), 409)
        expect((await postJson('/terms-of-use', {content: 'hello'})).status).toBe(409)
        expect((await deleteAlias('terms-of-use', 'secret')).status).toBe(403)
    })

    it('rejects a NULL expiry when writing an alias from the application', async () => {
        await expect(
            insertAlias(env.DB, {
                word: 'null-expiry',
                content: 'hello',
                secret: null,
                createdAt: Math.floor(Date.now() / 1000),
                expiresAt: null as unknown as number,
            }),
        ).rejects.toThrow('expiresAt')
    })

    it('shows the config page for a free word', async () => {
        const response = await get('/open')
        expect(response.status).toBe(200)
        expect(response.headers.get('content-type')).toContain('text/html')
        expect(response.headers.get('content-security-policy')).toContain(
            'form-action \'self\'',
        )
        expect(response.headers.get('x-robots-tag')).toBe('noindex')
        expectNoReferrer(response)
    })

    it('serves the demo alias inserted by the initial migration', async () => {
        const gatha = '一切有为法\n如梦幻泡影\n如露亦如电\n应作如是观'
        const stored = await aliasRow('diamond-sutra')
        expect(stored?.secret).toBeNull()
        expect(stored?.expires_at).toBeNull()
        expect(stored?.content).toBe(gatha)

        const resolved = await get('/diamond-sutra')
        expect(resolved.status).toBe(200)
        expect(resolved.headers.get('content-type')).toContain('text/plain')
        expect(resolved.headers.get('cache-control')).toBe('public, max-age=3600')
        expect(await resolved.text()).toBe(gatha)
    })

    it('normalizes chosen words to lowercase and trims surrounding whitespace', async () => {
        expect((await get('/%20Brave-Otter%20/hello')).status).toBe(303)

        const resolved = await get('/brave-otter')
        expect(resolved.status).toBe(200)
        expect(await resolved.text()).toBe('hello')
    })

    it('creates a chosen-word public URL alias and redirects', async () => {
        const created = await get('/alpha/https://example.com/path')
        expect(created.status).toBe(303)
        expect(created.headers.get('location')).toBe('/alpha')
        expect(created.headers.get('cache-control')).toBe('no-store')
        expectNoReferrer(created)

        const resolved = await get('/alpha')
        expect(resolved.status).toBe(301)
        expect(resolved.headers.get('location')).toBe('https://example.com/path')
        expect(resolved.headers.get('cache-control')).toMatch(
            /^public, max-age=\d+, immutable$/,
        )
        expect(resolved.headers.get('x-robots-tag')).toBe('noindex')
        expectNoReferrer(resolved)
    })

    it('returns text content as plain text', async () => {
        const created = await get('/note/hello%20world')
        expect(created.status).toBe(303)

        const resolved = await get('/note')
        expect(resolved.status).toBe(200)
        expect(resolved.headers.get('content-type')).toContain('text/plain')
        expect(await resolved.text()).toBe('hello world')
        expect(resolved.headers.get('cache-control')).toMatch(
            /^public, max-age=\d+, immutable$/,
        )
    })

    it('renders a public text alias as an HTML page when HTML is preferred', async () => {
        expect((await get('/browser-note/some%20%3Cb%3Etext')).status).toBe(303)

        const page = await request('/browser-note', {
            headers: {accept: 'text/html,application/xhtml+xml,*/*;q=0.8'},
        })
        expectHtml(page)
        expect(page.headers.get('cache-control')).toMatch(
            /^public, max-age=\d+, immutable$/,
        )
        expect(page.headers.get('vary')).toBe('Accept')
        expect(page.headers.get('x-robots-tag')).toBe('noindex')
        expectNoReferrer(page)

        const body = await page.text()
        expect(body).toContain('id="alias-content"')
        expect(body).toContain('id="copy-content"')
        expect(body).toContain('src="/content.js"')
        expect(body).toContain('some &lt;b&gt;text')
        expect(body).not.toContain('<b>text')

        const plain = await request('/browser-note', {headers: {accept: 'text/plain'}})
        expect(plain.status).toBe(200)
        expect(plain.headers.get('content-type')).toContain('text/plain')
        expect(plain.headers.get('vary')).toBe('Accept')
        expect(await plain.text()).toBe('some <b>text')
    })

    it('renders a private text alias as an HTML page for a Bearer HTML read', async () => {
        expect((await postJson('/private-page', {
            content: 'private page text',
            secret: 'page-secret',
            maxAge: 60,
        })).status).toBe(201)

        const page = await request('/private-page', {
            headers: {
                accept: 'text/html,application/xhtml+xml,*/*;q=0.8',
                authorization: 'Bearer page-secret',
            },
        })
        expectHtml(page)
        expect(page.headers.get('cache-control')).toBe('no-store')
        expect(page.headers.get('vary')).toBe('Authorization, Accept')
        expect(await page.text()).toContain('private page text')
    })

    it('creates a public alias from a JSON POST', async () => {
        const created = await postJson('/json-public', {
            content: 'hello from json',
            maxAge: 60,
        })
        expect(created.status).toBe(201)
        expect(created.headers.get('location')).toBe('/json-public')
        expect(created.headers.get('cache-control')).toBe('no-store')
        expect(await created.json()).toEqual({
            word: 'json-public',
            url: 'https://aka.test/json-public',
            oneTime: false,
            private: false,
        })

        const resolved = await get('/json-public')
        expect(resolved.status).toBe(200)
        expect(await resolved.text()).toBe('hello from json')
    })

    it('creates aliases from HTML form posts', async () => {
        const created = await postForm('/form-private', {
            'content': 'https://example.com/form',
            'secret': 'form-secret',
            'max-age': '86400',
        })
        expect(created.status).toBe(201)
        expect(created.headers.get('location')).toBe('/form-private')
        expect(created.headers.get('cache-control')).toBe('no-store')
        expect(created.headers.get('content-type')).toContain('text/html')

        expect((await get('/form-private')).status).toBe(401)
        const unlocked = await getWithAuth('/form-private', 'form-secret')
        expect(unlocked.status).toBe(302)
        expect(unlocked.headers.get('location')).toBe('https://example.com/form')

        const generated = await postForm('/-', {
            'content': 'hello from a form',
            'max-age': '0',
        })
        expect(generated.status).toBe(201)
        expect(generated.headers.get('content-type')).toContain('text/html')
        const word = generated.headers.get('location')!.slice(1)
        expect(word).toMatch(/^[a-z0-9][a-z0-9_-]{1,31}$/)

        const read = await get(`/${word}`)
        expect(read.status).toBe(200)
        expect(await read.text()).toBe('hello from a form')
        expectHtml(await get(`/${word}`))
    })

    it('renders form validation errors as HTML and ignores a secret query', async () => {
        const missingContent = await postForm('/form-error', {'max-age': '604800'})
        expectHtml(missingContent, 422)

        const badMaxAge = await postForm('/form-error', {
            'content': 'hello',
            'max-age': String(MAX_MAX_AGE + 1),
        })
        expectHtml(badMaxAge, 422)

        const unitMaxAge = await postForm('/form-error', {
            'content': 'hello',
            'max-age': '3d',
        })
        expectHtml(unitMaxAge, 422)

        const secretQuery = await postForm('/form-error?secret=x', {
            content: 'hello',
        })
        expectHtml(secretQuery, 201)
        expect(secretQuery.headers.get('location')).toBe('/form-error')
        expect((await aliasRow('form-error'))?.secret).toBeNull()
        expect(await (await get('/form-error')).text()).toBe('hello')
    })

    it('rejects non-JSON, non-form POST bodies and non-string content, and ignores a secret query', async () => {
        const plain = await request('/bad-json', {
            method: 'POST',
            headers: {'content-type': 'text/plain'},
            body: 'content=hello',
        })
        expect(plain.status).toBe(400)

        const malformed = await request('/bad-json', {
            method: 'POST',
            headers: {'content-type': 'application/json'},
            body: '{',
        })
        expect(malformed.status).toBe(400)

        const wrongType = await postJson('/bad-json', {content: 42})
        expect(wrongType.status).toBe(422)
        expect(await wrongType.json()).toMatchObject({
            error: {code: 'invalid_content'},
        })

        const secretQuery = await postJson('/bad-json?secret=x', {
            content: 'hello',
        })
        expect(secretQuery.status).toBe(201)
        expect(await secretQuery.json()).toMatchObject({
            word: 'bad-json',
            private: false,
        })
        expect((await aliasRow('bad-json'))?.secret).toBeNull()
        expect(await (await get('/bad-json')).text()).toBe('hello')
    })

    it('rejects duplicate words and invalid max-age, and ignores a secret query', async () => {
        expect((await get('/taken/one')).status).toBe(303)
        expect((await get('/taken/two')).status).toBe(409)
        expect((await get('/taken/two?secret=x')).status).toBe(409)

        expect((await get('/secret-query/hello?secret=x')).status).toBe(303)
        expect((await aliasRow('secret-query'))?.secret).toBeNull()
        expect(await (await get('/secret-query?secret=x')).text()).toBe('hello')

        expect((await get('/bad/hello?max-age=-1')).status).toBe(422)
        expect((await get('/bad/hello?max-age=1.5')).status).toBe(422)
        expect((await get('/bad/hello?max-age=abc')).status).toBe(422)
        expect((await get('/bad/hello?max-age=1w')).status).toBe(422)
        expect((await get('/bad/hello?max-age=3d')).status).toBe(422)
        expect((await get('/bad/hello?max-age=30min')).status).toBe(422)
        expect((await get(`/bad/hello?max-age=${MAX_MAX_AGE + 1}`)).status).toBe(422)

        const unitMaxAge = await postJson('/bad-json', {
            content: 'hello',
            maxAge: '3d',
        })
        expect(unitMaxAge.status).toBe(422)
        expect(await unitMaxAge.json()).toMatchObject({
            error: {code: 'invalid_max_age'},
        })
    })

    it('returns 409 for an existing word before content or max-age validation', async () => {
        expect((await get('/existing/one')).status).toBe(303)

        expectHtml(await get('/existing/'), 409)
        expect((await get('/existing/one?max-age=3d')).status).toBe(409)

        const badContent = await postJson('/existing', {content: 42})
        expect(badContent.status).toBe(409)

        const badMaxAge = await postJson('/existing', {
            content: 'hello',
            maxAge: '3d',
        })
        expect(badMaxAge.status).toBe(409)

        expectHtml(await postForm('/existing', {'max-age': '3d'}), 409)

        const malformedBody = await request('/existing', {
            method: 'POST',
            headers: {'content-type': 'application/json'},
            body: '{',
        })
        expect(malformedBody.status).toBe(400)
    })

    it('creates a private alias and authenticates GET with Bearer', async () => {
        const config = await get('/private')
        expect(config.status).toBe(200)

        const created = await postJson('/private', {
            content: 'https://example.com/private',
            secret: 'hunter2',
            maxAge: MAX_MAX_AGE,
        })
        expect(created.status).toBe(201)
        expect(created.headers.get('location')).toBe('/private')
        expect(created.headers.get('location')).not.toContain('hunter2')
        expect(await created.json()).toMatchObject({
            word: 'private',
            private: true,
            oneTime: false,
        })

        const stored = (await aliasRow('private'))?.content ?? ''
        expect(stored).not.toContain('example.com')
        expect(
            await decryptContent(
                {salt: 'test-salt', word: 'private', secret: 'hunter2'},
                stored,
            ),
        ).toBe('https://example.com/private')
        await expect(
            decryptContent(
                {salt: 'test-salt', word: 'private', secret: null},
                stored,
            ),
        ).rejects.toThrow()
        await expect(
            decryptContent(
                {salt: 'test-salt', word: 'private', secret: 'wrong'},
                stored,
            ),
        ).rejects.toThrow()

        const missing = await get('/private')
        expect(missing.status).toBe(401)
        expect(missing.headers.get('www-authenticate')).toContain('Bearer')
        expect(missing.headers.get('vary')).toContain('Authorization')

        const wrong = await getWithAuth('/private', 'wrong')
        expect(wrong.status).toBe(401)

        const unlocked = await getWithAuth('/private', 'hunter2')
        expect(unlocked.status).toBe(302)
        expect(unlocked.headers.get('location')).toBe('https://example.com/private')
        expect(unlocked.headers.get('cache-control')).toBe('no-store')
        expect(unlocked.headers.get('vary')).toContain('Authorization')
    })

    it('returns private text with no-store and Vary: Authorization', async () => {
        const created = await postJson('/private-text', {
            content: 'just text',
            secret: 'text-secret',
            maxAge: 60,
        })
        expect(created.status).toBe(201)

        const missing = await get('/private-text')
        expect(missing.status).toBe(401)

        const unlocked = await getWithAuth('/private-text', 'text-secret')
        expect(unlocked.status).toBe(200)
        expect(unlocked.headers.get('content-type')).toContain('text/plain')
        expect(unlocked.headers.get('cache-control')).toBe('no-store')
        expect(unlocked.headers.get('vary')).toContain('Authorization')
        expect(await unlocked.text()).toBe('just text')
    })

    it('renders the secret prompt page directly for a browser private read', async () => {
        const created = await postJson('/browser-private', {
            content: 'browser secret text',
            secret: 'browser-secret',
            maxAge: 60,
        })
        expect(created.status).toBe(201)

        const page = await request('/browser-private', {
            headers: {accept: 'text/html,application/xhtml+xml,*/*;q=0.8'},
        })
        expectHtml(page)
        expect(page.headers.get('cache-control')).toBe('no-store')
        expect(page.headers.get('x-robots-tag')).toBe('noindex')
        expect(page.headers.get('vary')).toContain('Authorization')
        expect(page.headers.get('location')).toBeNull()
        expectNoReferrer(page)

        const body = await page.text()
        expect(body).toContain('id="auth-form"')
        expect(body).toContain('src="/auth.js"')
        expect(body).toContain('type="password"')
        expect(body).toContain('autocomplete="off"')
        expect(body).not.toContain('name="unlock"')
    })

    it('serves private content as JSON for the prompt page fetch', async () => {
        expect((await postJson('/json-text', {
            content: 'json secret text',
            secret: 'json-secret',
            maxAge: 60,
        })).status).toBe(201)
        expect((await postJson('/json-url', {
            content: 'https://example.com/json',
            secret: 'json-secret',
            maxAge: 60,
        })).status).toBe(201)

        const text = await request('/json-text', {
            headers: {
                accept: 'application/json',
                authorization: 'Bearer json-secret',
            },
        })
        expect(text.status).toBe(200)
        expect(text.headers.get('content-type')).toContain('application/json')
        expect(text.headers.get('cache-control')).toBe('no-store')
        expect(text.headers.get('vary')).toContain('Authorization')
        expect(await text.json()).toEqual({content: 'json secret text'})

        const url = await request('/json-url', {
            headers: {
                accept: 'application/json',
                authorization: 'Bearer json-secret',
            },
        })
        expect(url.status).toBe(200)
        expect(await url.json()).toEqual({content: 'https://example.com/json'})

        expect((await request('/json-text', {
            headers: {
                accept: 'application/json',
                authorization: 'Bearer wrong',
            },
        })).status).toBe(401)

        expect((await request('/json-text', {
            headers: {accept: 'application/json'},
        })).status).toBe(401)

        expect((await get('/json-public/https://example.com/public')).status).toBe(303)
        expect((await request('/json-public', {
            headers: {accept: 'application/json'},
        })).status).toBe(301)
    })

    it('consumes a private one-time alias only after a successful JSON unlock', async () => {
        expect((await postJson('/json-once', {
            content: 'one-time json',
            secret: 'once-secret',
            maxAge: 0,
        })).status).toBe(201)

        const page = await request('/json-once', {headers: {accept: 'text/html'}})
        expectHtml(page)
        expect(await aliasRow('json-once')).not.toBeNull()

        expect((await request('/json-once', {
            headers: {
                accept: 'application/json',
                authorization: 'Bearer wrong',
            },
        })).status).toBe(401)
        expect(await aliasRow('json-once')).not.toBeNull()

        const unlocked = await request('/json-once', {
            headers: {
                accept: 'application/json',
                authorization: 'Bearer once-secret',
            },
        })
        expect(unlocked.status).toBe(200)
        expect(await unlocked.json()).toEqual({content: 'one-time json'})
        expect(await aliasRow('json-once')).toBeNull()

        expectHtml(await get('/json-once'))
    })

    it('keeps POST creation-only while the prompt page uses GET', async () => {
        expect((await postJson('/create-only', {
            content: 'hello',
            secret: 'create-secret',
            extra: '1',
        })).status).toBe(201)
        expect((await postJson('/create-only', {content: 'again'})).status).toBe(409)

        expect((await postForm('/form-create-only', {content: 'hello'})).status).toBe(201)
        expectHtml(await postForm('/form-create-only', {content: 'hello'}), 409)
        expectHtml(await postForm('/form-create-only-missing', {secret: 'xx'}), 422)
    })

    it('treats an empty secret as public', async () => {
        const created = await postJson('/empty-secret', {
            content: 'hello',
            secret: '',
        })
        expect(created.status).toBe(201)
        expect(await created.json()).toMatchObject({
            word: 'empty-secret',
            private: false,
        })
        expect((await aliasRow('empty-secret'))?.secret).toBeNull()

        const resolved = await get('/empty-secret')
        expect(resolved.status).toBe(200)
        expect(await resolved.text()).toBe('hello')
    })

    it('validates secret type and length on create', async () => {
        const nonString = await postJson('/secret-type', {
            content: 'hello',
            secret: 42,
        })
        expect(nonString.status).toBe(422)
        expect(await nonString.json()).toMatchObject({
            error: {code: 'invalid_secret'},
        })

        const tooLong = await postJson('/secret-long', {
            content: 'hello',
            secret: 'a'.repeat(257),
        })
        expect(tooLong.status).toBe(422)
        expect(await tooLong.json()).toMatchObject({
            error: {code: 'invalid_secret'},
        })

        const longest = await postJson('/secret-max', {
            content: 'hello',
            secret: 'a'.repeat(256),
            maxAge: 60,
        })
        expect(longest.status).toBe(201)
        expect((await get('/secret-max')).status).toBe(401)
        const unlocked = await getWithAuth('/secret-max', 'a'.repeat(256))
        expect(unlocked.status).toBe(200)
        expect(await unlocked.text()).toBe('hello')
    })

    it('requires at least two characters for a secret', async () => {
        const tooShort = await postJson('/secret-short', {
            content: 'hello',
            secret: 'a',
        })
        expect(tooShort.status).toBe(422)
        expect(await tooShort.json()).toMatchObject({
            error: {code: 'invalid_secret'},
        })

        const shortest = await postJson('/secret-min', {
            content: 'hello',
            secret: 'ab',
        })
        expect(shortest.status).toBe(201)
        expect((await get('/secret-min')).status).toBe(401)
        expect(await (await getWithAuth('/secret-min', 'ab')).text()).toBe('hello')
        expect((await getWithAuth('/secret-min', 'a')).status).toBe(401)
    })

    it('burns a one-time public alias after one successful read', async () => {
        const created = await get('/once/https://example.com/once?max-age=0')
        expect(created.status).toBe(201)
        expect(created.headers.get('location')).toBe('/once')
        expect(created.headers.get('cache-control')).toBe('no-store')
        expect(created.headers.get('content-type')).toContain('text/html')

        const consumed = await get('/once')
        expect(consumed.status).toBe(302)
        expect(consumed.headers.get('location')).toBe('https://example.com/once')
        expect(consumed.headers.get('cache-control')).toBe('no-store')

        const again = await get('/once')
        expectHtml(again)
        expect(await aliasRow('once')).toBeNull()
    })

    it('retries generated words and returns 503 with Retry-After when allocation is exhausted', async () => {
        await env.DB.prepare(
            'CREATE TRIGGER fail_generated_insert BEFORE INSERT ON aliases BEGIN SELECT RAISE(IGNORE); END',
        ).run()

        try {
            const fromPath = await get('/-/hello')
            expectHtml(fromPath, 503)
            expect(fromPath.headers.get('retry-after')).toBe('1')

            const fromJson = await postJson('/-', {content: 'hello'})
            expect(fromJson.status).toBe(503)
            expect(fromJson.headers.get('retry-after')).toBe('1')
            expect(await fromJson.json()).toMatchObject({
                error: {code: 'word_exhausted'},
            })

            const fromForm = await postForm('/-', {content: 'hello'})
            expectHtml(fromForm, 503)
            expect(fromForm.headers.get('retry-after')).toBe('1')
        } finally {
            await env.DB.prepare('DROP TRIGGER IF EXISTS fail_generated_insert').run()
        }
    })

    it('burns a one-time text alias exactly once', async () => {
        const created = await get('/once-text/hello?max-age=0')
        expect(created.status).toBe(201)

        const first = await get('/once-text')
        expect(first.status).toBe(200)
        expect(await first.text()).toBe('hello')
        expect(first.headers.get('cache-control')).toBe('no-store')

        const second = await get('/once-text')
        expectHtml(second)
    })

    it('renders a one-time text alias as a no-store HTML page once', async () => {
        const created = await get('/once-page/hello%20page?max-age=0')
        expect(created.status).toBe(201)

        const first = await request('/once-page', {
            headers: {accept: 'text/html,application/xhtml+xml,*/*;q=0.8'},
        })
        expectHtml(first)
        expect(first.headers.get('cache-control')).toBe('no-store')
        expect(first.headers.get('vary')).toBe('Accept')
        expect(await first.text()).toContain('hello page')
        expect(await aliasRow('once-page')).toBeNull()

        const second = await get('/once-page')
        expectHtml(second)
        expect(await second.text()).toContain('id="create-form"')
    })

    it('does not burn a private one-time alias on a wrong Bearer secret', async () => {
        const created = await postJson('/once-private', {
            content: 'https://example.com/once-private',
            secret: 'sesame',
            maxAge: 0,
        })
        expect(created.status).toBe(201)

        const missing = await get('/once-private')
        expect(missing.status).toBe(401)

        const wrong = await getWithAuth('/once-private', 'nope')
        expect(wrong.status).toBe(401)
        expect(await aliasRow('once-private')).not.toBeNull()

        const correct = await getWithAuth('/once-private', 'sesame')
        expect(correct.status).toBe(302)
        expect(correct.headers.get('location')).toBe(
            'https://example.com/once-private',
        )
        expect(await aliasRow('once-private')).toBeNull()

        const again = await get('/once-private')
        expectHtml(again)
    })

    it('generates a public word through the shorthand route', async () => {
        const created = await get('/-/https://example.com/generated')
        expect(created.status).toBe(201)
        const location = created.headers.get('location')
        expect(location).toMatch(/^\/[a-z0-9][a-z0-9_-]{1,31}$/)
        const word = location!.slice(1)

        const resolved = await get(`/${word}`)
        expect(resolved.status).toBe(301)
        expect(resolved.headers.get('location')).toBe(
            'https://example.com/generated',
        )
    })

    it('treats the generated wildcard as a word on GET and POST', async () => {
        expectHtml(await get('/-'))

        const created = await postJson('/-', {
            content: 'https://example.com/generated-json',
            maxAge: 86400,
        })
        expect(created.status).toBe(201)
        const body = await created.json() as {
            word: string
            url: string
            oneTime: boolean
            private: boolean
        }
        expect(body.word).toMatch(/^[a-z0-9][a-z0-9_-]{1,31}$/)
        expect(body.url).toBe(`https://aka.test/${body.word}`)
        expect(body.oneTime).toBe(false)
        expect(body.private).toBe(false)
        expect(created.headers.get('location')).toBe(`/${body.word}`)

        const resolved = await get(`/${body.word}`)
        expect(resolved.status).toBe(301)
        expect(resolved.headers.get('location')).toBe(
            'https://example.com/generated-json',
        )
    })

    it('creates a private one-time alias with a generated word', async () => {
        const created = await postJson('/-', {
            content: 'https://example.com/generated-private',
            secret: 'generated-secret',
            maxAge: 0,
        })
        expect(created.status).toBe(201)
        const body = await created.json() as {word: string, oneTime: boolean, private: boolean}
        expect(body.oneTime).toBe(true)
        expect(body.private).toBe(true)

        expect((await get(`/${body.word}`)).status).toBe(401)
        const unlocked = await getWithAuth(`/${body.word}`, 'generated-secret')
        expect(unlocked.status).toBe(302)
        expect(unlocked.headers.get('location')).toBe(
            'https://example.com/generated-private',
        )
        expectHtml(await getWithAuth(`/${body.word}`, 'generated-secret'))
    })

    it('generates a one-time public word', async () => {
        const created = await get('/-/hello?max-age=0')
        expect(created.status).toBe(201)
        const word = created.headers.get('location')!.slice(1)

        const first = await get(`/${word}`)
        expect(first.status).toBe(200)
        expect(await first.text()).toBe('hello')

        const second = await get(`/${word}`)
        expectHtml(second)
    })

    it('treats a bare ?0 query as max-age=0 on both create shortcuts', async () => {
        const before = Math.floor(Date.now() / 1000)

        const chosen = await get('/zero-sugar/https://example.com/zero?0')
        expect(chosen.status).toBe(201)
        expect(chosen.headers.get('location')).toBe('/zero-sugar')
        expect((await aliasRow('zero-sugar'))?.expires_at).toBe(0)

        const first = await get('/zero-sugar')
        expect(first.status).toBe(302)
        expect(first.headers.get('location')).toBe('https://example.com/zero')
        expect(await aliasRow('zero-sugar')).toBeNull()

        const generated = await get('/-/zero?0')
        expect(generated.status).toBe(201)
        const word = generated.headers.get('location')!.slice(1)
        expect((await aliasRow(word))?.expires_at).toBe(0)

        expect((await get(`/${word}`)).status).toBe(200)
        expect(await aliasRow(word)).toBeNull()
        expectHtml(await get(`/${word}`))

        const explicitWins = await get('/zero-explicit/hello?max-age=60&0')
        expect(explicitWins.status).toBe(303)
        const explicitRow = await aliasRow('zero-explicit')
        expect(explicitRow?.expires_at).toBeGreaterThanOrEqual(before + 60)
        expect(explicitRow?.expires_at).toBeLessThanOrEqual(before + 60 + 2)
        expect((await get('/zero-explicit')).status).toBe(200)

        const valuedZero = await get('/zero-valued/hello?0=1')
        expect(valuedZero.status).toBe(303)
        const valuedRow = await aliasRow('zero-valued')
        expect(valuedRow?.expires_at).toBeGreaterThanOrEqual(before + DEFAULT_MAX_AGE)
        expect(valuedRow?.expires_at).toBeLessThanOrEqual(before + DEFAULT_MAX_AGE + 2)
        expect((await get('/zero-valued')).status).toBe(200)
    })

    it('applies the default lifetime to blank max-age values on every create path', async () => {
        const before = Math.floor(Date.now() / 1000)
        const expected = {min: before + DEFAULT_MAX_AGE - 2, max: before + DEFAULT_MAX_AGE + 2}

        expect((await get('/blank-path/hello?max-age=')).status).toBe(303)
        const pathRow = await aliasRow('blank-path')
        expect(pathRow?.expires_at).toBeGreaterThanOrEqual(expected.min)
        expect(pathRow?.expires_at).toBeLessThanOrEqual(expected.max)

        const json = await postJson('/blank-json', {
            content: 'hello',
            maxAge: '',
        })
        expect(json.status).toBe(201)
        const jsonRow = await aliasRow('blank-json')
        expect(jsonRow?.expires_at).toBeGreaterThanOrEqual(expected.min)
        expect(jsonRow?.expires_at).toBeLessThanOrEqual(expected.max)

        const form = await postForm('/blank-form', {
            'content': 'hello',
            'max-age': '',
        })
        expect(form.status).toBe(201)
        const formRow = await aliasRow('blank-form')
        expect(formRow?.expires_at).toBeGreaterThanOrEqual(expected.min)
        expect(formRow?.expires_at).toBeLessThanOrEqual(expected.max)
    })

    it('sets a one-week default and honours custom seconds', async () => {
        const before = Math.floor(Date.now() / 1000)
        expect((await get('/default/hello')).status).toBe(303)
        const defaultRow = await aliasRow('default')
        expect(defaultRow?.expires_at).toBeGreaterThanOrEqual(
            before + DEFAULT_MAX_AGE - 2,
        )
        expect(defaultRow?.expires_at).toBeLessThanOrEqual(
            before + DEFAULT_MAX_AGE + 2,
        )

        expect((await get('/custom/hello?max-age=60')).status).toBe(303)
        const customRow = await aliasRow('custom')
        expect(customRow?.expires_at).toBeGreaterThanOrEqual(before + 58)
        expect(customRow?.expires_at).toBeLessThanOrEqual(before + 62)

        expect((await get('/seconds/hello?max-age=259200')).status).toBe(303)
        const secondsRow = await aliasRow('seconds')
        expect(secondsRow?.expires_at).toBeGreaterThanOrEqual(
            before + 3 * 24 * 60 * 60 - 2,
        )
        expect(secondsRow?.expires_at).toBeLessThanOrEqual(
            before + 3 * 24 * 60 * 60 + 2,
        )

        const json = await postJson('/json-human', {
            content: 'hello',
            maxAge: 604800,
        })
        expect(json.status).toBe(201)
        const jsonRow = await aliasRow('json-human')
        expect(jsonRow?.expires_at).toBeGreaterThanOrEqual(
            before + DEFAULT_MAX_AGE - 2,
        )
        expect(jsonRow?.expires_at).toBeLessThanOrEqual(
            before + DEFAULT_MAX_AGE + 2,
        )
    })

    it('returns the 500 error page when stored content cannot be decrypted', async () => {
        const now = Math.floor(Date.now() / 1000)
        await env.DB.prepare(
            'INSERT INTO aliases (word, content, secret, created_at, expires_at) VALUES (?, ?, NULL, ?, ?)',
        )
            .bind('corrupt', 'not-ciphertext', now, now + 60)
            .run()

        const response = await get('/corrupt')
        expectHtml(response, 500)
        expectNoReferrer(response)
        expect(response.headers.get('cache-control')).toBe('no-store')
    })

    it('returns 410 and cleans up an expired alias', async () => {
        expect((await get('/expired/hello')).status).toBe(303)
        await env.DB.prepare('UPDATE aliases SET expires_at = ? WHERE word = ?')
            .bind(Math.floor(Date.now() / 1000) - 1, 'expired')
            .run()

        const response = await get('/expired')
        expect(response.status).toBe(410)
        expect(await response.text()).toContain('Alias expired')
        expect(await aliasRow('expired')).toBeNull()

        const free = await get('/expired')
        expectHtml(free)
    })

    it('only deletes private aliases with the matching secret', async () => {
        expect((await get('/public/hello')).status).toBe(303)
        expect((await deleteAlias('public', 'anything')).status).toBe(403)

        const created = await postJson('/deletable', {
            content: 'hello',
            secret: 'delete-me',
            maxAge: MAX_MAX_AGE,
        })
        expect(created.status).toBe(201)

        const noJson = await request('/deletable', {
            method: 'DELETE',
            body: JSON.stringify({secret: 'delete-me'}),
        })
        expect(noJson.status).toBe(400)

        const queryCreated = await postJson('/deletable-query', {
            content: 'hello',
            secret: 'delete-me',
            maxAge: MAX_MAX_AGE,
        })
        expect(queryCreated.status).toBe(201)

        const queryOnly = await request('/deletable-query?secret=delete-me', {
            method: 'DELETE',
            headers: {'content-type': 'application/json'},
            body: JSON.stringify({}),
        })
        expect(queryOnly.status).toBe(403)
        expect(await aliasRow('deletable-query')).not.toBeNull()

        const secretQuery = await request('/deletable-query?secret=wrong', {
            method: 'DELETE',
            headers: {'content-type': 'application/json'},
            body: JSON.stringify({secret: 'delete-me'}),
        })
        expect(secretQuery.status).toBe(204)
        expect(await aliasRow('deletable-query')).toBeNull()

        expect((await deleteAlias('deletable', 'wrong')).status).toBe(403)
        expect((await deleteAlias('deletable', 'delete-me')).status).toBe(204)
        expect(await aliasRow('deletable')).toBeNull()
    })

    it('accepts exactly 8 KiB of content and rejects one byte more', async () => {
        const exact = 'a'.repeat(8 * 1024)
        const exactCreated = await postJson('/exact-size', {content: exact})
        expect(exactCreated.status).toBe(201)
        const stored = (await aliasRow('exact-size'))?.content ?? ''
        expect(stored).not.toBe(exact)
        expect(
            await decryptContent(
                {salt: 'test-salt', word: 'exact-size', secret: null},
                stored,
            ),
        ).toBe(exact)

        const tooLong = 'a'.repeat(8 * 1024 + 1)
        expect((await get(`/big/${tooLong}`)).status).toBe(422)

        const created = await postJson('/needs-secret', {
            content: 'hello',
            secret: 'ss',
            maxAge: 60,
        })
        expect(created.status).toBe(201)

        const missing = await get('/needs-secret')
        expect(missing.status).toBe(401)
    })

    it('consumes a one-time alias exactly once under concurrent reads', async () => {
        expect((await get('/race-once/hello?max-age=0')).status).toBe(201)

        const responses = await Promise.all([
            get('/race-once'),
            get('/race-once'),
        ])
        const successes = responses.filter(response =>
            response.status === 200
            && response.headers.get('content-type')?.includes('text/plain'),
        )
        expect(successes).toHaveLength(1)
        expect(await successes[0]!.text()).toBe('hello')

        for (const response of responses) {
            if (response === successes[0]) continue
            expect([200, 404]).toContain(response.status)
            if (response.status === 200) {
                expect(response.headers.get('content-type')).toContain('text/html')
            }
        }
        expect(await aliasRow('race-once')).toBeNull()
    })

    it('preserves whitespace-only and percent-decoded path content', async () => {
        expect((await get('/spaces/%20%20')).status).toBe(303)
        const spaces = await get('/spaces')
        expect(spaces.status).toBe(200)
        expect(await spaces.text()).toBe('  ')

        expect((await get('/decoded/hello%20world%3Ffoo%3Dbar')).status).toBe(303)
        const decoded = await get('/decoded')
        expect(decoded.status).toBe(200)
        expect(await decoded.text()).toBe('hello world?foo=bar')

        expect((await get('/slash/left/right')).status).toBe(303)
        const slash = await get('/slash')
        expect(slash.status).toBe(200)
        expect(await slash.text()).toBe('left/right')

        const exact = '%41'.repeat(8 * 1024)
        expect((await get(`/encoded-exact/${exact}`)).status).toBe(303)
        expect((await get('/encoded-exact')).status).toBe(200)

        const oversized = '%41'.repeat(8 * 1024 + 1)
        expect((await get(`/encoded-too-big/${oversized}`)).status).toBe(422)
    })

    it('returns 400/404/410 for invalid, unknown, and expired delete targets', async () => {
        const invalid = await request('/_bad', {
            method: 'DELETE',
            headers: {'content-type': 'application/json'},
            body: JSON.stringify({secret: 'secret'}),
        })
        expect(invalid.status).toBe(422)
        expect(await invalid.json()).toMatchObject({
            error: {code: 'invalid_word'},
        })

        expect((await deleteAlias('never-created', 'secret')).status).toBe(404)

        const created = await postJson('/delete-expired', {
            content: 'hello',
            secret: 'expired-secret',
            maxAge: 60,
        })
        expect(created.status).toBe(201)
        await env.DB.prepare('UPDATE aliases SET expires_at = ? WHERE word = ?')
            .bind(Math.floor(Date.now() / 1000) - 1, 'delete-expired')
            .run()
        expect((await deleteAlias('delete-expired', 'expired-secret')).status).toBe(410)
        expect(await aliasRow('delete-expired')).toBeNull()
    })

    it('renders the HTML 404 page for an unmatched path', async () => {
        const response = await request('//')
        expectHtml(response, 404)
        expectNoReferrer(response)
        expect(response.headers.get('cache-control')).toBe('no-store')
        const body = await response.text()
        expect(body).toContain('Not found')
        expect(body).toContain('There is nothing at this address.')
        expect(body).toContain('菩提本无树')
    })

    it('uses default error copy and allows per-status overrides', async () => {
        expectHtml(await get('/_bad'), 422)
        const invalidWordBody = await (await get('/_bad')).text()
        expect(invalidWordBody).toContain('Invalid word')
        expect(invalidWordBody).toContain('凡所有相')

        expect((await get('/error-copy/hello')).status).toBe(303)
        const conflict = await get('/error-copy/again')
        expectHtml(conflict, 409)
        const conflictBody = await conflict.text()
        expect(conflictBody).toContain('Word already exists')
        expect(conflictBody).toContain('error-copy')
        expect(conflictBody).toContain('already been claimed')

        const badMaxAge = await get('/error-copy-2/hello?max-age=3d')
        expectHtml(badMaxAge, 422)
        expect(await badMaxAge.text()).toContain('Invalid max-age')
    })

    it('rejects invalid words on read, path create, and POST', async () => {
        expectHtml(await get('/_bad'), 422)
        expectHtml(await get('/_bad/hello'), 422)
        expect((await get('/a')).status).toBe(422)

        const json = await postJson('/_bad', {content: 'hello'})
        expect(json.status).toBe(422)
        expect(await json.json()).toMatchObject({
            error: {code: 'invalid_word'},
        })
        expect((await postJson('/a', {content: 'hello'})).status).toBe(422)
    })

    it('sets no-referrer, no-store, and noindex headers on page and error responses', async () => {
        const config = await get('/headers-config')
        expectHtml(config)
        expectNoReferrer(config)
        expect(config.headers.get('cache-control')).toBe('no-store')
        expect(config.headers.get('x-robots-tag')).toBe('noindex')

        const invalid = await get('/_bad')
        expectHtml(invalid, 422)
        expectNoReferrer(invalid)
        expect(invalid.headers.get('cache-control')).toBe('no-store')
        expect(invalid.headers.get('x-robots-tag')).toBe('noindex')

        const created = await get('/headers-redirect/hello')
        expect(created.status).toBe(303)
        expectNoReferrer(created)
        expect(created.headers.get('cache-control')).toBe('no-store')
        expect(created.headers.get('x-robots-tag')).toBe('noindex')

        const privateCreated = await postJson('/headers-private', {
            content: 'hello',
            secret: 'header-secret',
            maxAge: 60,
        })
        expect(privateCreated.status).toBe(201)
        expectNoReferrer(privateCreated)

        const unauthorized = await get('/headers-private')
        expect(unauthorized.status).toBe(401)
        expectNoReferrer(unauthorized)
        expect(unauthorized.headers.get('cache-control')).toBe('no-store')

        const notFound = await deleteAlias('headers-missing', 'secret')
        expect(notFound.status).toBe(404)
        expectNoReferrer(notFound)
        expect(notFound.headers.get('cache-control')).toBe('no-store')
    })

    it('serves the font with immutable cache and static security headers', async () => {
        const css = await (
            await env.ASSETS.fetch(new Request('https://assets.local/style.css'))
        ).text()
        const asset = /\/_fonts\/(oradano-gatha\.[a-f0-9]{8}\.woff2)/.exec(css)?.[1] ?? ''
        expect(asset).not.toBe('')

        const font = await env.ASSETS.fetch(
            new Request(`https://assets.local/_fonts/${asset}`),
        )
        expect(font.status).toBe(200)
        expect(font.headers.get('cache-control')).toBe(
            'public, max-age=31536000, immutable',
        )
        expect(font.headers.get('referrer-policy')).toBe('no-referrer')
        expect(font.headers.get('x-content-type-options')).toBe('nosniff')
        expect(font.headers.get('x-frame-options')).toBe('DENY')
        expect(font.headers.get('x-robots-tag')).toBe('noindex')
        expect(font.headers.get('content-security-policy')).toContain(
            'default-src \'none\'',
        )
    })
})

describe('one-time request methods', () => {
    it('does not consume on HEAD or OPTIONS', async () => {
        expect((await get('/head-once/hello?max-age=0')).status).toBe(201)

        const head = await request('/head-once', {method: 'HEAD'})
        expect(head.headers.get('cache-control')).toBe('no-store')
        expectNoReferrer(head)
        expect(await aliasRow('head-once')).not.toBeNull()

        const options = await request('/head-once', {method: 'OPTIONS'})
        expect(options.status).toBe(204)
        expect(options.headers.get('allow')).toBe('GET, HEAD, POST, DELETE, OPTIONS')
        expect(options.headers.get('cache-control')).toBe('no-store')
        expectNoReferrer(options)
        expect(await aliasRow('head-once')).not.toBeNull()

        const resolved = await get('/head-once')
        expect(await resolved.text()).toBe('hello')
    })
})

describe('retention', () => {
    const DAY = 24 * 60 * 60

    async function storeAlias (
        word: string,
        createdAt: number,
        expiresAt: number,
    ): Promise<void> {
        await env.DB.prepare(
            'INSERT INTO aliases (word, content, secret, created_at, expires_at) VALUES (?, ?, NULL, ?, ?)',
        )
            .bind(word, 'retention-content', createdAt, expiresAt)
            .run()
    }

    it('prunes expired aliases and keeps live and built-in ones', async () => {
        const now = Math.floor(Date.now() / 1000)
        await storeAlias('retention-expired', now - 120, now - 1)
        await storeAlias('retention-live', now, now + 60)
        await storeAlias('retention-unused-one-time', now, 0)

        await runScheduledRetention()

        expect(await aliasRow('retention-expired')).toBeNull()
        expect(await aliasRow('retention-live')).not.toBeNull()
        expect(await aliasRow('retention-unused-one-time')).not.toBeNull()
        expect(await aliasRow('diamond-sutra')).not.toBeNull()
        expect(await aliasRow('terms-of-use')).not.toBeNull()
    })

    it('prunes one-time aliases that were never consumed after 30 days', async () => {
        const now = Math.floor(Date.now() / 1000)
        await storeAlias('retention-old-one-time', now - MAX_MAX_AGE - DAY, 0)
        await storeAlias('retention-cutting-one-time', now - MAX_MAX_AGE, 0)
        await storeAlias('retention-young-one-time', now - MAX_MAX_AGE + DAY, 0)

        await runScheduledRetention()

        expect(await aliasRow('retention-old-one-time')).toBeNull()
        expect(await aliasRow('retention-cutting-one-time')).toBeNull()
        expect(await aliasRow('retention-young-one-time')).not.toBeNull()
    })

    it('drains a backlog larger than one batch', async () => {
        const now = Math.floor(Date.now() / 1000)
        await env.DB.prepare(
            `WITH RECURSIVE batch(i) AS (
                SELECT 1 UNION ALL SELECT i + 1 FROM batch WHERE i < 501
            )
            INSERT INTO aliases (word, content, secret, created_at, expires_at)
            SELECT 'retention-batch-' || i, 'x', NULL, ?, 0 FROM batch`,
        )
            .bind(now - MAX_MAX_AGE - DAY)
            .run()

        await runScheduledRetention()

        const remaining = await env.DB.prepare(
            'SELECT COUNT(*) AS count FROM aliases WHERE word LIKE \'retention-batch-%\'',
        ).first<{count: number}>()
        expect(remaining?.count).toBe(0)
    })
})

describe('rate limiting', () => {
    async function exhaust (
        ip: string,
        accept = 'text/html',
    ): Promise<{allowed: Response, limited: Response, attempts: number}> {
        let allowed: Response | undefined
        let attempts = 0
        for (let attempt = 0; attempt < 500; attempt += 1) {
            const response = await request('/', {
                headers: {'cf-connecting-ip': ip, accept},
            })
            attempts += 1
            allowed ??= response
            if (response.status === 429) return {allowed, limited: response, attempts}
        }
        throw new Error('the limiter never rejected a request')
    }

    it('rejects requests beyond the per-IP limit with a 429 page', async () => {
        const {allowed, limited, attempts} = await exhaust('192.0.2.11')
        expect(attempts).toBeGreaterThan(1)
        expectHtml(allowed, 200)
        expectHtml(limited, 429)
        expectNoReferrer(limited)
        expect(limited.headers.get('retry-after')).toBe('60')
        expect(limited.headers.get('cache-control')).toBe('no-store')
        expect(limited.headers.get('x-robots-tag')).toBe('noindex')
        expect(await limited.text()).toContain('Too many requests')
    })

    it('returns a JSON error when JSON is preferred', async () => {
        const {limited} = await exhaust('192.0.2.12', 'application/json')
        expect(limited.status).toBe(429)
        expect(limited.headers.get('content-type')).toContain('application/json')
        expect(limited.headers.get('cache-control')).toBe('no-store')
        expect(limited.headers.get('x-robots-tag')).toBeNull()
        expect(await limited.json()).toEqual({
            error: {code: 'rate_limited', message: 'Too many requests. Try again later.'},
        })
    })

    it('counts each client IP separately', async () => {
        await exhaust('192.0.2.13')
        const other = await request('/', {headers: {'cf-connecting-ip': '198.51.100.13'}})
        expectHtml(other, 200)
    })

    it('counts every request method against the same budget', async () => {
        const ip = '192.0.2.14'
        const head = await request('/', {method: 'HEAD', headers: {'cf-connecting-ip': ip}})
        expect(head.status).toBe(200)
        const {limited} = await exhaust(ip)
        expect(limited.status).toBe(429)
        const options = await request('/', {method: 'OPTIONS', headers: {'cf-connecting-ip': ip}})
        expect(options.status).toBe(429)
        expect(options.headers.get('retry-after')).toBe('60')
    })

    it('never consumes a one-time alias or writes while limited', async () => {
        const created = await get('/limited-once/https://example.com/once?max-age=0')
        expect(created.status).toBe(201)

        const ip = '192.0.2.15'
        await exhaust(ip)
        const blocked = await request('/limited-once', {headers: {'cf-connecting-ip': ip}})
        expect(blocked.status).toBe(429)
        expect(await aliasRow('limited-once')).not.toBeNull()

        const resolved = await get('/limited-once')
        expect(resolved.status).toBe(302)
        expect(resolved.headers.get('location')).toBe('https://example.com/once')
        expect(await aliasRow('limited-once')).toBeNull()
    })
})
