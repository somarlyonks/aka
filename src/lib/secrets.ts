function hmacKey (salt: string): Promise<CryptoKey> {
    return crypto.subtle.importKey(
        'raw',
        new TextEncoder().encode(salt),
        {name: 'HMAC', hash: 'SHA-256'},
        false,
        ['sign'],
    )
}

function toHex (buffer: ArrayBuffer): string {
    return Array.from(new Uint8Array(buffer))
        .map(byte => byte.toString(16).padStart(2, '0'))
        .join('')
}

export async function hashSecret (
    salt: string,
    word: string,
    secret: string,
): Promise<string> {
    const key = await hmacKey(salt)
    const data = new TextEncoder().encode(`${word}\0${secret}`)
    return toHex(await crypto.subtle.sign('HMAC', key, data))
}

export function timingSafeEqual (a: string, b: string): boolean {
    if (a.length !== b.length) {
        return false
    }
    let diff = 0
    for (let index = 0; index < a.length; index += 1) {
        diff |= a.charCodeAt(index) ^ b.charCodeAt(index)
    }
    return diff === 0
}

export async function verifySecret (
    salt: string,
    word: string,
    supplied: string,
    expected: string,
): Promise<boolean> {
    const actual = await hashSecret(salt, word, supplied)
    return timingSafeEqual(actual, expected)
}
