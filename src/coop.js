const DEFAULT_ROOM_ID = 'local-arena';
const MIN_BROADCAST_MS = 50;
const KEEPALIVE_MS = 500;
const STALE_PEER_MS = 2500;
const RECONNECT_BASE_MS = 500;
const RECONNECT_MAX_MS = 3000;

function round(value, decimals = 3) {
  const scale = 10 ** decimals;
  return Math.round((Number(value) || 0) * scale) / scale;
}

function sanitizeRoomId(raw) {
  const value = String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return value || DEFAULT_ROOM_ID;
}

function sanitizeName(raw) {
  return String(raw || '')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, 24);
}

function sanitizeServerUrl(raw) {
  let value = String(raw || '').trim();
  if (!value) return '';

  if (value.toLowerCase() === 'auto') {
    const loc = globalThis.location;
    if (!loc?.hostname) return '';
    const protocol = loc.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${protocol}//${loc.hostname}:8787`;
  }

  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) {
    value = `ws://${value}`;
  }

  try {
    const url = new URL(value, globalThis.location?.href);
    if (url.protocol === 'http:') url.protocol = 'ws:';
    if (url.protocol === 'https:') url.protocol = 'wss:';
    if (url.protocol !== 'ws:' && url.protocol !== 'wss:') return '';
    url.hash = '';
    return url.toString();
  } catch {
    return '';
  }
}

function sanitizeTeamId(raw) {
  const value = String(raw || '').trim().toLowerCase();
  return value === 'red' || value === 'blue' ? value : null;
}

function generateId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `pilot-${Math.random().toString(36).slice(2, 10)}`;
}

function normalizeActorState(state = {}) {
  const position = state.position || {};
  const velocity = state.velocity || {};

  return {
    position: {
      x: round(position.x),
      y: round(position.y),
      z: round(position.z),
    },
    velocity: {
      x: round(velocity.x),
      y: round(velocity.y),
      z: round(velocity.z),
    },
    yaw: round(state.yaw, 4),
    aimPitch: round(state.aimPitch, 4),
    firing: Boolean(state.firing),
    teamId: typeof state.teamId === 'string' ? state.teamId : null,
    weaponName: sanitizeName(state.weaponName || 'No Weapon'),
  };
}

export function createLocalCoopClient() {
  const params = new URLSearchParams(globalThis.location?.search || '');
  const serverUrl = sanitizeServerUrl(params.get('server') || params.get('ws'));
  const requestedTeam = sanitizeTeamId(params.get('team') || params.get('side'));
  const transport = serverUrl ? 'websocket' : 'broadcast';
  const requested = (
    params.has('room')
    || params.get('coop') === '1'
    || params.get('coop') === 'local'
    || params.get('coop') === 'ws'
    || params.get('coop') === 'network'
    || Boolean(serverUrl)
  );
  const supported = transport === 'websocket'
    ? typeof WebSocket === 'function'
    : typeof BroadcastChannel === 'function';
  const roomId = sanitizeRoomId(params.get('room') || (requested ? DEFAULT_ROOM_ID : ''));
  const playerId = sanitizeName(params.get('playerId') || params.get('id')).toLowerCase() || generateId();
  const joinedAt = Date.now();
  const displayName = sanitizeName(params.get('name')) || `Pilot ${playerId.slice(0, 4).toUpperCase()}`;
  const peers = new Map();
  const listeners = new Map();

  let channel = null;
  let socket = null;
  let destroyed = false;
  let reconnectTimer = null;
  let reconnectDelayMs = RECONNECT_BASE_MS;
  let connectionState = requested
    ? (supported ? (transport === 'websocket' ? 'connecting' : 'connected') : 'unsupported')
    : 'idle';
  let lastSentAt = 0;
  let lastSentSignature = '';
  let lastState = null;
  let lastWeaponPayload = null;
  let lastWorldPayload = null;
  let pendingStateEnvelope = null;
  let pendingWeaponEnvelope = null;
  let pendingWorldEnvelope = null;

  function pruneStalePeers(now = Date.now()) {
    for (const [peerId, peer] of peers) {
      if (now - peer.lastSeenAt > STALE_PEER_MS) peers.delete(peerId);
    }
  }

  function upsertPeer(message) {
    const actor = normalizeActorState(message.actor);
    peers.set(message.playerId, {
      playerId: message.playerId,
      name: sanitizeName(message.name) || `Pilot ${message.playerId.slice(0, 4).toUpperCase()}`,
      joinedAt: Number(message.joinedAt) || Date.now(),
      ...actor,
      lastSeenAt: Number(message.sentAt) || Date.now(),
    });
  }

  function emit(type, payload) {
    const handlers = listeners.get(type);
    if (!handlers) return;
    for (const handler of handlers) {
      try {
        handler(payload);
      } catch (err) {
        console.error(err);
      }
    }
  }

  function buildEnvelope(type, payload = {}) {
    return {
      type,
      roomId,
      playerId,
      joinedAt,
      name: displayName,
      sentAt: Date.now(),
      ...payload,
    };
  }

  function sendEnvelope(envelope) {
    if (channel) {
      channel.postMessage(envelope);
      return true;
    }

    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(envelope));
      return true;
    }

    return false;
  }

  function queueEnvelope(envelope) {
    if (transport !== 'websocket') return;
    if (envelope.type === 'state') pendingStateEnvelope = envelope;
    else if (envelope.type === 'weapon') pendingWeaponEnvelope = envelope;
    else if (envelope.type === 'world') pendingWorldEnvelope = envelope;
  }

  function flushPendingEnvelopes() {
    if (pendingStateEnvelope) {
      sendEnvelope(pendingStateEnvelope);
      pendingStateEnvelope = null;
    }
    if (pendingWeaponEnvelope) {
      sendEnvelope(pendingWeaponEnvelope);
      pendingWeaponEnvelope = null;
    }
    if (pendingWorldEnvelope) {
      sendEnvelope(pendingWorldEnvelope);
      pendingWorldEnvelope = null;
    }
  }

  function publishCachedState() {
    if (lastState) publishState(lastState, { force: true });
    if (lastWeaponPayload) publishWeapon(lastWeaponPayload);
    if (lastWorldPayload) publishWorld(lastWorldPayload);
  }

  function handleEnvelope(message) {
    if (!message || message.roomId !== roomId || message.playerId === playerId) return;

    if (message.type === 'leave') {
      peers.delete(message.playerId);
      emit('leave', message);
      return;
    }

    if (message.type === 'sync-request') {
      publishCachedState();
      emit('sync-request', message);
      return;
    }

    if (message.type === 'state') {
      upsertPeer(message);
      emit('state', message);
      return;
    }

    if (message.type === 'weapon' || message.type === 'fire' || message.type === 'world') {
      emit(message.type, message);
    }
  }

  function handleBroadcastMessage(event) {
    handleEnvelope(event?.data);
  }

  function clearReconnectTimer() {
    if (!reconnectTimer) return;
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  function scheduleReconnect() {
    if (destroyed || transport !== 'websocket' || !supported || reconnectTimer) return;
    connectionState = 'reconnecting';
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      reconnectDelayMs = Math.min(RECONNECT_MAX_MS, reconnectDelayMs * 2);
      connectSocket();
    }, reconnectDelayMs);
  }

  function handleSocketOpen(currentSocket) {
    if (socket !== currentSocket) return;
    reconnectDelayMs = RECONNECT_BASE_MS;
    connectionState = 'connected';
    flushPendingEnvelopes();
    publishCachedState();
    emit('connected', {
      transport,
      serverUrl,
    });
  }

  function handleSocketClose(currentSocket) {
    if (socket !== currentSocket) return;
    socket = null;
    peers.clear();
    if (destroyed) {
      connectionState = 'disconnected';
      return;
    }
    emit('disconnect', {
      transport,
      serverUrl,
    });
    scheduleReconnect();
  }

  function connectSocket() {
    if (destroyed || !requested || transport !== 'websocket' || !supported) return;

    clearReconnectTimer();
    connectionState = 'connecting';

    try {
      const currentSocket = new WebSocket(serverUrl);
      socket = currentSocket;
      currentSocket.addEventListener('open', () => handleSocketOpen(currentSocket));
      currentSocket.addEventListener('message', (event) => {
        if (socket !== currentSocket) return;
        try {
          handleEnvelope(JSON.parse(event.data));
        } catch (err) {
          console.error(err);
        }
      });
      currentSocket.addEventListener('close', () => handleSocketClose(currentSocket));
      currentSocket.addEventListener('error', () => {
        if (socket !== currentSocket || connectionState === 'connected') return;
        connectionState = 'error';
      });
    } catch (err) {
      console.error(err);
      connectionState = 'error';
      scheduleReconnect();
    }
  }

  if (requested && supported) {
    if (transport === 'broadcast') {
      channel = new BroadcastChannel(`voxel-fight-coop:${roomId}`);
      channel.addEventListener('message', handleBroadcastMessage);
    } else {
      connectSocket();
    }
  }

  function publishState(state, { force = false } = {}) {
    if (!requested || !supported) return;

    const actor = normalizeActorState(state);
    lastState = actor;

    const signature = JSON.stringify(actor);
    const now = Date.now();
    const changed = signature !== lastSentSignature;

    if (!force) {
      if (!changed && now - lastSentAt < KEEPALIVE_MS) return;
      if (changed && now - lastSentAt < MIN_BROADCAST_MS) return;
    }

    const envelope = buildEnvelope('state', { actor });
    const sent = sendEnvelope(envelope);
    if (!sent) queueEnvelope(envelope);

    lastSentAt = now;
    lastSentSignature = signature;
  }

  function listPeers() {
    pruneStalePeers();
    return Array.from(peers.values());
  }

  function getParticipants() {
    const now = Date.now();
    pruneStalePeers(now);
    return [
      { playerId, name: displayName, joinedAt, lastSeenAt: now },
      ...Array.from(peers.values()),
    ];
  }

  function getAuthorityId() {
    const participants = getParticipants();
    participants.sort((a, b) => {
      if ((a.joinedAt || 0) !== (b.joinedAt || 0)) return (a.joinedAt || 0) - (b.joinedAt || 0);
      return String(a.playerId).localeCompare(String(b.playerId));
    });
    return participants[0]?.playerId || playerId;
  }

  function isAuthority() {
    return getAuthorityId() === playerId;
  }

  function on(type, handler) {
    if (!listeners.has(type)) listeners.set(type, new Set());
    listeners.get(type).add(handler);
    return () => listeners.get(type)?.delete(handler);
  }

  function post(type, payload = {}) {
    if (!requested || !supported) return;
    const envelope = buildEnvelope(type, payload);
    if (!sendEnvelope(envelope)) queueEnvelope(envelope);
  }

  function publishWeapon(payload = {}) {
    lastWeaponPayload = { ...payload };
    post('weapon', lastWeaponPayload);
  }

  function publishFire(payload = {}) {
    post('fire', payload);
  }

  function publishWorld(payload = {}) {
    lastWorldPayload = { ...payload };
    post('world', lastWorldPayload);
  }

  function destroy() {
    destroyed = true;
    clearReconnectTimer();

    const leaveEnvelope = buildEnvelope('leave');
    if (channel) {
      channel.postMessage(leaveEnvelope);
      channel.removeEventListener('message', handleBroadcastMessage);
      channel.close();
      channel = null;
    }

    if (socket) {
      if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(leaveEnvelope));
      socket.close();
      socket = null;
    }

    peers.clear();
    listeners.clear();
    connectionState = 'disconnected';
  }

  return {
    requested,
    supported,
    roomId,
    playerId,
    joinedAt,
    displayName,
    requestedTeam,
    get enabled() {
      return requested && supported && (Boolean(channel) || transport === 'websocket');
    },
    get transport() {
      return transport;
    },
    get serverUrl() {
      return serverUrl;
    },
    get connectionState() {
      return connectionState;
    },
    publishState,
    publishWeapon,
    publishFire,
    publishWorld,
    listPeers,
    getParticipants,
    getAuthorityId,
    isAuthority,
    on,
    destroy,
  };
}




