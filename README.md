# aka

A tiny Cloudflare Worker that stores a long string under a short word. Built with TypeScript, Hono, D1, and Workers Static Assets.

## Features

- public alias, quick write/read
- private alias auth with `Authorization: Bearer`
- burn after read when `max-age=0`
- daily retention: expired aliases and unconsumed one-time aliases older than 30 days are deleted

## Quick start

```bash
npm install
cp .dev.vars.example .dev.vars   # edit SECRET_SALT
npm run db:migrate:local
npm run dev
```

Open <http://localhost:8787> in a browser for the index page. Send `Accept: application/json` to get the health status.

Schema changes are applied directly to the initial migration files. If you have an older local database, remove `.wrangler/state/v3/d1` and rerun the migrations. Built-in content updates can be added as a normal data migration.

```bash
npm test          # unit + integration (Workers runtime, local D1)
npm run test:e2e  # Playwright browser smoke tests
npm run typecheck
npm run lint
```

Before the first e2e run, install the browser once with `npx playwright install chromium`.

## Routes

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/` | Index page; JSON `{"ok":true}` when `Accept: application/json` |
| `GET` | `/:word` | Config page, public resolve, or private Bearer resolve |
| `GET` | `/:word/:content` | Create a public alias with a chosen word |
| `POST` | `/:word` | Create an alias (JSON body or HTML form) |
| `DELETE` | `/:word` | Delete a private alias (JSON body) |

`terms-of-use` is a built-in public alias, like `diamond-sutra`. Both are inserted by the initial seed migrations with `expires_at = NULL` (never expire) and plaintext content; request handling does not seed them.

On any create path, use `-` as the word to have the server generate one. For example `GET /-/:content`.

## Examples

Public alias:

```bash
curl -i 'http://localhost:8787/bravo/https://example.com/long/path'
# 303 -> /bravo

curl -i http://localhost:8787/bravo
# 301 -> https://example.com/long/path
```

Generated word:

```bash
curl -i 'http://localhost:8787/-/https://example.com/long/path'
# 201, Location: /brave-otter-4821
```

Private alias:

```bash
curl -i -X POST http://localhost:8787/secret \
  -H 'content-type: application/json' \
  -d '{"content":"https://example.com/private","secret":"hunter2"}'

curl -i -H 'Authorization: Bearer hunter2' http://localhost:8787/secret
# 302 -> https://example.com/private
```

JSON fields: `content` is required, `secret` is optional, and `maxAge` is optional. `maxAge` accepts whole seconds only (`3600`); `0` means one-time, the default is `604800` (7 days), and the maximum is `2592000` (30 days). JSON POST is JSON-in/JSON-out: success is `201` with `{ "word", "url", "oneTime", "private" }` and `Location: /:word`; errors are `{ "error": { "code", "message" } }`. The config form posts `content`, `secret`, and `max-age` as `application/x-www-form-urlencoded` and returns HTML instead; `max-age` uses the same whole-seconds rule. Without the Bearer token, private aliases return `401`.

One-time alias (`max-age=0`, or the shorthand `?0`):

```bash
curl -i 'http://localhost:8787/once/https://example.com?max-age=0'
curl -i http://localhost:8787/once   # first read consumes it
```

Delete:

```bash
curl -i -X DELETE http://localhost:8787/secret \
  -H 'content-type: application/json' \
  -d '{"secret":"hunter2"}'
# 204
```

## Deploy

`wrangler.jsonc` uses the default environment for local development and a separate `prod` environment for deployment. `npm run dev` uses a local D1 database; `npm run deploy` deploys `prod`.

```bash
npx wrangler d1 create aka
# put the returned database_id into env.prod in wrangler.jsonc

npm run db:migrate:prod
npx wrangler secret put SECRET_SALT --env prod

npm run deploy
```

The schema and initial built-in aliases live in `src/db/migrations/`, with one SQL statement per file. This project is treated as pre-release: edit those files and recreate the D1 database for schema changes. Built-in content updates can be applied with a normal data migration.

Keep `SECRET_SALT` stable: it keys the secret hashes and every user-created content key, so changing it invalidates existing private secrets and makes encrypted content undecryptable. The plaintext built-in rows are unaffected. Request logging is disabled in `wrangler.jsonc`.

A Cron Trigger runs the retention job daily at 03:00 UTC. It deletes aliases whose lifetime has ended and one-time aliases that were never consumed 30 days after creation; built-in aliases never expire and are left untouched. Local development does not fire Cron Triggers automatically: with `wrangler dev` running, trigger the handler with `curl 'http://localhost:8787/cdn-cgi/local/scheduled?cron=0+3+*+*+*'`.

## License

MIT
