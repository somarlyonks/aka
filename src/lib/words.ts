const WORD_RE = /^[a-z0-9][a-z0-9_-]{1,31}$/

/** The single-character wildcard that asks the server to generate a word. */
export const GENERATED_WORD = '-'

export type WordParam
    = | {kind: 'chosen', word: string}
        | {kind: 'generated'}
        | {kind: 'invalid'}

const ADJECTIVES = [
    'amber', 'azure', 'bold', 'brave', 'brisk', 'calm', 'clever', 'coral',
    'cosmic', 'crisp', 'curious', 'dapper', 'dizzy', 'eager', 'earthy', 'ember',
    'fancy', 'fierce', 'fluffy', 'foggy', 'frosted', 'gentle', 'giant', 'glossy',
    'golden', 'happy', 'hidden', 'humble', 'icy', 'jade', 'jolly', 'keen',
    'kind', 'lively', 'lucky', 'lunar', 'mellow', 'merry', 'mighty', 'misty',
    'neon', 'noble', 'opal', 'peach', 'plum', 'quartz', 'quiet', 'rapid',
    'ruby', 'rustic', 'sage', 'salty', 'shiny', 'silent', 'silver', 'sleepy',
    'snowy', 'solar', 'spry', 'steady', 'sunny', 'swift', 'teal', 'tidy',
    'tiny', 'topaz', 'velvet', 'vivid', 'warm', 'wild', 'witty', 'zesty',
] as const

const ANIMALS = [
    'ant', 'badger', 'bat', 'bear', 'beaver', 'bee', 'bison', 'boar',
    'bobcat', 'buffalo', 'camel', 'cat', 'cheetah', 'condor', 'cougar', 'coyote',
    'crane', 'crow', 'deer', 'dingo', 'dolphin', 'donkey', 'dove', 'duck',
    'eagle', 'eel', 'elk', 'falcon', 'ferret', 'finch', 'fox', 'frog',
    'gecko', 'goat', 'goose', 'gopher', 'gorilla', 'hare', 'hawk', 'hedgehog',
    'heron', 'hippo', 'horse', 'hummingbird', 'ibis', 'jackal', 'jaguar', 'kangaroo',
    'koala', 'lemur', 'leopard', 'lion', 'lizard', 'llama', 'lynx', 'marmot',
    'marten', 'mink', 'mole', 'mongoose', 'moose', 'moth', 'mouse', 'mule',
    'narwhal', 'newt', 'ocelot', 'okapi', 'opossum', 'otter', 'owl', 'panda',
    'panther', 'parrot', 'peacock', 'pelican', 'penguin', 'pheasant', 'pigeon', 'pike',
    'pony', 'puma', 'quail', 'rabbit', 'raccoon', 'ram', 'raven', 'robin',
    'salmon', 'seal', 'shark', 'sheep', 'shrew', 'skunk', 'sloth', 'snail',
    'snake', 'sparrow', 'spider', 'squid', 'squirrel', 'starling', 'stoat', 'swan',
    'tapir', 'tiger', 'toad', 'tortoise', 'toucan', 'trout', 'turkey', 'turtle',
    'walrus', 'weasel', 'whale', 'wolf', 'wombat', 'woodpecker', 'yak', 'zebra',
] as const

export function normalizeWord (raw: string): string {
    return raw.trim().toLowerCase()
}

export function isValidWord (word: string): boolean {
    return WORD_RE.test(word)
}

/**
 * Normalizes a `:word` route parameter. The wildcard `-` means "generate a
 * word"; every other value must be a valid, claimable word.
 */
export function parseWordParam (raw: string): WordParam {
    const word = normalizeWord(raw)
    if (word === GENERATED_WORD) {
        return {kind: 'generated'}
    }
    if (!isValidWord(word)) {
        return {kind: 'invalid'}
    }
    return {kind: 'chosen', word}
}

export function randomInt (max: number): number {
    const values = new Uint32Array(1)
    crypto.getRandomValues(values)
    return values[0]! % max
}

export function generateWord (attempt: number): string {
    const adjective = ADJECTIVES[randomInt(ADJECTIVES.length)]!
    const animal = ANIMALS[randomInt(ANIMALS.length)]!
    if (attempt === 0) return animal
    const suffix = String(randomInt(10_000)).padStart(4, '0')
    if (attempt === 1) return `${animal}-${suffix}`
    const base = `${adjective}-${animal}`
    if (attempt === 2) return base
    return `${base}-${suffix}`
}
