import {buildTextContent} from './content.js'

const form = document.querySelector('#auth-form')
const secretInput = document.querySelector('#secret')
const error = document.querySelector('#auth-error')
const button = form?.querySelector('button')

function showError (message) {
    if (!error) return
    error.textContent = message
    error.hidden = false
}

function showText (text) {
    const panel = document.querySelector('#auth-panel')
    if (!panel) return
    document.body.classList.add('page-content')
    panel.replaceWith(buildTextContent(text))
}

function isHttpUrl (value) {
    try {
        const {protocol} = new URL(value)
        return protocol === 'http:' || protocol === 'https:'
    } catch {
        return false
    }
}

async function unlock (secret) {
    const response = await fetch(location.pathname, {
        headers: {
            Accept: 'application/json',
            Authorization: `Bearer ${secret}`,
        },
        cache: 'no-store',
    })

    if (response.status === 401) {
        showError('Incorrect secret.')
        return
    }
    if (!response.ok) {
        showError('This alias could not be opened.')
        return
    }

    const body = await response.json()
    if (typeof body.content !== 'string') {
        showError('This alias could not be opened.')
        return
    }
    if (isHttpUrl(body.content)) {
        location.assign(body.content)
        return
    }
    showText(body.content)
}

if (form && secretInput) {
    form.addEventListener('submit', (event) => {
        event.preventDefault()
        if (!button || button.disabled) return
        button.disabled = true
        unlock(secretInput.value)
            .catch(() => showError('This alias could not be opened.'))
            .finally(() => {button.disabled = false})
    })
}
