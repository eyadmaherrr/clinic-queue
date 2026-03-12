const socket = io({
  transports: ['websocket'],
  reconnectionAttempts: 5,
  reconnectionDelay: 1000
});

let currentPatient = null;
let completedPatients = [];

document.addEventListener('DOMContentLoaded', () => {
    loadTodayStats();
    loadTodayHistory();
    
    socket.on('queue-update', (data) => {
        updateQueueInfo(data);
        updateNextPatients(data.queue);
        if (data.currentServing) {
            showCurrentPatient(data.currentServing);
            fetchPatientHistory(data.currentServing.phoneDigits);
        } else {
            hideCurrentPatient();
        }
    });
});

function showCurrentPatient(patient) {
    currentPatient = patient;
    document.getElementById('noPatientMessage').classList.add('hidden');
    document.getElementById('currentPatientCard').classList.remove('hidden');
    
    document.getElementById('currentNumber').textContent = `#${patient.id.toString().padStart(3, '0')}`;
    document.getElementById('currentName').textContent = patient.name;
    document.getElementById('currentPhone').textContent = patient.phoneNumber;
    document.getElementById('currentArea').textContent = patient.area || 'Unknown';
    
    const statusEl = document.getElementById('currentStatus');
    if (patient.isPriority) {
        statusEl.textContent = '⭐ Priority';
        statusEl.className = 'patient-status priority';
    } else {
        statusEl.textContent = 'Regular';
        statusEl.className = 'patient-status';
    }
    
    // Clear complaint input
    const complaintInput = document.getElementById('complaintInput');
    if (complaintInput) complaintInput.value = '';
}

function hideCurrentPatient() {
    const noPatientMsg = document.getElementById('noPatientMessage');
    const patientCard = document.getElementById('currentPatientCard');
    
    if (noPatientMsg) noPatientMsg.classList.remove('hidden');
    if (patientCard) patientCard.classList.add('hidden');
    currentPatient = null;
}

function fetchPatientHistory(phone) {
    // Format phone number for API
    const formattedPhone = phone.replace(/\D/g, '');
    
    fetch(`/api/check-patient/${formattedPhone}`)
        .then(response => {
            if (!response.ok) {
                throw new Error('Failed to fetch patient history');
            }
            return response.json();
        })
        .then(data => {
            const lastVisitEl = document.getElementById('currentLastVisit');
            const typeEl = document.getElementById('currentType');
            
            if (lastVisitEl) {
                lastVisitEl.textContent = data.lastVisitDate ? formatDate(data.lastVisitDate) : 'First visit';
            }
            if (typeEl) {
                typeEl.textContent = data.lastVisitDate ? 'Returning Patient' : 'New Patient';
            }
        })
        .catch(error => {
            console.error('Error fetching patient history:', error);
            const lastVisitEl = document.getElementById('currentLastVisit');
            const typeEl = document.getElementById('currentType');
            
            if (lastVisitEl) lastVisitEl.textContent = 'Unknown';
            if (typeEl) typeEl.textContent = 'Patient';
        });
}

function updateNextPatients(queue) {
    const list = document.getElementById('nextPatientsList');
    if (!list) return;
    
    const nextFive = queue.slice(0, 5);
    
    if (nextFive.length === 0) {
        list.innerHTML = '<div class="empty-next">No patients waiting</div>';
        return;
    }
    
    list.innerHTML = nextFive.map((patient, index) => `
        <div class="next-patient-item-small ${patient.isPriority ? 'priority' : ''}">
            <span class="next-position">${index + 1}</span>
            <span class="next-name">${escapeHtml(patient.name)}</span>
            <span class="next-area">${escapeHtml(patient.area || 'Unknown')}</span>
            ${patient.isPriority ? '<span class="priority-star">⭐</span>' : ''}
        </div>
    `).join('');
}

function updateQueueInfo(data) {
    const queueCount = document.getElementById('queueCount');
    if (queueCount) {
        queueCount.textContent = data.queueLength || 0;
    }
}

function loadTodayStats() {
    // Fetch today's stats from server
    fetch('/api/today-stats')
        .then(response => response.json())
        .then(data => {
            const todayCount = document.getElementById('todayCount');
            if (todayCount) {
                todayCount.textContent = data.todayCount || 0;
            }
        })
        .catch(error => {
            console.error('Error loading today stats:', error);
        });
}

function loadTodayHistory() {
    // Fetch today's completed patients
    fetch('/api/today-history')
        .then(response => response.json())
        .then(data => {
            if (data.history && data.history.length > 0) {
                completedPatients = data.history;
                updateTodayHistory();
            }
        })
        .catch(error => {
            console.error('Error loading today history:', error);
        });
}

function completePatient() {
    const complaint = document.getElementById('complaintInput')?.value || '';
    
    if (!currentPatient) {
        showNotification('No patient to complete', 'error');
        return;
    }
    
    // Save to server
    fetch('/api/complete-patient', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            patientId: currentPatient.id,
            patientData: currentPatient,
            complaint: complaint,
            completedTime: new Date().toISOString()
        })
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            // Add to local history
            completedPatients.unshift({
                ...currentPatient,
                complaint: complaint,
                completedTime: new Date().toLocaleTimeString()
            });
            
            updateTodayHistory();
            
            // Call next patient
            socket.emit('call-next');
            showNotification('Patient completed', 'success');
        } else {
            showNotification('Error completing patient', 'error');
        }
    })
    .catch(error => {
        console.error('Error completing patient:', error);
        showNotification('Error completing patient', 'error');
    });
}

function saveNotes() {
    if (!currentPatient) {
        showNotification('No patient selected', 'error');
        return;
    }
    
    const notes = document.getElementById('complaintInput')?.value || '';
    
    fetch('/api/save-notes', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            patientId: currentPatient.id,
            notes: notes
        })
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            showNotification('Notes saved', 'success');
        } else {
            showNotification('Error saving notes', 'error');
        }
    })
    .catch(error => {
        console.error('Error saving notes:', error);
        showNotification('Error saving notes', 'error');
    });
}

function referPatient() {
    if (!currentPatient) {
        showNotification('No patient to refer', 'error');
        return;
    }
    
    if (confirm('Refer this patient to another department?')) {
        fetch('/api/refer-patient', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                patientId: currentPatient.id,
                patientData: currentPatient
            })
        })
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                showNotification('Patient referred', 'success');
                // Call next patient
                socket.emit('call-next');
            } else {
                showNotification('Error referring patient', 'error');
            }
        })
        .catch(error => {
            console.error('Error referring patient:', error);
            showNotification('Error referring patient', 'error');
        });
    }
}

function updateTodayHistory() {
    const tbody = document.getElementById('todayHistory');
    if (!tbody) return;
    
    if (completedPatients.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="6" class="empty-table">No patients seen today</td>
            </tr>
        `;
        return;
    }
    
    tbody.innerHTML = completedPatients.map(p => `
        <tr>
            <td>${p.completedTime || formatTime(new Date())}</td>
            <td>${escapeHtml(p.name)}</td>
            <td>${escapeHtml(p.area || 'Unknown')}</td>
            <td>${p.isPriority ? 'Priority' : 'Regular'}</td>
            <td>${escapeHtml(p.complaint || '-')}</td>
            <td>
                <button class="action-btn" onclick="viewPatientDetails(${p.id})">
                    <i class="fas fa-eye"></i>
                </button>
            </td>
        </tr>
    `).join('');
}

function viewPatientDetails(patientId) {
    // Redirect to patients page or open modal
    window.location.href = `/patients?id=${patientId}`;
}

function showNotification(message, type) {
    // Use your existing notification function
    if (typeof window.showNotification === 'function') {
        window.showNotification(message, type);
    } else {
        alert(message);
    }
}

// Helper function to escape HTML
function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Helper function to format date
function formatDate(dateString) {
    if (!dateString) return 'Unknown';
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

// Helper function to format time
function formatTime(date) {
    if (!date) return '-';
    try {
        return date.toLocaleTimeString('en-EG', {
            hour: '2-digit',
            minute: '2-digit'
        });
    } catch {
        return '-';
    }
}