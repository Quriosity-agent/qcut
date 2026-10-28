/**
 * How long QCut waits for the editor to confirm a project opened. The
 * renderer answers an open request only once the project has loaded, and
 * gives up itself after 20 s; this leaves room for that answer to arrive.
 *
 * It lives apart from the navigator handler so the utility process, which
 * serves the HTTP API in the packaged app, can use it without loading a
 * main-process module.
 */
export const NAVIGATION_TIMEOUT_MS = 25_000;
