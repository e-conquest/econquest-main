/**
 * Loaded into the server under test with NODE_OPTIONS="--import ...": every feed fails at once, as on
 * a computer with no network. Requests to this machine pass through.
 */
const real = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = String(input instanceof Request ? input.url : input);
  if (/^https?:\/\/(127\.0\.0\.1|localhost)/.test(url)) return real(input, init);
  throw new TypeError('fetch failed (offline test)');
};
