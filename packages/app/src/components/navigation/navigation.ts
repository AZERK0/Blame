const navigationEventName = "app:navigation"

let currentPathname = initialPathname()

export function navigate(pathname: string) {
  currentPathname = normalizedPathname(pathname)
  try {
    window.history.pushState(null, "", currentPathname)
  } catch {}
  window.dispatchEvent(new Event(navigationEventName))
}

export function navigationPathname() {
  return currentPathname
}

export function subscribeToNavigation(callback: () => void) {
  const handlePopState = () => {
    currentPathname = initialPathname()
    callback()
  }

  window.addEventListener(navigationEventName, callback)
  window.addEventListener("popstate", handlePopState)

  return () => {
    window.removeEventListener(navigationEventName, callback)
    window.removeEventListener("popstate", handlePopState)
  }
}

function initialPathname() {
  return normalizedPathname(window.location.pathname)
}

function normalizedPathname(pathname: string) {
  if (pathname === "/" || pathname.endsWith("/index.html")) return "/backlog"
  return pathname.startsWith("/") ? pathname : `/${pathname}`
}
