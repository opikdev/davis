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

// Charts redraw as they settle, so a found mark can vanish before the click.
// Only that error is retried: a second click on a bar would clear its filter.
async function clickWhenSettled(selector) {
  await browser.waitUntil(async () => {
    try {
      await $(selector).click()
      return true
    } catch (error) {
      if (String(error).includes("stale element")) return false
      throw error
    }
  })
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

  it("filters the Page by a clicked bar, and clears it", async () => {
    await clickWhenSettled(".recharts-bar-rectangle")

    const chip = $('[aria-label="Clear region APAC"]')
    await chip.waitForDisplayed()
    await chip.click()
    await chip.waitForExist({ reverse: true })
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
