/**
 * Vitest stub for the `server-only` guard package. Production builds resolve
 * the real package through Next.js (which enforces the client-import error);
 * tests run server-side, so an empty module is the correct stand-in.
 */
export {};
