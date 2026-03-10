// Client-side JavaScript for all pages
// Replace your existing socket initialization with this:
const socket = io({
  transports: ['websocket'], // Force WebSocket only for Render
  reconnectionAttempts: 5,
  reconnectionDelay: 1000,
  timeout: 20000
});

// ==================== UTILITY FUNCTIONS ====================

// Format waiting time
const formatTime = (minutes) => {
    if (minutes === null || minutes === undefined) return 'N/A';
    if (minutes < 0) return 'Now';
    if (minutes < 1) return '< 1 min';
    if (minutes === 1) return '1 min';
    if (minutes < 60) return `${Math.round(minutes)} mins`;
    const hours = Math.floor(minutes / 60);
    const remainingMins = Math.round(minutes % 60);
    return `${hours}h ${remainingMins}m`;
};

// Play notification sound
const playNotification = () => {
    try {
        const audioContext = new (window.AudioContext || window.webkitAudioContext)();
        
        if (audioContext.state === 'suspended') {
            audioContext.resume();
        }
        
        const oscillator = audioContext.createOscillator();
        const gainNode = audioContext.createGain();
        
        oscillator.connect(gainNode);
        gainNode.connect(audioContext.destination);
        
        oscillator.frequency.value = 800;
        gainNode.gain.value = 0.1;
        
        oscillator.start();
        oscillator.stop(audioContext.currentTime + 0.1);
    } catch (e) {
        console.log('Audio notification not available:', e);
    }
};

// Animation helper for numbers
const animateNumber = (elementId, finalValue, duration = 1000) => {
    const element = document.getElementById(elementId);
    if (!element) return;
    
    const startValue = parseInt(element.textContent) || 0;
    const startTime = performance.now();
    
    const updateNumber = (currentTime) => {
        const elapsed = currentTime - startTime;
        const progress = Math.min(elapsed / duration, 1);
        
        const easeOutQuart = 1 - Math.pow(1 - progress, 3);
        const currentValue = Math.floor(startValue + (finalValue - startValue) * easeOutQuart);
        
        element.textContent = currentValue;
        
        if (progress < 1) {
            requestAnimationFrame(updateNumber);
        } else {
            element.textContent = finalValue;
        }
    };
    
    requestAnimationFrame(updateNumber);
};

// Show temporary notification
const showNotification = (message, type = 'success') => {
    const notification = document.createElement('div');
    notification.className = `notification-message ${type}`;
    notification.textContent = message;
    notification.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        background-color: ${type === 'success' ? 'var(--gold)' : 'var(--danger)'};
        color: ${type === 'success' ? 'var(--accent)' : 'white'};
        padding: 15px 25px;
        border-radius: 50px;
        font-size: 1rem;
        font-weight: 500;
        box-shadow: 0 10px 20px rgba(0, 0, 0, 0.3);
        z-index: 1000;
        animation: slideInRight 0.3s ease;
    `;
    
    document.body.appendChild(notification);
    
    setTimeout(() => {
        notification.style.animation = 'slideOutRight 0.3s ease';
        setTimeout(() => {
            notification.remove();
        }, 300);
    }, 3000);
};

// Add animation styles
const addAnimationStyles = () => {
    if (document.getElementById('animation-styles')) return;
    
    const style = document.createElement('style');
    style.id = 'animation-styles';
    style.textContent = `
        @keyframes slideInRight {
            from {
                transform: translateX(100%);
                opacity: 0;
            }
            to {
                transform: translateX(0);
                opacity: 1;
            }
        }
        
        @keyframes slideOutRight {
            from {
                transform: translateX(0);
                opacity: 1;
            }
            to {
                transform: translateX(100%);
                opacity: 0;
            }
        }
        
        @keyframes fadeIn {
            from {
                opacity: 0;
            }
            to {
                opacity: 1;
            }
        }
    `;
    
    document.head.appendChild(style);
};

// ==================== PAGE INITIALIZATION ====================

document.addEventListener('DOMContentLoaded', () => {
    const path = window.location.pathname;
    
    if (path === '/' || path === '/login') {
        // Login page doesn't need socket
    } else if (path === '/dashboard' || path === '/dashboard.html') {
        initDashboardPage();
    } else if (path === '/screen' || path === '/screen.html') {
        initScreenPage();
    } else if (path === '/track' || path === '/track.html') {
        initTrackPage();
    }
    
    addAnimationStyles();
});

// ==================== DASHBOARD PAGE ====================

function initDashboardPage() {
    const queueList = document.getElementById('queueList');
    const callNextBtn = document.getElementById('callNextBtn');
    const clearQueueBtn = document.getElementById('clearQueueBtn');
    const currentServingDisplay = document.getElementById('currentServingDisplay');
    const totalInQueue = document.getElementById('totalInQueue');
    const totalWaitTime = document.getElementById('totalWaitTime');
    const addPatientForm = document.getElementById('addPatientForm');
    const whatsappContainer = document.getElementById('whatsappLinkContainer');
    const whatsappLink = document.getElementById('whatsappLink');
    const copyLinkBtn = document.getElementById('copyLinkBtn');
    const openWhatsAppBtn = document.getElementById('openWhatsAppBtn');
    
    if (!callNextBtn) return;
    
    // Add patient form handler
    if (addPatientForm) {
        addPatientForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            
            const name = document.getElementById('patientName').value.trim();
            const phone = document.getElementById('phoneNumber').value.trim();
            const addBtn = document.getElementById('addPatientBtn');
            
            if (!name || !phone) {
                showNotification('Please fill in all fields', 'error');
                return;
            }
            
            addBtn.disabled = true;
            addBtn.innerHTML = '<span class="spinner-small"></span> Adding...';
            
            try {
                const response = await fetch('/api/add-patient', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ name, phoneNumber: phone })
                });
                
                const data = await response.json();
                
                if (data.success) {
                    whatsappLink.value = data.whatsappLink;
                    openWhatsAppBtn.href = data.whatsappLink;
                    whatsappContainer.classList.remove('hidden');
                    
                    document.getElementById('patientName').value = '';
                    document.getElementById('phoneNumber').value = '';
                    
                    showNotification('Patient added successfully!', 'success');
                } else {
                    showNotification(data.error || 'Failed to add patient', 'error');
                }
            } catch (error) {
                console.error('Error:', error);
                showNotification('Failed to add patient', 'error');
            } finally {
                addBtn.disabled = false;
                addBtn.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg> Add Patient to Queue';
            }
        });
    }
    
    // Copy link button
    if (copyLinkBtn) {
        copyLinkBtn.addEventListener('click', () => {
            whatsappLink.select();
            document.execCommand('copy');
            showNotification('Link copied to clipboard!', 'success');
        });
    }
    
    // Call next button handler
    callNextBtn.addEventListener('click', () => {
        socket.emit('call-next');
        showNotification('Next patient called', 'success');
    });
    
    // Clear queue button handler
    clearQueueBtn.addEventListener('click', () => {
        if (confirm('⚠️ Are you sure you want to clear the entire queue? This action cannot be undone.')) {
            socket.emit('clear-queue');
            showNotification('Queue cleared successfully', 'success');
        }
    });
    
    // Make removePatient function globally available
    window.removePatient = (patientId) => {
        if (confirm('Are you sure you want to remove this patient from the queue?')) {
            socket.emit('remove-patient', patientId);
            showNotification('Patient removed from queue', 'success');
        }
    };
    
    // Socket event handlers
    socket.on('queue-update', (data) => {
        if (data.queue.length === 0) {
            queueList.innerHTML = '<div class="empty-queue-message">No patients in queue</div>';
        } else {
            queueList.innerHTML = data.queue.map((patient, index) => `
                <div class="queue-item" data-id="${patient.id}" style="animation: slideIn 0.3s ease; animation-delay: ${index * 0.05}s">
                    <div class="patient-info">
                        <span class="patient-number">#${patient.id}</span>
                        <div class="patient-details">
                            <span class="patient-name">${patient.name}</span>
                            <span class="patient-phone">📞 ${patient.displayPhone || patient.phoneNumber}</span>
                            <span class="patient-time">🕒 ${new Date(patient.joinTime).toLocaleTimeString()}</span>
                        </div>
                    </div>
                    <div class="patient-status">
                        <span class="patient-wait">⏱️ ${formatTime(patient.waitingTime)}</span>
                        <span class="patient-position">📍 Position: ${patient.position}</span>
                    </div>
                    <button class="remove-btn" onclick="removePatient(${patient.id})" title="Remove patient">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M18 6L6 18M6 6l12 12"/>
                        </svg>
                    </button>
                </div>
            `).join('');
        }
        
        if (currentServingDisplay) {
            if (data.currentServing) {
                currentServingDisplay.textContent = `${data.currentServing.name} (#${data.currentServing.id})`;
                currentServingDisplay.style.color = 'var(--gold)';
            } else {
                currentServingDisplay.textContent = 'None';
                currentServingDisplay.style.color = 'var(--text-secondary)';
            }
        }
        
        if (totalInQueue) {
            animateNumber('totalInQueue', data.queueLength, 500);
        }
        
        if (totalWaitTime) {
            const totalWait = data.queue.reduce((sum, patient) => sum + (patient.waitingTime || 0), 0);
            totalWaitTime.textContent = formatTime(totalWait);
        }
    });
    
    socket.on('next-called', (data) => {
        playNotification();
    });
}

// ==================== SCREEN PAGE ====================

function initScreenPage() {
    const nowServing = document.getElementById('nowServing');
    const nextPatients = document.getElementById('nextPatients');
    const totalInQueue = document.getElementById('totalInQueue');
    const estimatedWait = document.getElementById('estimatedWait');
    const datetime = document.getElementById('datetime');
    
    if (!nowServing) return;
    
    const AVERAGE_CONSULTATION_TIME = 5;
    
    const updateDateTime = () => {
        if (datetime) {
            const now = new Date();
            const options = { 
                hour: '2-digit', 
                minute: '2-digit',
                second: '2-digit',
                hour12: false
            };
            datetime.textContent = now.toLocaleTimeString('en-US', options);
        }
    };
    
    setInterval(updateDateTime, 1000);
    updateDateTime();
    
    socket.on('queue-update', (data) => {
        if (nowServing) {
            nowServing.classList.add('updated');
            setTimeout(() => {
                nowServing.classList.remove('updated');
            }, 500);
            
            if (data.currentServing) {
                nowServing.textContent = data.currentServing.id.toString().padStart(3, '0');
            } else {
                nowServing.textContent = '---';
            }
        }
        
        const nextFive = data.queue.slice(0, 5);
        if (nextPatients) {
            if (nextFive.length === 0) {
                nextPatients.innerHTML = '';
                for (let i = 0; i < 5; i++) {
                    nextPatients.innerHTML += `
                        <div class="next-patient-item empty" style="animation: slideInRight 0.5s ease; animation-delay: ${i * 0.1}s">
                            <span class="next-patient-number">---</span>
                            <span class="next-patient-name">No patient in queue</span>
                        </div>
                    `;
                }
            } else {
                nextPatients.innerHTML = nextFive.map((patient, index) => `
                    <div class="next-patient-item" style="animation: slideInRight 0.5s ease; animation-delay: ${index * 0.1}s">
                        <span class="next-patient-number">#${patient.id.toString().padStart(3, '0')}</span>
                        <span class="next-patient-name">${patient.name}</span>
                    </div>
                `).join('');
                
                if (nextFive.length < 5) {
                    for (let i = nextFive.length; i < 5; i++) {
                        nextPatients.innerHTML += `
                            <div class="next-patient-item empty" style="animation: slideInRight 0.5s ease; animation-delay: ${i * 0.1}s">
                                <span class="next-patient-number">---</span>
                                <span class="next-patient-name">Available</span>
                            </div>
                        `;
                    }
                }
            }
        }
        
        if (totalInQueue) {
            totalInQueue.textContent = data.queueLength;
        }
        
        if (estimatedWait) {
            const totalWait = data.queueLength * AVERAGE_CONSULTATION_TIME;
            estimatedWait.textContent = formatTime(totalWait);
        }
    });
    
    socket.on('next-called', () => {
        playNotification();
        
        if (nowServing) {
            nowServing.style.animation = 'none';
            nowServing.offsetHeight;
            nowServing.style.animation = 'pulse 0.5s ease 3';
        }
    });
}

// ==================== TRACK PAGE (Fixed) ====================

function initTrackPage() {
    const phoneEntryForm = document.getElementById('phoneEntryForm');
    const loadingState = document.getElementById('loadingState');
    const queueStatus = document.getElementById('queueStatus');
    const trackBtn = document.getElementById('trackBtn');
    const phoneInput = document.getElementById('phoneNumber');
    const trackError = document.getElementById('trackError');
    const trackSuccess = document.getElementById('trackSuccess');
    const backBtn = document.getElementById('backBtn');
    
    if (!trackBtn) return;

    let currentPatientId = null;
    let socketConnection = null;
    let isTracking = false;

    // Auto-focus on phone input
    phoneInput.focus();

    // Track button click handler
    trackBtn.addEventListener('click', trackPatient);
    
    // Enter key handler
    phoneInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            trackPatient();
        }
    });

    // Phone input validation - only allow digits
    phoneInput.addEventListener('input', (e) => {
        e.target.value = e.target.value.replace(/\D/g, '');
    });

    // Back button handler
    if (backBtn) {
        backBtn.addEventListener('click', () => {
            resetToEntryForm();
        });
    }

    function trackPatient() {
        if (isTracking) return;
        
        let phone = phoneInput.value.trim();
        
        if (!phone) {
            showTrackError('Please enter your phone number');
            return;
        }

        // Remove any non-digit characters
        phone = phone.replace(/\D/g, '');
        
        if (phone.length < 3) {
            showTrackError('Please enter a valid phone number');
            return;
        }

        // Show loading, hide form and error
        phoneEntryForm.classList.add('hidden');
        loadingState.classList.remove('hidden');
        trackError.classList.add('hidden');
        if (trackSuccess) trackSuccess.classList.add('hidden');
        
        isTracking = true;

        console.log('Tracking phone:', phone); // Debug log

        // Fetch patient data
        fetch(`/api/patient/${phone}`)
            .then(response => {
                if (!response.ok) {
                    return response.json().then(data => {
                        throw new Error(data.error || 'Patient not found');
                    });
                }
                return response.json();
            })
            .then(data => {
                console.log('Patient data received:', data); // Debug log
                
                loadingState.classList.add('hidden');
                
                if (data.error) {
                    showTrackError(data.error);
                    phoneEntryForm.classList.remove('hidden');
                    isTracking = false;
                    return;
                }

                // Store patient info
                currentPatientId = data.id;

                // Show status
                queueStatus.classList.remove('hidden');
                
                // Update display
                updatePatientDisplay(data);

                // Show success message
                if (trackSuccess) {
                    trackSuccess.textContent = 'Patient found! Tracking your position...';
                    trackSuccess.classList.remove('hidden');
                    setTimeout(() => {
                        trackSuccess.classList.add('hidden');
                    }, 3000);
                }

                // Setup socket for real-time updates
                setupSocketForTrack();
            })
            .catch(error => {
                console.error('Error:', error);
                loadingState.classList.add('hidden');
                phoneEntryForm.classList.remove('hidden');
                showTrackError(error.message || 'Phone number not found in queue');
                isTracking = false;
            });
    }

    function showTrackError(message) {
        trackError.textContent = message;
        trackError.classList.remove('hidden');
        
        // Auto hide after 3 seconds
        setTimeout(() => {
            trackError.classList.add('hidden');
        }, 3000);
    }

    function updatePatientDisplay(data) {
        const nameEl = document.getElementById('patientName');
        const phoneEl = document.getElementById('patientPhone');
        const queueNumEl = document.getElementById('queueNumber');
        const positionEl = document.getElementById('position');
        const peopleAheadEl = document.getElementById('peopleAhead');
        const waitingTimeEl = document.getElementById('waitingTime');
        const currentServingEl = document.getElementById('currentServing');
        const queueLengthEl = document.getElementById('queueLength');
        const progressBar = document.getElementById('progressBar');
        
        if (nameEl) nameEl.textContent = data.name || '-';
        if (phoneEl) phoneEl.textContent = data.phoneNumber || '-';
        if (queueNumEl) queueNumEl.textContent = data.id || '-';
        if (positionEl) positionEl.textContent = data.position || '-';
        if (peopleAheadEl) peopleAheadEl.textContent = (data.position - 1) || '0';
        if (waitingTimeEl) waitingTimeEl.textContent = formatTime(data.waitingTime);
        
        if (currentServingEl) {
            if (data.currentServing) {
                currentServingEl.textContent = `#${data.currentServing.id} - ${data.currentServing.name}`;
            } else {
                currentServingEl.textContent = 'No patient being served';
            }
        }

        if (queueLengthEl) queueLengthEl.textContent = data.queueLength || '0';

        // Update progress bar
        if (progressBar && data.queueLength > 0 && data.position) {
            const progress = ((data.queueLength - data.position) / data.queueLength) * 100;
            progressBar.style.width = `${Math.max(0, progress)}%`;
        }
    }

    function setupSocketForTrack() {
        // Disconnect existing socket if any
        if (socketConnection) {
            socketConnection.disconnect();
        }

        socketConnection = io();

        socketConnection.on('connect', () => {
            console.log('Socket connected for tracking');
        });

        socketConnection.on('queue-update', (data) => {
            console.log('Queue update received:', data); // Debug log
            
            if (!currentPatientId) return;
            
            // Find this patient in the queue
            const patient = data.queue.find(p => p.id === currentPatientId);
            
            if (patient) {
                // Patient still in queue
                updatePatientDisplay({
                    ...patient,
                    currentServing: data.currentServing,
                    queueLength: data.queueLength
                });
            } else {
                // Patient not in queue - check if being served
                if (data.currentServing && data.currentServing.id === currentPatientId) {
                    // Patient is currently being served
                    const currentServingEl = document.getElementById('currentServing');
                    if (currentServingEl) {
                        currentServingEl.innerHTML = 
                            `<span style="color: var(--success); font-weight: 700;">#${data.currentServing.id} - ${data.currentServing.name} (YOU ARE NOW BEING SERVED)</span>`;
                    }
                    
                    const positionEl = document.getElementById('position');
                    if (positionEl) positionEl.textContent = 'Being Served';
                    
                    const peopleAheadEl = document.getElementById('peopleAhead');
                    if (peopleAheadEl) peopleAheadEl.textContent = '0';
                    
                    const waitingTimeEl = document.getElementById('waitingTime');
                    if (waitingTimeEl) waitingTimeEl.textContent = 'Now';
                    
                    const progressBar = document.getElementById('progressBar');
                    if (progressBar) progressBar.style.width = '100%';
                    
                    showTrackNotification('It\'s your turn! Please proceed to the consultation room.');
                } else {
                    // Patient no longer in queue (served or removed)
                    showServedMessage();
                }
            }
        });

        socketConnection.on('next-called', (data) => {
            console.log('Next called:', data); // Debug log
            if (data.patient && data.patient.id === currentPatientId) {
                playNotification();
                showTrackNotification('It\'s your turn! Please proceed to the consultation room.');
            }
        });

        socketConnection.on('disconnect', () => {
            console.log('Socket disconnected');
        });

        socketConnection.on('connect_error', (error) => {
            console.error('Socket connection error:', error);
            showTrackError('Connection error. Please refresh the page.');
        });
    }

    function showServedMessage() {
        const statusCard = document.querySelector('.status-card');
        if (statusCard) {
            statusCard.innerHTML = `
                <button id="backBtn" class="back-btn">← Track Another Number</button>
                <div class="served-message">
                    <div class="checkmark">✓</div>
                    <h2>You have been served!</h2>
                    <p>Thank you for visiting our clinic.</p>
                    <p style="margin-top: 20px; color: var(--text-secondary);">If you haven't been seen yet, please contact reception.</p>
                </div>
            `;
            
            // Reattach back button handler
            const newBackBtn = document.getElementById('backBtn');
            if (newBackBtn) {
                newBackBtn.addEventListener('click', resetToEntryForm);
            }
        }
    }

    function resetToEntryForm() {
        // Disconnect socket
        if (socketConnection) {
            socketConnection.disconnect();
            socketConnection = null;
        }
        
        // Reset UI
        queueStatus.classList.add('hidden');
        phoneEntryForm.classList.remove('hidden');
        phoneInput.value = '';
        phoneInput.focus();
        currentPatientId = null;
        isTracking = false;
        
        // Clear any errors
        if (trackError) trackError.classList.add('hidden');
    }

    function showTrackNotification(message) {
        const notification = document.createElement('div');
        notification.className = 'track-notification';
        notification.textContent = message;
        document.body.appendChild(notification);
        
        setTimeout(() => {
            notification.remove();
        }, 5000);
    }
}

// Make functions globally available
window.showNotification = showNotification;
window.formatTime = formatTime;
window.playNotification = playNotification;