interface MediaRange {
    type: string
    q: number
}

function parseAccept (accept: string): MediaRange[] {
    return accept
        .split(',')
        .map((part) => {
            const [range, ...parameters] = part.trim().split(';')
            let q = 1
            for (const parameter of parameters) {
                const [key, value] = parameter.trim().split('=')
                if (key?.toLowerCase() === 'q') {
                    const parsed = Number(value)
                    if (Number.isFinite(parsed)) {
                        q = parsed
                    }
                }
            }
            return {type: (range ?? '').trim().toLowerCase(), q}
        })
        .filter(entry => entry.type.length > 0)
}

function qualityFor (entries: MediaRange[], type: string): number {
    return Math.max(
        0,
        ...entries.filter(entry => entry.type === type).map(entry => entry.q),
    )
}

/**
 * True only when the client explicitly prefers text/html over application/json.
 * Browsers get the secret prompt page; API clients and wildcards do not.
 */
export function prefersHtml (accept: string | null | undefined): boolean {
    if (!accept) return false
    const entries = parseAccept(accept)
    const html = qualityFor(entries, 'text/html')
    const json = qualityFor(entries, 'application/json')
    return html > 0 && html > json
}

/**
 * True only when the client explicitly prefers application/json over text/html.
 * Browsers, wildcard Accept values, and missing Accept headers get the HTML index.
 */
export function prefersJson (accept: string | null | undefined): boolean {
    if (!accept) return false
    const entries = parseAccept(accept)
    const json = qualityFor(entries, 'application/json')
    const html = qualityFor(entries, 'text/html')
    return json > 0 && json > html
}
