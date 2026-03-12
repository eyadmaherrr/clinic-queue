// Patients page JavaScript
let currentPage = 1;
let totalPages = 1;
let currentPatientId = null;

document.addEventListener('DOMContentLoaded', () => {
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
});

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
                const errorData = await response.json().catch(() => null);
                console.error('API error response:', {
                    status: response.status,
                    statusText: response.statusText,
                    errorData
                });
                throw new Error(errorData?.error || `HTTP ${response.status}`);
            }
            return response.json();
        })
        .then(data => {
            console.log('API response data:', data);
            
            // Handle different response structures
            const patients = Array.isArray(data.patients) ? data.patients : 
                           Array.isArray(data) ? data : [];
            
            const pagination = data.pagination || { 
                page: currentPage, 
                limit: 20, 
                total: patients.length, 
                pages: 1 
            };
            
            renderPatientsTable(patients);
            renderPagination(pagination);
            
            const totalEl = document.getElementById('totalPatients');
            if (totalEl) totalEl.textContent = pagination.total || patients.length;
        })
        .catch(error => {
            console.error('Error loading patients:', error);
            
            const tbody = document.getElementById('patientsTableBody');
            if (tbody) {
                tbody.innerHTML = `
                    <tr>
                        <td colspan="8" class="empty-table">
                            <i class="fas fa-exclamation-triangle" style="color: var(--danger); font-size: 3rem;"></i>
                            <p style="color: var(--danger);">Failed to load patients</p>
                            <p style="color: var(--text-secondary); font-size: 0.9rem;">${error.message}</p>
                            <button class="btn btn-primary" onclick="location.reload()">
                                <i class="fas fa-sync-alt"></i> Retry
                            </button>
                        </td>
                    </tr>
                `;
            }
        });
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
    
    let html = '';
    for (const patient of patients) {
        // Skip if no ID
        if (!patient || !patient.id) {
            console.warn('Skipping patient with no ID:', patient);
            continue;
        }
        
        const id = patient.id;
        const name = patient.name || 'Unknown';
        const phone = patient.phone_digits ? '+' + patient.phone_digits : '-';
        const area = patient.area || '-';
        const firstVisit = patient.first_visit_date ? formatDate(patient.first_visit_date) : '-';
        // Use last_visit_date from database
        const lastVisit = patient.last_visit_date ? formatDate(patient.last_visit_date) : 
                         (patient.last_visit ? formatDate(patient.last_visit) : '-');
        const totalVisits = patient.total_visits || 1;
        
        html += `
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
        `;
    }
    
    if (html === '') {
        tbody.innerHTML = `
            <tr>
                <td colspan="8" class="empty-table">
                    <p>No valid patients found</p>
                </td>
            </tr>
        `;
    } else {
        tbody.innerHTML = html;
    }
}

function renderPagination(pagination) {
    const container = document.getElementById('pagination');
    if (!container) return;
    
    currentPage = pagination.page || 1;
    totalPages = pagination.pages || Math.ceil((pagination.total || 0) / (pagination.limit || 20)) || 1;
    
    let html = '<div class="pagination-controls">';
    
    // Previous button
    html += `<button class="page-btn" onclick="changePage(${currentPage - 1})" ${currentPage <= 1 ? 'disabled' : ''}>
        <i class="fas fa-chevron-left"></i>
    </button>`;
    
    // Page numbers
    const startPage = Math.max(1, currentPage - 2);
    const endPage = Math.min(totalPages, currentPage + 2);
    
    if (startPage > 1) {
        html += `<button class="page-btn" onclick="changePage(1)">1</button>`;
        if (startPage > 2) html += `<span class="page-dots">...</span>`;
    }
    
    for (let i = startPage; i <= endPage; i++) {
        html += `<button class="page-btn ${i === currentPage ? 'active' : ''}" 
            onclick="changePage(${i})">${i}</button>`;
    }
    
    if (endPage < totalPages) {
        if (endPage < totalPages - 1) html += `<span class="page-dots">...</span>`;
        html += `<button class="page-btn" onclick="changePage(${totalPages})">${totalPages}</button>`;
    }
    
    // Next button
    html += `<button class="page-btn" onclick="changePage(${currentPage + 1})" ${currentPage >= totalPages ? 'disabled' : ''}>
        <i class="fas fa-chevron-right"></i>
    </button>`;
    
    html += '</div>';
    container.innerHTML = html;
}

function changePage(page) {
    if (page < 1 || page > totalPages) return;
    currentPage = page;
    const search = document.getElementById('searchInput')?.value || '';
    loadPatients(search);
}

function viewPatientDetails(patientId) {
    if (!patientId) {
        alert('Invalid patient ID');
        return;
    }
    
    currentPatientId = patientId;
    
    // Show loading in modal
    const modal = document.getElementById('patientModal');
    const modalName = document.getElementById('modalPatientName');
    const visitsBody = document.getElementById('visitsTableBody');
    
    if (!modal || !modalName || !visitsBody) return;
    
    modalName.textContent = 'Loading...';
    visitsBody.innerHTML = `
        <tr>
            <td colspan="5" class="empty-table">
                <div class="spinner"></div>
                <p>Loading patient history...</p>
            </td>
        </tr>
    `;
    modal.classList.remove('hidden');
    
    fetch(`/api/patients/${patientId}`)
        .then(async response => {
            if (!response.ok) {
                const errorData = await response.json().catch(() => null);
                throw new Error(errorData?.error || `HTTP ${response.status}`);
            }
            return response.json();
        })
        .then(data => {
            console.log('Patient details received:', data);
            
            const patient = data.patient;
            const visits = data.visits || [];
            
            // Update modal with patient data
            document.getElementById('modalPatientName').textContent = patient?.name || 'Unknown';
            document.getElementById('modalPatientPhone').textContent = patient?.phone_digits ? '+' + patient.phone_digits : '-';
            document.getElementById('modalPatientArea').textContent = patient?.area || '-';
            document.getElementById('modalFirstVisit').textContent = formatDate(patient?.first_visit_date);
            document.getElementById('modalLastVisit').textContent = formatDate(patient?.last_visit_date);
            document.getElementById('modalTotalVisits').textContent = patient?.total_visits || 1;
            
            renderVisitsTable(visits);
        })
        .catch(error => {
            console.error('Error loading patient details:', error);
            
            document.getElementById('modalPatientName').textContent = 'Error';
            document.getElementById('visitsTableBody').innerHTML = `
                <tr>
                    <td colspan="5" class="empty-table">
                        <i class="fas fa-exclamation-triangle" style="color: var(--danger); font-size: 2rem;"></i>
                        <p style="color: var(--danger);">Failed to load patient details</p>
                        <p style="color: var(--text-secondary); font-size: 0.9rem;">${error.message}</p>
                        <button class="btn btn-primary" onclick="closePatientModal()">Close</button>
                    </td>
                </tr>
            `;
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
    const modal = document.getElementById('patientModal');
    if (modal) modal.classList.add('hidden');
    currentPatientId = null;
}

function sendWhatsAppFromModal() {
    if (!currentPatientId) return;
    
    fetch(`/api/patients/${currentPatientId}`)
        .then(response => response.json())
        .then(data => {
            const patient = data.patient;
            sendWhatsAppToPatient(patient?.phone_digits, patient?.name);
        })
        .catch(error => {
            console.error('Error sending WhatsApp:', error);
            alert('Failed to send WhatsApp message');
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

function formatTime(minutes) {
    if (!minutes) return '-';
    if (minutes < 1) return '< 1 min';
    if (minutes < 60) return `${minutes} min`;
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return `${hours}h ${mins}m`;
}

// Make functions globally available
window.viewPatientDetails = viewPatientDetails;
window.closePatientModal = closePatientModal;
window.sendWhatsAppFromModal = sendWhatsAppFromModal;
window.sendWhatsAppToPatient = sendWhatsAppToPatient;
window.changePage = changePage;
window.loadPatients = loadPatients;