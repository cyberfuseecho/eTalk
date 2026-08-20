// ============================================
// VIDEO CALL APP — Safe, Robust, Feature-Complete
// ============================================

const socket = io(window.location.origin, {
  reconnection: true,
  reconnectionAttempts: 10,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 5000,
  timeout: 20000
});

// === DOM Elements ===
const pinScreen = document.getElementById('pin-screen');
const previewScreen = document.getElementById('preview-screen');
const waitingScreen = document.getElementById('waiting-screen');
const callScreen = document.getElementById('call-screen');

const pinInput = document.getElementById('pin-input');
const joinBtn = document.getElementById('join-btn');
const errorMsg = document.getElementById('error-msg');

const previewVideo = document.getElementById('preview-video');
const previewToggleAudio = document.getElementById('preview-toggle-audio');
const previewToggleVideo = document.getElementById('preview-toggle-video');
const cancelPreviewBtn = document.getElementById('cancel-preview-btn');
const confirmJoinBtn = document.getElementById('confirm-join-btn');
const recordingDot = document.getElementById('recording-dot');

const waitingPin = document.getElementById('waiting-pin');
const cancelWaitBtn = document.getElementById('cancel-wait-btn');

const localVideo = document.getElementById('local-video');
const remoteVideo = document.getElementById('remote-video');
const toggleAudioBtn = document.getElementById('toggle-audio-btn');
const toggleVideoBtn = document.getElementById('toggle-video-btn');
const screenShareBtn = document.getElementById('screen-share-btn');
const endCallBtn = document.getElementById('end-call-btn');
const connectionStatus = document.getElementById('connection-status');
const remoteMuted = document.getElementById('remote-muted');
const remoteScreenIndicator = document.getElementById('remote-screen-share-indicator');
const callTimer = document.getElementById('call-timer');
const localRecDot = document.getElementById('local-rec-dot');

// === State ===
let localStream = null;
let peerConnection = null;
let currentPin = null;
let isAudioEnabled = true;
let isVideoEnabled = true;
let isScreenSharing = false;
let screenStream = null;
let originalVideoTrack = null;
let remoteAudioEnabled = true;
let callStartTime = null;
let timerInterval = null;
let isInCall = false;

// === TURN + STUN Servers (Free Open Relay) ===
const servers = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    {
      urls: 'turn:openrelay.metered.ca:80',
      username: 'openrelayproject',
      credential: 'openrelayproject'
    },
    {
      urls: 'turn:openrelay.metered.ca:443',
      username: 'openrelayproject',
      credential: 'openrelayproject'
    }
  ],
  iceCandidatePoolSize: 10
};

// ============================================
// PIN INPUT HANDLING
// ============================================

pinInput.addEventListener('input', (e) => {
  e.target.value = e.target.value.replace(/\D/g, '').slice(0, 4);
  joinBtn.disabled = e.target.value.length !== 4;
  errorMsg.textContent = '';
});

pinInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && pinInput.value.length === 4) {
    startPreview();
  }
});

joinBtn.addEventListener('click', startPreview);

// ============================================
// PREVIEW SCREEN (Camera check before joining)
// ============================================

async function startPreview() {
  const pin = pinInput.value.trim();
  if (!/^\d{4}$/.test(pin)) {
    errorMsg.textContent = 'Please enter exactly 4 digits';
    return;
  }
  currentPin = pin;

  try {
    // Stop any existing stream first (prevents memory leak)
    stopLocalStream();

    localStream = await getMediaStream();
    previewVideo.srcObject = localStream;
    recordingDot.classList.remove('hidden');
    showScreen('preview');
  } catch (err) {
    console.error('Preview error:', err);
    errorMsg.textContent = 'Camera/microphone access denied. Please allow access in browser settings.';
  }
}

function getMediaStream() {
  return navigator.mediaDevices.getUserMedia({
    video: {
      width: { ideal: 1280 },
      height: { ideal: 720 },
      facingMode: 'user'
    },
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
      sampleRate: 48000
    }
  });
}

previewToggleAudio.addEventListener('click', () => {
  if (!localStream) return;
  isAudioEnabled = !isAudioEnabled;
  localStream.getAudioTracks().forEach(t => t.enabled = isAudioEnabled);
  previewToggleAudio.classList.toggle('active', isAudioEnabled);
});

previewToggleVideo.addEventListener('click', () => {
  if (!localStream) return;
  isVideoEnabled = !isVideoEnabled;
  localStream.getVideoTracks().forEach(t => t.enabled = isVideoEnabled);
  previewToggleVideo.classList.toggle('active', isVideoEnabled);
  recordingDot.classList.toggle('hidden', !isVideoEnabled);
});

cancelPreviewBtn.addEventListener('click', () => {
  stopLocalStream();
  resetToPinScreen();
});

confirmJoinBtn.addEventListener('click', () => {
  showScreen('waiting');
  waitingPin.textContent = currentPin;
  socket.emit('join-room', currentPin);
});

// ============================================
// WAITING SCREEN
// ============================================

cancelWaitBtn.addEventListener('click', () => {
  if (currentPin) socket.emit('end-call', currentPin);
  cleanup();
  resetToPinScreen();
});

// ============================================
// CALL CONTROLS
// ============================================

toggleAudioBtn.addEventListener('click', () => {
  if (!localStream) return;
  isAudioEnabled = !isAudioEnabled;
  localStream.getAudioTracks().forEach(t => t.enabled = isAudioEnabled);
  toggleAudioBtn.classList.toggle('active', isAudioEnabled);
  socket.emit('toggle-audio', { pin: currentPin, enabled: isAudioEnabled });
});

toggleVideoBtn.addEventListener('click', () => {
  if (!localStream) return;
  isVideoEnabled = !isVideoEnabled;
  localStream.getVideoTracks().forEach(t => t.enabled = isVideoEnabled);
  toggleVideoBtn.classList.toggle('active', isVideoEnabled);
  socket.emit('toggle-video', { pin: currentPin, enabled: isVideoEnabled });
});

screenShareBtn.addEventListener('click', toggleScreenShare);

endCallBtn.addEventListener('click', () => {
  socket.emit('end-call', currentPin);
  endCallLocal();
});

// ============================================
// SCREEN SHARING
// ============================================

async function toggleScreenShare() {
  if (!isScreenSharing) {
    try {
      screenStream = await navigator.mediaDevices.getDisplayMedia({
        video: { cursor: 'always' },
        audio: false
      });

      const screenTrack = screenStream.getVideoTracks()[0];
      originalVideoTrack = localStream.getVideoTracks()[0];

      // Replace track in peer connection
      const sender = peerConnection?.getSenders().find(s => 
        s.track && s.track.kind === 'video'
      );
      if (sender) await sender.replaceTrack(screenTrack);

      // Replace in local stream
      localStream.removeTrack(originalVideoTrack);
      localStream.addTrack(screenTrack);
      localVideo.srcObject = localStream;

      isScreenSharing = true;
      screenShareBtn.classList.add('active');

      socket.emit('screen-share', { pin: currentPin, enabled: true });

      screenTrack.onended = () => stopScreenShare();
    } catch (err) {
      console.error('Screen share failed:', err);
    }
  } else {
    stopScreenShare();
  }
}

async function stopScreenShare() {
  if (!isScreenSharing) return;

  const screenTrack = screenStream?.getVideoTracks()[0];
  if (screenTrack) screenTrack.stop();

  if (originalVideoTrack && peerConnection) {
    const sender = peerConnection.getSenders().find(s => 
      s.track && s.track.kind === 'video'
    );
    if (sender) await sender.replaceTrack(originalVideoTrack);

    localStream.removeTrack(screenTrack);
    localStream.addTrack(originalVideoTrack);
    localVideo.srcObject = localStream;
  }

  screenStream = null;
  originalVideoTrack = null;
  isScreenSharing = false;
  screenShareBtn.classList.remove('active');
  socket.emit('screen-share', { pin: currentPin, enabled: false });
}

// ============================================
// WEBRTC PEER CONNECTION
// ============================================

async function createPeerConnection() {
  peerConnection = new RTCPeerConnection(servers);

  // Add all tracks from local stream
  localStream.getTracks().forEach(track => {
    peerConnection.addTrack(track, localStream);
  });

  // Handle incoming remote stream
  peerConnection.ontrack = (event) => {
    const [remoteStream] = event.streams;
    if (remoteStream) {
      remoteVideo.srcObject = remoteStream;
      // iOS Safari fix: force play after setting srcObject
      remoteVideo.play().catch(() => {});
      updateConnectionStatus('Connected');
    }
  };

  // Send ICE candidates to peer
  peerConnection.onicecandidate = (event) => {
    if (event.candidate && currentPin) {
      socket.emit('ice-candidate', { pin: currentPin, candidate: event.candidate });
    }
  };

  // Connection state monitoring
  peerConnection.onconnectionstatechange = () => {
    const state = peerConnection.connectionState;
    console.log('Connection state:', state);
    if (state === 'connected') {
      updateConnectionStatus('Connected');
      startCallTimer();
    } else if (state === 'disconnected') {
      updateConnectionStatus('Reconnecting...');
    } else if (state === 'failed') {
      updateConnectionStatus('Connection failed');
    }
  };

  peerConnection.oniceconnectionstatechange = () => {
    console.log('ICE state:', peerConnection.iceConnectionState);
  };
}

async function makeOffer() {
  await createPeerConnection();
  const offer = await peerConnection.createOffer();
  await peerConnection.setLocalDescription(offer);
  socket.emit('offer', { pin: currentPin, offer: offer });
}

async function handleOffer(offer) {
  await createPeerConnection();
  await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
  const answer = await peerConnection.createAnswer();
  await peerConnection.setLocalDescription(answer);
  socket.emit('answer', { pin: currentPin, answer: answer });
}

async function handleAnswer(answer) {
  if (peerConnection && peerConnection.signalingState !== 'stable') {
    await peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
  }
}

async function handleIceCandidate(candidate) {
  if (peerConnection && peerConnection.remoteDescription) {
    try {
      await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
    } catch (err) {
      console.error('Error adding ICE candidate:', err);
    }
  }
}

// ============================================
// CALL TIMER
// ============================================

function startCallTimer() {
  if (timerInterval) return;
  callStartTime = Date.now();
  timerInterval = setInterval(() => {
    const elapsed = Math.floor((Date.now() - callStartTime) / 1000);
    const mins = String(Math.floor(elapsed / 60)).padStart(2, '0');
    const secs = String(elapsed % 60).padStart(2, '0');
    callTimer.textContent = `${mins}:${secs}`;
  }, 1000);
}

function stopCallTimer() {
  clearInterval(timerInterval);
  timerInterval = null;
  callStartTime = null;
  callTimer.textContent = '00:00';
}

// ============================================
// CLEANUP & RESET
// ============================================

function stopLocalStream() {
  if (localStream) {
    localStream.getTracks().forEach(track => track.stop());
    localStream = null;
  }
  if (previewVideo) previewVideo.srcObject = null;
  if (localVideo) localVideo.srcObject = null;
  if (remoteVideo) remoteVideo.srcObject = null;
}

function cleanup() {
  if (peerConnection) {
    peerConnection.close();
    peerConnection = null;
  }
  stopLocalStream();
  if (screenStream) {
    screenStream.getTracks().forEach(t => t.stop());
    screenStream = null;
  }
  originalVideoTrack = null;
  isScreenSharing = false;
  screenShareBtn.classList.remove('active');
  currentPin = null;
  isAudioEnabled = true;
  isVideoEnabled = true;
  isInCall = false;
  stopCallTimer();
  updateConnectionStatus('Connecting...');
  remoteMuted.classList.add('hidden');
  remoteScreenIndicator.classList.add('hidden');
  toggleAudioBtn.classList.add('active');
  toggleVideoBtn.classList.add('active');
  recordingDot.classList.add('hidden');
}

function endCallLocal() {
  cleanup();
  resetToPinScreen();
}

function resetToPinScreen() {
  showScreen('pin');
  pinInput.value = '';
  joinBtn.disabled = true;
  waitingPin.textContent = '';
  errorMsg.textContent = '';
}

function showScreen(name) {
  [pinScreen, previewScreen, waitingScreen, callScreen].forEach(s => s.classList.remove('active'));
  if (name === 'pin') pinScreen.classList.add('active');
  if (name === 'preview') previewScreen.classList.add('active');
  if (name === 'waiting') waitingScreen.classList.add('active');
  if (name === 'call') callScreen.classList.add('active');
}

function updateConnectionStatus(text) {
  connectionStatus.textContent = text;
  connectionStatus.style.display = text ? 'block' : 'none';
  if (text === 'Connected') {
    setTimeout(() => { connectionStatus.style.display = 'none'; }, 2500);
  }
}

// ============================================
// VISIBILITY CHANGE — Resume camera after background
// ============================================

document.addEventListener('visibilitychange', async () => {
  if (document.hidden || !isInCall) return;
  
  // Check if camera is frozen/stopped
  const videoTrack = localStream?.getVideoTracks()[0];
  if (videoTrack && videoTrack.readyState === 'ended') {
    console.log('Camera stopped in background, re-acquiring...');
    try {
      const newStream = await getMediaStream();
      const newTrack = newStream.getVideoTracks()[0];
      const oldTrack = localStream.getVideoTracks()[0];
      
      if (peerConnection) {
        const sender = peerConnection.getSenders().find(s => s.track === oldTrack);
        if (sender) await sender.replaceTrack(newTrack);
      }
      
      localStream.removeTrack(oldTrack);
      localStream.addTrack(newTrack);
      localVideo.srcObject = localStream;
    } catch (err) {
      console.error('Failed to re-acquire camera:', err);
    }
  }
});

// ============================================
// SOCKET.IO EVENTS
// ============================================

socket.on('waiting', (msg) => {
  console.log(msg);
});

socket.on('user-joined', async (userId) => {
  console.log('User joined:', userId);
  showScreen('call');
  isInCall = true;
  await makeOffer();
});

socket.on('offer', async (data) => {
  console.log('Received offer from:', data.from);
  showScreen('call');
  isInCall = true;
  await handleOffer(data.offer);
});

socket.on('answer', async (data) => {
  console.log('Received answer from:', data.from);
  await handleAnswer(data.answer);
});

socket.on('ice-candidate', async (data) => {
  await handleIceCandidate(data.candidate);
});

socket.on('toggle-audio', (data) => {
  remoteAudioEnabled = data.enabled;
  remoteMuted.classList.toggle('hidden', remoteAudioEnabled);
});

socket.on('toggle-video', (data) => {
  if (!data.enabled && remoteVideo.srcObject) {
    // Could show avatar/placeholder here
  }
});

socket.on('screen-share', (data) => {
  remoteScreenIndicator.classList.toggle('hidden', !data.enabled);
});

socket.on('call-ended', () => {
  alert('The other person ended the call');
  endCallLocal();
});

socket.on('user-left', () => {
  updateConnectionStatus('Other person left');
  if (peerConnection) {
    peerConnection.close();
    peerConnection = null;
  }
  remoteVideo.srcObject = null;
  stopCallTimer();
});

socket.on('error', (msg) => {
  if (msg.includes('full')) {
    cleanup();
    resetToPinScreen();
  }
  errorMsg.textContent = msg;
});

socket.on('disconnect', (reason) => {
  console.log('Socket disconnected:', reason);
  if (isInCall) {
    updateConnectionStatus('Reconnecting...');
  }
});

socket.on('reconnect', () => {
  console.log('Socket reconnected');
  if (currentPin && isInCall) {
    socket.emit('join-room', currentPin);
  }
});

socket.on('reconnect_failed', () => {
  updateConnectionStatus('Connection lost');
  cleanup();
  resetToPinScreen();
});

// ============================================
// SAFETY: Warn before closing tab during call
// ============================================

window.addEventListener('beforeunload', (e) => {
  if (isInCall) {
    e.preventDefault();
    e.returnValue = '';
  }
});
