const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');
const http = require('http');
const WebSocket = require('ws');
const { rewriteHtml } = require('./html-rewriter');
const { setupWebSocketProxy } = require('./websocket-proxy');

const app = express();
const PORT = process.env.PORT || 3000;

// Target configuration
const TARGET_HOST = 'axiom.trade';
const TARGET_URL = `https://${TARGET_HOST}`;

// Trust proxy for Railway/Render
app.set('trust proxy', 1);

// CORS headers for all requests
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', '*');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  next();
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Subdomain API route mappings
const SUBDOMAIN_ROUTES = {
  '/translate': 'translate.axiom.trade',
  '/cluster/2': 'cluster2.axiom.trade',
  '/cluster/3': 'cluster3.axiom.trade',
  '/cluster/4': 'cluster4.axiom.trade',
  '/cluster/5': 'cluster5.axiom.trade',
  '/cluster/6': 'cluster6.axiom.trade',
  '/cluster/7': 'cluster7.axiom.trade',
  '/cluster/8': 'cluster8.axiom.trade',
  '/cluster/9': 'cluster9.axiom.trade',
  '/cluster/asia2': 'cluster-asia2.axiom.trade',
  '/socket8': 'socket8.axiom.trade',
  '/reporting': 'reporting.axiom.trade',
  '/tx-pro': 'tx-pro.axiom.trade',
  '/tx-custom': 'tx-custom.axiom.trade'
};

// Create subdomain proxy handlers
Object.entries(SUBDOMAIN_ROUTES).forEach(([route, subdomain]) => {
  app.use(route, createProxyMiddleware({
    target: `https://${subdomain}`,
    changeOrigin: true,
    pathRewrite: (path) => path.replace(route, '') || '/',
    onProxyReq: (proxyReq, req, res) => {
      proxyReq.setHeader('Host', subdomain);
      proxyReq.setHeader('Origin', `https://${subdomain}`);
      proxyReq.setHeader('Referer', `https://${subdomain}/`);
      proxyReq.removeHeader('x-forwarded-for');
      proxyReq.removeHeader('x-forwarded-host');
      proxyReq.removeHeader('x-forwarded-proto');
      proxyReq.removeHeader('x-real-ip');
    },
    onProxyRes: (proxyRes, req, res) => {
      proxyRes.headers['Access-Control-Allow-Origin'] = '*';
      proxyRes.headers['Access-Control-Allow-Methods'] = 'GET, POST, PUT, DELETE, OPTIONS';
      proxyRes.headers['Access-Control-Allow-Headers'] = '*';
    },
    onError: (err, req, res) => {
      console.error(`Proxy error for ${subdomain}:`, err.message);
      res.status(500).json({ error: 'Proxy error', message: err.message });
    }
  }));
  console.log(`Registered subdomain route: ${route} -> ${subdomain}`);
});

// Proxy middleware configuration
const proxyMiddleware = createProxyMiddleware({
  target: TARGET_URL,
  changeOrigin: true,
  ws: false, // We handle WebSockets separately
  selfHandleResponse: true,

  onProxyReq: (proxyReq, req, res) => {
    // Set headers to appear as if request is from axiom.trade
    proxyReq.setHeader('Host', TARGET_HOST);
    proxyReq.setHeader('Origin', TARGET_URL);
    proxyReq.setHeader('Referer', `${TARGET_URL}/`);

    // Request uncompressed content so we can modify it
    proxyReq.setHeader('Accept-Encoding', 'identity');

    // Remove identifying headers
    proxyReq.removeHeader('x-forwarded-for');
    proxyReq.removeHeader('x-forwarded-host');
    proxyReq.removeHeader('x-forwarded-proto');
    proxyReq.removeHeader('x-real-ip');
  },

  onProxyRes: async (proxyRes, req, res) => {
    const contentType = proxyRes.headers['content-type'] || '';

    // Copy headers, but remove CSP
    const headers = {};
    for (const [key, value] of Object.entries(proxyRes.headers)) {
      const lowerKey = key.toLowerCase();
      if (!lowerKey.includes('content-security-policy') &&
          !lowerKey.includes('x-frame-options') &&
          !lowerKey.includes('strict-transport-security')) {
        headers[key] = value;
      }
    }

    // Add CORS headers
    headers['Access-Control-Allow-Origin'] = '*';
    headers['Access-Control-Allow-Methods'] = 'GET, POST, PUT, DELETE, OPTIONS';
    headers['Access-Control-Allow-Headers'] = '*';

    // Get the host from the request for rewriting
    const protocol = req.headers['x-forwarded-proto'] || 'https';
    const host = req.headers['x-forwarded-host'] || req.headers.host || 'localhost:3000';
    const myDomain = `${protocol}://${host}`;

    // Handle HTML responses - rewrite content
    if (contentType.includes('text/html')) {
      let body = '';
      proxyRes.on('data', (chunk) => {
        body += chunk.toString();
      });

      proxyRes.on('end', () => {
        try {
          const rewritten = rewriteHtml(body, host, protocol);

          // Update content-length
          delete headers['content-length'];
          headers['content-length'] = Buffer.byteLength(rewritten);

          res.writeHead(proxyRes.statusCode, headers);
          res.end(rewritten);
        } catch (error) {
          console.error('HTML rewrite error:', error);
          res.writeHead(proxyRes.statusCode, headers);
          res.end(body);
        }
      });
      return;
    }

    // Handle JavaScript responses - rewrite URLs
    if (contentType.includes('javascript') || contentType.includes('application/json')) {
      let body = '';
      proxyRes.on('data', (chunk) => {
        body += chunk.toString();
      });

      proxyRes.on('end', () => {
        try {
          // Replace axiom.trade URLs with our domain
          let rewritten = body
            .replace(/https:\/\/axiom\.trade/g, myDomain)
            .replace(/wss:\/\/axiom\.trade/g, `wss://${host}`)
            .replace(/"axiom\.trade"/g, `"${host}"`);

          delete headers['content-length'];
          headers['content-length'] = Buffer.byteLength(rewritten);

          res.writeHead(proxyRes.statusCode, headers);
          res.end(rewritten);
        } catch (error) {
          console.error('JS rewrite error:', error);
          res.writeHead(proxyRes.statusCode, headers);
          res.end(body);
        }
      });
      return;
    }

    // For other content types, pipe directly
    res.writeHead(proxyRes.statusCode, headers);
    proxyRes.pipe(res);
  },

  onError: (err, req, res) => {
    console.error('Proxy error:', err);
    res.status(500).json({ error: 'Proxy error', message: err.message });
  }
});

// Use proxy for all routes
app.use('/', proxyMiddleware);

// Create HTTP server
const server = http.createServer(app);

// Setup WebSocket proxy
setupWebSocketProxy(server, TARGET_HOST);

// Start server
server.listen(PORT, () => {
  console.log(`Axiom proxy server running on port ${PORT}`);
  console.log(`Proxying to: ${TARGET_URL}`);
  console.log(`WebSocket proxy enabled`);
});

// Handle graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down...');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});
