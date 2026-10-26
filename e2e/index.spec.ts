import {expect, test} from '@playwright/test'

test.describe('index page', () => {
    test('renders in the browser', async ({page}) => {
        const response = await page.goto('/')

        expect(response?.status()).toBe(200)
        await expect(page).toHaveTitle(/aka/)
        await expect(page.getByRole('heading', {level: 1})).toBeVisible()
    })

    test('skips the hero guide once it has been seen', async ({page}) => {
        const sidebar = page.locator('#hero-gatha')
        const hint = page.locator('.method-hint')

        await page.goto('/')
        await expect(hint).toBeVisible()
        await expect(sidebar).toBeHidden()

        await page.locator('[data-reveal-sidebar]').click()
        await expect(sidebar).toBeVisible()
        await expect(sidebar).toHaveClass(/is-settled/)
        expect(await page.evaluate('localStorage.getItem("aka.guide.seen")')).toBe('1')

        await page.reload()
        await expect(sidebar).toBeVisible()
        await expect(sidebar).toHaveClass(/is-settled/)
        await expect(hint).toBeHidden()
        await expect(page.locator('html')).not.toHaveClass(/needs-hint/)
    })

    test('opens the built-in Terms of Use alias from the footer', async ({page}) => {
        await page.goto('/')
        await page.getByRole('link', {name: 'Terms of Use'}).click()

        await expect(page).toHaveURL(/\/terms-of-use$/)
        await expect(page.locator('body')).toContainText('TERMS OF USE')
        await expect(page.locator('body')).toContainText('Last updated')
    })

    test('serves JSON health when JSON is preferred', async ({request}) => {
        const response = await request.get('/', {
            headers: {accept: 'application/json'},
        })

        expect(response.status()).toBe(200)
        expect(await response.json()).toEqual({ok: true})
    })
})
