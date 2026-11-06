export function markOperatingSystem() {
  const isMac = navigator.userAgent.includes("Macintosh")
  document.documentElement.dataset.os = isMac ? "macos" : "other"
}
