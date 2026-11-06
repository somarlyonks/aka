export interface NewAlias {
    word: string
    content: string
    secret: string | null
    createdAt: number
    expiresAt: number
}

interface AliasRow {
    word: string
    content: string
    secret: string | null
    created_at: number
    expires_at: number | null
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

const PRUNE_BATCH_SIZE = 500
const PRUNE_MAX_BATCHES = 20

export interface RetentionWindow {
    now: number
    oneTimeCutoff: number
}

/**
 * Deletes aliases whose lifetime ended and one-time aliases that were never
 * consumed before the retention cutoff. Built-ins (`expires_at` NULL) are kept.
 */
export async function pruneAliases (
    db: D1Database,
    {now, oneTimeCutoff}: RetentionWindow,
): Promise<number> {
    const expired = await drainBatches(expiredBatch(db, now))
    const abandoned = await drainBatches(abandonedOneTimeBatch(db, oneTimeCutoff))
    return expired + abandoned

    function expiredBatch (db: D1Database, now: number): D1PreparedStatement {
        return db
            .prepare(
                `DELETE FROM aliases WHERE word IN (
                SELECT word FROM aliases
                WHERE expires_at > 0 AND expires_at <= ?
                LIMIT ?
            )`)
            .bind(now, PRUNE_BATCH_SIZE)
    }

    function abandonedOneTimeBatch (
        db: D1Database,
        oneTimeCutoff: number,
    ): D1PreparedStatement {
        return db
            .prepare(
                `DELETE FROM aliases WHERE word IN (
                SELECT word FROM aliases
                WHERE expires_at = 0 AND created_at <= ?
                LIMIT ?
            )`)
            .bind(oneTimeCutoff, PRUNE_BATCH_SIZE)
    }

    async function drainBatches (batch: D1PreparedStatement): Promise<number> {
        let pruned = 0
        for (let pass = 0; pass < PRUNE_MAX_BATCHES; pass += 1) {
            const changes = (await batch.run()).meta.changes ?? 0
            pruned += changes
            if (changes < PRUNE_BATCH_SIZE) break
        }
        return pruned
    }
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
