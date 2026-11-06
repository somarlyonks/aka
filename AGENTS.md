# aka — design

Alias service: a long string is stored under specific words, and visiting the words returns the original string.

## Assumptions

- Single-tenant service on Cloudflare Worker; no accounts, admin role, cookies, or sessions.
- "Long string" is usually a URL, but arbitrary text is also supported.
- On any create path, a word of `-` is a wildcard: the server generates a word and returns it.
- Words are immutable. Deletion is API-only; there is no delete UI.
- No reserved words.

## Routes

```
GET    /                            index page; JSON health if Accept prefers application/json
GET    /:word/:content              create public alias with a chosen word
GET    /:word                       free   : config page (content, secret, max-age fields)
                                    public : 301 (URL) or 200 text
                                    private: Bearer pass -> 302 (URL) or 200 text; missing + HTML -> secret prompt page; else 401
POST   /:word                       create only (JSON or form body)
DELETE /:word                       API delete, secret in the JSON body
```

## Lifetime (`max-age`)

`max-age` is read **only when creating an alias**: from the query string on `GET /:word/:content` and `GET /-/:content`, and from the JSON body on `POST /:word` (`maxAge`) or the form field `max-age`. It accepts whole seconds only:

- absent/blank -> default `604800` seconds (7 days)
- positive integer seconds -> the alias expires after that many seconds
- `0` -> one-time alias
- parsing error, malformed, or overflow -> `422`
- maximum allowed value: `2592000` seconds (30 days)
- already existing word -> `409`

A bare `?0` query is shorthand for `max-age=0`; an explicit `max-age` wins when both are given. Other bare queries are ignored.

`max-age` is carried through all creation paths:

- `GET /:word/:content?max-age=3600`
- `GET /-/:content?max-age=604800`
- `POST /:word` with JSON body `{ "content": "...", "maxAge": 604800 }`

The free-word config page includes a `max-age` seconds input (default `604800`, maximum `2592000`, `0` for one-time). The form posts `application/x-www-form-urlencoded` fields `content`, `secret`, and `max-age`; a blank field uses the default. Reads of an existing alias ignore `max-age`; it never changes an existing alias.

An unconsumed one-time alias does not expire, so retention removes it 30 days after creation (see [Expiry and one-time semantics](#expiry-and-one-time-semantics)).

### Creation responses

- Chosen word via `GET /:word/:content`, public normal alias -> `303 See Other` to `/:word`.
- `POST /:word` (JSON API), any successful create -> `201 Created` JSON body `{ "word", "url", "oneTime", "private" }` with `Location: /:word`. It is JSON-in/JSON-out and never redirects or renders HTML.
- `POST /:word` with an HTML form body -> `201 Created` confirmation page, the same page used for generated words. Validation errors re-render the config page with `422`; duplicate words and allocation exhaustion use error pages.
- Chosen or generated one-time alias via `GET` -> `201 Created` confirmation page. It intentionally does **not** redirect, because following the link would immediately consume the alias.
- Generated word, normal alias via `GET /-/:content` -> `201 Created` confirmation page with the generated word and a `Location: /:word` header; the word did not exist before the request, so the response must show it rather than redirect.

## Browser flow

Both `GET` creation shortcuts are mutating GETs: they are rate-limited and return `no-store` with `X-Robots-Tag: noindex`.

### `GET /:word/:content` — chosen-word public shortcut

Create a public word from the wildcard remainder:

```
GET /brave-otter/https://example.com/a/very/long/path
GET /one-shot/some%20text?max-age=0
```

- `content` is everything after `/:word/`, percent-decoded once; URLs containing `/` need no encoding, but a content URL's own query string must encode `?` as `%3F` and `&` as `%26`.
- Free word -> public alias, then `303` (normal) or `201` confirmation.
- Existing word -> `409`, checked before content and `max-age` validation.

### `GET /:word` — free word

The word does not exist: render a `200 text/html` config page with:

- `content` — required textarea (URL or arbitrary text)
- `secret` — optional password field; if set, the word becomes private
- `max-age` — optional seconds field (default `604800`; maximum `2592000`; `0` = one-time)

The form posts directly to `/:word` (or `/-` on the generated-word config page) as `application/x-www-form-urlencoded`; no JavaScript is required. This is the only creation path that accepts a secret in a browser; POST only creates.

### `GET /:word` — public word

Normal alias:

- Content parses as absolute `http:`/`https:` -> `301 Moved Permanently`.
- Any other content -> `200 text/plain; charset=utf-8`, or a `200 text/html` content page when the client prefers `text/html` over `application/json` (the same preference rule as the index page). The content page shows the word, the content as escaped text, and a copy button that copies the exact string.
- Cacheable under the policy below, with `Vary: Accept`.

One-time alias:

- Never cached and never `301`.
- The alias is destroyed on its first successful view:
  - URL -> `302 Found` with `Location`
  - text -> `200 text/plain; charset=utf-8`, or the `text/html` content page for prefer-HTML clients
- Subsequent requests find the word free and show the config page.

### `GET /:word` — private word

Private reads require `Authorization: Bearer <secret>`:

- Missing Authorization and `Accept` prefers `text/html` -> `200 text/html` secret prompt page rendered directly by `GET /:word`; no redirect and no extra route.
- The prompt page's script fetches the same `GET /:word` with `Authorization: Bearer <secret>` and `Accept: application/json`. A valid unlock returns `200 application/json` with `{ "content": "..." }` and `no-store`; the page navigates when the content is an absolute `http:`/`https:` URL and otherwise replaces the prompt with the text and a copy button. A wrong secret returns `401`. The prompt page requires JavaScript; without it, send the Bearer header directly.
- Missing, malformed, or wrong Bearer otherwise -> `401 Unauthorized` with `WWW-Authenticate: Bearer realm="aka"` and `Cache-Control: no-store`.
- Correct Bearer:
  - `Accept` prefers `application/json` -> `200 application/json` body `{ "content": "..." }` with `no-store` and `Vary: Authorization`.
  - URL content -> `302 Found` with `Location`, `Cache-Control: no-store`, and `Vary: Authorization`.
  - Text content -> `200 text/plain; charset=utf-8`, or the `text/html` content page for prefer-HTML clients, with `no-store` and `Vary: Authorization, Accept`.
  - One-time alias -> destroyed and returned.
- Private responses never use `301`, so a shared cache cannot serve them without the Authorization header.

### `POST /:word`

POST only creates an alias and accepts `Content-Type: application/json` (returns JSON) or an HTML form body (`application/x-www-form-urlencoded`, returns HTML).

```json
{
  "content": "https://example.com/private",
  "secret": "hunter2",
  "maxAge": 604800
}
```

- `content` is required and must be a string.
- `secret` is optional; a non-empty string makes the alias private.
- `maxAge` is optional; whole seconds only, default `604800` (7 days), maximum `2592000` (30 days), `0` one-time.
- Success -> `201 Created` JSON body `{ "word", "url", "oneTime", "private" }` with `Location: /:word`. It never redirects.
- Word already exists -> `409` (checked after body parsing, before field validation); invalid JSON/body -> `400`; invalid word, content, secret, or `maxAge` -> `422`. Errors are JSON in the shape `{ "error": { "code": "...", "message": "..." } }`. Secrets cannot override and cannot change the lifetime.

### `DELETE /:word`

Delete a private alias:

- Body: `{ "secret": "..." }` (`application/json`).
- Private word with matching secret -> `204`.
- Private word with missing/wrong secret -> `403`; public word -> `403`; unknown word -> `404`.
- Deletion takes effect immediately.

## Expiry and one-time semantics

- An alias past its lifetime -> `410 Gone` and is removed. This check runs before rendering a public resolve, a config page, or a private resolve.
- A one-time alias is consumed on its first successful view:
  - public: exactly one request receives the content
  - private: verify the secret, then consume; only the request that consumes the alias receives the content
- Concurrent views: exactly one winner; losers receive `404` (or the free-word config page on a later GET).
- Failed auth, config page views, `HEAD`/`OPTIONS`, and error responses do not consume a one-time alias.
- Prefetchers/crawlers can consume a public one-time alias; do not rely on one-time links for sensitive public content.
- One-time consumption cannot be defeated by edge or browser caching.
- A scheduled retention run executes daily. It removes aliases whose lifetime has ended even when they were never read, and one-time aliases that were never consumed once they are 30 days old. Built-in aliases (`expires_at = NULL`) are never removed.

## Cache policy

Normal aliases are safe to cache as immutable:

- public URL: `301`, `Cache-Control: public, max-age=<ttl>, immutable`
- public text: `200` with the same cache policy, `Vary: Accept` because the representation depends on the preferred type
- `<ttl>` is one year, or the seconds until expiry when that is sooner
- built-in aliases use `public, max-age=3600` instead

Everything stateful or secret-bearing is `no-store`:

- one-time resolves (`302`/`200`)
- private GET responses (`302`/`200`) with `Vary: Authorization`
- secret prompt page and JSON unlock responses
- config pages
- creation responses, including `201` confirmations
- `403`, `404`, `409`, `410`, `422`, `429`

## Rate limiting

Two native Cloudflare layers with deliberately different windows. Neither one stores counters of its own.

1. **Worker, per client address** — the `RATE_LIMITER` binding, `60 requests / 60 seconds`. The sustained cap, and the only layer that can answer well: it negotiates HTML against JSON and sends `Retry-After: 60`.
2. **Edge, per client IP** — a WAF rate limiting rule, `30 requests / 10 seconds`, blocking for 10 seconds. The burst cap: it stops 30+ requests inside one 10-second burst that the per-minute counter would still allow.

- The Worker client key comes from `CF-Connecting-IP`. IPv6 clients are grouped by their `/64` prefix, so one client cannot rotate through its own addresses for free. A request without the header shares one bucket.
- Both layers count per Cloudflare location and are approximate, so a client reaching several locations can exceed either budget by a small multiple. This is accepted: the budgets exist to stop floods and brute force, not to meter usage.
- Over the Worker budget -> `429 Too Many Requests` with `Retry-After: 60`, `Cache-Control: no-store`, and the standard HTML error page, or `{ "error": { "code": "rate_limited", "message": "..." } }` when `Accept` prefers `application/json`.
- A rejected request is decided before any route runs: it never reads an alias and never consumes a one-time alias.
- There is no per-word lockout for failed secret attempts; the per-client budgets are the only protection, so secret entropy is the real defence.

## Secret rules

- Optional at creation: no secret -> public; secret -> private.
- Public words can be created through `GET /:word/:content` or `GET /-/:content`; neither accepts a secret. Generated private words use `POST /-` with a secret in the request body.
- A secret is submitted in the create request body (JSON or HTML form) or as an `Authorization: Bearer` header; the prompt page's script sends that header. Secrets never appear in a URL or `Location` header; a `?secret=` query parameter is ignored on every route.
- Private words require the exact secret as a Bearer token on every view and in the JSON body for deletion.
- Secrets are never stored in plaintext and cannot be recovered by the Service.

## Word and content limits

### Word

- Words are case-insensitive; surrounding whitespace is ignored.
- Format: `^[a-z0-9][a-z0-9_-]{1,31}$`.
- Total length: 2–32 ASCII characters. The first character must be a letter or digit; the rest may be letters, digits, `-`, or `_`.
- `-`, `_`, and other non-alphanumeric first characters are invalid words; on create paths a word of `-` stands for wildcard means "generate a word".

#### Built-in Words

No reserved-word list and no profanity filter: every format-valid word is claimable. Only `/` is special (index/health, never a word). Internal public resources must not reserve any valid word.

There are built-in words like `terms-of-use` inserted with migrations. Built-in words work like normal user defined words but do not have a max-age and never expire.

#### Wildcard Word

When creating words, naming it with `-` means let the system generate the words. Generated words use the same format as normal words. The word is generated from human-readable wordlists. If no word can be allocated, return `503` with `Retry-After`.

### Content

- Must be a non-empty string.
- Maximum size: **8192 UTF-8 bytes (8 KiB)**, measured after percent-decoding for path-based creation. The JSON encoding overhead is not counted.
- User-created content is not trimmed, normalized, parsed, or type-tagged. Whitespace is preserved; a whitespace-only value passes the non-empty check. It is encrypted at rest and returned exactly as it was provided.
- Path creation: content is the wildcard remainder after `/:word/` or `/-/`, percent-decoded once. `/` is allowed unencoded. A content URL's own query string must encode `?` as `%3F` and `&` as `%26`; URL fragments (`#`) cannot be sent.
- POST (JSON or form): `content` must be a string and is subject to the same 8192-byte limit.
- Resolution classifies content at read time. Only an absolute `http:` or `https:` URL redirects; everything else, including `javascript:` and `data:` strings, is returned as `text/plain` and never executed or redirected.

### Related creation limits

- `secret`: optional, 2–256 characters when non-empty; empty means public.
- `max-age` / `maxAge`: `0` or whole seconds up to `2592000` (30 days); default `604800` (7 days).

## Validation and security

- Word, content, secret, and lifetime limits are listed in [Word and content limits](#word-and-content-limits).
- `max-age`: `0` or a non-negative base-10 integer number of seconds; reject `NaN`, negatives, fractions, unit suffixes (`1w`, `3d`), malformed strings, and values above `2592000` (30 days).
- Resolution classifies content at read time: only an absolute `http:` or `https:` URL redirects. Everything else, including `javascript:` and `data:` strings, is returned as `text/plain` and never executed or redirected.
- HTML templates escape all user-supplied values. Send a strict CSP that allows only same-origin resources, denies framing and base URI changes, and otherwise defaults to `none`. Send `X-Frame-Options: DENY`.
- Secret inputs are password fields and are not autocompleted.
- All responses set `Referrer-Policy: no-referrer`.
- `X-Robots-Tag: noindex` on all HTML responses, redirect responses, and static assets. JSON error responses use `Cache-Control: no-store` without `X-Robots-Tag`.
- The service does not log URLs, content, secrets, headers, or bodies.

## Project layout

```
src/
  index.ts                  Hono app, middleware, root index/health, route wiring, scheduled retention
  types.ts                  Env bindings
  routes/
    pages.ts                GET /:word (config, public resolve, private resolve)
    submit.ts               GET /:word/:content, GET /-/*, POST /:word (JSON/form; `-` generates)
    remove.ts               DELETE /:word
  lib/
    accept.ts               Accept header negotiation for JSON health and the HTML prompt
    auth.ts                 Authorization: Bearer parsing
    content.ts              path content extraction/decoding, content/URL/secret validation
    content-crypto.ts       AES-GCM content encryption/decryption
    html.ts                 static-template loading, escaping, placeholder rendering
    json.ts                 JSON object body parsing for API routes
    lifetime.ts             max-age parsing, expiry, immutable TTL, retention window
    respond.ts              HTML/JSON/text/redirect responses and security/cache headers
    secrets.ts              HMAC hash and timing-safe verification
    words.ts                validation, normalization, generated-word selection
    rate-limit.ts           per-client rate limit key and limiter check
  db/
    repo.ts                 repository layer, including atomic one-time delete
    migrations/             D1 SQL migrations, one statement per file
test/
  api.test.ts               Worker integration tests against local D1
  unit.test.ts              unit tests for lib helpers
  setup.ts                  applies migrations and resets test aliases
  raw.d.ts                  `?raw` module declarations for migration imports
e2e/
public/
  auth.js                   prompt page fetch with the Bearer header
  content.js                content page copy button; renders unlocked text
  style.css                 site styles and Oradano @font-face
  hero.js                   hero guide animation/localStorage behavior
  ji.svg                    logo, favicon, and background mask
  _headers                  static asset security and font/media cache headers
  _fonts/
  _media/                   hashed static images;
  _templates/
.agents/
  skills/oradano-font/           font collect/remap/subset build skill
wrangler.jsonc
playwright.config.ts
vitest.config.ts
eslint.config.mjs
package.json
tsconfig.json
.dev.vars.example
AGENTS.md
README.md
LICENSE
```

## Deployment

- `wrangler.jsonc` uses the default environment for local development and a separate `prod` environment for deployment, each with its own D1 binding. `npm run dev`, the test harness, and Playwright use the default environment with a local D1 database; `npm run deploy` targets `prod`. There is no remote dev environment.
- The `RATE_LIMITER` binding is declared in both the top level and `prod`, because `ratelimits` is not inherited by named environments. The daily retention Cron Trigger (`0 3 * * *`) is declared at the top level and is inherited by `prod`. Local development and tests simulate the limiter, so the Worker-level 429 path is covered without a remote deployment.
- Secrets: `SECRET_SALT` (required, stable) via `wrangler secret put SECRET_SALT --env prod`; `.dev.vars` locally. Disable Workers Logs / request observability in the dashboard.
- Apply migrations locally via `npm run db:migrate:local` and for production via `npm run db:migrate:prod`.
- Each migration file contains exactly one SQL statement, so tests can execute the files directly without parsing them.
- Custom domain bound to the Worker; smoke test public create/resolve, generated shorthand, one-time consumption, private create/auth, and private delete after deploy.
