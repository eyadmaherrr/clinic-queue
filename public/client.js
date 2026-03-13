// Client-side JavaScript for all pages
const socket = io({
  transports: ['websocket'],
  reconnectionAttempts: 5,
  reconnectionDelay: 1000,
  timeout: 20000
});

// ==================== UTILITY FUNCTIONS ====================

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

// Replace the playNotification function with this:
const playNotification = () => {
    try {
        const audio = new Audio('/sounds/beep.mp3');
        audio.volume = 0.5; // Set volume to 50%
        audio.play().catch(e => {
            console.log('Audio playback failed:', e);
            // Fallback to Web Audio API if MP3 fails
            fallbackBeep();
        });
    } catch (e) {
        console.log('Audio not available:', e);
        fallbackBeep();
    }
};

// Fallback beep using Web Audio API (kept as backup)
const fallbackBeep = () => {
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
        console.log('Fallback audio also failed:', e);
    }
};

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
        border: 2px solid var(--gold);
    `;
    
    document.body.appendChild(notification);
    
    setTimeout(() => {
        notification.style.animation = 'slideOutRight 0.3s ease';
        setTimeout(() => {
            notification.remove();
        }, 300);
    }, 3000);
};

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
    } else if (path === '/doctor' || path === '/doctor.html') {
        initDoctorPage();
    } else if (path === '/patients' || path === '/patients.html') {
        initPatientsPage();
    }
    
    addAnimationStyles();
    
    // Modal event listeners
    const closeBtn = document.querySelector('.close-modal');
    if (closeBtn) {
        closeBtn.addEventListener('click', closeEditModal);
    }
    
    const cancelBtn = document.getElementById('cancelEditBtn');
    if (cancelBtn) {
        cancelBtn.addEventListener('click', closeEditModal);
    }
    
    const saveBtn = document.getElementById('saveEditBtn');
    if (saveBtn) {
        saveBtn.addEventListener('click', saveEdit);
    }
    
    window.addEventListener('click', (e) => {
        const modal = document.getElementById('editModal');
        if (e.target === modal) {
            closeEditModal();
        }
    });
});

// ==================== GLOBAL FUNCTIONS ====================

// Global variables for modal
let currentEditId = null;

// Open edit modal
window.openEditModal = (patientId, patientName, patientPhone) => {
    currentEditId = patientId;
    document.getElementById('editPatientId').value = patientId;
    document.getElementById('editPatientName').value = patientName;
    document.getElementById('editPatientPhone').value = patientPhone;
    document.getElementById('editModal').classList.remove('hidden');
};

// Close edit modal
window.closeEditModal = () => {
    document.getElementById('editModal').classList.add('hidden');
    currentEditId = null;
};

// Save edit
window.saveEdit = () => {
    const patientId = currentEditId;
    const newName = document.getElementById('editPatientName').value.trim();
    const newPhone = document.getElementById('editPatientPhone').value.trim();
    
    if (!newName || !newPhone) {
        showNotification('Please fill all fields', 'error');
        return;
    }
    
    fetch('/api/edit-patient', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ patientId, name: newName, phoneNumber: newPhone })
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            showNotification('Patient updated successfully', 'success');
            closeEditModal();
        } else {
            showNotification(data.error || 'Failed to update patient', 'error');
        }
    })
    .catch(error => {
        console.error('Error:', error);
        showNotification('Failed to update patient', 'error');
    });
};

// Send WhatsApp message
window.sendWhatsApp = (phoneNumber, patientName, queueNumber) => {
    // Format phone number (remove any non-digits)
    const formattedPhone = phoneNumber.replace(/\D/g, '');
    
    const message = encodeURIComponent(
        `🏥 *Dr Maher Mahmoud Clinics*\n\n` +
        `Hello *${patientName}*,\n\n` +
        `*Your Queue Number:* #${queueNumber}\n\n` +
        `You can track your position here:\n${window.location.origin}/track\n\n` +
        `Thank you for choosing our clinic!`
    );
    
    window.open(`https://wa.me/${formattedPhone}?text=${message}`, '_blank');
};

// Move patient up in queue
window.moveUp = (patientId) => {
    const queueList = document.getElementById('queueList');
    const items = Array.from(queueList.children);
    const index = items.findIndex(item => item.dataset.id == patientId);
    
    if (index > 0) {
        // Swap with previous item
        const orderedIds = items.map(item => parseInt(item.dataset.id));
        [orderedIds[index - 1], orderedIds[index]] = [orderedIds[index], orderedIds[index - 1]];
        
        fetch('/api/reorder-queue', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ orderedIds })
        })
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                showNotification('Patient moved up', 'success');
            }
        })
        .catch(error => {
            console.error('Error:', error);
            showNotification('Failed to move patient', 'error');
        });
    }
};

// Move patient down in queue
window.moveDown = (patientId) => {
    const queueList = document.getElementById('queueList');
    const items = Array.from(queueList.children);
    const index = items.findIndex(item => item.dataset.id == patientId);
    
    if (index < items.length - 1) {
        // Swap with next item
        const orderedIds = items.map(item => parseInt(item.dataset.id));
        [orderedIds[index], orderedIds[index + 1]] = [orderedIds[index + 1], orderedIds[index]];
        
        fetch('/api/reorder-queue', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ orderedIds })
        })
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                showNotification('Patient moved down', 'success');
            }
        })
        .catch(error => {
            console.error('Error:', error);
            showNotification('Failed to move patient', 'error');
        });
    }
};

// ==================== DASHBOARD PAGE ====================

function initDashboardPage() {
    const queueList = document.getElementById('queueList');
    const callNextBtn = document.getElementById('callNextBtn');
    const clearQueueBtn = document.getElementById('clearQueueBtn');
    const currentServingDisplay = document.getElementById('currentServingDisplay');
    const totalInQueue = document.getElementById('totalInQueue');
    const totalWaitTime = document.getElementById('totalWaitTime');
    const priorityCount = document.getElementById('priorityCount');
    const missedCount = document.getElementById('missedCount');
    const addPatientForm = document.getElementById('addPatientForm');
    const whatsappContainer = document.getElementById('whatsappLinkContainer');
    const whatsappLink = document.getElementById('whatsappLink');
    const copyLinkBtn = document.getElementById('copyLinkBtn');
    const openWhatsAppBtn = document.getElementById('openWhatsAppBtn');
    
    if (!callNextBtn) return;
    
    updateAddPatientForm();
    
    if (addPatientForm) {
        addPatientForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            
            const name = document.getElementById('patientName').value.trim();
            const phone = document.getElementById('phoneNumber').value.trim();
            const isPriority = document.getElementById('priorityCheckbox')?.checked || false;
            const area = document.getElementById('patientArea')?.value.trim() || 'Unknown';
            const lastVisitDate = document.getElementById('lastVisitDate')?.value || null;
            const isNewPatient = document.getElementById('isNewPatient')?.checked || true;
            
            const addBtn = document.getElementById('addPatientBtn');
            
            if (!name || !phone) {
                showNotification('Please fill in all fields', 'error');
                return;
            }
            
            if (!area) {
                showNotification('Please enter the patient\'s area', 'error');
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
                    body: JSON.stringify({ 
                        name, 
                        phoneNumber: phone, 
                        isPriority,
                        area,
                        lastVisitDate,
                        isNewPatient
                    })
                });
                
                const data = await response.json();
                
                if (data.success) {
                    whatsappLink.value = data.whatsappLink;
                    openWhatsAppBtn.href = data.whatsappLink;
                    whatsappContainer.classList.remove('hidden');
                    
                    // Clear all form fields
                    document.getElementById('patientName').value = '';
                    document.getElementById('phoneNumber').value = '';
                    document.getElementById('patientArea').value = '';
                    document.getElementById('lastVisitDate').value = '';
                    document.getElementById('priorityCheckbox').checked = false;
                    document.getElementById('isNewPatient').checked = true;
                    
                    showNotification('Patient added successfully!', 'success');
                } else {
                    showNotification(data.error || 'Failed to add patient', 'error');
                }
            } catch (error) {
                console.error('Error:', error);
                showNotification('Failed to add patient', 'error');
            } finally {
                addBtn.disabled = false;
                addBtn.innerHTML = '<i class="fas fa-plus"></i> Add Patient to Queue';
            }
        });
    }
    
    // Auto-detect patient history when phone number loses focus
    const phoneInput = document.getElementById('phoneNumber');
    const nameInput = document.getElementById('patientName');
    const lastVisitInput = document.getElementById('lastVisitDate');
    const isNewCheckbox = document.getElementById('isNewPatient');
    const patientStatusText = document.getElementById('patientStatusText');
    const areaInput = document.getElementById('patientArea');
    const visitHint = document.getElementById('visitHint');

    if (phoneInput) {
        phoneInput.addEventListener('blur', async function() {
            const phone = this.value.trim();
            
            if (phone.length < 10) return;
            
            // Show loading state
            const originalBg = this.style.backgroundColor;
            this.style.backgroundColor = '#fff9e6';
            if (visitHint) {
                visitHint.textContent = 'Checking patient history...';
                visitHint.style.color = 'var(--text-secondary)';
            }
            
            try {
                // Format phone number (remove non-digits)
                const formattedPhone = phone.replace(/\D/g, '');
                
                const response = await fetch(`/api/check-patient/${formattedPhone}`);
                
                if (!response.ok) {
                    throw new Error(`HTTP error! status: ${response.status}`);
                }
                
                const data = await response.json();
                
                if (data.found) {
                    // Returning patient - autofill all fields
                    if (nameInput) {
                        nameInput.value = data.name || '';
                    }
                    if (lastVisitInput) {
                        lastVisitInput.value = data.lastVisitDate || '';
                        lastVisitInput.readOnly = true;
                    }
                    if (isNewCheckbox) {
                        isNewCheckbox.checked = false;
                        isNewCheckbox.disabled = true;
                    }
                    if (patientStatusText) {
                        patientStatusText.textContent = 'Returning Patient';
                    }
                    if (areaInput && data.area) {
                        areaInput.value = data.area;
                    }
                    if (visitHint) {
                        visitHint.textContent = `✅ Patient found! Last visit: ${data.lastVisitDate || 'Unknown'}`;
                        visitHint.style.color = 'var(--success)';
                    }
                    
                    // Optional: Show a quick notification
                    if (typeof showNotification === 'function') {
                        showNotification(`Welcome back, ${data.name}!`, 'success');
                    }
                } else {
                    // New patient - clear fields
                    if (lastVisitInput) {
                        lastVisitInput.value = '';
                        lastVisitInput.readOnly = false;
                    }
                    if (isNewCheckbox) {
                        isNewCheckbox.checked = true;
                        isNewCheckbox.disabled = true;
                    }
                    if (patientStatusText) {
                        patientStatusText.textContent = 'New Patient';
                    }
                    if (visitHint) {
                        visitHint.textContent = '🆕 New patient - please enter details';
                        visitHint.style.color = 'var(--text-secondary)';
                    }
                    // Don't clear name - reception might have already typed it
                }
            } catch (error) {
                console.error('Error checking patient:', error);
                if (visitHint) {
                    visitHint.textContent = '❌ Error checking history. Please try again.';
                    visitHint.style.color = 'var(--danger)';
                }
                
                // Reset fields on error
                if (lastVisitInput) {
                    lastVisitInput.value = '';
                    lastVisitInput.readOnly = false;
                }
                if (isNewCheckbox) {
                    isNewCheckbox.checked = true;
                    isNewCheckbox.disabled = true;
                }
                if (patientStatusText) {
                    patientStatusText.textContent = 'New Patient';
                }
            } finally {
                this.style.backgroundColor = originalBg;
            }
        });
        
        // Also check when Enter is pressed
        phoneInput.addEventListener('keypress', function(e) {
            if (e.key === 'Enter') {
                this.blur();
            }
        });
    }
    
    if (copyLinkBtn) {
        copyLinkBtn.addEventListener('click', () => {
            whatsappLink.select();
            document.execCommand('copy');
            showNotification('Link copied to clipboard!', 'success');
        });
    }
    
    callNextBtn.addEventListener('click', () => {
        socket.emit('call-next');
        showNotification('Next patient called', 'success');
    });
    
    clearQueueBtn.addEventListener('click', () => {
        if (confirm('⚠️ Are you sure you want to clear the entire queue? This action cannot be undone.')) {
            socket.emit('clear-queue');
            showNotification('Queue cleared successfully', 'success');
        }
    });
    
    window.removePatient = (patientId) => {
        if (confirm('Are you sure you want to remove this patient from the queue?')) {
            socket.emit('remove-patient', patientId);
            showNotification('Patient removed from queue', 'success');
        }
    };
    
    window.togglePriority = (patientId) => {
        fetch('/api/toggle-priority', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ patientId })
        })
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                showNotification(data.isPriority ? '⭐ Priority ON' : 'Priority OFF', 'success');
            }
        })
        .catch(error => {
            console.error('Error:', error);
            showNotification('Failed to toggle priority', 'error');
        });
    };

    window.markMissed = (patientId) => {
        if (confirm('Mark this patient as missed? They will turn gray and be skipped.')) {
            fetch('/api/mark-missed', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ patientId })
            })
            .then(response => response.json())
            .then(data => {
                if (data.success) {
                    showNotification('Patient marked as missed', 'success');
                }
            })
            .catch(error => {
                console.error('Error:', error);
                showNotification('Failed to mark as missed', 'error');
            });
        }
    };

    window.restorePatient = (patientId) => {
        if (confirm('Restore this patient? They will be next in line.')) {
            fetch('/api/restore-patient', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ patientId })
            })
            .then(response => response.json())
            .then(data => {
                if (data.success) {
                    showNotification('Patient restored', 'success');
                }
            })
            .catch(error => {
                console.error('Error:', error);
                showNotification('Failed to restore patient', 'error');
            });
        }
    };
    
    socket.on('queue-update', (data) => {
        renderQueueList(data.queue);
        
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
        
        if (priorityCount) {
            const priorityPatients = data.queue.filter(p => p.isPriority && !p.isMissed).length;
            priorityCount.textContent = priorityPatients;
        }
        
        if (missedCount) {
            const missedPatients = data.queue.filter(p => p.isMissed).length;
            missedCount.textContent = missedPatients;
        }
    });
    
    socket.on('next-called', (data) => {
        playNotification();
    });
}

function renderQueueList(queue) {
    const queueList = document.getElementById('queueList');
    if (!queueList) return;
    
    if (queue.length === 0) {
        queueList.innerHTML = '<div class="empty-queue-message">No patients in queue</div>';
        return;
    }
    
    queueList.innerHTML = queue.map((patient, index) => {
        const isMissed = patient.isMissed;
        const isPriority = patient.isPriority;
        
        let cardClass = '';
        if (isMissed) cardClass = 'missed-patient';
        else if (isPriority) cardClass = 'priority-patient';
        
        // Format phone number for display
        const displayPhone = patient.displayPhone || patient.phoneNumber || `+20${patient.phoneDigits}`;
        
        return `
        <div class="queue-item ${cardClass}" data-id="${patient.id}">
            <div class="move-controls">
                <button class="move-btn move-up" onclick="moveUp(${patient.id})" ${index === 0 ? 'disabled' : ''}>
                    <i class="fas fa-chevron-up"></i>
                </button>
                <button class="move-btn move-down" onclick="moveDown(${patient.id})" ${index === queue.length - 1 ? 'disabled' : ''}>
                    <i class="fas fa-chevron-down"></i>
                </button>
            </div>
            <div class="patient-info">
                <span class="patient-number">#${patient.id}</span>
                <div class="patient-details">
                    <span class="patient-name">${patient.name}</span>
                    <span class="patient-phone"><i class="fas fa-phone-alt"></i> ${displayPhone}</span>
                    <span class="patient-time"><i class="far fa-clock"></i> ${new Date(patient.joinTime).toLocaleTimeString()}</span>
                    ${patient.area ? `<span class="patient-area"><i class="fas fa-map-marker-alt"></i> ${patient.area}</span>` : ''}
                    ${isPriority && !isMissed ? '<span class="priority-badge"><i class="fas fa-star"></i> Priority</span>' : ''}
                    ${isMissed ? '<span class="missed-badge"><i class="fas fa-hourglass"></i> Missed</span>' : ''}
                </div>
            </div>
            <div class="patient-status">
                <span class="patient-wait"><i class="fas fa-hourglass-half"></i> ${formatTime(patient.waitingTime)}</span>
                <span class="patient-position"><i class="fas fa-map-marker-alt"></i> Position: ${patient.position}</span>
            </div>
            <div class="patient-actions">
                <button class="action-btn whatsapp-btn" onclick="sendWhatsApp('${patient.phoneDigits}', '${patient.name}', ${patient.id})" title="Send WhatsApp">
                    <i class="fab fa-whatsapp"></i>
                </button>
                <button class="action-btn edit-btn" onclick="openEditModal(${patient.id}, '${patient.name}', '${patient.phoneDigits}')" title="Edit patient">
                    <i class="fas fa-edit"></i>
                </button>
                ${!isMissed ? `
                    <button class="action-btn priority-btn ${isPriority ? 'active' : ''}" 
                            onclick="togglePriority(${patient.id})" 
                            title="${isPriority ? 'Remove priority' : 'Mark as priority'}">
                        <i class="fas fa-star"></i>
                    </button>
                    <button class="action-btn missed-btn" onclick="markMissed(${patient.id})" title="Mark as missed">
                        <i class="fas fa-clock"></i>
                    </button>
                ` : `
                    <button class="action-btn restore-btn" onclick="restorePatient(${patient.id})" title="Restore to queue">
                        <i class="fas fa-undo-alt"></i>
                    </button>
                `}
                <button class="action-btn remove-btn" onclick="removePatient(${patient.id})" title="Remove patient">
                    <i class="fas fa-trash"></i>
                </button>
            </div>
        </div>
    `}).join('');
}

function updateAddPatientForm() {
    const form = document.getElementById('addPatientForm');
    if (!form) return;
    
    // Check if fields already exist
    if (document.getElementById('patientArea')) return;
    
    // Create area and date row
    const areaRow = document.createElement('div');
    areaRow.className = 'form-row';
    areaRow.innerHTML = `
        <div class="form-group">
            <label for="patientArea"><i class="fas fa-map-marker-alt"></i> Area/District</label>
            <input type="text" id="patientArea" name="patientArea" 
                   placeholder="e.g., 6th October, Dokki, Maadi" required>
        </div>
        <div class="form-group">
            <label for="lastVisitDate"><i class="fas fa-calendar"></i> Last Visit</label>
            <input type="date" id="lastVisitDate" name="lastVisitDate" readonly>
            <small class="form-hint" id="visitHint">Enter phone number to auto-fill</small>
        </div>
    `;
    
    // Create new patient checkbox
    const checkboxGroup = document.createElement('div');
    checkboxGroup.className = 'checkbox-group';
    checkboxGroup.innerHTML = `
        <label>
            <input type="checkbox" id="isNewPatient" checked disabled>
            <i class="fas fa-user-plus"></i> <span id="patientStatusText">New Patient</span>
        </label>
    `;
    
    // Get the priority checkbox and submit button
    const priorityCheckbox = document.querySelector('.priority-checkbox');
    const submitBtn = form.querySelector('button[type="submit"]');
    
    // Insert the new fields in the correct order
    form.insertBefore(areaRow, priorityCheckbox);
    form.insertBefore(checkboxGroup, priorityCheckbox);
}

// ==================== SCREEN PAGE ====================

function initScreenPage() {
    const nowServing = document.getElementById('nowServing');
    const nowServingName = document.getElementById('nowServingName');
    const nextPatients = document.getElementById('nextPatients');
    const totalInQueue = document.getElementById('totalInQueue');
    const priorityCount = document.getElementById('priorityCount');
    const missedCount = document.getElementById('missedCount');
    const estimatedWait = document.getElementById('estimatedWait');
    const datetime = document.getElementById('datetime');
    
    if (!nowServing) return;
    
    const AVERAGE_CONSULTATION_TIME = 15;
    
    const updateDateTime = () => {
        if (datetime) {
            const now = new Date();
            const options = { 
                hour: '2-digit', 
                minute: '2-digit',
                second: '2-digit',
                hour12: true
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
                if (nowServingName) {
                    nowServingName.textContent = data.currentServing.name;
                }
            } else {
                nowServing.textContent = '---';
                if (nowServingName) {
                    nowServingName.textContent = '';
                }
            }
        }
        
        const nextEight = data.queue.slice(0, 8);
        
        if (nextPatients) {
            if (nextEight.length === 0) {
                nextPatients.innerHTML = '';
                for (let i = 0; i < 5; i++) {
                    nextPatients.innerHTML += `
                        <div class="next-patient-item empty">
                            <span class="next-patient-number">---</span>
                            <span class="next-patient-name">No patient in queue</span>
                        </div>
                    `;
                }
            } else {
                nextPatients.innerHTML = nextEight.map((patient, index) => {
                    let patientClass = '';
                    
                    if (patient.isMissed) {
                        patientClass = 'missed';
                    } else if (patient.isPriority) {
                        patientClass = 'priority';
                    }
                    
                    const isNext = index === 0 && !patient.isMissed ? ' (Next)' : '';
                    
                    return `
                        <div class="next-patient-item ${patientClass}">
                            <span class="next-patient-number">#${patient.id.toString().padStart(3, '0')}</span>
                            <span class="next-patient-name">${patient.name}${isNext}</span>
                        </div>
                    `;
                }).join('');
            }
        }
        
        if (totalInQueue) {
            totalInQueue.textContent = data.queueLength;
        }
        
        if (priorityCount) {
            const priorityPatients = data.queue.filter(p => p.isPriority && !p.isMissed).length;
            priorityCount.textContent = priorityPatients;
        }
        
        if (missedCount) {
            const missedPatients = data.queue.filter(p => p.isMissed).length;
            missedCount.textContent = missedPatients;
        }
        
        if (estimatedWait) {
            const activePatients = data.queue.filter(p => !p.isMissed).length;
            const totalWait = activePatients * AVERAGE_CONSULTATION_TIME;
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

// ==================== TRACK PAGE ====================

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

    phoneInput.focus();

    trackBtn.addEventListener('click', trackPatient);
    
    phoneInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            trackPatient();
        }
    });

    phoneInput.addEventListener('input', (e) => {
        e.target.value = e.target.value.replace(/\D/g, '');
    });

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

        phone = phone.replace(/\D/g, '');
        
        if (phone.length < 3) {
            showTrackError('Please enter a valid phone number');
            return;
        }

        phoneEntryForm.classList.add('hidden');
        loadingState.classList.remove('hidden');
        trackError.classList.add('hidden');
        if (trackSuccess) trackSuccess.classList.add('hidden');
        
        isTracking = true;

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
                loadingState.classList.add('hidden');
                
                if (data.error) {
                    showTrackError(data.error);
                    phoneEntryForm.classList.remove('hidden');
                    isTracking = false;
                    return;
                }

                currentPatientId = data.id;
                queueStatus.classList.remove('hidden');
                updatePatientDisplay(data);

                if (trackSuccess) {
                    trackSuccess.textContent = 'Patient found! Tracking your position...';
                    trackSuccess.classList.remove('hidden');
                    setTimeout(() => {
                        trackSuccess.classList.add('hidden');
                    }, 3000);
                }

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

        if (progressBar && data.queueLength > 0 && data.position) {
            const progress = ((data.queueLength - data.position) / data.queueLength) * 100;
            progressBar.style.width = `${Math.max(0, progress)}%`;
        }
    }

    function setupSocketForTrack() {
        if (socketConnection) {
            socketConnection.disconnect();
        }

        socketConnection = io();

        socketConnection.on('connect', () => {
            console.log('Socket connected for tracking');
        });

        socketConnection.on('queue-update', (data) => {
            if (!currentPatientId) return;
            
            const patient = data.queue.find(p => p.id === currentPatientId);
            
            if (patient) {
                updatePatientDisplay({
                    ...patient,
                    currentServing: data.currentServing,
                    queueLength: data.queueLength
                });
            } else {
                if (data.currentServing && data.currentServing.id === currentPatientId) {
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
                    showServedMessage();
                }
            }
        });

        socketConnection.on('next-called', (data) => {
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
            
            const newBackBtn = document.getElementById('backBtn');
            if (newBackBtn) {
                newBackBtn.addEventListener('click', resetToEntryForm);
            }
        }
    }

    function resetToEntryForm() {
        if (socketConnection) {
            socketConnection.disconnect();
            socketConnection = null;
        }
        
        queueStatus.classList.add('hidden');
        phoneEntryForm.classList.remove('hidden');
        phoneInput.value = '';
        phoneInput.focus();
        currentPatientId = null;
        isTracking = false;
        
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

// ==================== DOCTOR PAGE ====================

function initDoctorPage() {
    const nowServing = document.getElementById('nowServing');
    const nowServingName = document.getElementById('nowServingName');
    const nowServingArea = document.getElementById('nowServingArea');
    const nowServingStatus = document.getElementById('nowServingStatus');
    const nextPatients = document.getElementById('nextPatients');
    const todayCount = document.getElementById('todayCount');
    
    if (!nowServing) return;
    
    socket.on('queue-update', (data) => {
        // Update current patient
        if (data.currentServing) {
            nowServing.textContent = `#${data.currentServing.id.toString().padStart(3, '0')}`;
            if (nowServingName) nowServingName.textContent = data.currentServing.name;
            if (nowServingArea) nowServingArea.textContent = data.currentServing.area || 'Unknown';
            if (nowServingStatus) {
                nowServingStatus.textContent = data.currentServing.isPriority ? '⭐ Priority' : 'Regular';
                nowServingStatus.className = data.currentServing.isPriority ? 'priority' : '';
            }
        } else {
            nowServing.textContent = '---';
            if (nowServingName) nowServingName.textContent = 'No patient';
            if (nowServingArea) nowServingArea.textContent = '';
            if (nowServingStatus) nowServingStatus.textContent = '';
        }
        
        // Update next patients
        const nextFive = data.queue.slice(0, 5);
        if (nextPatients) {
            if (nextFive.length === 0) {
                nextPatients.innerHTML = '<div class="empty-next">No patients waiting</div>';
            } else {
                nextPatients.innerHTML = nextFive.map((patient, index) => `
                    <div class="next-patient-item-small ${patient.isPriority ? 'priority' : ''}">
                        <span class="next-position">${index + 1}</span>
                        <span class="next-name">${patient.name}</span>
                        <span class="next-area">${patient.area || 'Unknown'}</span>
                        ${patient.isPriority ? '<span class="priority-star">⭐</span>' : ''}
                    </div>
                `).join('');
            }
        }
        
        // Update today's count
        if (todayCount) {
            todayCount.textContent = data.queueLength;
        }
    });
}

// ==================== PATIENTS PAGE ====================

function initPatientsPage() {
    loadPatients();
    
    // Search input with debounce
    const searchInput = document.getElementById('searchInput');
    let searchTimeout;
    if (searchInput) {
        searchInput.addEventListener('input', () => {
            clearTimeout(searchTimeout);
            searchTimeout = setTimeout(() => {
                currentPage = 1;
                loadPatients(searchInput.value);
            }, 500);
        });
    }
    
    // Modal close button
    const closeBtn = document.querySelector('.close-modal');
    if (closeBtn) {
        closeBtn.addEventListener('click', closePatientModal);
    }
    
    // Click outside modal to close
    window.addEventListener('click', (e) => {
        const modal = document.getElementById('patientModal');
        if (e.target === modal) {
            closePatientModal();
        }
    });
}

// Patients page variables
let currentPage = 1;
let totalPages = 1;
let currentPatientId = null;

function loadPatients(search = '') {
    const url = `/api/patients?page=${currentPage}&limit=20&search=${encodeURIComponent(search)}`;
    
    // Show loading state
    const tbody = document.getElementById('patientsTableBody');
    if (!tbody) return;
    
    tbody.innerHTML = `
        <tr>
            <td colspan="8" class="empty-table">
                <div class="spinner"></div>
                <p>Loading patients...</p>
            </td>
        </tr>
    `;
    
    fetch(url)
        .then(async response => {
            if (!response.ok) {
                const text = await response.text();
                console.error('API response not OK:', response.status, text.substring(0, 200));
                throw new Error(`HTTP ${response.status}`);
            }
            return response.json();
        })
        .then(data => {
            console.log('API response data:', data);
            
            // Check if we have a valid response
            if (data && typeof data === 'object') {
                // Handle case where patients array might be missing
                const patients = Array.isArray(data.patients) ? data.patients : [];
                const pagination = data.pagination || { page: 1, limit: 20, total: 0, pages: 0 };
                
                renderPatientsTable(patients);
                renderPagination(pagination);
                const totalEl = document.getElementById('totalPatients');
                if (totalEl) totalEl.textContent = pagination.total || 0;
            } else {
                console.error('Unexpected API response structure:', data);
                showPatientsError('Invalid data format received from server');
            }
        })
        .catch(error => {
            console.error('Error loading patients:', error);
            showPatientsError(error.message);
        });
}

function showPatientsError(message) {
    const tbody = document.getElementById('patientsTableBody');
    if (!tbody) return;
    
    tbody.innerHTML = `
        <tr>
            <td colspan="8" class="empty-table">
                <i class="fas fa-exclamation-triangle" style="color: var(--danger); font-size: 3rem;"></i>
                <p style="color: var(--danger);">Failed to load patients: ${message}</p>
                <button class="btn btn-primary" onclick="location.reload()">
                    <i class="fas fa-sync-alt"></i> Retry
                </button>
            </td>
        </tr>
    `;
}

function renderPatientsTable(patients) {
    const tbody = document.getElementById('patientsTableBody');
    if (!tbody) return;
    
    if (!patients || patients.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="8" class="empty-table">
                    <i class="fas fa-users" style="font-size: 3rem; opacity: 0.5;"></i>
                    <p>No patients found</p>
                </td>
            </tr>
        `;
        return;
    }
    
    tbody.innerHTML = patients.map(patient => {
        // Safely access properties with defaults
        const id = patient.id || '-';
        const name = patient.name || 'Unknown';
        const phone = patient.phone_digits ? '+' + patient.phone_digits : '-';
        const area = patient.area || '-';
        const firstVisit = patient.first_visit_date ? formatDate(patient.first_visit_date) : '-';
        const lastVisit = patient.last_visit_date ? formatDate(patient.last_visit_date) : '-';
        const totalVisits = patient.total_visits || 1;
        
        return `
        <tr onclick="viewPatientDetails(${id})" style="cursor: pointer;">
            <td>#${id}</td>
            <td><strong>${escapeHtml(name)}</strong></td>
            <td>${phone}</td>
            <td>${escapeHtml(area)}</td>
            <td>${firstVisit}</td>
            <td>${lastVisit}</td>
            <td><span class="visit-badge">${totalVisits}</span></td>
            <td>
                <button class="action-btn" onclick="event.stopPropagation(); viewPatientDetails(${id})">
                    <i class="fas fa-eye"></i>
                </button>
                <button class="action-btn whatsapp-btn" onclick="event.stopPropagation(); sendWhatsAppToPatient('${patient.phone_digits || ''}', '${escapeHtml(name)}')">
                    <i class="fab fa-whatsapp"></i>
                </button>
            </td>
        </tr>
    `}).join('');
}

function renderPagination(pagination) {
    const container = document.getElementById('pagination');
    if (!container) return;
    
    currentPage = pagination.page || 1;
    totalPages = pagination.pages || 1;
    
    let html = '<div class="pagination-controls">';
    
    // Previous button
    html += `<button class="page-btn" onclick="changePatientsPage(${currentPage - 1})" ${currentPage === 1 ? 'disabled' : ''}>
        <i class="fas fa-chevron-left"></i>
    </button>`;
    
    // Page numbers
    const startPage = Math.max(1, currentPage - 2);
    const endPage = Math.min(totalPages, currentPage + 2);
    
    if (startPage > 1) {
        html += `<button class="page-btn" onclick="changePatientsPage(1)">1</button>`;
        if (startPage > 2) html += `<span class="page-dots">...</span>`;
    }
    
    for (let i = startPage; i <= endPage; i++) {
        html += `<button class="page-btn ${i === currentPage ? 'active' : ''}" 
            onclick="changePatientsPage(${i})">${i}</button>`;
    }
    
    if (endPage < totalPages) {
        if (endPage < totalPages - 1) html += `<span class="page-dots">...</span>`;
        html += `<button class="page-btn" onclick="changePatientsPage(${totalPages})">${totalPages}</button>`;
    }
    
    // Next button
    html += `<button class="page-btn" onclick="changePatientsPage(${currentPage + 1})" ${currentPage === totalPages ? 'disabled' : ''}>
        <i class="fas fa-chevron-right"></i>
    </button>`;
    
    html += '</div>';
    container.innerHTML = html;
}

function changePatientsPage(page) {
    if (page < 1 || page > totalPages) return;
    currentPage = page;
    const search = document.getElementById('searchInput')?.value || '';
    loadPatients(search);
}

function viewPatientDetails(patientId) {
    currentPatientId = patientId;
    
    fetch(`/api/patients/${patientId}`)
        .then(response => response.json())
        .then(data => {
            const patient = data.patient;
            const visits = data.visits || [];
            
            document.getElementById('modalPatientName').textContent = patient.name || 'Unknown';
            document.getElementById('modalPatientPhone').textContent = patient.phone_digits ? '+' + patient.phone_digits : '-';
            document.getElementById('modalPatientArea').textContent = patient.area || '-';
            document.getElementById('modalFirstVisit').textContent = formatDate(patient.first_visit_date);
            document.getElementById('modalLastVisit').textContent = formatDate(patient.last_visit_date);
            document.getElementById('modalTotalVisits').textContent = patient.total_visits || 1;
            
            renderVisitsTable(visits);
            
            document.getElementById('patientModal').classList.remove('hidden');
        })
        .catch(error => {
            console.error('Error loading patient details:', error);
            alert('Failed to load patient details');
        });
}

function renderVisitsTable(visits) {
    const tbody = document.getElementById('visitsTableBody');
    if (!tbody) return;
    
    if (!visits || visits.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="5" class="empty-table">No visit history</td>
            </tr>
        `;
        return;
    }
    
    tbody.innerHTML = visits.map(visit => `
        <tr>
            <td>${formatDateTime(visit.join_time)}</td>
            <td>#${visit.queue_number || '-'}</td>
            <td>${formatTime(visit.waiting_time)}</td>
            <td>${visit.is_priority ? '⭐ Priority' : 'Regular'}</td>
            <td>
                <span class="status-badge ${visit.is_missed ? 'missed' : 'completed'}">
                    ${visit.is_missed ? 'Missed' : 'Completed'}
                </span>
            </td>
        </tr>
    `).join('');
}

function closePatientModal() {
    document.getElementById('patientModal').classList.add('hidden');
    currentPatientId = null;
}

function sendWhatsAppFromModal() {
    if (!currentPatientId) return;
    
    fetch(`/api/patients/${currentPatientId}`)
        .then(response => response.json())
        .then(data => {
            const patient = data.patient;
            sendWhatsAppToPatient(patient.phone_digits, patient.name);
        });
}

function sendWhatsAppToPatient(phoneDigits, name) {
    if (!phoneDigits) {
        alert('No phone number available');
        return;
    }
    
    const formattedPhone = phoneDigits.replace(/\D/g, '');
    const message = encodeURIComponent(
        `🏥 *Dr Maher Mahmoud Clinics*\n\n` +
        `Hello *${name || 'Patient'}*,\n\n` +
        `This is a message from our clinic.\n` +
        `You can track your queue position here:\n${window.location.origin}/track`
    );
    
    window.open(`https://wa.me/${formattedPhone}?text=${message}`, '_blank');
}

// Helper functions
function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function formatDate(dateString) {
    if (!dateString) return '-';
    try {
        const date = new Date(dateString);
        return date.toLocaleDateString('en-EG', {
            year: 'numeric',
            month: 'short',
            day: 'numeric'
        });
    } catch {
        return dateString;
    }
}

function formatDateTime(dateString) {
    if (!dateString) return '-';
    try {
        const date = new Date(dateString);
        return date.toLocaleString('en-EG', {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    } catch {
        return dateString;
    }
}

// Make functions globally available
window.showNotification = showNotification;
window.formatTime = formatTime;
window.playNotification = playNotification;
window.sendWhatsAppToPatient = sendWhatsAppToPatient;
window.viewPatientDetails = viewPatientDetails;
window.closePatientModal = closePatientModal;
window.sendWhatsAppFromModal = sendWhatsAppFromModal;
window.changePatientsPage = changePatientsPage;