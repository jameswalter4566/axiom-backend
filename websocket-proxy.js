const WebSocket = require('ws');
const https = require('https');
const http = require('http');

/**
 * Setup WebSocket proxy to forward connections to Axiom
 */
function setupWebSocketProxy(server, targetHost) {
  // Handle upgrade requests for WebSocket connections
  server.on('upgrade', (request, socket, head) => {
    console.log(`WebSocket upgrade request: ${request.url}`);

    // Determine target WebSocket URL
    const targetUrl = `wss://${targetHost}${request.url}`;
    console.log(`Proxying WebSocket to: ${targetUrl}`);

    // Create connection to target WebSocket
    const targetWs = new WebSocket(targetUrl, {
      headers: {
        'Host': targetHost,
        'Origin': `https://${targetHost}`,
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
