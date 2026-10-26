import {attachCopyButton} from './content.js'

const button = document.getElementById('copy-content')

if (button) {
    button.hidden = !attachCopyButton(button, () => button.previousElementSibling.textContent)
}
