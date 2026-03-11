// db.js - Database management for clinic queue with better-sqlite3
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

// Ensure db directory exists
const dbDir = path.join(__dirname, 'db');
if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
}

const dbPath = path.join(dbDir, 'clinic.db');
const db = new Database(dbPath);

// Enable foreign keys
db.pragma('foreign_keys = ON');

// Initialize database tables
db.exec(`
    CREATE TABLE IF NOT EXISTS patients (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        phone_digits TEXT UNIQUE,
        name TEXT,
        area TEXT,
        first_visit_date TEXT,
        last_visit_date TEXT,
        total_visits INTEGER DEFAULT 1,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS queue_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        patient_id INTEGER,
        queue_number INTEGER,
        join_time TEXT,
        call_time TEXT,
        complete_time TEXT,
        is_priority BOOLEAN DEFAULT 0,
        is_missed BOOLEAN DEFAULT 0,
        waiting_time INTEGER,
        doctor_notes TEXT,
        FOREIGN KEY (patient_id) REFERENCES patients (id)
    );

    CREATE TABLE IF NOT EXISTS current_queue (
        id INTEGER PRIMARY KEY,
        patient_id INTEGER UNIQUE,
        queue_number INTEGER UNIQUE,
        name TEXT,
        phone_digits TEXT,
        area TEXT,
        join_time TEXT,
        is_priority BOOLEAN DEFAULT 0,
        is_missed BOOLEAN DEFAULT 0,
        position INTEGER,
        FOREIGN KEY (patient_id) REFERENCES patients (id)
    );

    CREATE TABLE IF NOT EXISTS current_serving (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        patient_id INTEGER,
        name TEXT,
        phone_digits TEXT,
        call_time TEXT,
        FOREIGN KEY (patient_id) REFERENCES patients (id)
    );
`);

console.log('✅ Database initialized with better-sqlite3');

// Helper functions using better-sqlite3 sync methods
const dbHelpers = {
    findPatientByPhone: (phoneDigits) => {
        const stmt = db.prepare('SELECT * FROM patients WHERE phone_digits = ?');
        return stmt.get(phoneDigits);
    },

    addPatient: (patientData) => {
        const { phoneDigits, name, area, lastVisitDate } = patientData;
        const today = new Date().toISOString().split('T')[0];
        
        const stmt = db.prepare(
            `INSERT INTO patients (phone_digits, name, area, first_visit_date, last_visit_date, total_visits)
             VALUES (?, ?, ?, ?, ?, 1)`
        );
        
        const info = stmt.run(phoneDigits, name, area, today, lastVisitDate || today);
        return { id: info.lastInsertRowid };
    },

    updatePatientVisit: (patientId) => {
        const today = new Date().toISOString().split('T')[0];
        const stmt = db.prepare(
            `UPDATE patients 
             SET last_visit_date = ?, total_visits = total_visits + 1 
             WHERE id = ?`
        );
        stmt.run(today, patientId);
    },

// Save current queue to database - FIXED VERSION
saveQueue: (queue, currentServing, nextId) => {
    return new Promise((resolve, reject) => {
        try {
            // Clear existing queue
            db.prepare('DELETE FROM current_queue').run();
            db.prepare('DELETE FROM current_serving WHERE id = 1').run();
            
            // Insert current queue
            const insertStmt = db.prepare(
                `INSERT INTO current_queue 
                 (id, patient_id, queue_number, name, phone_digits, area, join_time, is_priority, is_missed, position)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
            );
            
            // Use transaction for better performance
            const insertMany = db.transaction((queue) => {
                for (const [index, patient] of queue.entries()) {
                    insertStmt.run(
                        patient.id,
                        patient.patientId || null,
                        patient.id,
                        patient.name,
                        patient.phoneDigits,
                        patient.area || 'Unknown',
                        patient.joinTime,
                        patient.isPriority ? 1 : 0,
                        patient.isMissed ? 1 : 0,
                        index + 1
                    );
                }
            });
            
            insertMany(queue);
            
            // Insert current serving
            if (currentServing) {
                db.prepare(
                    `INSERT INTO current_serving (id, patient_id, name, phone_digits, call_time)
                     VALUES (1, ?, ?, ?, ?)`
                ).run(
                    currentServing.patientId || null,
                    currentServing.name,
                    currentServing.phoneDigits,
                    new Date().toISOString()
                );
            }
            
            // Update sequence for nextId
            db.prepare('UPDATE sqlite_sequence SET seq = ? WHERE name = ?').run(nextId, 'current_queue');
            
            console.log('✅ Queue saved to database');
            resolve({ success: true });
            
        } catch (error) {
            console.error('❌ Error saving queue:', error);
            reject(error);
        }
    });
},

// Load queue from database - FIXED VERSION
loadQueue: () => {
    return new Promise((resolve, reject) => {
        try {
            const queue = db.prepare('SELECT * FROM current_queue ORDER BY position').all();
            const currentServing = db.prepare('SELECT * FROM current_serving WHERE id = 1').get();
            const seq = db.prepare('SELECT seq FROM sqlite_sequence WHERE name = ?').get('current_queue');
            
            const formattedQueue = queue.map(row => ({
                id: row.queue_number,
                patientId: row.patient_id,
                name: row.name,
                phoneDigits: row.phone_digits,
                area: row.area,
                joinTime: row.join_time,
                isPriority: row.is_priority === 1,
                isMissed: row.is_missed === 1
            }));
            
            const formattedCurrentServing = currentServing ? {
                id: currentServing.patient_id,
                name: currentServing.name,
                phoneDigits: currentServing.phone_digits
            } : null;
            
            const nextId = (seq && seq.seq) ? seq.seq + 1 : 1;
            
            resolve({ queue: formattedQueue, currentServing: formattedCurrentServing, nextId });
            
        } catch (error) {
            console.error('❌ Error loading queue:', error);
            reject(error);
        }
    });
},

// Add to history when patient is served - FIXED VERSION
addToHistory: (patient, callTime, completeTime, waitingTime, doctorNotes = '') => {
    return new Promise((resolve, reject) => {
        try {
            const stmt = db.prepare(
                `INSERT INTO queue_history 
                 (patient_id, queue_number, join_time, call_time, complete_time, is_priority, is_missed, waiting_time, doctor_notes)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
            );
            
            stmt.run(
                patient.patientId || null,
                patient.id,
                patient.joinTime,
                callTime,
                completeTime,
                patient.isPriority ? 1 : 0,
                patient.isMissed ? 1 : 0,
                waitingTime,
                doctorNotes
            );
            
            console.log(`✅ Added patient #${patient.id} to history`);
            resolve({ success: true });
            
        } catch (error) {
            console.error('❌ Error adding to history:', error);
            reject(error);
        }
    });
},

    getAllPatients: (limit = 20, offset = 0, search = '') => {
        let query = `SELECT * FROM patients`;
        let countQuery = `SELECT COUNT(*) as total FROM patients`;
        let params = [];
        
        if (search) {
            query += ` WHERE name LIKE ? OR phone_digits LIKE ? OR area LIKE ?`;
            countQuery += ` WHERE name LIKE ? OR phone_digits LIKE ? OR area LIKE ?`;
            const searchPattern = `%${search}%`;
            params = [searchPattern, searchPattern, searchPattern];
        }
        
        query += ` ORDER BY id DESC LIMIT ? OFFSET ?`;
        
        const countStmt = db.prepare(countQuery);
        const total = params.length > 0 
            ? countStmt.get(params[0], params[1], params[2]).total
            : countStmt.get().total;
        
        const stmt = db.prepare(query);
        const patients = params.length > 0
            ? stmt.all(params[0], params[1], params[2], limit, offset)
            : stmt.all(limit, offset);
        
        // Add visit counts
        patients.forEach(patient => {
            const countStmt = db.prepare('SELECT COUNT(*) as count FROM queue_history WHERE patient_id = ?');
            const countResult = countStmt.get(patient.id);
            patient.total_visits = countResult ? countResult.count : 0;
            
            const lastStmt = db.prepare('SELECT MAX(join_time) as last FROM queue_history WHERE patient_id = ?');
            const lastResult = lastStmt.get(patient.id);
            patient.last_visit = lastResult ? lastResult.last : null;
        });
        
        return { patients, total };
    },

    getPatientWithHistory: (patientId) => {
        const patient = db.prepare('SELECT * FROM patients WHERE id = ?').get(patientId);
        
        if (!patient) return null;
        
        const visits = db.prepare(`
            SELECT * FROM queue_history 
            WHERE patient_id = ? 
            ORDER BY join_time DESC 
            LIMIT 50
        `).all(patientId);
        
        return { patient, visits };
    }
};

module.exports = { db, dbHelpers };