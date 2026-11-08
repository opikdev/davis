function button(name) {
  return $(`//button[starts-with(normalize-space(.), "${name}")]`)
}

async function waitForText(text) {
  await browser.waitUntil(
    async () => (await $("body").getText()).includes(text),
    { timeoutMsg: `"${text}" never showed` }
  )
}

describe("Davis", () => {
  it("opens a file from the project", async () => {
    await $('button[title="sales.csv"]').click()

    const rows = $('[aria-label^="Rows of"]')
    await rows.waitForDisplayed()
    await browser.waitUntil(async () => (await rows.getText()).includes("APAC"))
  })

  it("builds a Page from a starting point", async () => {
    await button("New Page").click()
    await button("Overview").click()

    await waitForText("Total amount")
    await waitForText("1,400")
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
