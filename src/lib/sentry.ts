// Crash + performance monitoring via Sentry (the "Crash Data" / "Performance
// Data" the privacy label declares). First-party only — no ad/tracking SDKs.
//
// The DSN comes from EXPO_PUBLIC_SENTRY_DSN (set per-profile in eas.json env).
// When it's unset — local dev, or before a Sentry project exists — init is a
// no-op so the app runs exactly as before. Source-map upload is handled by the
// @sentry/react-native/expo config plugin at build time (needs SENTRY_AUTH_TOKEN).
import type { ComponentType } from 'react';
import * as Sentry from '@sentry/react-native';

const DSN = process.env.EXPO_PUBLIC_SENTRY_DSN;

export const sentryEnabled = !!DSN;

export function initSentry(): void {
  if (!DSN) return;
  Sentry.init({
    dsn: DSN,
    // Capture a sample of performance traces; tune down if volume gets noisy.
    tracesSampleRate: 0.2,
    // We never want PII like emails in crash reports.
    sendDefaultPii: false,
  });
}

/** Wrap the root component so Sentry can instrument navigation + errors. */
export function wrapWithSentry<T extends ComponentType<any>>(component: T): T {
  return (DSN ? Sentry.wrap(component) : component) as T;
}

export { Sentry };
