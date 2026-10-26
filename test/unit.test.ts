import {describe, expect, it} from 'vitest'
import {isHttpUrl, isValidSecret, MAX_SECRET_CHARS, MIN_SECRET_CHARS} from '../src/lib/content'
import {decryptContent, encryptContent} from '../src/lib/content-crypto'
import {escapeHtml} from '../src/lib/html'
import {
    DEFAULT_MAX_AGE,
    MAX_MAX_AGE,
    expiresAtFor,
    immutableTtl,
    isExpired,
    isOneTime,
    parseMaxAge,
} from '../src/lib/lifetime'
import {rateLimitKeyFor} from '../src/lib/rate-limit'
import {hashSecret, timingSafeEqual, verifySecret} from '../src/lib/secrets'
import {generateWord, isValidWord, parseWordParam} from '../src/lib/words'

describe('lifetime', () => {
    it('defaults to one week and parses explicit max-age values', () => {
        expect(DEFAULT_MAX_AGE).toBe(7 * 24 * 60 * 60)
        expect(MAX_MAX_AGE).toBe(30 * 24 * 60 * 60)
        expect(parseMaxAge(undefined)).toBe(DEFAULT_MAX_AGE)
        expect(parseMaxAge('')).toBe(DEFAULT_MAX_AGE)
        expect(parseMaxAge('   ')).toBe(DEFAULT_MAX_AGE)
        expect(parseMaxAge('0')).toBe(0)
        expect(parseMaxAge('60')).toBe(60)
        expect(parseMaxAge(String(MAX_MAX_AGE))).toBe(MAX_MAX_AGE)
    })

    it('rejects duration units, negative, fractional, malformed, and oversized values', () => {
        const invalid = [
            '1s', '90s', '30min', '12h', '3 days', '1w', '1M', '1mo', '30d',
            '1w2d', '1.5d', '1dfoo', '1d2', '0d',
            '-1', '1.5', 'abc', '+1', '1e3', '31d', '5w',
            String(MAX_MAX_AGE + 1),
        ]
        for (const value of invalid) {
            expect(parseMaxAge(value)).toBeUndefined()
        }
    })

    it('maps max-age 0 to a one-time alias', () => {
        expect(expiresAtFor(0, 100)).toBe(0)
        expect(isOneTime(0)).toBe(true)
        expect(isOneTime(null)).toBe(false)
        expect(isOneTime(200)).toBe(false)
        expect(expiresAtFor(60, 100)).toBe(160)
    })

    it('checks expiry and caps the immutable TTL', () => {
        expect(isExpired(null, 100)).toBe(false)
        expect(isExpired(0, 100)).toBe(false)
        expect(isExpired(100, 100)).toBe(true)
        expect(isExpired(101, 100)).toBe(false)
        expect(immutableTtl(null, 100)).toBe(365 * 24 * 60 * 60)
        expect(immutableTtl(100 + 60, 100)).toBe(60)
        expect(immutableTtl(100 + 10 * 365 * 24 * 60 * 60, 100)).toBe(
            365 * 24 * 60 * 60,
        )
    })
})

describe('words', () => {
    it('validates word shape', () => {
        expect(isValidWord('brave-otter')).toBe(true)
        expect(isValidWord('a1')).toBe(true)
        expect(isValidWord('-')).toBe(false)
        expect(isValidWord('api')).toBe(true)
        expect(isValidWord('A')).toBe(false)
        expect(isValidWord('bad word')).toBe(false)
    })

    it('generates valid, varied words', () => {
        const words = new Set<string>()
        for (let attempt = 0; attempt < 30; attempt += 1) {
            const word = generateWord(attempt % 3)
            expect(isValidWord(word)).toBe(true)
            words.add(word)
        }
        expect(words.size).toBeGreaterThan(1)
    })

    it('parses the generated-word wildcard', () => {
        expect(parseWordParam('-')).toEqual({kind: 'generated'})
        expect(parseWordParam(' - ')).toEqual({kind: 'generated'})
        expect(parseWordParam('Brave-Otter')).toEqual({
            kind: 'chosen',
            word: 'brave-otter',
        })
        expect(parseWordParam('')).toEqual({kind: 'invalid'})
        expect(parseWordParam('a')).toEqual({kind: 'invalid'})
        expect(parseWordParam('_bad')).toEqual({kind: 'invalid'})
    })
})

describe('secrets', () => {
    it('hashes deterministically with word separation', async () => {
        const first = await hashSecret('salt', 'word-a', 'secret')
        const again = await hashSecret('salt', 'word-a', 'secret')
        const otherWord = await hashSecret('salt', 'word-b', 'secret')
        expect(first).toBe(again)
        expect(otherWord).not.toBe(first)
    })

    it('verifies in constant time', async () => {
        const expected = await hashSecret('salt', 'word', 'secret')
        expect(await verifySecret('salt', 'word', 'secret', expected)).toBe(true)
        expect(await verifySecret('salt', 'word', 'wrong', expected)).toBe(false)
        expect(timingSafeEqual('abc', 'abc')).toBe(true)
        expect(timingSafeEqual('abc', 'abd')).toBe(false)
        expect(timingSafeEqual('abc', 'ab')).toBe(false)
    })
})

describe('content', () => {
    it('classifies only absolute http(s) URLs as redirects', () => {
        expect(isHttpUrl('https://example.com/a')).toBe(true)
        expect(isHttpUrl('HTTP://example.com')).toBe(true)
        expect(isHttpUrl('example.com')).toBe(false)
        expect(isHttpUrl('javascript:alert(1)')).toBe(false)
        expect(isHttpUrl('data:text/plain,hello')).toBe(false)
        expect(isHttpUrl('not a url')).toBe(false)
    })

    it('escapes HTML', () => {
        expect(escapeHtml(`<script>"x"&'`)).toBe(
            '&lt;script&gt;&quot;x&quot;&amp;&#39;',
        )
    })
})

describe('content encryption', () => {
    const publicContext = (salt = 'salt', word = 'word') => ({
        salt,
        word,
        secret: null,
    })
    const privateContext = (
        secret = 'hunter2',
        salt = 'salt',
        word = 'word',
    ) => ({salt, word, secret})

    it('round-trips public content through AES-GCM', async () => {
        const stored = await encryptContent(publicContext(), 'hello world')
        expect(stored).not.toContain('hello world')
        expect(await decryptContent(publicContext(), stored)).toBe('hello world')
    })

    it('round-trips private content with the secret', async () => {
        const stored = await encryptContent(privateContext(), 'hunter2')
        expect(stored).not.toContain('hunter2')
        expect(await decryptContent(privateContext(), stored)).toBe('hunter2')
    })

    it('uses a fresh IV for every write', async () => {
        const first = await encryptContent(publicContext(), 'same input')
        const second = await encryptContent(publicContext(), 'same input')
        expect(first).not.toBe(second)
        expect(await decryptContent(publicContext(), first)).toBe('same input')
        expect(await decryptContent(publicContext(), second)).toBe('same input')
    })

    it('cannot decrypt public content with another salt', async () => {
        const stored = await encryptContent(publicContext('salt-a'), 'hidden')
        await expect(
            decryptContent(publicContext('salt-b'), stored),
        ).rejects.toThrow()
    })

    it('cannot decrypt private content without the secret', async () => {
        const stored = await encryptContent(privateContext('hunter2'), 'hidden')
        await expect(
            decryptContent(publicContext(), stored),
        ).rejects.toThrow()
        await expect(
            decryptContent(privateContext('wrong'), stored),
        ).rejects.toThrow()
        await expect(
            decryptContent(privateContext('hunter2', 'salt', 'another'), stored),
        ).rejects.toThrow()
    })

    it('cannot decrypt public content with a secret-derived key', async () => {
        const stored = await encryptContent(publicContext(), 'hidden')
        await expect(
            decryptContent(privateContext('hunter2'), stored),
        ).rejects.toThrow()
    })

    it('rejects stored values that are not ciphertext', async () => {
        await expect(
            decryptContent(publicContext(), 'plain text'),
        ).rejects.toThrow()
    })
})

describe('rate limit keys', () => {
    it('counts IPv4 clients by address', () => {
        expect(rateLimitKeyFor('203.0.113.7')).toBe('203.0.113.7')
        expect(rateLimitKeyFor(' 203.0.113.7 ')).toBe('203.0.113.7')
    })

    it('groups IPv6 clients by /64', () => {
        expect(rateLimitKeyFor('2001:db8:1:2:3:4:5:6')).toBe('2001:db8:1:2')
        expect(rateLimitKeyFor('2001:db8:1:2::1')).toBe('2001:db8:1:2')
        expect(rateLimitKeyFor('2001:db8:1:2::')).toBe('2001:db8:1:2')
        expect(rateLimitKeyFor('::1')).toBe('0:0:0:0')
    })

    it('treats IPv4-mapped IPv6 clients as IPv4 and unknown clients as one bucket', () => {
        expect(rateLimitKeyFor('::ffff:203.0.113.7')).toBe('203.0.113.7')
        expect(rateLimitKeyFor(undefined)).toBe(rateLimitKeyFor(''))
    })
})

describe('secret length', () => {
    it('accepts only two to 256 characters', () => {
        expect(MIN_SECRET_CHARS).toBe(2)
        expect(isValidSecret('')).toBe(false)
        expect(isValidSecret('a')).toBe(false)
        expect(isValidSecret('ab')).toBe(true)
        expect(isValidSecret('a'.repeat(MAX_SECRET_CHARS))).toBe(true)
        expect(isValidSecret('a'.repeat(MAX_SECRET_CHARS + 1))).toBe(false)
    })
})
