// ================================================================
// SERVER.JS FIXES — Flip Camera Handler
// ================================================================
// CATATAN: Copy GANTI function ini di server.js asli (sekitar baris 236-247)

// Admin meminta viewer membalik kamera (depan/belakang)
socket.on('flip-camera', ({ sessionId }) => {
  if (!sessionId) {
    console.log('[SIO] flip-camera error: sessionId is null/undefined');
    socket.emit('flip-camera-rejected', { sessionId: null });
    return;
  }

  // ✅ FIX #1: Check apakah room viewer masih ada
  const targetRoom = io.sockets.adapter.rooms.get(`viewer:${sessionId}`);
  if (!targetRoom || targetRoom.size === 0) {
    console.log(`[SIO] flip-camera failed: viewer ${sessionId} not found in rooms`);
    socket.emit('flip-camera-rejected', { sessionId });
    return;
  }

  // ✅ FIX #2: Double-check dengan cari socket langsung by sessionId
  // Ini handle case di mana socket disconnect tapi room belum cleanup
  let targetSocket = null;
  io.sockets.sockets.forEach(s => {
    if (s._sessionId === sessionId && s._role === 'viewer' && s.connected) {
      targetSocket = s;
    }
  });

  if (!targetSocket) {
    console.log(`[SIO] flip-camera failed: viewer socket ${sessionId} not found or disconnected`);
    socket.emit('flip-camera-rejected', { sessionId });
    return;
  }

  // ✅ Emit ke viewer untuk request flip camera
  io.to(`viewer:${sessionId}`).emit('flip-camera');
  console.log(`[SIO] Admin "${user.name}" requested flip camera → viewer:${sessionId}`);
});

// ================================================================
// OPTIONAL: Tambah handler untuk timeout monitoring
// ================================================================
// Jika ingin trace flip camera yang hang/timeout di server side,
// tambahkan ini di bagian atas io.on('connection', ...) listener:

// Track flip camera requests yang belum selesai
const flipCameraTimeouts = new Map();

// Ganti handler flip-camera dengan yang ini jika ingin auto-timeout:
socket.on('flip-camera', ({ sessionId }) => {
  if (!sessionId) {
    console.log('[SIO] flip-camera error: sessionId is null/undefined');
    socket.emit('flip-camera-rejected', { sessionId: null });
    return;
  }

  const targetRoom = io.sockets.adapter.rooms.get(`viewer:${sessionId}`);
  if (!targetRoom || targetRoom.size === 0) {
    console.log(`[SIO] flip-camera failed: viewer ${sessionId} not found`);
    socket.emit('flip-camera-rejected', { sessionId });
    return;
  }

  let targetSocket = null;
  io.sockets.sockets.forEach(s => {
    if (s._sessionId === sessionId && s._role === 'viewer' && s.connected) {
      targetSocket = s;
    }
  });

  if (!targetSocket) {
    console.log(`[SIO] flip-camera failed: viewer socket ${sessionId} not connected`);
    socket.emit('flip-camera-rejected', { sessionId });
    return;
  }

  // ✅ OPTIONAL: Set timeout untuk auto-reject kalau viewer tidak respond dalam 30 detik
  const requestId = `${sessionId}-${Date.now()}`;
  
  const timeoutHandle = setTimeout(() => {
    flipCameraTimeouts.delete(requestId);
    console.log(`[SIO] flip-camera timeout: viewer ${sessionId} did not respond in 30s`);
    io.to('admins').emit('flip-camera-timeout', { sessionId });
  }, 30000);

  flipCameraTimeouts.set(requestId, timeoutHandle);

  // Emit ke viewer
  io.to(`viewer:${sessionId}`).emit('flip-camera');
  console.log(`[SIO] Admin "${user.name}" requested flip camera → ${sessionId}`);
});

// Cleanup timeout saat viewer respond
socket.on('flip-camera-accepted', ({ sessionId }) => {
  if (!sessionId) return;
  
  // Find dan clear timeout yang match sessionId
  flipCameraTimeouts.forEach((timeout, key) => {
    if (key.startsWith(`${sessionId}-`)) {
      clearTimeout(timeout);
      flipCameraTimeouts.delete(key);
    }
  });
  
  io.to('admins').emit('flip-camera-accepted', { sessionId });
  console.log(`[SIO] flip-camera-accepted from ${sessionId}`);
});

socket.on('flip-camera-rejected', ({ sessionId }) => {
  if (!sessionId) return;
  
  // Find dan clear timeout
  flipCameraTimeouts.forEach((timeout, key) => {
    if (key.startsWith(`${sessionId}-`)) {
      clearTimeout(timeout);
      flipCameraTimeouts.delete(key);
    }
  });
  
  io.to('admins').emit('flip-camera-rejected', { sessionId });
  console.log(`[SIO] flip-camera-rejected from ${sessionId}`);
});

// ================================================================
// NOTES:
// ================================================================
// 1. Yang important adalah FIX #1 dan #2 di bagian pertama
// 2. Optional timeout monitoring tidak wajib, tapi bagus untuk debugging
// 3. Jangan lupa check juga bahwa viewer register dengan benar:
//    - registerViewer di client SETELAH mySessionId valid
//    - Socket middleware verify token dengan benar
// 
