const COPY_ICON = '<svg width="24px" height="24px" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M19.4 20H9.6C9.26863 20 9 19.7314 9 19.4V9.6C9 9.26863 9.26863 9 9.6 9H19.4C19.7314 9 20 9.26863 20 9.6V19.4C20 19.7314 19.7314 20 19.4 20Z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"></path><path d="M15 9V4.6C15 4.26863 14.7314 4 14.4 4H4.6C4.26863 4 4 4.26863 4 4.6V14.4C4 14.7314 4.26863 15 4.6 15H9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"></path></svg>'
const COPIED_ICON = '<svg width="24px" height="24px" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M8.5 4H6C4.89543 4 4 4.89543 4 6V20C4 21.1046 4.89543 22 6 22H12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"></path><path d="M15.5 4H18C19.1046 4 20 4.89543 20 6V15" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"></path><path d="M8 6.4V4.5C8 4.22386 8.22386 4 8.5 4C8.77614 4 9.00422 3.77604 9.05152 3.50398C9.19968 2.65171 9.77399 1 12 1C14.226 1 14.8003 2.65171 14.9485 3.50398C14.9958 3.77604 15.2239 4 15.5 4C15.7761 4 16 4.22386 16 4.5V6.4C16 6.73137 15.7314 7 15.4 7H8.6C8.26863 7 8 6.73137 8 6.4Z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"></path><path d="M15.5 20.5L17.5 22.5L22.5 17.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"></path></svg>'
const FAILED_ICON = '<svg width="24px" height="24px" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M8.5 4H6C4.89543 4 4 4.89543 4 6V20C4 21.1046 4.89543 22 6 22H18C19.1046 22 20 21.1046 20 20V6C20 4.89543 19.1046 4 18 4H15.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"></path><path d="M8 6.4V4.5C8 4.22386 8.22386 4 8.5 4C8.77614 4 9.00422 3.77604 9.05152 3.50398C9.19968 2.65171 9.77399 1 12 1C14.226 1 14.8003 2.65171 14.9485 3.50398C14.9958 3.77604 15.2239 4 15.5 4C15.7761 4 16 4.22386 16 4.5V6.4C16 6.73137 15.7314 7 15.4 7H8.6C8.26863 7 8 6.73137 8 6.4Z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"></path></svg>'

const COPY_LABEL = 'Copy content'
const COPIED_LABEL = 'Copied'
const FAILED_LABEL = 'Copy failed'
const RESET_DELAY_MS = 1600

function showIcon (button, icon, label) {
    button.innerHTML = icon
    button.setAttribute('aria-label', label)
}

export function attachCopyButton (button, readText) {
    if (!navigator.clipboard?.writeText) return false

    let resetTimer
    const flash = (icon, label) => {
        showIcon(button, icon, label)
        clearTimeout(resetTimer)
        resetTimer = setTimeout(
            () => showIcon(button, COPY_ICON, COPY_LABEL),
            RESET_DELAY_MS,
        )
    }

    showIcon(button, COPY_ICON, COPY_LABEL)
    button.addEventListener('click', () => {
        navigator.clipboard.writeText(readText()).then(
            () => flash(COPIED_ICON, COPIED_LABEL),
            () => flash(FAILED_ICON, FAILED_LABEL),
        )
    })
    return true
}

export function buildTextContent (text) {
    const section = document.createElement('section')

    const content = document.createElement('pre')
    content.textContent = text

    const div = document.createElement('div')

    const button = document.createElement('button')
    button.type = 'button'
    button.classList.add('icon')
    button.hidden = !attachCopyButton(button, () => content.textContent)
    div.appendChild(button)

    section.append(content, div)
    return section
}

const content = document.querySelector('#alias-content')
const button = document.querySelector('#copy-content')

if (content && button) {
    button.hidden = !attachCopyButton(button, () => content.textContent)
}
