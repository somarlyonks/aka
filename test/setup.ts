import {env} from 'cloudflare:workers'
import {beforeAll, beforeEach} from 'vitest'
import init from '../src/db/migrations/0001_init.sql?raw'
import expiryIndex from '../src/db/migrations/0002_expiry_index.sql?raw'
import seedDemo from '../src/db/migrations/0003_seed_demo.sql?raw'
import seedTerms from '../src/db/migrations/0004_seed_terms.sql?raw'

const migrations = [init, expiryIndex, seedDemo, seedTerms]

beforeAll(async () => {
    await env.DB.prepare('DROP TABLE IF EXISTS aliases').run()
    for (const migration of migrations) {
        await env.DB.prepare(migration).run()
    }
})

beforeEach(async () => {
    // Remove aliases created by tests, but keep the built-ins from migrations.
    await env.DB.prepare('DELETE FROM aliases WHERE word NOT IN (?, ?)')
        .bind('diamond-sutra', 'terms-of-use')
        .run()
})
