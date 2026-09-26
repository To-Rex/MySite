/**
 * Types for `site-url.mjs`, which stays plain JavaScript because the build
 * scripts run it directly through node, with no compile step in front of them.
 */
export declare const CANONICAL_URL: string
export declare function resolveSiteUrl(env?: Record<string, string | undefined>): string
