// Reloads the current page. A module of its own so tests can replace it (jsdom can't reload).
export function reloadPage(): void {
  window.location.reload()
}
