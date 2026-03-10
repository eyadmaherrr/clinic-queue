const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const session = require('express-session');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// Middleware
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Session middleware
app.use(session({
    secret: 'clinic-queue-secret-key',
    resave: false,
    saveUninitialized: false,
    cookie: { 
        secure: false,
        maxAge: 24 * 60 * 60 * 1000 // 24 hours
    }
}));

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
const patientPhoneMap = new Map(); // phoneNumber -> patientId

// Constants
const AVERAGE_CONSULTATION_TIME = 5; // minutes per patient
const BASE_URL = 'http://localhost:3000'; // Change this in production
const COUNTRY_CODE = '20'; // Egypt country code

// Helper functions
const calculateWaitingTime = (position) => {
    if (position < 0) return 0;
    return position * AVERAGE_CONSULTATION_TIME;
};

/**
 * Smart phone number formatting for Egypt (+20)
 * Handles various input formats and normalizes to +20[digits]
 */
const formatPhoneNumber = (phone) => {
    // Remove all non-digit characters
    let digits = phone.replace(/\D/g, '');
    
    console.log('Raw input digits:', digits); // Debug log
    
    // If no digits, return empty
    if (!digits) return '';
    
    // Case 1: Number already has 20 prefix (with or without +)
    if (digits.startsWith('20')) {
        // Already has correct country code
        return digits;
    }
    
    // Case 2: Number starts with 0 (local format: 01012345678)
    if (digits.startsWith('0')) {
        // Remove leading zero and add 20
        digits = digits.substring(1);
        return '20' + digits;
    }
    
    // Case 3: Number starts with 1 (mobile without zero: 1012345678)
    if (digits.startsWith('1')) {
        // Add 20 prefix
        return '20' + digits;
    }
    
    // Case 4: Number starts with 2 (might be partial country code)
    if (digits.startsWith('2') && digits.length > 3) {
        // Check if it's actually 20 followed by more digits
        if (digits.substring(0, 2) === '20') {
            return digits;
        }
        // It's 2 followed by something else, add 0?
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
    
    // Ensure it starts with 20
    if (phoneDigits.startsWith('20')) {
        return `+${phoneDigits}`;
    } else {
        return `+20${phoneDigits}`;
    }
};

/**
 * Extract the local number without country code
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

// Routes
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

// Redirect any old /view/:token links to track page
app.get('/view/:token', (req, res) => {
    res.redirect('/track');
});

// API endpoint to get patient by phone number
app.get('/api/patient/:phone', (req, res) => {
    let phone = req.params.phone;
    
    // Remove any non-digit characters
    phone = phone.replace(/\D/g, '');
    
    if (!phone || phone.length < 3) {
        return res.status(400).json({ error: 'Invalid phone number' });
    }

    console.log('Searching for phone:', phone); // Debug log

    // Try different formats to find the patient
    let patient = null;
    
    // Format 1: As entered
    patient = queue.find(p => p.phoneDigits === phone);
    
    // Format 2: With 20 prefix
    if (!patient && !phone.startsWith('20')) {
        const with20 = '20' + phone;
        patient = queue.find(p => p.phoneDigits === with20);
    }
    
    // Format 3: Remove leading zero and add 20
    if (!patient && phone.startsWith('0')) {
        const withoutZero = phone.substring(1);
        const with20 = '20' + withoutZero;
        patient = queue.find(p => p.phoneDigits === with20);
    }
    
    // Format 4: If they entered with 20 already but different format
    if (!patient && phone.startsWith('20')) {
        const without20 = phone.substring(2);
        const with20again = '20' + without20;
        patient = queue.find(p => p.phoneDigits === with20again);
    }
    
    console.log('Found:', patient ? 'yes' : 'no'); // Debug log
    
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

// API endpoint to add patient (reception only)
app.post('/api/add-patient', requireAuth, express.json(), (req, res) => {
    const { name, phoneNumber } = req.body;
    
    if (!name || !phoneNumber) {
        return res.status(400).json({ error: 'Name and phone number are required' });
    }

    // Format phone number to Egypt standard (+20)
    let phoneDigits = formatPhoneNumber(phoneNumber);
    
    console.log('Formatted phone:', phoneDigits); // Debug log
    
    // Validate phone number (should be 11-12 digits total with country code)
    if (phoneDigits.length < 11 || phoneDigits.length > 13) {
        return res.status(400).json({ 
            error: 'Please enter a valid Egyptian phone number (e.g., 01012345678 or 1012345678)' 
        });
    }

    // Check if patient already in queue
    const existingPatient = queue.find(p => p.phoneDigits === phoneDigits);
    
    if (existingPatient) {
        return res.status(400).json({ error: 'Phone number already registered in queue' });
    }

    // Create new patient
    const newPatient = {
        id: nextId++,
        name: name,
        phoneDigits: phoneDigits,
        phoneNumber: displayPhoneNumber(phoneDigits),
        localNumber: getLocalNumber(phoneDigits),
        joinTime: new Date().toISOString()
    };

    queue.push(newPatient);

    // Store phone mapping
    patientPhoneMap.set(phoneDigits, newPatient.id);

    // Generate track link
    const trackLink = `${BASE_URL}/track`;

    // Generate WhatsApp message
    const whatsappMessage = encodeURIComponent(
        `🏥 *Clinic Queue System*\n\n` +
        `Hello *${name}*, you have been added to the queue.\n\n` +
        `*Your Queue Number:* #${newPatient.id}\n` +
        `*Current Position:* ${queue.length}\n` +
        `*Estimated Wait:* ${calculateWaitingTime(queue.length - 1)} minutes\n\n` +
        `👉 *Track your position:*\n` +
        `${trackLink}\n\n` +
        `📱 *Your phone number on file:* ${displayPhoneNumber(phoneDigits)}\n\n` +
        `*You can also track using:* ${getLocalNumber(phoneDigits)} (without +20)\n\n` +
        `Just click the link above and enter your phone number to see your position in real-time!\n\n` +
        `Thank you for choosing our clinic!`
    );

    // For WhatsApp link, use the digits with 20 prefix
    const whatsappLink = `https://wa.me/${phoneDigits}?text=${whatsappMessage}`;

    updateAllClients();

    res.json({
        success: true,
        patient: {
            ...newPatient,
            displayPhone: displayPhoneNumber(phoneDigits)
        },
        trackLink: trackLink,
        whatsappLink: whatsappLink,
        formats: {
            full: displayPhoneNumber(phoneDigits),
            local: getLocalNumber(phoneDigits),
            withCountryCode: phoneDigits
        }
    });
});

// Socket.io connection handling
io.on('connection', (socket) => {
    console.log('New client connected');

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

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log('\n=== Clinic Queue System ===');
    console.log(`🚀 Server running on http://localhost:${PORT}`);
    console.log(`🔐 Login page: http://localhost:${PORT}/login`);
    console.log(`📊 Dashboard: http://localhost:${PORT}/dashboard (requires login)`);
    console.log(`📱 Track page: http://localhost:${PORT}/track`);
    console.log(`📺 TV Screen: http://localhost:${PORT}/screen`);
    console.log(`🔑 Admin password: 12345 (you can edit this later)`);
    console.log(`📞 Egypt country code: +20`);
    console.log('===========================\n');
});