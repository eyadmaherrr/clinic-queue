const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const session = require('express-session');
const fetch = require('node-fetch'); // You'll need to install this

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
    credentials: true
  },
  transports: ['websocket', 'polling'] // Allow both but websocket preferred
});

// Middleware
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Session middleware - FIXED for Render
app.use(session({
    secret: process.env.SESSION_SECRET || 'clinic-queue-secret-key',
    resave: false,
    saveUninitialized: false,
    cookie: { 
        secure: process.env.NODE_ENV === 'production', // true for HTTPS
        maxAge: 24 * 60 * 60 * 1000, // 24 hours
        sameSite: 'lax' // Important for Render
    }
}));

// Trust proxy - IMPORTANT for Render
app.set('trust proxy', 1);

// Simple authentication
const USERS = {
    admin: {
        password: '12345', // CHANGE THIS AFTER DEPLOYMENT!
        role: 'admin'
    }
};

// In-memory queue storage
let queue = [];
let currentServing = null;
let nextId = 1;

// Store patient by phone number
const patientPhoneMap = new Map(); // phoneNumber -> patientId

// Constants
const AVERAGE_CONSULTATION_TIME = 5; // minutes per patient
const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const COUNTRY_CODE = '20'; // Egypt country code

// Helper functions
const calculateWaitingTime = (position) => {
    if (position < 0) return 0;
    return position * AVERAGE_CONSULTATION_TIME;
};

/**
 * Smart phone number formatting for Egypt (+20)
 */
const formatPhoneNumber = (phone) => {
    // Remove all non-digit characters
    let digits = phone.replace(/\D/g, '');
    
    console.log('Raw input digits:', digits);
    
    if (!digits) return '';
    
    // Case 1: Number already has 20 prefix
    if (digits.startsWith('20')) {
        return digits;
    }
    
    // Case 2: Number starts with 0 (01012345678)
    if (digits.startsWith('0')) {
        digits = digits.substring(1);
        return '20' + digits;
    }
    
    // Case 3: Number starts with 1 (1012345678)
    if (digits.startsWith('1')) {
        return '20' + digits;
    }
    
    // Default: add 20 prefix
    return '20' + digits;
};

/**
 * Format phone number for display with +20 prefix
 */
const displayPhoneNumber = (phoneDigits) => {
    if (!phoneDigits) return '';
    if (phoneDigits.startsWith('20')) {
        return `+${phoneDigits}`;
    }
    return `+20${phoneDigits}`;
};

/**
 * Get local number without country code
 */
const getLocalNumber = (phoneDigits) => {
    if (phoneDigits.startsWith('20')) {
        return phoneDigits.substring(2);
    }
    return phoneDigits;
};

const updateAllClients = () => {
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

// ==================== RENDER-SPECIFIC FIXES ====================

// Health check endpoint (required for Render)
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

// Root redirect
app.get('/', (req, res) => {
    res.redirect('/login');
});

// ==================== AUTH ROUTES ====================

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

// ==================== PAGE ROUTES ====================

app.get('/dashboard', requireAuth, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

app.get('/track', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'track.html'));
});

app.get('/screen', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'screen.html'));
});

// Redirect old view links
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

    // Try different formats
    let patient = null;
    
    // As entered
    patient = queue.find(p => p.phoneDigits === phone);
    
    // With 20 prefix
    if (!patient && !phone.startsWith('20')) {
        const with20 = '20' + phone;
        patient = queue.find(p => p.phoneDigits === with20);
    }
    
    // Remove leading zero and add 20
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
        queueLength: queue.length
    });
});

// Add patient (reception only)
app.post('/api/add-patient', requireAuth, express.json(), (req, res) => {
    const { name, phoneNumber } = req.body;
    
    if (!name || !phoneNumber) {
        return res.status(400).json({ error: 'Name and phone number are required' });
    }

    const phoneDigits = formatPhoneNumber(phoneNumber);
    
    console.log('Formatted phone:', phoneDigits);
    
    if (phoneDigits.length < 11 || phoneDigits.length > 13) {
        return res.status(400).json({ 
            error: 'Please enter a valid Egyptian phone number (e.g., 01012345678 or 1012345678)' 
        });
    }

    const existingPatient = queue.find(p => p.phoneDigits === phoneDigits);
    
    if (existingPatient) {
        return res.status(400).json({ error: 'Phone number already registered in queue' });
    }

    const newPatient = {
        id: nextId++,
        name: name,
        phoneDigits: phoneDigits,
        phoneNumber: displayPhoneNumber(phoneDigits),
        localNumber: getLocalNumber(phoneDigits),
        joinTime: new Date().toISOString()
    };

    queue.push(newPatient);
    patientPhoneMap.set(phoneDigits, newPatient.id);

    const trackLink = `${BASE_URL}/track`;

    const whatsappMessage = encodeURIComponent(
        `🏥 *Clinic Queue System*\n\n` +
        `Hello *${name}*, you have been added to the queue.\n\n` +
        `*Your Queue Number:* #${newPatient.id}\n` +
        `*Current Position:* ${queue.length}\n` +
        `*Estimated Wait:* ${calculateWaitingTime(queue.length - 1)} minutes\n\n` +
        `👉 *Track your position:*\n` +
        `${trackLink}\n\n` +
        `📱 *Your phone number on file:* ${displayPhoneNumber(phoneDigits)}\n\n` +
        `Thank you for choosing our clinic!`
    );

    const whatsappLink = `https://wa.me/${phoneDigits}?text=${whatsappMessage}`;

    updateAllClients();

    res.json({
        success: true,
        patient: {
            ...newPatient,
            displayPhone: displayPhoneNumber(phoneDigits)
        },
        trackLink: trackLink,
        whatsappLink: whatsappLink
    });
});

// ==================== SOCKET.IO WITH RENDER FIXES ====================

io.on('connection', (socket) => {
    console.log('New client connected from:', socket.handshake.address);

    // Send initial queue state
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

    // Handle call next patient
    socket.on('call-next', () => {
        if (queue.length > 0) {
            const nextPatient = queue.shift();
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

    // Handle remove patient
    socket.on('remove-patient', (patientId) => {
        const index = queue.findIndex(p => p.id === patientId);
        if (index !== -1) {
            const patient = queue[index];
            patientPhoneMap.delete(patient.phoneDigits);
            queue.splice(index, 1);
            updateAllClients();
        }
    });

    // Handle clear queue
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

// ==================== RENDER KEEP-AWAKE MECHANISM ====================

// Self-ping every 10 minutes to help keep the app alive
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
    }, 10 * 60 * 1000); // Every 10 minutes
    
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