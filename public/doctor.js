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
            // Pass the full patient data to fetch history
            fetchPatientHistory(data.currentServing);
        } else {
            hideCurrentPatient();
        }
    });
});

// Helper function to calculate age from birth date
function calculateAge(birthDate) {
    if (!birthDate) return null;
    
    const today = new Date();
    const birth = new Date(birthDate);
    let age = today.getFullYear() - birth.getFullYear();
    const monthDiff = today.getMonth() - birth.getMonth();
    
    // Adjust age if birthday hasn't occurred yet this year
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birth.getDate())) {
        age--;
    }
    
    return age;
}

// Helper function to format age string
function formatAge(age) {
    if (age === null || age === undefined) return '-';
    if (age === 0) return '< 1 year';
    if (age === 1) return '1 year';
    return `${age} years`;
}

function showCurrentPatient(patient) {
    currentPatient = patient;
    document.getElementById('noPatientMessage').classList.add('hidden');
    document.getElementById('currentPatientCard').classList.remove('hidden');
    
    document.getElementById('currentNumber').textContent = `#${patient.id.toString().padStart(3, '0')}`;
    document.getElementById('currentName').textContent = patient.name;
    document.getElementById('currentPhone').textContent = patient.phoneNumber;
    document.getElementById('currentArea').textContent = patient.area || 'Unknown';
    
    // Handle birth date and age
    const birthDateEl = document.getElementById('currentBirthDate');
    const ageEl = document.getElementById('currentAge');
    
    if (birthDateEl && ageEl) {
        if (patient.birthDate) {
            // Format birth date for display
            const formattedBirthDate = formatDate(patient.birthDate);
            birthDateEl.textContent = formattedBirthDate;
            
            // Calculate and display age
            const age = calculateAge(patient.birthDate);
            ageEl.textContent = formatAge(age);
        } else {
            birthDateEl.textContent = 'Not specified';
            ageEl.textContent = '-';
        }
    }
    
    const statusEl = document.getElementById('currentStatus');
    if (patient.isPriority) {
        statusEl.textContent = '⭐ Priority';
        statusEl.className = 'patient-status priority';
    } else {
        statusEl.textContent = 'Regular';
        statusEl.className = 'patient-status';
    }
}

function hideCurrentPatient() {
    const noPatientMsg = document.getElementById('noPatientMessage');
    const patientCard = document.getElementById('currentPatientCard');
    
    if (noPatientMsg) noPatientMsg.classList.remove('hidden');
    if (patientCard) patientCard.classList.add('hidden');
    currentPatient = null;
}

function fetchPatientHistory(patient) {
    // If patient already has lastVisitDate in the queue data, use it
    if (patient.lastVisitDate) {
        const lastVisitEl = document.getElementById('currentLastVisit');
        const typeEl = document.getElementById('currentType');
        
        if (lastVisitEl) {
            lastVisitEl.textContent = formatDate(patient.lastVisitDate);
        }
        if (typeEl) {
            // THIS IS WHERE WE INDICATE NEW VS RETURNING PATIENT
            typeEl.textContent = patient.lastVisitDate ? 'Returning Patient' : 'New Patient';
            // Add a class for styling if needed
            if (!patient.lastVisitDate) {
                typeEl.classList.add('new-patient-badge');
            } else {
                typeEl.classList.remove('new-patient-badge');
            }
        }
        return;
    }
    
    // Format phone number for API
    const formattedPhone = patient.phoneDigits?.replace(/\D/g, '') || '';
    
    if (!formattedPhone) {
        // No phone number, can't fetch
        const lastVisitEl = document.getElementById('currentLastVisit');
        const typeEl = document.getElementById('currentType');
        if (lastVisitEl) lastVisitEl.textContent = 'Unknown';
        if (typeEl) {
            typeEl.textContent = 'Unknown';
            typeEl.classList.remove('new-patient-badge');
        }
        return;
    }
    
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
                // THIS IS WHERE WE INDICATE NEW VS RETURNING PATIENT
                typeEl.textContent = data.lastVisitDate ? 'Returning Patient' : 'New Patient';
                // Add a class for styling if needed
                if (!data.lastVisitDate) {
                    typeEl.classList.add('new-patient-badge');
                } else {
                    typeEl.classList.remove('new-patient-badge');
                }
            }
        })
        .catch(error => {
            console.error('Error fetching patient history:', error);
            const lastVisitEl = document.getElementById('currentLastVisit');
            const typeEl = document.getElementById('currentType');
            
            if (lastVisitEl) lastVisitEl.textContent = 'Unknown';
            if (typeEl) {
                typeEl.textContent = 'Patient';
                typeEl.classList.remove('new-patient-badge');
            }
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
        <div class="next-patient-item-small ${patient.isPriority ? 'priority' : ''} ${!patient.lastVisitDate ? 'new-patient' : ''}">
            <span class="next-position">${index + 1}</span>
            <span class="next-name">${escapeHtml(patient.name)}</span>
            <span class="next-area">${escapeHtml(patient.area || 'Unknown')}</span>
            ${patient.isPriority ? '<span class="priority-star">⭐</span>' : ''}
            ${!patient.lastVisitDate ? '<span class="new-badge">🆕 New</span>' : ''}
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
            <td>${p.completedTime ? formatTime(new Date(p.completedTime)) : formatTime(new Date())}</td>
            <td>${escapeHtml(p.name)}</td>
            <td>${escapeHtml(p.area || 'Unknown')}</td>
            <td>${p.is_priority ? 'Priority' : 'Regular'}</td>
            <td>${escapeHtml(p.complaint || '-')}</td>
            <td>
                <button class="action-btn view-btn" onclick="viewPatientDetails(${p.patient_id})" title="View patient details">
                    <i class="fas fa-eye"></i>
                </button>
            </td>
        </tr>
    `).join('');
}

function viewPatientDetails(patientId) {
    window.location.href = `/patients?id=${patientId}`;
}

// Local notification function
function showNotification(message, type = 'success') {
    if (typeof window.showNotification === 'function') {
        window.showNotification(message, type);
    } else {
        // Fallback notification
        const notification = document.createElement('div');
        notification.className = `doctor-notification ${type}`;
        notification.textContent = message;
        notification.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            background-color: ${type === 'success' ? 'var(--gold)' : 'var(--danger)'};
            color: ${type === 'success' ? 'var(--accent)' : 'white'};
            padding: 12px 20px;
            border-radius: 8px;
            font-size: 0.9rem;
            font-weight: 500;
            box-shadow: 0 4px 12px rgba(0,0,0,0.15);
            z-index: 9999;
            animation: slideIn 0.3s ease;
        `;
        document.body.appendChild(notification);
        
        setTimeout(() => {
            notification.remove();
        }, 3000);
    }
}

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function formatDate(dateString) {
    if (!dateString) return 'Not specified';
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