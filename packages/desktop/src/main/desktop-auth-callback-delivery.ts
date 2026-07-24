import type { DesktopAuthCallback } from "./desktop-auth-deep-link"

export type DesktopAuthCallbackDelivery = {
  id: number
  result: DesktopAuthCallback
}

export class DesktopAuthCallbackDeliveryQueue {
  private nextId = 1
  private current?: DesktopAuthCallbackDelivery

  acknowledge(id: number) {
    if (this.current?.id !== id) return false
    this.current = undefined
    return true
  }

  enqueue(result: DesktopAuthCallback) {
    const delivery = { id: this.nextId, result }
    this.nextId += 1
    this.current = delivery
    return delivery
  }

  pending() {
    return this.current
  }
}
