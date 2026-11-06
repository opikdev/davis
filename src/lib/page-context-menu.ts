// The webview's own menu offers Reload and Back, which don't belong in a desktop app.
export function hidePageContextMenu() {
  document.addEventListener("contextmenu", (event) => {
    const isEditable = (event.target as Element).closest("input, textarea")
    if (!isEditable && !window.getSelection()?.toString()) {
      event.preventDefault()
    }
  })
}
