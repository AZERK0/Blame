import { initializeBlameTelemetry, shutdownBlameTelemetry } from '@blame/telemetry'
import apiPackage from '../package.json' with { type: 'json' }

export function initializeApiTelemetry() {
  return initializeBlameTelemetry({
    serviceName: 'blame-api',
    serviceVersion: resolveServiceVersion(),
  })
}

export function shutdownApiTelemetry() {
  return shutdownBlameTelemetry()
}

function resolveServiceVersion() {
  return process.env.BLAME_VERSION?.trim() || apiPackage.version
}
