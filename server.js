const express = require("express");
const http = require("http");
const socketIo = require("socket.io");
const path = require("path");
const session = require("express-session");
const fetch = require("node-fetch");
const { dbHelpers, pool, dbReady } = require('./db-pg');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
    credentials: true,
  },
  transports: ["websocket", "polling"],
});

// Middleware
app.use(express.static(path.join(__dirname, "public")));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Session middleware
app.use(
  session({
    secret: process.env.SESSION_SECRET || "clinic-queue-secret-key",
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: process.env.NODE_ENV === "production",
      maxAge: 24 * 60 * 60 * 1000,
      sameSite: "lax",
    },
  })
);

app.set("trust proxy", 1);

// Simple authentication
const USERS = {
  admin: {
    password: "12345",
    role: "admin",
  },
};

// In-memory queue storage
let queue = [];
let currentServing = null;
let nextId = 1;

// Store patient by phone number
const patientPhoneMap = new Map();

// Constants
const AVERAGE_CONSULTATION_TIME = 5;
const BASE_URL = process.env.BASE_URL || "http://localhost:3000";
const COUNTRY_CODE = "20";

// ==================== DATABASE LOAD ON STARTUP ====================
async function loadSavedQueue() {
    try {
        // Wait for database tables to be ready
        await dbReady;
        console.log('✅ Database ready, loading queue...');
        
        const saved = await dbHelpers.loadQueue();
        if (saved) {
            queue = saved.queue;
            currentServing = saved.currentServing;
            nextId = saved.nextId;
            console.log(`✅ Loaded ${queue.length} patients from database`);
            console.log(`✅ Next ID: ${nextId}`);
            
            // Rebuild patientPhoneMap
            queue.forEach(patient => {
                if (patient.phoneDigits) {
                    patientPhoneMap.set(patient.phoneDigits, patient.id);
                }
            });
        }
    } catch (error) {
        console.error('Error loading queue:', error);
    }
}

// Call this before server starts
loadSavedQueue();

// ==================== HELPER FUNCTIONS ====================

const calculateWaitingTime = (position) => {
  if (position < 0) return 0;
  return position * AVERAGE_CONSULTATION_TIME;
};

const formatPhoneNumber = (phone) => {
  let digits = phone.replace(/\D/g, "");
  if (!digits) return "";
  if (digits.startsWith("20")) return digits;
  if (digits.startsWith("0")) {
    digits = digits.substring(1);
    return "20" + digits;
  }
  if (digits.startsWith("1")) return "20" + digits;
  return "20" + digits;
};

const displayPhoneNumber = (phoneDigits) => {
  if (!phoneDigits) return "";
  if (phoneDigits.startsWith("20")) {
    return `+${phoneDigits}`;
  }
  return `+20${phoneDigits}`;
};

const getLocalNumber = (phoneDigits) => {
  if (!phoneDigits) return "";
  if (phoneDigits.startsWith("20")) {
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
      displayPhone: displayPhoneNumber(patient.phoneDigits),
    })),
    currentServing: currentServing
      ? {
          ...currentServing,
          displayPhone: displayPhoneNumber(currentServing.phoneDigits),
        }
      : null,
    queueLength: queue.length,
  };

  io.emit("queue-update", queueData);
  
  // Save to database with Promise handling
  if (dbHelpers && typeof dbHelpers.saveQueue === 'function') {
    dbHelpers.saveQueue(queue, currentServing, nextId)
      .then(() => {
        console.log('✅ Queue saved to database');
      })
      .catch(err => {
        console.error('❌ Error saving queue:', err);
      });
  } else {
    console.warn('⚠️ saveQueue function not available');
  }
};

// Authentication middleware
const requireAuth = (req, res, next) => {
  if (req.session.user) {
    next();
  } else {
    res.redirect("/login");
  }
};

// Health check endpoint
app.get("/healthz", (req, res) => {
  res.status(200).json({
    status: "healthy",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    queueLength: queue.length,
    currentServing: currentServing ? currentServing.id : null,
    memory: process.memoryUsage(),
    environment: process.env.NODE_ENV || "development",
  });
});

// ==================== PAGE ROUTES ====================

app.get("/", (req, res) => {
  res.redirect("/login");
});

app.get("/login", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "login.html"));
});

app.post("/login", (req, res) => {
  const { password } = req.body;

  if (USERS.admin && USERS.admin.password === password) {
    req.session.user = {
      username: "admin",
      role: "admin",
    };
    res.redirect("/dashboard");
  } else {
    res.redirect("/login?error=1");
  }
});

app.get("/logout", (req, res) => {
  req.session.destroy();
  res.redirect("/login");
});

app.get('/doctor', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'doctor.html'));
});

app.get("/dashboard", requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, "public", "dashboard.html"));
});

app.get("/track", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "track.html"));
});

app.get("/screen", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "screen.html"));
});

app.get("/patients", requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, "public", "patients.html"));
});

app.get("/view/:token", (req, res) => {
  res.redirect("/track");
});

// ==================== API ROUTES ====================

// Check patient history by phone number - FIXED
// Check patient history by phone number - WITH BIRTH DATE
app.get('/api/check-patient/:phone', requireAuth, async (req, res) => {
    try {
        let phone = req.params.phone;
        phone = phone.replace(/\D/g, '');
        
        if (!phone || phone.length < 3) {
            return res.status(400).json({ error: 'Invalid phone number' });
        }
        
        const phoneDigits = formatPhoneNumber(phone);
        console.log('Checking patient history for:', phoneDigits);
        
        const patient = await dbHelpers.findPatientByPhone(phoneDigits);
        
        if (patient) {
            console.log('Patient found:', patient);
            res.json({
                found: true,
                patientId: patient.id,
                name: patient.name,
                area: patient.area,
                birthDate: patient.birth_date,  // 👈 ADD THIS
                lastVisitDate: patient.last_visit_date,
                totalVisits: patient.total_visits
            });
        } else {
            res.json({ found: false });
        }
    } catch (error) {
        console.error('Error checking patient:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Get patient by phone number
app.get("/api/patient/:phone", (req, res) => {
  try {
    let phone = req.params.phone;
    phone = phone.replace(/\D/g, "");

    if (!phone || phone.length < 3) {
      return res.status(400).json({ error: "Invalid phone number" });
    }

    console.log("Searching for phone:", phone);

    let patient = null;

    patient = queue.find((p) => p.phoneDigits === phone);

    if (!patient && !phone.startsWith("20")) {
      const with20 = "20" + phone;
      patient = queue.find((p) => p.phoneDigits === with20);
    }

    if (!patient && phone.startsWith("0")) {
      const withoutZero = phone.substring(1);
      const with20 = "20" + withoutZero;
      patient = queue.find((p) => p.phoneDigits === with20);
    }

    if (!patient) {
      return res.status(404).json({ error: "Phone number not found in queue" });
    }

    const position = queue.findIndex((p) => p.id === patient.id) + 1;

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
      isMissed: patient.isMissed || false,
      area: patient.area || 'Unknown',
      lastVisitDate: patient.lastVisitDate || null,
      isNewPatient: patient.isNewPatient !== false
    });
  } catch (error) {
    console.error('Error in /api/patient:', error);
    res.status(500).json({ error: 'Server error', message: error.message });
  }
});

// Get all patients from database (with pagination) - UPDATED FOR POSTGRESQL
app.get('/api/patients', requireAuth, async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;
        const search = req.query.search || '';
        const offset = (page - 1) * limit;
        
        console.log('Fetching patients - page:', page, 'search:', search);
        
        const result = await dbHelpers.getAllPatients(limit, offset, search);
        
        const totalPages = Math.ceil(result.total / limit);
        
        res.json({
            patients: result.patients,
            pagination: {
                page,
                limit,
                total: result.total,
                pages: totalPages
            }
        });
        
    } catch (error) {
        console.error('Error in /api/patients:', error);
        res.status(500).json({ 
            error: 'Server error', 
            message: error.message,
            patients: [],
            pagination: {
                page: 1,
                limit: 20,
                total: 0,
                pages: 0
            }
        });
    }
});

// Get patient details with visit history - UPDATED FOR POSTGRESQL
app.get('/api/patients/:id', requireAuth, async (req, res) => {
    try {
        const patientId = req.params.id;
        
        console.log('Fetching patient details for ID:', patientId);
        
        if (!patientId || isNaN(parseInt(patientId))) {
            return res.status(400).json({ error: 'Invalid patient ID' });
        }
        
        const result = await dbHelpers.getPatientWithHistory(patientId);
        
        if (!result) {
            return res.status(404).json({ error: 'Patient not found' });
        }
        
        console.log(`Found ${result.visits.length} visits for patient ${patientId}`);
        
        res.json({ 
            patient: result.patient, 
            visits: result.visits 
        });
        
    } catch (error) {
        console.error('Error in /api/patients/:id:', error);
        res.status(500).json({ error: 'Server error', message: error.message });
    }
});

// Add patient - FIXED for new patients
// Add patient - WITH BIRTH DATE
app.post('/api/add-patient', requireAuth, express.json(), async (req, res) => {
    try {
        console.log('Add patient request received:', req.body);
        
        const { 
            name, 
            phoneNumber, 
            isPriority = false,
            area = 'Unknown',
            birthDate = null,  // 👈 ADD THIS
            lastVisitDate = null,
            isNewPatient = true 
        } = req.body;
        
        // Validate required fields
        if (!name || !name.trim()) {
            return res.status(400).json({ error: 'Patient name is required' });
        }
        
        if (!phoneNumber || !phoneNumber.trim()) {
            return res.status(400).json({ error: 'Phone number is required' });
        }

        // Format phone number
        const phoneDigits = formatPhoneNumber(phoneNumber);
        console.log('Formatted phone:', phoneDigits);
        
        // Basic validation
        if (phoneDigits.length < 10) {
            return res.status(400).json({ 
                error: 'Please enter a valid phone number' 
            });
        }

        // Check if already in queue
        const existingPatient = queue.find(p => p.phoneDigits === phoneDigits && !p.isMissed);
        if (existingPatient) {
            return res.status(400).json({ error: 'Phone number already registered in queue' });
        }

        // Create new patient object WITH BIRTH DATE
        const newPatient = {
            id: nextId++,
            name: name.trim(),
            phoneDigits: phoneDigits,
            phoneNumber: displayPhoneNumber(phoneDigits),
            localNumber: getLocalNumber(phoneDigits),
            joinTime: new Date().toISOString(),
            isPriority: isPriority,
            isMissed: false,
            area: area.trim() || 'Unknown',
            birthDate: birthDate,  // 👈 ADD THIS
            lastVisitDate: null, // Always start with null for new patients
            isNewPatient: true
        };

        // Save to database
        try {
            // Check if patient exists in database
            const existing = await dbHelpers.findPatientByPhone(phoneDigits);
            
            if (existing) {
                // This is a RETURNING patient
                newPatient.patientId = existing.id;
                newPatient.isNewPatient = false;
                newPatient.lastVisitDate = existing.last_visit_date; // Use their PREVIOUS last visit date
                newPatient.birthDate = existing.birth_date; // 👈 ADD THIS
                
                // Update their record for NEXT time
                await dbHelpers.updatePatientVisit(existing.id);
                
                console.log(`✅ Returning patient #${existing.id} - last visit was ${existing.last_visit_date}`);
            } else {
                // This is a NEW patient - INCLUDE BIRTH DATE
                const result = await dbHelpers.addPatient({
                    phoneDigits,
                    name: name.trim(),
                    area: area.trim() || 'Unknown',
                    birthDate: birthDate,  // 👈 ADD THIS
                    lastVisitDate: null
                });
                newPatient.patientId = result.id;
                newPatient.isNewPatient = true;
                newPatient.lastVisitDate = null;
                
                console.log(`✅ Added new patient to database with ID: ${result.id}`);
            }
        } catch (dbError) {
            console.error('Database error (non-critical):', dbError);
            // Continue - queue still works
        }

        // Add to queue
        if (isPriority) {
            const priorityCount = queue.filter(p => p.isPriority && !p.isMissed).length;
            queue.splice(priorityCount, 0, newPatient);
        } else {
            queue.push(newPatient);
        }
        
        patientPhoneMap.set(phoneDigits, newPatient.id);

        // Update all clients
        updateAllClients();

        // Generate WhatsApp link
        const trackLink = `${BASE_URL}/track`;
        const patientType = newPatient.isNewPatient ? '🆕 New Patient' : '🔄 Returning Patient';
        const visitDisplay = newPatient.lastVisitDate ? `Last visit: ${newPatient.lastVisitDate}` : 'First visit';
        
        const whatsappMessage = encodeURIComponent(
            `🏥 *Dr Maher Mahmoud Clinics*\n\n` +
            `Hello *${name.trim()}*, you have been added to the queue.\n\n` +
            `*Your Queue Number:* #${newPatient.id}\n` +
            `*Priority:* ${isPriority ? '⭐ Priority' : '🟢 Normal'}\n` +
            `*Current Position:* ${newPatient.position}\n` +
            `*Estimated Wait:* ${calculateWaitingTime(newPatient.position - 1)} minutes\n\n` +
            `*Area:* ${area.trim() || 'Unknown'}\n` +
            `*Status:* ${patientType}\n` +
            `*${visitDisplay}*\n\n` +
            `👉 *Track your position:*\n` +
            `${trackLink}\n\n` +
            `Thank you for choosing our clinic!`
        );

        const whatsappLink = `https://wa.me/${phoneDigits}?text=${whatsappMessage}`;

        // Send success response
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
        console.error('Error in add-patient:', error);
        res.status(500).json({ 
            error: 'Failed to add patient', 
            message: error.message 
        });
    }
});

// Toggle priority
app.post("/api/toggle-priority", requireAuth, express.json(), (req, res) => {
  try {
    const { patientId } = req.body;

    if (!patientId) {
      return res.status(400).json({ error: "Patient ID is required" });
    }

    const patient = queue.find((p) => p.id === patientId);
    if (!patient) {
      return res.status(404).json({ error: "Patient not found" });
    }

    // Toggle priority
    patient.isPriority = !patient.isPriority;

    // If priority was turned ON, move patient to top
    if (patient.isPriority && !patient.isMissed) {
      // Remove patient from current position
      const index = queue.findIndex((p) => p.id === patientId);
      queue.splice(index, 1);

      // Find position to insert (after other non-missed priority patients)
      const priorityCount = queue.filter(
        (p) => p.isPriority && !p.isMissed,
      ).length;
      queue.splice(priorityCount, 0, patient);
    }

    updateAllClients();

    res.json({ success: true, isPriority: patient.isPriority });
  } catch (error) {
    console.error("Error toggling priority:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Mark as missed
app.post("/api/mark-missed", requireAuth, express.json(), (req, res) => {
  try {
    const { patientId } = req.body;

    if (!patientId) {
      return res.status(400).json({ error: "Patient ID is required" });
    }

    const patient = queue.find((p) => p.id === patientId);
    if (!patient) {
      return res.status(404).json({ error: "Patient not found" });
    }

    patient.isMissed = true;
    patient.missedTime = new Date().toISOString();

    updateAllClients();

    res.json({ success: true });
  } catch (error) {
    console.error("Error marking missed:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Restore missed patient
app.post("/api/restore-patient", requireAuth, express.json(), (req, res) => {
  try {
    const { patientId } = req.body;

    if (!patientId) {
      return res.status(400).json({ error: "Patient ID is required" });
    }

    const patient = queue.find((p) => p.id === patientId);
    if (!patient) {
      return res.status(404).json({ error: "Patient not found" });
    }

    patient.isMissed = false;
    patient.missedTime = null;

    updateAllClients();

    res.json({ success: true });
  } catch (error) {
    console.error("Error restoring patient:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Edit patient
app.post("/api/edit-patient", requireAuth, express.json(), (req, res) => {
  try {
    console.log("Edit patient request received:", req.body);

    const { patientId, name, phoneNumber } = req.body;

    if (!patientId || !name || !phoneNumber) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const patient = queue.find((p) => p.id === patientId);
    if (!patient) {
      return res.status(404).json({ error: "Patient not found" });
    }

    const phoneDigits = formatPhoneNumber(phoneNumber);

    // Check if new phone number already exists (except current patient)
    const existingPatient = queue.find(
      (p) => p.phoneDigits === phoneDigits && p.id !== patientId,
    );
    if (existingPatient) {
      return res.status(400).json({ error: "Phone number already in use" });
    }

    patient.name = name;
    patient.phoneDigits = phoneDigits;
    patient.phoneNumber = displayPhoneNumber(phoneDigits);
    patient.localNumber = getLocalNumber(phoneDigits);

    updateAllClients();

    console.log("Patient updated successfully:", patient);
    res.json({ success: true });
  } catch (error) {
    console.error("Error editing patient:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Reorder queue
app.post("/api/reorder-queue", requireAuth, express.json(), (req, res) => {
  try {
    console.log("Reorder request received:", req.body);

    const { orderedIds } = req.body;

    if (!orderedIds || !Array.isArray(orderedIds)) {
      return res.status(400).json({ error: "Invalid order data" });
    }

    if (orderedIds.length === 0) {
      return res.status(400).json({ error: "Empty order data" });
    }

    // Create new queue based on ordered IDs
    const newQueue = [];
    const processedIds = new Set();

    for (const id of orderedIds) {
      const patient = queue.find((p) => p.id === id);
      if (patient && !processedIds.has(id)) {
        newQueue.push(patient);
        processedIds.add(id);
      }
    }

    // Add any patients that might have been missed
    queue.forEach((patient) => {
      if (!processedIds.has(patient.id)) {
        newQueue.push(patient);
      }
    });

    if (newQueue.length === 0) {
      return res.status(400).json({ error: "No valid patients found" });
    }

    queue = newQueue;
    updatePositions();
    updateAllClients();

    console.log("Queue reordered successfully");
    res.json({ success: true });
  } catch (error) {
    console.error("Error reordering queue:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Get today's stats - UPDATED FOR POSTGRESQL
app.get('/api/today-stats', requireAuth, async (req, res) => {
    try {
        const today = new Date().toISOString().split('T')[0];
        
        const result = await pool.query(
            'SELECT COUNT(*) as count FROM queue_history WHERE DATE(join_time) = $1',
            [today]
        );
        
        res.json({ todayCount: parseInt(result.rows[0].count) || 0 });
    } catch (error) {
        console.error('Error getting today stats:', error);
        res.json({ todayCount: 0 });
    }
});

// Get today's history - UPDATED FOR POSTGRESQL
app.get('/api/today-history', requireAuth, async (req, res) => {
    try {
        const today = new Date().toISOString().split('T')[0];
        
        const result = await pool.query(
            `SELECT q.*, p.name, p.area, p.phone_digits 
             FROM queue_history q
             LEFT JOIN patients p ON q.patient_id = p.id
             WHERE DATE(q.join_time) = $1
             ORDER BY q.complete_time DESC NULLS LAST LIMIT 20`,
            [today]
        );
        
        res.json({ history: result.rows || [] });
    } catch (error) {
        console.error('Error getting today history:', error);
        res.json({ history: [] });
    }
});

// Complete patient
app.post('/api/complete-patient', requireAuth, express.json(), (req, res) => {
    try {
        const { patientId, patientData, complaint, completedTime } = req.body;
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false });
    }
});

// Save notes
app.post('/api/save-notes', requireAuth, express.json(), (req, res) => {
    try {
        const { patientId, notes } = req.body;
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false });
    }
});

// Refer patient
app.post('/api/refer-patient', requireAuth, express.json(), (req, res) => {
    try {
        const { patientId, patientData } = req.body;
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false });
    }
});

// ==================== SOCKET.IO ====================

io.on("connection", (socket) => {
  console.log("New client connected from:", socket.handshake.address);

  const queueData = {
    queue: queue.map((patient, index) => ({
      ...patient,
      position: index + 1,
      waitingTime: calculateWaitingTime(index),
      displayPhone: displayPhoneNumber(patient.phoneDigits),
    })),
    currentServing: currentServing
      ? {
          ...currentServing,
          displayPhone: displayPhoneNumber(currentServing.phoneDigits),
        }
      : null,
    queueLength: queue.length,
  };

  socket.emit("queue-update", queueData);

socket.on("call-next", () => {
    try {
      const nextIndex = queue.findIndex((p) => !p.isMissed);

      if (nextIndex !== -1) {
        const nextPatient = queue[nextIndex];
        queue.splice(nextIndex, 1);
        currentServing = nextPatient;

        // Add to history with Promise handling
        try {
          const callTime = new Date().toISOString();
          if (dbHelpers && typeof dbHelpers.addToHistory === 'function') {
            dbHelpers.addToHistory(
              nextPatient,
              callTime,
              null,
              calculateWaitingTime(nextIndex)
            )
            .then(() => {
              console.log(`✅ History saved for patient #${nextPatient.id}`);
            })
            .catch(err => {
              console.error("❌ Error adding to history:", err);
            });
          }
        } catch (historyError) {
          console.error("History error:", historyError);
        }

        io.emit("next-called", {
          patient: {
            ...nextPatient,
            displayPhone: displayPhoneNumber(nextPatient.phoneDigits),
          },
          message: `Now serving: ${nextPatient.name}`,
        });

        updateAllClients();
      }
    } catch (error) {
      console.error('Error in call-next:', error);
    }
});

  socket.on("remove-patient", (patientId) => {
    const index = queue.findIndex((p) => p.id === patientId);
    if (index !== -1) {
      const patient = queue[index];
      patientPhoneMap.delete(patient.phoneDigits);
      queue.splice(index, 1);
      updateAllClients();
    }
  });

  socket.on("clear-queue", () => {
    queue = [];
    currentServing = null;
    nextId = 1;
    patientPhoneMap.clear();
    updateAllClients();
  });

  socket.on("disconnect", () => {
    console.log("Client disconnected");
  });
});

// Self-ping mechanism
if (process.env.NODE_ENV === "production") {
  const selfUrl = process.env.RENDER_EXTERNAL_URL || BASE_URL;

  setInterval(
    async () => {
      try {
        const response = await fetch(`${selfUrl}/healthz`);
        const data = await response.json();
        console.log(
          `[${new Date().toISOString()}] Self-ping successful - Queue: ${data.queueLength} patients`,
        );
      } catch (err) {
        console.log(
          `[${new Date().toISOString()}] Self-ping failed:`,
          err.message,
        );
      }
    },
    10 * 60 * 1000,
  );

  console.log(`✅ Keep-awake mechanism enabled - pinging every 10 minutes`);
}

// ==================== START SERVER ====================

const PORT = process.env.PORT || 3000;
server.listen(PORT, "0.0.0.0", async () => {
  // Wait for database to be ready before starting
  await dbReady;
  
  console.log("\n=== Clinic Queue System ===");
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`🔐 Login page: http://localhost:${PORT}/login`);
  console.log(`📊 Dashboard: http://localhost:${PORT}/dashboard`);
  console.log(`📱 Track page: http://localhost:${PORT}/track`);
  console.log(`📺 TV Screen: http://localhost:${PORT}/screen`);
  console.log(`👨‍⚕️ Doctor Screen: http://localhost:${PORT}/doctor`);
  console.log(`📋 Patients Records: http://localhost:${PORT}/patients`);
  console.log(`🔑 Admin password: 12345 (CHANGE THIS AFTER DEPLOYMENT!)`);
  console.log(`🌍 Environment: ${process.env.NODE_ENV || "development"}`);
  console.log(`💾 Database: PostgreSQL on Render`);
  if (process.env.RENDER_EXTERNAL_URL) {
    console.log(`📡 Public URL: ${process.env.RENDER_EXTERNAL_URL}`);
  }
  console.log("===========================\n");
});