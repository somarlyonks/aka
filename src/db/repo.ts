import type {AliasRow} from '../types'

export interface NewAlias {
    word: string
    content: string
    secret: string | null
    createdAt: number
    expiresAt: number
}

export async function getAlias (db: D1Database, word: string): Promise<AliasRow | null> {
    return db
        .prepare(
            'SELECT word, content, secret, created_at, expires_at FROM aliases WHERE word = ?',
        )
        .bind(word)
        .first<AliasRow>()
}

export async function aliasExists (db: D1Database, word: string): Promise<boolean> {
    const row = await db
        .prepare('SELECT 1 AS present FROM aliases WHERE word = ?')
        .bind(word)
        .first<{present: number}>()
    return row?.present === 1
}

export async function insertAlias (db: D1Database, alias: NewAlias): Promise<boolean> {
    if (!Number.isSafeInteger(alias.expiresAt) || alias.expiresAt < 0) {
        throw new Error('Alias expiresAt must be a non-negative integer')
    }

    const result = await db
        .prepare(
            'INSERT OR IGNORE INTO aliases (word, content, secret, created_at, expires_at) VALUES (?, ?, ?, ?, ?)',
        )
        .bind(
            alias.word,
            alias.content,
            alias.secret,
            alias.createdAt,
            alias.expiresAt,
        )
        .run()
    return (result.meta.changes ?? 0) > 0
}

export async function deleteAlias (db: D1Database, word: string): Promise<void> {
    await db.prepare('DELETE FROM aliases WHERE word = ?').bind(word).run()
}

/**
 * Deletes a one-time alias and returns its content. The delete is the read:
 * only one concurrent caller can receive a row.
 */
export async function consumeOneTime (
    db: D1Database,
    word: string,
): Promise<string | null> {
    const row = await db
        .prepare(
            'DELETE FROM aliases WHERE word = ? AND expires_at = 0 RETURNING content',
        )
        .bind(word)
        .first<{content: string}>()
    return row?.content ?? null
}
