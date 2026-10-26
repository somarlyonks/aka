// @ts-check

import configs from '@somarlyonks/eslint'

export default configs.concat([
    {
        ignores: [
            'dist/**',
            'coverage/**',
            'playwright-report/**',
            'test-results/**',
            '.wrangler/**',
        ],
    },
    {
        rules: {
            'eslint-plugin-no-null/no-null': 'off',
        },
    },
])
