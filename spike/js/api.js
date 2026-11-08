/**
 * FIRS SPIKE TEST - api.js
 * The ONLY file that talks to the Apps Script backend.
 *
 * Rules that keep the browser happy (CORS "simple requests"):
 *  - GET without custom headers.
 *  - POST with Content-Type: text/plain (JSON string as body) -> no preflight.
 *  - credentials: 'omit' (never send cookies; Google answers with a wildcard origin).
 *  - redirect: 'follow' (Apps Script answers via script.googleusercontent.com).
 *
 * Every call resolves (never throws) with:
 *   { ok, data, error:{code,message}, ms, httpStatus, redirected, finalHost }
 */
(function (global) {
  'use strict';

  const CONFIG = {
    // >>> PASTE YOUR WEB APP URL HERE (must end with /exec) <<<
    BASE_URL: 'PASTE_YOUR_WEB_APP_EXEC_URL_HERE',
    TIMEOUT_MS: 30000
  };

  // Future Google Sign-In: setTokenProvider(async () => idTokenString)
  let tokenProvider = null;

  function setTokenProvider(fn) {
    tokenProvider = typeof fn === 'function' ? fn : null;
  }

  function isConfigured() {
    return /^https:\/\/script\.google\.com\/(a\/macros\/[^/]+\/|macros\/)s\/[^/]+\/exec$/.test(CONFIG.BASE_URL);
  }

  function failure(code, message, extra) {
    return Object.assign({
      ok: false, data: null, error: { code: code, message: message },
      ms: 0, httpStatus: null, redirected: false, finalHost: null
    }, extra || {});
  }

  async function request(method, query, body) {
    if (!isConfigured()) {
      return failure('NOT_CONFIGURED',
        'BASE_URL in js/api.js is not set to a valid Apps Script /exec URL.');
    }

    const started = performance.now();
    const controller = new AbortController();
    const timer = setTimeout(function () { controller.abort(); }, CONFIG.TIMEOUT_MS);

    const init = {
      method: method,
      redirect: 'follow',
      credentials: 'omit',
      cache: 'no-store',
      signal: controller.signal
    };

    let url = CONFIG.BASE_URL;

    if (method === 'GET') {
      // Cache-buster only. NEVER put tokens in a URL (they end up in logs/history).
      const params = new URLSearchParams(Object.assign({}, query, { _: String(Date.now()) }));
      url += '?' + params.toString();
    } else {
      const payload = Object.assign({}, body);
      if (tokenProvider) {
        try {
          const token = await tokenProvider();
          if (token) payload.auth = { idToken: token };
        } catch (e) {
          clearTimeout(timer);
          return failure('AUTH_TOKEN_ERROR', 'Could not obtain sign-in token.');
        }
      }
      // text/plain keeps this a CORS "simple request" (no OPTIONS preflight).
      init.headers = { 'Content-Type': 'text/plain;charset=utf-8' };
      init.body = JSON.stringify(payload);
    }

    try {
      const res = await fetch(url, init);
      const text = await res.text();
      const ms = Math.round(performance.now() - started);

      let finalHost = null;
      try { finalHost = new URL(res.url).host; } catch (e) { /* ignore */ }

      const info = {
        ms: ms, httpStatus: res.status, redirected: res.redirected, finalHost: finalHost
      };

      // HTML instead of JSON = Google login/error page (wrong URL, /dev URL, access not "Anyone").
      if (/^\s*</.test(text)) {
        return failure('NOT_JSON',
          'Received an HTML page instead of JSON. Check: URL ends with /exec, deployment access is "Anyone", ' +
          'and you deployed a NEW VERSION after code changes.', info);
      }

      let json;
      try {
        json = JSON.parse(text);
      } catch (e) {
        return failure('NOT_JSON', 'Response was not valid JSON: ' + text.slice(0, 120), info);
      }

      if (!res.ok) {
        return failure('HTTP_ERROR', 'HTTP ' + res.status, Object.assign(info, { data: json }));
      }

      if (json && json.ok === false) {
        const err = json.error || { code: 'SERVER_ERROR', message: 'Unknown server error.' };
        return Object.assign({ ok: false, data: null, error: err }, info);
      }

      return Object.assign({ ok: true, data: json.data, error: null, meta: json.meta }, info);

    } catch (err) {
      const ms = Math.round(performance.now() - started);
      if (err && err.name === 'AbortError') {
        return failure('TIMEOUT', 'No response within ' + (CONFIG.TIMEOUT_MS / 1000) + ' s.', { ms: ms });
      }
      // Browsers hide the real reason: CORS block, offline, DNS and blocked hosts all look the same.
      return failure('NETWORK',
        'Request failed before a response was received (offline, CORS block, or blocked host ' +
        'such as script.google.com / script.googleusercontent.com).', { ms: ms });
    } finally {
      clearTimeout(timer);
    }
  }

  global.FIRS_API = {
    ping:         function ()         { return request('GET',  { action: 'ping' }); },
    getMasterData: function ()        { return request('GET',  { action: 'master' }); },
    lookupReport: function (reportId) { return request('GET',  { action: 'lookup', reportId: reportId }); },
    submitReport: function (report)   { return request('POST', null, Object.assign({ action: 'submitReport' }, report)); },
    setTokenProvider: setTokenProvider,
    isConfigured: isConfigured,
    getBaseUrl: function () { return CONFIG.BASE_URL; }
  };
})(window);
