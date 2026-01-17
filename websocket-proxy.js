const WebSocket = require('ws');
const https = require('https');
const http = require('http');

// WebSocket subdomain routing
const WS_ROUTES = {
  '/ws/socket8': 'socket8.axiom.trade',
  '/ws/cluster2': 'cluster2.axiom.trade',
  '/ws/cluster3': 'cluster3.axiom.trade',
  '/ws/cluster4': 'cluster4.axiom.trade',
  '/ws/cluster5': 'cluster5.axiom.trade',
  '/ws/cluster6': 'cluster6.axiom.trade',
  '/ws/cluster7': 'cluster7.axiom.trade',
  '/ws/cluster8': 'cluster8.axiom.trade',
  '/ws/cluster9': 'cluster9.axiom.trade',
  '/ws/cluster-asia2': 'cluster-asia2.axiom.trade',
  '/ws/main': 'axiom.trade'
};

/**
 * Setup WebSocket proxy to forward connections to Axiom
 */
function setupWebSocketProxy(server, targetHost) {
  // Handle upgrade requests for WebSocket connections
  server.on('upgrade', (request, socket, head) => {
    console.log(`WebSocket upgrade request: ${request.url}`);

    // Determine target host based on URL path
    let actualTargetHost = targetHost;
    let actualPath = request.url;

    for (const [route, host] of Object.entries(WS_ROUTES)) {
      if (request.url.startsWith(route)) {
        actualTargetHost = host;
        actualPath = request.url.substring(route.length) || '/';
        console.log(`Routing WebSocket to subdomain: ${host}`);
        break;
      }
    }

    // Determine target WebSocket URL
    const targetUrl = `wss://${actualTargetHost}${actualPath}`;
    console.log(`Proxying WebSocket to: ${targetUrl}`);

    // Create connection to target WebSocket
    const targetWs = new WebSocket(targetUrl, {
      headers: {
        'Host': actualTargetHost,
        'Origin': `https://${actualTargetHost}`,
        'User-Agent': request.headers['user-agent'] || 'Mozilla/5.0',
      },
      rejectUnauthorized: true
    });

    // Create WebSocket server for this connection
    const wss = new WebSocket.Server({ noServer: true });

    targetWs.on('open', () => {
      console.log('Target WebSocket connected');

      // Complete the upgrade
      wss.handleUpgrade(request, socket, head, (clientWs) => {
        console.log('Client WebSocket connected');

        // Forward messages from client to target
        clientWs.on('message', (message) => {
          try {
            if (targetWs.readyState === WebSocket.OPEN) {
              targetWs.send(message);
            }
          } catch (error) {
            console.error('Error forwarding client message:', error);
          }
        });

        // Forward messages from target to client
        targetWs.on('message', (message) => {
          try {
            if (clientWs.readyState === WebSocket.OPEN) {
              clientWs.send(message);
            }
          } catch (error) {
            console.error('Error forwarding target message:', error);
          }
        });

        // Handle client close
        clientWs.on('close', (code, reason) => {
          console.log(`Client WebSocket closed: ${code} ${reason}`);
          if (targetWs.readyState === WebSocket.OPEN) {
            targetWs.close(code, reason);
          }
        });

        // Handle client error
        clientWs.on('error', (error) => {
          console.error('Client WebSocket error:', error);
          if (targetWs.readyState === WebSocket.OPEN) {
            targetWs.close();
          }
        });

        // Handle target close
        targetWs.on('close', (code, reason) => {
          console.log(`Target WebSocket closed: ${code} ${reason}`);
          if (clientWs.readyState === WebSocket.OPEN) {
            clientWs.close(code, reason);
          }
        });

        // Handle target error
        targetWs.on('error', (error) => {
          console.error('Target WebSocket error:', error);
          if (clientWs.readyState === WebSocket.OPEN) {
            clientWs.close();
          }
        });

        // Ping/pong to keep connection alive
        const pingInterval = setInterval(() => {
          if (clientWs.readyState === WebSocket.OPEN) {
            clientWs.ping();
          }
          if (targetWs.readyState === WebSocket.OPEN) {
            targetWs.ping();
          }
        }, 30000);

        clientWs.on('close', () => clearInterval(pingInterval));
        targetWs.on('close', () => clearInterval(pingInterval));
      });
    });

    targetWs.on('error', (error) => {
      console.error('Failed to connect to target WebSocket:', error.message);
      socket.destroy();
    });

    // Handle socket timeout
    socket.setTimeout(30000);
    socket.on('timeout', () => {
      console.log('Socket timeout');
      socket.destroy();
    });
  });

  console.log('WebSocket proxy initialized');
}

module.exports = { setupWebSocketProxy };
