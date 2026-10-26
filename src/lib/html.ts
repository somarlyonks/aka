import {DEFAULT_MAX_AGE_INPUT, MAX_MAX_AGE_INPUT} from './lifetime'

export function escapeHtml (value: string): string {
    return value
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll('\'', '&#39;')
}

export function renderTemplate (
    template: string,
    values: Record<string, string>,
): string {
    return template.replace(/\{\{([A-Z0-9_]+)\}\}/g, (_match, key: string) =>
        escapeHtml(values[key] ?? ''),
    )
}

export async function loadAssetText (assets: Fetcher, path: string): Promise<string> {
    const response = await assets.fetch(
        new Request(new URL(path, 'https://assets.local')),
    )
    if (!response.ok) {
        throw new Error(`Missing static asset: ${path}`)
    }
    return response.text()
}

const PARTIALS = {
    HEADER: '/_templates/_header.html',
    FOOTER: '/_templates/_footer.html',
} as const

async function expandPartials (assets: Fetcher, template: string): Promise<string> {
    let output = template
    for (const [name, path] of Object.entries(PARTIALS)) {
        const token = `{{>${name}}}`
        if (!output.includes(token)) continue
        output = output.replaceAll(token, await loadAssetText(assets, path))
    }
    return output
}

async function renderPage (
    assets: Fetcher,
    path: string,
    values: Record<string, string> = {},
): Promise<string> {
    const template = await loadAssetText(assets, path)
    return renderTemplate(await expandPartials(assets, template), values)
}

export async function renderIndexPage (assets: Fetcher): Promise<string> {
    return renderPage(assets, '/_templates/index.html')
}

export async function renderConfigPage (
    assets: Fetcher,
    input: {
        word: string
        content?: string
        maxAge?: string
        error?: string
        generated?: boolean
    },
): Promise<string> {
    const generated = input.generated === true
    return renderPage(assets, '/_templates/config.html', {
        TITLE: generated ? 'Create a generated alias' : `Create ${input.word}`,
        WORD: input.word,
        ACTION: `/${input.word}`,
        CHOSEN_HIDDEN: generated ? 'hidden' : '',
        GENERATED_HIDDEN: generated ? '' : 'hidden',
        CONTENT: input.content ?? '',
        MAX_AGE: input.maxAge ?? DEFAULT_MAX_AGE_INPUT,
        MAX_MAX_AGE: MAX_MAX_AGE_INPUT,
        DEFAULT_MAX_AGE: DEFAULT_MAX_AGE_INPUT,
        ERROR_HIDDEN: input.error ? '' : 'hidden',
        ERROR_TEXT: input.error ?? '',
    })
}

export async function renderAuthPage (
    assets: Fetcher,
    input: {word: string},
): Promise<string> {
    return renderPage(assets, '/_templates/auth.html', {
        TITLE: `Unlock ${input.word}`,
        WORD: input.word,
    })
}

export async function renderCreatedPage (
    assets: Fetcher,
    input: {
        word: string
        origin: string
        oneTime: boolean
        privateAlias: boolean
    },
): Promise<string> {
    return renderPage(assets, '/_templates/created.html', {
        WORD: input.word,
        URL: `${input.origin}/${input.word}`,
        ONE_TIME_HIDDEN: input.oneTime ? '' : 'hidden',
        PRIVATE_HIDDEN: input.privateAlias ? '' : 'hidden',
    })
}

export async function renderContentPage (
    assets: Fetcher,
    input: {word: string, content: string},
): Promise<string> {
    return renderPage(assets, '/_templates/content.html', {
        TITLE: input.word,
        WORD: input.word,
        CONTENT: input.content,
    })
}

export async function renderErrorPage (
    assets: Fetcher,
    input: {title: string, ji: string, message: string},
): Promise<string> {
    return renderPage(assets, '/_templates/error.html', {
        TITLE: input.title,
        JI: input.ji,
        MESSAGE: input.message,
    })
}
