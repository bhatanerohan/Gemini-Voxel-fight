import crypto from 'node:crypto';
import http from 'node:http';

const HOST = process.env.COOP_HOST || '0.0.0.0';
const PORT = Number(process.env.COOP_PORT || 8787);
const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const rooms = new Map();

function createFrame(payload = '', opcode = 0x1) {
  const body = Buffer.isBuffer(payload) ? payload : Buffer.from(String(payload));
  const length = body.length;

  let header = null;
  if (length < 126) {
    header = Buffer.alloc(2);
    header[1] = length;
  } else if (length < 65536) {
    header = Buffer.alloc(4);
    header[1] = 126;
    header.writeUInt16BE(length, 2);
  } else {
    header = Buffer.alloc(10);
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(length), 2);
  }

  header[0] = 0x80 | (opcode & 0x0f);
  return Buffer.concat([header, body]);
}

function sendJson(client, payload) {
  if (!client || client.closed || !client.socket || client.socket.destroyed) return false;
  try {
    client.socket.write(createFrame(JSON.stringify(payload)));
    return true;
  } catch (err) {
    return false;
  }
}

function getRoom(roomId) {
  if (!rooms.has(roomId)) rooms.set(roomId, new Set());
  return rooms.get(roomId);
}

function removeClientFromRoom(client) {
  if (!client.roomId || !rooms.has(client.roomId)) return;
  const room = rooms.get(client.roomId);
  room.delete(client);
  if (room.size === 0) rooms.delete(client.roomId);
}

function addClientToRoom(client, roomId) {
  const room = getRoom(roomId);
  room.add(client);
}

function broadcastToRoom(roomId, payload, excludeClient = null) {
  const room = rooms.get(roomId);
  if (!room || room.size === 0) return;

  for (const peer of room) {
    if (peer === excludeClient) continue;
    sendJson(peer, payload);
  }
}

function cleanupClient(client) {
  if (!client || client.closed) return;
  client.closed = true;

  const leavePayload = client.roomId && client.playerId
    ? {
        type: 'leave',
        roomId: client.roomId,
        playerId: client.playerId,
        joinedAt: client.joinedAt,
        name: client.name,
        sentAt: Date.now(),
      }
    : null;

  removeClientFromRoom(client);
  if (leavePayload) broadcastToRoom(leavePayload.roomId, leavePayload, client);

  try {
    client.socket.destroy();
  } catch (err) {}
}

function handleJsonMessage(client, text) {
  let payload = null;
  try {
    payload = JSON.parse(text);
  } catch (err) {
    return;
  }

  const roomId = typeof payload.roomId === 'string' ? payload.roomId : '';
  const playerId = typeof payload.playerId === 'string' ? payload.playerId : '';
  if (!roomId || !playerId) return;

  const roomChanged = roomId !== client.roomId;
  if (roomChanged) {
    removeClientFromRoom(client);
    client.roomId = roomId;
    addClientToRoom(client, roomId);
  }

  client.playerId = playerId;
  client.joinedAt = Number(payload.joinedAt) || Date.now();
  client.name = typeof payload.name === 'string' ? payload.name : '';
  client.lastSeenAt = Date.now();

  if (roomChanged) {
    broadcastToRoom(roomId, {
      type: 'sync-request',
      roomId,
      playerId,
      joinedAt: client.joinedAt,
      name: client.name,
      sentAt: Date.now(),
    }, client);
  }

  broadcastToRoom(roomId, payload, client);
}

function consumeFrames(client, chunk) {
  client.buffer = Buffer.concat([client.buffer, chunk]);

  while (client.buffer.length >= 2) {
    const first = client.buffer[0];
    const second = client.buffer[1];
    const opcode = first & 0x0f;
    const masked = (second & 0x80) !== 0;
    let payloadLength = second & 0x7f;
    let offset = 2;

    if ((first & 0x80) === 0) {
      cleanupClient(client);
      return;
    }

    if (payloadLength === 126) {
      if (client.buffer.length < offset + 2) return;
      payloadLength = client.buffer.readUInt16BE(offset);
      offset += 2;
    } else if (payloadLength === 127) {
      if (client.buffer.length < offset + 8) return;
      const longLength = client.buffer.readBigUInt64BE(offset);
      if (longLength > BigInt(Number.MAX_SAFE_INTEGER)) {
        cleanupClient(client);
        return;
      }
      payloadLength = Number(longLength);
      offset += 8;
    }

    if (!masked) {
      cleanupClient(client);
      return;
    }

    const frameLength = offset + 4 + payloadLength;
    if (client.buffer.length < frameLength) return;

    const mask = client.buffer.subarray(offset, offset + 4);
    offset += 4;
    const payload = Buffer.from(client.buffer.subarray(offset, offset + payloadLength));
    for (let i = 0; i < payload.length; i++) {
      payload[i] ^= mask[i % 4];
    }

    client.buffer = client.buffer.subarray(frameLength);

    if (opcode === 0x8) {
      try {
        client.socket.write(createFrame(Buffer.alloc(0), 0x8));
      } catch (err) {}
      cleanupClient(client);
      return;
    }

    if (opcode === 0x9) {
      try {
        client.socket.write(createFrame(payload, 0xA));
      } catch (err) {
        cleanupClient(client);
        return;
      }
      continue;
    }

    if (opcode !== 0x1) continue;
    handleJsonMessage(client, payload.toString('utf8'));
  }
}

const server = http.createServer((req, res) => {
  if (req.url === '/healthz') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      ok: true,
      rooms: rooms.size,
      timestamp: Date.now(),
    }));
    return;
  }

  res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(`Voxel Arena co-op WebSocket server\nHost: ${HOST}\nPort: ${PORT}\nHealth: /healthz\n`);
});

server.on('upgrade', (req, socket) => {
  const key = req.headers['sec-websocket-key'];
  const upgrade = req.headers.upgrade;
  if (typeof key !== 'string' || String(upgrade || '').toLowerCase() !== 'websocket') {
    socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
    socket.destroy();
    return;
  }

  const accept = crypto
    .createHash('sha1')
    .update(key + WS_GUID)
    .digest('base64');

  socket.write([
    'HTTP/1.1 101 Switching Protocols',
    'Upgrade: websocket',
    'Connection: Upgrade',
    `Sec-WebSocket-Accept: ${accept}`,
    '\r\n',
  ].join('\r\n'));

  const client = {
    socket,
    buffer: Buffer.alloc(0),
    closed: false,
    roomId: '',
    playerId: '',
    joinedAt: 0,
    name: '',
    lastSeenAt: Date.now(),
  };

  socket.on('data', (chunk) => consumeFrames(client, chunk));
  socket.on('close', () => cleanupClient(client));
  socket.on('end', () => cleanupClient(client));
  socket.on('error', () => cleanupClient(client));
});

server.listen(PORT, HOST, () => {
  console.log(`Voxel Arena co-op server listening on ws://${HOST}:${PORT}`);
});
