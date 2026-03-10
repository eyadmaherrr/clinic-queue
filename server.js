const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const session = require('express-session');
const fetch = require('node-fetch');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
    credentials: true
  },
  transports: ['websocket', 'polling']
});

// Middleware
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Session middleware
app.use(session({
    secret: process.env.SESSION_SECRET || 'clinic-queue-secret-key',
    resave: false,
    saveUninitialized: false,
    cookie: { 
        secure: process.env.NODE_ENV === 'production',
        maxAge: 24 * 60 * 60 * 1000,
        sameSite: 'lax'
    }
}));

app.set('trust proxy', 1);

// Simple authentication
const USERS = {
    admin: {
        password: '12345',
        role: 'admin'
    }
};

// In-memory queue storage
let queue = [];
let currentServing = null;
let nextId = 1;

// Store patient by phone number
const patientPhoneMap = new Map();

// Constants
const AVERAGE_CONSULTATION_TIME = 5;
const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const COUNTRY_CODE = '20';

// ==================== HELPER FUNCTIONS ====================

const calculateWaitingTime = (position) => {
    if (position < 0) return 0;
    return position * AVERAGE_CONSULTATION_TIME;
};

const formatPhoneNumber = (phone) => {
    let digits = phone.replace(/\D/g, '');
    if (!digits) return '';
    if (digits.startsWith('20')) return digits;
    if (digits.startsWith('0')) {
        digits = digits.substring(1);
        return '20' + digits;
    }
    if (digits.startsWith('1')) return '20' + digits;
    return '20' + digits;
};

const displayPhoneNumber = (phoneDigits) => {
    if (!phoneDigits) return '';
    if (phoneDigits.startsWith('20')) {
        return `+${phoneDigits}`;
    }
    return `+20${phoneDigits}`;
};

const getLocalNumber = (phoneDigits) => {
    if (!phoneDigits) return '';
    if (phoneDigits.startsWith('20')) {
        return phoneDigits.substring(2);
    }
    return phoneDigits;
};

// ==================== QUEUE MANAGEMENT ====================
const updatePositions = () => {
    queue.forEach((patient, index) => {
        patient.position = index + 1;
    });
};

const updateAllClients = () => {
    updatePositions();
    
    const queueData = {
        queue: queue.map((patient, index) => ({
            ...patient,
            position: index + 1,
            waitingTime: calculateWaitingTime(index),
            displayPhone: displayPhoneNumber(patient.phoneDigits)
        })),
        currentServing: currentServing ? {
            ...currentServing,
            displayPhone: displayPhoneNumber(currentServing.phoneDigits)
        } : null,
        queueLength: queue.length
    };
    
    io.emit('queue-update', queueData);
};

// Authentication middleware
const requireAuth = (req, res, next) => {
    if (req.session.user) {
        next();
    } else {
        res.redirect('/login');
    }
};

// Health check endpoint
app.get('/healthz', (req, res) => {
    res.status(200).json({ 
        status: 'healthy', 
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        queueLength: queue.length,
        currentServing: currentServing ? currentServing.id : null,
        memory: process.memoryUsage(),
        environment: process.env.NODE_ENV || 'development'
    });
});

// ==================== PAGE ROUTES ====================

app.get('/', (req, res) => {
    res.redirect('/login');
});

app.get('/login', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.post('/login', (req, res) => {
    const { password } = req.body;
    
    if (USERS.admin && USERS.admin.password === password) {
        req.session.user = {
            username: 'admin',
            role: 'admin'
        };
        res.redirect('/dashboard');
    } else {
        res.redirect('/login?error=1');
    }
});

app.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/login');
});

app.get('/dashboard', requireAuth, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

app.get('/track', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'track.html'));
});

app.get('/screen', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'screen.html'));
});

app.get('/view/:token', (req, res) => {
    res.redirect('/track');
});

// ==================== API ROUTES ====================

// Get patient by phone number
app.get('/api/patient/:phone', (req, res) => {
    let phone = req.params.phone;
    phone = phone.replace(/\D/g, '');
    
    if (!phone || phone.length < 3) {
        return res.status(400).json({ error: 'Invalid phone number' });
    }

    console.log('Searching for phone:', phone);

    let patient = null;
    
    patient = queue.find(p => p.phoneDigits === phone);
    
    if (!patient && !phone.startsWith('20')) {
        const with20 = '20' + phone;
        patient = queue.find(p => p.phoneDigits === with20);
    }
    
    if (!patient && phone.startsWith('0')) {
        const withoutZero = phone.substring(1);
        const with20 = '20' + withoutZero;
        patient = queue.find(p => p.phoneDigits === with20);
    }
    
    if (!patient) {
        return res.status(404).json({ error: 'Phone number not found in queue' });
    }

    const position = queue.findIndex(p => p.id === patient.id) + 1;
    
    res.json({
        id: patient.id,
        name: patient.name,
        phoneNumber: displayPhoneNumber(patient.phoneDigits),
        localNumber: getLocalNumber(patient.phoneDigits),
        position: position,
        waitingTime: calculateWaitingTime(position - 1),
        currentServing: currentServing,
        queueLength: queue.length,
        isPriority: patient.isPriority || false,
        isMissed: patient.isMissed || false
    });
});

// Add patient
// Add patient - FIXED: Priority patients go to TOP
app.post('/api/add-patient', requireAuth, express.json(), (req, res) => {
    try {
        const { name, phoneNumber, isPriority = false } = req.body;
        
        if (!name || !phoneNumber) {
            return res.status(400).json({ error: 'Name and phone number are required' });
        }

        const phoneDigits = formatPhoneNumber(phoneNumber);
        
        if (phoneDigits.length < 11 || phoneDigits.length > 13) {
            return res.status(400).json({ 
                error: 'Please enter a valid Egyptian phone number (e.g., 01012345678 or 1012345678)' 
            });
        }

        const existingPatient = queue.find(p => p.phoneDigits === phoneDigits && !p.isMissed);
        
        if (existingPatient) {
            return res.status(400).json({ error: 'Phone number already registered in queue' });
        }

        const newPatient = {
            id: nextId++,
            name: name,
            phoneDigits: phoneDigits,
            phoneNumber: displayPhoneNumber(phoneDigits),
            localNumber: getLocalNumber(phoneDigits),
            joinTime: new Date().toISOString(),
            isPriority: isPriority,
            isMissed: false
        };

        // If priority patient, add to top (after existing priority patients)
        if (isPriority) {
            const priorityCount = queue.filter(p => p.isPriority && !p.isMissed).length;
            queue.splice(priorityCount, 0, newPatient);
        } else {
            // Regular patient goes to end
            queue.push(newPatient);
        }
        
        patientPhoneMap.set(phoneDigits, newPatient.id);
        updateAllClients();

        const trackLink = `${BASE_URL}/track`;

        const whatsappMessage = encodeURIComponent(
            `🏥 *Dr Maher Mahmoud Clinics*\n\n` +
            `Hello *${name}*, you have been added to the queue.\n\n` +
            `*Your Queue Number:* #${newPatient.id}\n` +
            `*Priority:* ${isPriority ? '⭐ Priority' : '🟢 Normal'}\n` +
            `*Current Position:* ${newPatient.position}\n` +
            `*Estimated Wait:* ${calculateWaitingTime(newPatient.position - 1)} minutes\n\n` +
            `👉 *Track your position:*\n` +
            `${trackLink}\n\n` +
            `📱 *Your phone number on file:* ${displayPhoneNumber(phoneDigits)}\n\n` +
            `Thank you for choosing our clinic!`
        );

        const whatsappLink = `https://wa.me/${phoneDigits}?text=${whatsappMessage}`;

        res.json({
            success: true,
            patient: {
                ...newPatient,
                displayPhone: displayPhoneNumber(phoneDigits)
            },
            trackLink: trackLink,
            whatsappLink: whatsappLink
        });
    } catch (error) {
        console.error('Error adding patient:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Toggle priority
// Toggle priority - FIXED: Priority patients go to TOP
app.post('/api/toggle-priority', requireAuth, express.json(), (req, res) => {
    try {
        const { patientId } = req.body;
        
        if (!patientId) {
            return res.status(400).json({ error: 'Patient ID is required' });
        }

        const patient = queue.find(p => p.id === patientId);
        if (!patient) {
            return res.status(404).json({ error: 'Patient not found' });
        }
        
        // Toggle priority
        patient.isPriority = !patient.isPriority;
        
        // If priority was turned ON, move patient to top
        if (patient.isPriority && !patient.isMissed) {
            // Remove patient from current position
            const index = queue.findIndex(p => p.id === patientId);
            queue.splice(index, 1);
            
            // Find position to insert (after other non-missed priority patients)
            const priorityCount = queue.filter(p => p.isPriority && !p.isMissed).length;
            queue.splice(priorityCount, 0, patient);
        }
        
        updateAllClients();
        
        res.json({ success: true, isPriority: patient.isPriority });
    } catch (error) {
        console.error('Error toggling priority:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});
// Mark as missed
app.post('/api/mark-missed', requireAuth, express.json(), (req, res) => {
    try {
        const { patientId } = req.body;
        
        if (!patientId) {
            return res.status(400).json({ error: 'Patient ID is required' });
        }

        const patient = queue.find(p => p.id === patientId);
        if (!patient) {
            return res.status(404).json({ error: 'Patient not found' });
        }
        
        patient.isMissed = true;
        patient.missedTime = new Date().toISOString();
        
        updateAllClients();
        
        res.json({ success: true });
    } catch (error) {
        console.error('Error marking missed:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Restore missed patient
app.post('/api/restore-patient', requireAuth, express.json(), (req, res) => {
    try {
        const { patientId } = req.body;
        
        if (!patientId) {
            return res.status(400).json({ error: 'Patient ID is required' });
        }

        const patient = queue.find(p => p.id === patientId);
        if (!patient) {
            return res.status(404).json({ error: 'Patient not found' });
        }
        
        patient.isMissed = false;
        patient.missedTime = null;
        
        updateAllClients();
        
        res.json({ success: true });
    } catch (error) {
        console.error('Error restoring patient:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Edit patient - FIXED VERSION
app.post('/api/edit-patient', requireAuth, express.json(), (req, res) => {
    try {
        console.log('Edit patient request received:', req.body); // Debug log
        
        const { patientId, name, phoneNumber } = req.body;
        
        if (!patientId || !name || !phoneNumber) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        const patient = queue.find(p => p.id === patientId);
        if (!patient) {
            return res.status(404).json({ error: 'Patient not found' });
        }
        
        const phoneDigits = formatPhoneNumber(phoneNumber);
        
        // Check if new phone number already exists (except current patient)
        const existingPatient = queue.find(p => p.phoneDigits === phoneDigits && p.id !== patientId);
        if (existingPatient) {
            return res.status(400).json({ error: 'Phone number already in use' });
        }
        
        patient.name = name;
        patient.phoneDigits = phoneDigits;
        patient.phoneNumber = displayPhoneNumber(phoneDigits);
        patient.localNumber = getLocalNumber(phoneDigits);
        
        updateAllClients();
        
        console.log('Patient updated successfully:', patient); // Debug log
        res.json({ success: true });
    } catch (error) {
        console.error('Error editing patient:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Reorder queue - FIXED VERSION
app.post('/api/reorder-queue', requireAuth, express.json(), (req, res) => {
    try {
        console.log('Reorder request received:', req.body); // Debug log
        
        const { orderedIds } = req.body;
        
        if (!orderedIds || !Array.isArray(orderedIds)) {
            return res.status(400).json({ error: 'Invalid order data' });
        }
        
        if (orderedIds.length === 0) {
            return res.status(400).json({ error: 'Empty order data' });
        }
        
        // Create new queue based on ordered IDs
        const newQueue = [];
        const processedIds = new Set();
        
        for (const id of orderedIds) {
            const patient = queue.find(p => p.id === id);
            if (patient && !processedIds.has(id)) {
                newQueue.push(patient);
                processedIds.add(id);
            }
        }
        
        // Add any patients that might have been missed
        queue.forEach(patient => {
            if (!processedIds.has(patient.id)) {
                newQueue.push(patient);
            }
        });
        
        if (newQueue.length === 0) {
            return res.status(400).json({ error: 'No valid patients found' });
        }
        
        queue = newQueue;
        updatePositions();
        updateAllClients();
        
        console.log('Queue reordered successfully'); // Debug log
        res.json({ success: true });
    } catch (error) {
        console.error('Error reordering queue:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ==================== SOCKET.IO ====================

io.on('connection', (socket) => {
    console.log('New client connected from:', socket.handshake.address);

    const queueData = {
        queue: queue.map((patient, index) => ({
            ...patient,
            position: index + 1,
            waitingTime: calculateWaitingTime(index),
            displayPhone: displayPhoneNumber(patient.phoneDigits)
        })),
        currentServing: currentServing ? {
            ...currentServing,
            displayPhone: displayPhoneNumber(currentServing.phoneDigits)
        } : null,
        queueLength: queue.length
    };
    
    socket.emit('queue-update', queueData);

    socket.on('call-next', () => {
        const nextIndex = queue.findIndex(p => !p.isMissed);
        
        if (nextIndex !== -1) {
            const nextPatient = queue[nextIndex];
            queue.splice(nextIndex, 1);
            currentServing = nextPatient;
            
            io.emit('next-called', {
                patient: {
                    ...nextPatient,
                    displayPhone: displayPhoneNumber(nextPatient.phoneDigits)
                },
                message: `Now serving: ${nextPatient.name}`
            });
            
            updateAllClients();
        }
    });

    socket.on('remove-patient', (patientId) => {
        const index = queue.findIndex(p => p.id === patientId);
        if (index !== -1) {
            const patient = queue[index];
            patientPhoneMap.delete(patient.phoneDigits);
            queue.splice(index, 1);
            updateAllClients();
        }
    });

    socket.on('clear-queue', () => {
        queue = [];
        currentServing = null;
        nextId = 1;
        patientPhoneMap.clear();
        updateAllClients();
    });

    socket.on('disconnect', () => {
        console.log('Client disconnected');
    });
});

// Self-ping mechanism
if (process.env.NODE_ENV === 'production') {
    const selfUrl = process.env.RENDER_EXTERNAL_URL || BASE_URL;
    
    setInterval(async () => {
        try {
            const response = await fetch(`${selfUrl}/healthz`);
            const data = await response.json();
            console.log(`[${new Date().toISOString()}] Self-ping successful - Queue: ${data.queueLength} patients`);
        } catch (err) {
            console.log(`[${new Date().toISOString()}] Self-ping failed:`, err.message);
        }
    }, 10 * 60 * 1000);
    
    console.log(`✅ Keep-awake mechanism enabled - pinging every 10 minutes`);
}

// ==================== START SERVER ====================

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log('\n=== Clinic Queue System ===');
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`🔐 Login page: http://localhost:${PORT}/login`);
    console.log(`📊 Dashboard: http://localhost:${PORT}/dashboard`);
    console.log(`📱 Track page: http://localhost:${PORT}/track`);
    console.log(`📺 TV Screen: http://localhost:${PORT}/screen`);
    console.log(`🔑 Admin password: 12345 (CHANGE THIS AFTER DEPLOYMENT!)`);
    console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
    if (process.env.RENDER_EXTERNAL_URL) {
        console.log(`📡 Public URL: ${process.env.RENDER_EXTERNAL_URL}`);
    }
    console.log('===========================\n');
});