const GUIDE_KEY = 'aka.guide.seen'

const trigger = document.querySelector('[data-reveal-sidebar]')
const sidebar = document.querySelector('.hero > sidebar')

function guideWasSeen () {
    try {
        return localStorage.getItem(GUIDE_KEY) === '1'
    } catch {
        return false
    }
}

function rememberGuide () {
    try {
        localStorage.setItem(GUIDE_KEY, '1')
    } catch {
        // Storage unavailable; the guide simply shows again next time.
    }
}

if (trigger && sidebar) {
    const chars = sidebar.querySelectorAll('.gatha-char')
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)')

    const settle = () => requestAnimationFrame(() => sidebar.classList.add('is-settled'))

    const reveal = ({instant = false} = {}) => {
        if (sidebar.classList.contains('is-revealed')) return

        sidebar.classList.add('is-revealed')
        trigger.setAttribute('aria-expanded', 'true')
        trigger.querySelector('.method-hint')?.classList.add('is-dismissed')

        if (instant || reduceMotion.matches || typeof Element.prototype.animate !== 'function') {
            sidebar.classList.add('is-settled')
            return
        }

        chars.forEach((char, index) => {
            const animation = char.animate(
                [
                    {opacity: 0},
                    {opacity: 1},
                ],
                {
                    duration: 450,
                    delay: index * 90,
                    easing: 'ease-out',
                    fill: 'backwards',
                },
            )

            if (index === chars.length - 1) {
                animation.finished.then(settle, settle)
            }
        })
    }

    if (guideWasSeen()) {
        reveal({instant: true})
    } else {
        document.documentElement.classList.add('needs-hint')
    }

    trigger.addEventListener('click', () => {
        if (sidebar.classList.contains('is-revealed')) return

        rememberGuide()
        reveal()
    })
}

const cue = document.querySelector('.scroll-cue')
const scrollTarget = document.querySelector('#create')
const afterTarget = scrollTarget?.nextElementSibling

if (cue && afterTarget && 'IntersectionObserver' in window) {
    const observer = new IntersectionObserver(([entry]) => {
        cue.classList.toggle('is-hidden', entry.isIntersecting)
    })
    observer.observe(afterTarget)
}
