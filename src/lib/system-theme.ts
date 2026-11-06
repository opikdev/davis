export function followSystemTheme() {
  const darkMode = window.matchMedia("(prefers-color-scheme: dark)")
  const apply = () => {
    document.documentElement.classList.toggle("dark", darkMode.matches)
  }

  apply()
  darkMode.addEventListener("change", apply)
}
