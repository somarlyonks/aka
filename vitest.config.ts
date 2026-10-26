import {defineConfig} from 'vitest/config'
import {cloudflareTest} from '@cloudflare/vitest-plugin'

export default defineConfig({
    plugins: [
        cloudflareTest({
            wrangler: {configPath: './wrangler.jsonc'},
            miniflare: {
                bindings: {
                    SECRET_SALT: 'test-salt',
                },
            },
        }),
    ],
    test: {
        fileParallelism: false,
        setupFiles: ['./test/setup.ts'],
        exclude: ['**/node_modules/**', '**/dist/**', 'e2e/**'],
    },
})
