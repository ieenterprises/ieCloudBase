import axios from 'axios';

// Route browser requests to sandbox.iecloudbase.com through our local reseller-api
// streaming proxy (http://localhost:4000/sandbox-proxy) so stale local OS/router
// DNS caches for the old IP (51.20.74.228) never block connecting to Elastic IP 13.51.192.94.
const origFetch = window.fetch.bind(window);
window.fetch = function (input, init) {
  try {
    const rawUrl = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input?.url || '';
    if (
      rawUrl &&
      (rawUrl.startsWith('https://sandbox.iecloudbase.com') ||
        rawUrl.startsWith('http://51.20.74.228') ||
        rawUrl.startsWith('https://51.20.74.228.sslip.io') ||
        rawUrl.startsWith('https://13.51.192.94.sslip.io'))
    ) {
      const parsed = new URL(rawUrl);
      const apiOrigin = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') ? 'http://localhost:4000' : '';
      const proxiedUrl = `${apiOrigin}/sandbox-proxy${parsed.pathname}${parsed.search}`;
      if (typeof input === 'string' || input instanceof URL) {
        return origFetch(proxiedUrl, init);
      }
      return origFetch(new Request(proxiedUrl, input), init);
    }
  } catch {}
  return origFetch(input, init);
};

// The SDK asks Axios for responseType: "stream"; in browsers that needs the fetch adapter.
axios.defaults.adapter = 'fetch';
