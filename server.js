const WebSocket = require('ws');
const http = require('http');
const fs = require('fs');
const path = require('path');

// Configuração: use index.html (padrão web)
const CLIENT_FILE = 'index.html';

// Armazenamento em memória (volátil)
const clients = new Map(); // { ws: { nickname, ws } }

// Servidor HTTP para servir o HTML
const server = http.createServer((req, res) => {
  if (req.url === '/') {
    fs.readFile(path.join(__dirname, CLIENT_FILE), (err, data) => {
      if (err) {
        console.error('Erro ao carregar:', err.message);
        res.writeHead(500);
        res.end('Erro ao carregar o cliente.');
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(data);
    });
  } else {
    res.writeHead(404);
    res.end('Not found');
  }
});

// Servidor WebSocket
const wss = new WebSocket.Server({ server });

function broadcastUserList() {
  const userList = Array.from(clients.values()).map(c => c.nickname);
  const payload = JSON.stringify({ type: 'user_list', users: userList });
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  });
}

function sendNotification(ws, message) {
  ws.send(JSON.stringify({ type: 'notification', text: message }));
}

wss.on('connection', (ws) => {
  let registered = false;

  ws.on('message', (data) => {
    if (!registered) {
      try {
        const msg = JSON.parse(data);
        if (msg.type === 'register_nickname' && msg.nickname) {
          const nickname = msg.nickname.trim();
          if (!nickname) return;

          if (Array.from(clients.values()).some(c => c.nickname === nickname)) {
            ws.send(JSON.stringify({ type: 'notification', text: 'Nome já em uso. Atualize a página e escolha outro.' }));
            ws.close();
            return;
          }

          clients.set(ws, { nickname, ws });
          registered = true;
          sendNotification(ws, `Bem-vindo, ${nickname}!`);
          broadcastUserList();
          wss.clients.forEach(client => {
            if (client !== ws && client.readyState === WebSocket.OPEN) {
              sendNotification(client, `${nickname} entrou no chat.`);
            }
          });
        } else {
          ws.close();
        }
        return;
      } catch (e) {
        ws.close();
        return;
      }
    }

    try {
      const msg = JSON.parse(data);
      const sender = clients.get(ws)?.nickname;
      if (!sender) return;

      switch (msg.type) {
        case 'message':
          const publicMsg = JSON.stringify({ type: 'message', sender, text: msg.text });
          wss.clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN) {
              client.send(publicMsg);
            }
          });
          break;

        case 'dm':
          if (!msg.target || !msg.text) return;
          const targetClient = Array.from(clients.entries()).find(([_, c]) => c.nickname === msg.target)?.[0];
          if (targetClient && targetClient.readyState === WebSocket.OPEN) {
            targetClient.send(JSON.stringify({ type: 'dm', sender, target: msg.target, text: msg.text }));
            ws.send(JSON.stringify({ type: 'dm', sender, target: msg.target, text: msg.text }));
          } else {
            sendNotification(ws, `Usuário "${msg.target}" não está online.`);
          }
          break;
      }
    } catch (e) {
      // Ignora
    }
  });

  ws.on('close', () => {
    const client = clients.get(ws);
    if (client) {
      const nickname = client.nickname;
      clients.delete(ws);
      broadcastUserList();
      wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
          sendNotification(client, `${nickname} saiu do chat.`);
        }
      });
    }
  });

  ws.on('error', () => {
    clients.delete(ws);
  });
});

// ✅ Configuração essencial para o Render
const PORT = process.env.PORT || 3000;

server.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ Servidor rodando em http://localhost:${PORT}`);
  console.log(`📁 Servindo: ${path.join(__dirname, CLIENT_FILE)}`);
});