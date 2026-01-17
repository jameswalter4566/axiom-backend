/**
 * HTML Rewriter for Axiom proxy
 * Modifies HTML to work on a different domain
 */

/**
 * Get the override script that handles hostname spoofing
 */
function getOverrideScript(host, protocol) {
  return `
<script>
// Axiom Proxy Override Script - Runs before any other code
(function() {
  'use strict';

  const PROXY_HOST = '${host}';
  const PROXY_ORIGIN = '${protocol}://${host}';
  const TARGET_HOST = 'axiom.trade';
  const TARGET_ORIGIN = 'https://axiom.trade';

  // Store real values
  const realLocation = window.location;
  const realHostname = realLocation.hostname;
  const realHost = realLocation.host;
  const realOrigin = realLocation.origin;
  const realHref = realLocation.href;

  console.log('[Axiom Proxy] Initializing hostname override...');
  console.log('[Axiom Proxy] Real host:', realHost);
  console.log('[Axiom Proxy] Target host:', TARGET_HOST);

  // Create a proxy for location that returns spoofed values
  const locationHandler = {
    get: function(target, prop) {
      switch(prop) {
        case 'hostname':
          return TARGET_HOST;
        case 'host':
          return TARGET_HOST;
        case 'origin':
          return TARGET_ORIGIN;
        case 'href':
          return realHref.replace(realHost, TARGET_HOST).replace('http://', 'https://');
        case 'protocol':
          return 'https:';
        case 'port':
          return '';
        default:
          const value = target[prop];
          if (typeof value === 'function') {
            return value.bind(target);
          }
          return value;
      }
    },
    set: function(target, prop, value) {
      target[prop] = value;
      return true;
    }
  };

  // Try to create a Proxy for location
  try {
    // Override hostname getter on Location prototype
    const locationProto = Object.getPrototypeOf(window.location);

    const props = ['hostname', 'host', 'origin'];
    props.forEach(prop => {
      try {
        Object.defineProperty(locationProto, prop, {
          get: function() {
            if (prop === 'hostname') return TARGET_HOST;
            if (prop === 'host') return TARGET_HOST;
            if (prop === 'origin') return TARGET_ORIGIN;
          },
          configurable: true
        });
      } catch(e) {
        // Property might not be configurable
      }
    });
  } catch(e) {
    console.log('[Axiom Proxy] Could not override location prototype:', e.message);
  }

  // Override fetch to rewrite URLs back to proxy
  const originalFetch = window.fetch;
  window.fetch = function(url, options) {
    if (typeof url === 'string') {
      // Rewrite axiom.trade URLs to go through our proxy
      if (url.includes('axiom.trade')) {
        url = url.replace(/https:\\/\\/axiom\\.trade/g, PROXY_ORIGIN);
      }
    }
    return originalFetch.call(this, url, options);
  };

  // Override XMLHttpRequest
  const originalOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(method, url, ...rest) {
    if (typeof url === 'string' && url.includes('axiom.trade')) {
      url = url.replace(/https:\\/\\/axiom\\.trade/g, PROXY_ORIGIN);
    }
    return originalOpen.call(this, method, url, ...rest);
  };

  // Override WebSocket to connect through our proxy
  const OriginalWebSocket = window.WebSocket;
  window.WebSocket = function(url, protocols) {
    if (typeof url === 'string') {
      // Rewrite axiom.trade WebSocket URLs
      if (url.includes('axiom.trade')) {
        const wsProtocol = PROXY_ORIGIN.startsWith('https') ? 'wss:' : 'ws:';
        url = url.replace(/wss:\\/\\/axiom\\.trade/g, wsProtocol + '//' + PROXY_HOST);
        url = url.replace(/ws:\\/\\/axiom\\.trade/g, wsProtocol + '//' + PROXY_HOST);
      }
    }
    console.log('[Axiom Proxy] WebSocket connecting to:', url);
    return new OriginalWebSocket(url, protocols);
  };
  window.WebSocket.prototype = OriginalWebSocket.prototype;
  window.WebSocket.CONNECTING = OriginalWebSocket.CONNECTING;
  window.WebSocket.OPEN = OriginalWebSocket.OPEN;
  window.WebSocket.CLOSING = OriginalWebSocket.CLOSING;
  window.WebSocket.CLOSED = OriginalWebSocket.CLOSED;

  // Block redirects to root/homepage that might be triggered by hostname check
  const originalPushState = history.pushState;
  const originalReplaceState = history.replaceState;

  history.pushState = function(state, title, url) {
    if (url === '/' || url === '' || url === TARGET_ORIGIN + '/') {
      console.log('[Axiom Proxy] Blocked redirect to root');
      return;
    }
    return originalPushState.apply(this, arguments);
  };

  history.replaceState = function(state, title, url) {
    if (url === '/' || url === '' || url === TARGET_ORIGIN + '/') {
      console.log('[Axiom Proxy] Blocked redirect to root');
      return;
    }
    return originalReplaceState.apply(this, arguments);
  };

  // Override document.domain if possible
  try {
    Object.defineProperty(document, 'domain', {
      get: function() { return TARGET_HOST; },
      configurable: true
    });
  } catch(e) {}

  // Intercept any hostname checks in setTimeout/setInterval callbacks
  const originalSetTimeout = window.setTimeout;
  const originalSetInterval = window.setInterval;

  // Flag to indicate proxy is active
  window.__AXIOM_PROXY__ = true;
  window.__AXIOM_PROXY_HOST__ = PROXY_HOST;
  window.__AXIOM_TARGET_HOST__ = TARGET_HOST;

  console.log('[Axiom Proxy] Override script loaded successfully');
})();
</script>
`;
}

/**
 * Rewrite HTML content for proxy
 */
function rewriteHtml(html, host, protocol = 'https') {
  // Remove CSP nonce attributes
  html = html.replace(/ nonce="[^"]*"/g, '');

  // Remove inline CSP meta tags
  html = html.replace(/<meta[^>]*content-security-policy[^>]*>/gi, '');

  // Insert override script right after <head>
  const overrideScript = getOverrideScript(host, protocol);
  html = html.replace(/<head[^>]*>/i, (match) => match + overrideScript);

  // Replace axiom.trade URLs with proxy URLs in the HTML
  // Be careful not to break inline scripts
  const proxyOrigin = `${protocol}://${host}`;

  // Replace in href and src attributes
  html = html.replace(/href="https:\/\/axiom\.trade/g, `href="${proxyOrigin}`);
  html = html.replace(/src="https:\/\/axiom\.trade/g, `src="${proxyOrigin}`);

  // Replace in data attributes
  html = html.replace(/data-[^=]*="https:\/\/axiom\.trade/g, (match) => {
    return match.replace('https://axiom.trade', proxyOrigin);
  });

  // Add base tag to ensure relative URLs work correctly
  if (!html.includes('<base')) {
    html = html.replace(/<head[^>]*>/i, (match) => {
      return match + `<base href="${proxyOrigin}/">`;
    });
  }

  return html;
}

module.exports = { rewriteHtml, getOverrideScript };
