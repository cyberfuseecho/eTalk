const socket = io();

// DOM Elements
const pinScreen = document.getElementById('pin-screen');
const waitingScreen = document.getElementById('waiting-screen');
const callScreen = document.getElementById('call-screen');
const pinInput = document.getElementById('pin-input');
const joinBtn = document.getElementById('join-btn');
const errorMsg = document.getElementById('error-msg');
const waitingPin = document.getElementById('waiting-pin');
const cancelWaitBtn = document.getElementById('cancel-wait-btn');
const localVideo = document.getElementById('local-video');
const remoteVideo = document.getElementById('remote-video');
const toggleAudioBtn = document.getElementById('toggle-audio-btn');
const toggleVideoBtn = document.getElementById('toggle-video-btn');
const endCallBtn = document.getElementById('end-call-btn');
const connectionStatus = document.getElementById('connection-status');
const remoteMuted = document.getElementById('remote-muted');

// State
let localStream = null;
let peerConnection = null;
let currentPin = null;
let isAudioEnabled = true;
let isVideoEnabled = true;
let remoteAudioEnabled = true;
let remoteVideoEnabled = true;

const servers = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'stun:stun3.l.google.com:19302' },
    { urls: 'stun:stun4.l.google.com:19302' }
  ]
};

// PIN input validation
pinInput.addEventListener('input', (e) => {
  e.target.value = e.target.value.replace(/\D/g, '').slice(0, 4);
  joinBtn.disabled = e.target.value.length !== 4;
  errorMsg.textContent = '';
});

pinInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && pinInput.value.length === 4) {
    joinCall();
  }
});

joinBtn.addEventListener('click', joinCall);
cancelWaitBtn.addEventListener('click', resetToPinScreen);
endCallBtn.addEventListener('click', endCall);

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

async function joinCall() {
  const pin = pinInput.value.trim();
  if (!/^\d{4}$/.test(pin)) {
    errorMsg.textContent = 'Please enter exactly 4 digits';
    return;
  }

  currentPin = pin;
  
  try {
    localStream = await navigator.mediaDevices.getUserMedia({ 
      video: { width: { ideal: 1280 }, height: { ideal: 720 } }, 
      audio: true 
    });
    localVideo.srcObject = localStream;
  } catch (err) {
    errorMsg.textContent = 'Camera/microphone access denied. Please allow access.';
    console.error('getUserMedia error:', err);
    return;
  }

  showScreen('waiting');
  waitingPin.textContent = pin;
  socket.emit('join-room', pin);
}

function resetToPinScreen() {
  cleanup();
  showScreen('pin');
  pinInput.value = '';
  joinBtn.disabled = true;
  waitingPin.textContent = '';
}

function showScreen(name) {
  [pinScreen, waitingScreen, callScreen].forEach(s => s.classList.remove('active'));
  if (name === 'pin') pinScreen.classList.add('active');
  if (name === 'waiting') waitingScreen.classList.add('active');
  if (name === 'call') callScreen.classList.add('active');
}

async function createPeerConnection() {
  peerConnection = new RTCPeerConnection(servers);

  localStream.getTracks().forEach(track => {
    peerConnection.addTrack(track, localStream);
  });

  peerConnection.ontrack = (event) => {
    if (event.streams && event.streams[0]) {
      remoteVideo.srcObject = event.streams[0];
      connectionStatus.textContent = 'Connected';
      setTimeout(() => connectionStatus.style.display = 'none', 2000);
    }
  };

  peerConnection.onicecandidate = (event) => {
    if (event.candidate) {
      socket.emit('ice-candidate', { pin: currentPin, candidate: event.candidate });
    }
  };

  peerConnection.onconnectionstatechange = () => {
    console.log('Connection state:', peerConnection.connectionState);
    if (peerConnection.connectionState === 'connected') {
      connectionStatus.textContent = 'Connected';
      setTimeout(() => connectionStatus.style.display = 'none', 2000);
    } else if (peerConnection.connectionState === 'disconnected' || 
               peerConnection.connectionState === 'failed') {
      connectionStatus.style.display = 'block';
      connectionStatus.textContent = 'Disconnected';
    }
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
  if (peerConnection) {
    await peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
  }
}

async function handleIceCandidate(candidate) {
  if (peerConnection) {
    try {
      await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
    } catch (err) {
      console.error('Error adding ICE candidate:', err);
    }
  }
}

function endCall() {
  socket.emit('end-call', currentPin);
  cleanup();
  resetToPinScreen();
}

function cleanup() {
  if (peerConnection) {
    peerConnection.close();
    peerConnection = null;
  }
  if (localStream) {
    localStream.getTracks().forEach(track => track.stop());
    localStream = null;
  }
  localVideo.srcObject = null;
  remoteVideo.srcObject = null;
  currentPin = null;
  isAudioEnabled = true;
  isVideoEnabled = true;
  connectionStatus.style.display = 'block';
  connectionStatus.textContent = 'Connecting...';
  remoteMuted.classList.add('hidden');
  toggleAudioBtn.classList.add('active');
  toggleVideoBtn.classList.add('active');
}

// Socket events
socket.on('waiting', (msg) => {
  console.log(msg);
});

socket.on('user-joined', async (userId) => {
  console.log('User joined:', userId);
  showScreen('call');
  await makeOffer();
});

socket.on('offer', async (data) => {
  console.log('Received offer from:', data.from);
  showScreen('call');
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
  remoteVideoEnabled = data.enabled;
  if (!remoteVideoEnabled && remoteVideo.srcObject) {
    remoteVideo.style.display = 'none';
  } else {
    remoteVideo.style.display = 'block';
  }
});

socket.on('call-ended', () => {
  alert('The other person ended the call');
  cleanup();
  resetToPinScreen();
});

socket.on('user-left', () => {
  connectionStatus.style.display = 'block';
  connectionStatus.textContent = 'Other person left';
  if (peerConnection) {
    peerConnection.close();
    peerConnection = null;
  }
  remoteVideo.srcObject = null;
});

socket.on('error', (msg) => {
  errorMsg.textContent = msg;
  if (msg.includes('full')) {
    cleanup();
    resetToPinScreen();
  }
});

socket.on('disconnect', () => {
  cleanup();
  resetToPinScreen();
});
