const socket = io({
  transports: ['websocket'],
  reconnectionAttempts: 5,
  reconnectionDelay: 1000
});

let currentPatient = null;
let completedPatients = [];

document.addEventListener('DOMContentLoaded', () => {
    loadTodayStats();
    
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
    document.getElementById('complaintInput').value = '';
}

function hideCurrentPatient() {
    document.getElementById('noPatientMessage').classList.remove('hidden');
    document.getElementById('currentPatientCard').classList.add('hidden');
    currentPatient = null;
}

function fetchPatientHistory(phone) {
    fetch(`/api/patient-history/${phone}`)
        .then(response => response.json())
        .then(data => {
            document.getElementById('currentLastVisit').textContent = data.lastVisit || 'First visit';
            document.getElementById('currentType').textContent = data.lastVisit ? 'Returning' : 'New Patient';
        });
}

function updateNextPatients(queue) {
    const list = document.getElementById('nextPatientsList');
    const nextFive = queue.slice(0, 5);
    
    if (nextFive.length === 0) {
        list.innerHTML = '<div class="empty-next">No patients waiting</div>';
        return;
    }
    
    list.innerHTML = nextFive.map((patient, index) => `
        <div class="next-patient-item-small ${patient.isPriority ? 'priority' : ''}">
            <span class="next-position">${index + 1}</span>
            <span class="next-name">${patient.name}</span>
            <span class="next-area">${patient.area || 'Unknown'}</span>
            ${patient.isPriority ? '<span class="priority-star">⭐</span>' : ''}
        </div>
    `).join('');
}

function updateQueueInfo(data) {
    document.getElementById('queueCount').textContent = data.queueLength;
}

function loadTodayStats() {
    // This would fetch from server in real implementation
    document.getElementById('todayCount').textContent = '12';
}

function completePatient() {
    const complaint = document.getElementById('complaintInput').value;
    
    if (currentPatient) {
        // Save to today's history
        completedPatients.push({
            ...currentPatient,
            complaint: complaint,
            completedTime: new Date().toLocaleTimeString()
        });
        
        updateTodayHistory();
        
        // Call next patient
        socket.emit('call-next');
        showNotification('Patient completed', 'success');
    }
}

function saveNotes() {
    showNotification('Notes saved', 'success');
}

function referPatient() {
    if (confirm('Refer this patient to another department?')) {
        showNotification('Patient referred', 'success');
    }
}

function updateTodayHistory() {
    const tbody = document.getElementById('todayHistory');
    tbody.innerHTML = completedPatients.map(p => `
        <tr>
            <td>${p.completedTime}</td>
            <td>${p.name}</td>
            <td>${p.area || 'Unknown'}</td>
            <td>${p.isPriority ? 'Priority' : 'Regular'}</td>
            <td>${p.complaint || '-'}</td>
            <td>-</td>
        </tr>
    `).join('');
}

function showNotification(message, type) {
    // Use your existing notification function
    if (typeof window.showNotification === 'function') {
        window.showNotification(message, type);
    } else {
        alert(message);
    }
}