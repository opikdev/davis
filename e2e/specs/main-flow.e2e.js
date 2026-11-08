function button(name) {
  return $(
    `//button[@aria-label="${name}" or starts-with(normalize-space(.), "${name}")]`
  )
}

async function waitForText(text, selector = "body") {
  await browser.waitUntil(
    () =>
      browser.execute(
        (selector, text) =>
          document.querySelector(selector)?.textContent.includes(text),
        selector,
        text
      ),
    { timeoutMsg: `"${text}" never showed in ${selector}` }
  )
}

// The separator depends on the system locale, so compare digits only.
async function waitForNumber(digits) {
  await browser.waitUntil(
    () =>
      browser.execute(
        (digits) =>
          document.body.textContent
            .replace(/[\s,.\u00a0\u202f']/g, "")
            .includes(digits),
        digits
      ),
    { timeoutMsg: `${digits} never showed` }
  )
}

describe("Davis", () => {
  it("opens a file from the project", async () => {
    await $('button[title="sales.csv"]').click()

    await $('[aria-label^="Rows of"]').waitForDisplayed()
    await waitForText("APAC", '[aria-label^="Rows of"]')
  })

  it("builds a Page from a starting point", async () => {
    await button("New Page").click()
    await button("Overview").click()

    await waitForText("Total amount")
    await waitForNumber("1400")
    await $(".recharts-surface").waitForDisplayed()
  })

  it("presents the Page and exits with Escape", async () => {
    await button("Present").click()
    const presenting = $('[role="dialog"][aria-label^="Presenting"]')
    await presenting.waitForDisplayed()
    await $(`[role="dialog"] .recharts-surface`).waitForDisplayed()

    await browser.keys("Escape")

    await presenting.waitForExist({ reverse: true })
  })
})
