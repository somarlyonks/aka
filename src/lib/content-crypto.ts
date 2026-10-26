/**
 * Content at rest is encrypted with AES-256-GCM. The key depends on who may
 * read the alias:
 *
 * - public alias: HKDF-SHA256(SECRET_SALT) with info `aka-content-v1`;
 * - private alias: HKDF-SHA256(SECRET_SALT || NUL || secret) with the word as
 *   salt and info `aka-content-v1:secret`.
 *
 * A private row therefore cannot be decrypted from the database and
 * SECRET_SALT alone: the plaintext secret is required, and it is never stored
 * (the `secret` column only holds a one-way HMAC). Each user-created row uses a
 * random 12-byte IV and stores the base64 of `iv || ciphertext || tag`.
 *
 * The public built-in rows inserted by the initial migration are the only
 * exception: rows with `expires_at = NULL` are stored as plaintext, because a
 * SQL migration cannot derive a key from the environment secret and these
 * public rows never expire. Every expiring row is ciphertext. Encryption is not
 * end-to-end encryption: the Worker decrypts in memory when a link is opened.
 */
export interface ContentContext {
    salt: string
    word: string
    secret: string | null
}

const IV_BYTES = 12
const KEY_INFO = 'aka-content-v1'
const SECRET_KEY_INFO = 'aka-content-v1:secret'

let cachedPublicKey: {salt: string, key: Promise<CryptoKey>} | null = null

function deriveKey (
    input: Uint8Array,
    salt: Uint8Array,
    info: string,
): Promise<CryptoKey> {
    return crypto.subtle
        .importKey('raw', input, 'HKDF', false, ['deriveKey'])
        .then(material =>
            crypto.subtle.deriveKey(
                {
                    name: 'HKDF',
                    hash: 'SHA-256',
                    salt,
                    info: new TextEncoder().encode(info),
                },
                material,
                {name: 'AES-GCM', length: 256},
                false,
                ['encrypt', 'decrypt'],
            ),
        )
}

function publicContentKey (salt: string): Promise<CryptoKey> {
    if (cachedPublicKey?.salt !== salt) {
        cachedPublicKey = {
            salt,
            key: deriveKey(
                new TextEncoder().encode(salt),
                new Uint8Array(0),
                KEY_INFO,
            ),
        }
    }
    return cachedPublicKey.key
}

function secretContentKey (
    context: ContentContext,
    secret: string,
): Promise<CryptoKey> {
    const encoder = new TextEncoder()
    return deriveKey(
        encoder.encode(`${context.salt}\0${secret}`),
        encoder.encode(context.word),
        SECRET_KEY_INFO,
    )
}

function contentKey (context: ContentContext): Promise<CryptoKey> {
    return context.secret === null
        ? publicContentKey(context.salt)
        : secretContentKey(context, context.secret)
}

function toBase64 (bytes: Uint8Array): string {
    let binary = ''
    for (const byte of bytes) {
        binary += String.fromCharCode(byte)
    }
    return btoa(binary)
}

function fromBase64 (value: string): Uint8Array {
    const binary = atob(value)
    const bytes = new Uint8Array(binary.length)
    for (let index = 0; index < binary.length; index += 1) {
        bytes[index] = binary.charCodeAt(index)
    }
    return bytes
}

export async function encryptContent (
    context: ContentContext,
    content: string,
): Promise<string> {
    const key = await contentKey(context)
    const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES))
    const ciphertext = await crypto.subtle.encrypt(
        {name: 'AES-GCM', iv},
        key,
        new TextEncoder().encode(content),
    )
    const packed = new Uint8Array(IV_BYTES + ciphertext.byteLength)
    packed.set(iv)
    packed.set(new Uint8Array(ciphertext), IV_BYTES)
    return toBase64(packed)
}

export async function decryptContent (
    context: ContentContext,
    stored: string,
): Promise<string> {
    const key = await contentKey(context)
    const packed = fromBase64(stored)
    const plaintext = await crypto.subtle.decrypt(
        {name: 'AES-GCM', iv: packed.slice(0, IV_BYTES)},
        key,
        packed.slice(IV_BYTES),
    )
    return new TextDecoder().decode(plaintext)
}
