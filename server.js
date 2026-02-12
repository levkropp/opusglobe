const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

const PORT = 8080;

// Create HTTP server to serve static files
const server = http.createServer((req, res) => {
    let filePath = req.url === '/' ? '/index.html' : req.url;
    filePath = path.join(__dirname, filePath);
    
    const extname = path.extname(filePath);
    const contentTypes = {
        '.html': 'text/html',
        '.js': 'application/javascript',
        '.css': 'text/css',
        '.json': 'application/json',
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
    };
    
    const contentType = contentTypes[extname] || 'application/octet-stream';
    
    fs.readFile(filePath, (err, content) => {
        if (err) {
            if (err.code === 'ENOENT') {
                res.writeHead(404);
                res.end('File not found');
            } else {
                res.writeHead(500);
                res.end('Server error');
            }
        } else {
            res.writeHead(200, { 'Content-Type': contentType });
            res.end(content);
        }
    });
});

// Create WebSocket server
const wss = new WebSocketServer({ server });

// Store connected players
const players = new Map();

// Store world block changes (delta from procedural generation)
const worldChanges = new Map(); // key: `${face}_${layer}` -> blockType

// Generate UUID
function generateUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        const r = Math.random() * 16 | 0;
        const v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

// Generate random color
function generateColor() {
    return {
        r: Math.random() * 0.7 + 0.3, // Avoid too dark colors
        g: Math.random() * 0.7 + 0.3,
        b: Math.random() * 0.7 + 0.3
    };
}

// Broadcast to all players except sender
function broadcast(message, excludeId = null) {
    const messageStr = JSON.stringify(message);
    wss.clients.forEach(client => {
        if (client.readyState === 1) { // WebSocket.OPEN
            const playerData = players.get(client);
            if (playerData && playerData.id !== excludeId) {
                client.send(messageStr);
            }
        }
    });
}

// Broadcast to all players including sender
function broadcastAll(message) {
    const messageStr = JSON.stringify(message);
    wss.clients.forEach(client => {
        if (client.readyState === 1) {
            client.send(messageStr);
        }
    });
}

wss.on('connection', (ws) => {
    // Assign player ID and color
    const playerId = generateUUID();
    const playerColor = generateColor();
    
    const playerData = {
        id: playerId,
        color: playerColor,
        position: [0, 102, 0], // Default position
        forward: [0, 0, -1],
        pitch: 0
    };
    
    players.set(ws, playerData);
    
    console.log(`Player connected: ${playerId}`);
    
    // Send player their ID and color
    ws.send(JSON.stringify({
        type: 'init',
        id: playerId,
        color: playerColor
    }));
    
    // Send existing players to new player
    players.forEach((data, client) => {
        if (client !== ws) {
            ws.send(JSON.stringify({
                type: 'playerJoin',
                id: data.id,
                color: data.color,
                position: data.position,
                forward: data.forward,
                pitch: data.pitch || 0
            }));
        }
    });
    
    // Send world block changes to new player
    if (worldChanges.size > 0) {
        const changes = [];
        for (const [key, block] of worldChanges) {
            const [face, layer] = key.split('_').map(Number);
            changes.push({ face, layer, block });
        }
        ws.send(JSON.stringify({ type: 'worldState', changes }));
    }

    // Notify other players about new player
    broadcast({
        type: 'playerJoin',
        id: playerId,
        color: playerColor,
        position: playerData.position,
        forward: playerData.forward,
        pitch: playerData.pitch
    }, playerId);
    
    // Handle messages from player
    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            
            if (data.type === 'blockChange') {
                const key = `${data.face}_${data.layer}`;
                worldChanges.set(key, data.block);
                broadcast({
                    type: 'blockChange',
                    face: data.face,
                    layer: data.layer,
                    block: data.block
                }, playerId);
            } else if (data.type === 'position') {
                // Update stored position
                playerData.position = data.position;
                playerData.forward = data.forward;
                playerData.pitch = data.pitch || 0;
                
                // Broadcast to other players
                broadcast({
                    type: 'playerMove',
                    id: playerId,
                    position: data.position,
                    forward: data.forward,
                    pitch: data.pitch || 0
                }, playerId);
            }
        } catch (e) {
            console.error('Error parsing message:', e);
        }
    });
    
    // Handle disconnect
    ws.on('close', () => {
        console.log(`Player disconnected: ${playerId}`);
        players.delete(ws);
        
        // Notify other players
        broadcast({
            type: 'playerLeave',
            id: playerId
        });
    });
    
    ws.on('error', (error) => {
        console.error(`WebSocket error for ${playerId}:`, error);
    });
});

server.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
    console.log('WebSocket server ready for connections');
});
