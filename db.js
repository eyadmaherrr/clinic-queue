// db.js - Database management for clinic queue with sqlite3
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

// Ensure db directory exists
const dbDir = path.join(__dirname, 'db');
if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
}

const dbPath = path.join(dbDir, 'clinic.db');
const db = new sqlite3.Database(dbPath);

// Enable foreign keys
db.run('PRAGMA foreign_keys = ON');

// Initialize database tables
db.serialize(() => {
    db.run(`
        CREATE TABLE IF NOT EXISTS patients (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            phone_digits TEXT UNIQUE,
            name TEXT,
            area TEXT,
            first_visit_date TEXT,
            last_visit_date TEXT,
            total_visits INTEGER DEFAULT 1,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
    `);

    db.run(`
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
        )
    `);

    db.run(`
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
        )
    `);

    db.run(`
        CREATE TABLE IF NOT EXISTS current_serving (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            patient_id INTEGER,
            name TEXT,
            phone_digits TEXT,
            call_time TEXT,
            FOREIGN KEY (patient_id) REFERENCES patients (id)
        )
    `);
});

console.log('✅ Database initialized with sqlite3');

// Helper functions using sqlite3 callbacks
const dbHelpers = {
    // Find patient by phone
    findPatientByPhone: (phoneDigits) => {
        return new Promise((resolve, reject) => {
            db.get(
                'SELECT * FROM patients WHERE phone_digits = ?',
                [phoneDigits],
                (err, row) => {
                    if (err) reject(err);
                    else resolve(row);
                }
            );
        });
    },

    // Add new patient
    addPatient: (patientData) => {
        return new Promise((resolve, reject) => {
            const { phoneDigits, name, area, lastVisitDate } = patientData;
            const today = new Date().toISOString().split('T')[0];
            
            db.run(
                `INSERT INTO patients (phone_digits, name, area, first_visit_date, last_visit_date, total_visits)
                 VALUES (?, ?, ?, ?, ?, 1)`,
                [phoneDigits, name, area, today, lastVisitDate || today],
                function(err) {
                    if (err) reject(err);
                    else resolve({ id: this.lastID });
                }
            );
        });
    },

    // Update patient last visit
    updatePatientVisit: (patientId) => {
        return new Promise((resolve, reject) => {
            const today = new Date().toISOString().split('T')[0];
            db.run(
                `UPDATE patients 
                 SET last_visit_date = ?, total_visits = total_visits + 1 
                 WHERE id = ?`,
                [today, patientId],
                (err) => {
                    if (err) reject(err);
                    else resolve();
                }
            );
        });
    },

    // Save current queue to database
    saveQueue: (queue, currentServing, nextId) => {
        return new Promise((resolve, reject) => {
            db.serialize(() => {
                // Clear existing queue
                db.run('DELETE FROM current_queue');
                db.run('DELETE FROM current_serving WHERE id = 1');
                
                // Insert current queue
                const stmt = db.prepare(
                    `INSERT INTO current_queue 
                     (id, patient_id, queue_number, name, phone_digits, area, join_time, is_priority, is_missed, position)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
                );
                
                queue.forEach((patient, index) => {
                    stmt.run(
                        patient.id,
                        patient.patientId || null,
                        patient.id,
                        patient.name,
                        patient.phoneDigits,
                        patient.area || 'Unknown',
                        patient.joinTime,
                        patient.isPriority ? 1 : 0,
                        patient.isMissed ? 1 : 0,
                        index + 1,
                        (err) => {
                            if (err) console.error('Error inserting queue item:', err);
                        }
                    );
                });
                
                stmt.finalize();
                
                // Insert current serving
                if (currentServing) {
                    db.run(
                        `INSERT INTO current_serving (id, patient_id, name, phone_digits, call_time)
                         VALUES (1, ?, ?, ?, ?)`,
                        [
                            currentServing.patientId || null,
                            currentServing.name,
                            currentServing.phoneDigits,
                            new Date().toISOString()
                        ],
                        (err) => {
                            if (err) console.error('Error inserting current serving:', err);
                        }
                    );
                }
                
                resolve({ success: true });
            });
        });
    },

    // Load queue from database
    loadQueue: () => {
        return new Promise((resolve, reject) => {
            db.all('SELECT * FROM current_queue ORDER BY position', (err, queue) => {
                if (err) reject(err);
                
                db.get('SELECT * FROM current_serving WHERE id = 1', (err, currentServing) => {
                    if (err) reject(err);
                    
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
                    
                    // Get nextId (just return 1 as default since sqlite_sequence might not exist)
                    resolve({ 
                        queue: formattedQueue, 
                        currentServing: formattedCurrentServing, 
                        nextId: 1 
                    });
                });
            });
        });
    },

    // Add to history when patient is served
    addToHistory: (patient, callTime, completeTime, waitingTime, doctorNotes = '') => {
        return new Promise((resolve, reject) => {
            db.run(
                `INSERT INTO queue_history 
                 (patient_id, queue_number, join_time, call_time, complete_time, is_priority, is_missed, waiting_time, doctor_notes)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    patient.patientId || null,
                    patient.id,
                    patient.joinTime,
                    callTime,
                    completeTime,
                    patient.isPriority ? 1 : 0,
                    patient.isMissed ? 1 : 0,
                    waitingTime,
                    doctorNotes
                ],
                function(err) {
                    if (err) reject(err);
                    else resolve({ id: this.lastID });
                }
            );
        });
    },

    // Get all patients with pagination
    getAllPatients: (limit = 20, offset = 0, search = '') => {
        return new Promise((resolve, reject) => {
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
            
            // Get total count
            db.get(countQuery, params.length ? params : [], (err, countResult) => {
                if (err) reject(err);
                
                const total = countResult ? countResult.total : 0;
                
                // Get paginated results
                const queryParams = [...params, limit, offset];
                db.all(query, queryParams, (err, patients) => {
                    if (err) reject(err);
                    
                    // Add visit counts for each patient
                    let completed = 0;
                    if (patients.length === 0) {
                        resolve({ patients, total });
                        return;
                    }
                    
                    patients.forEach((patient, index) => {
                        db.get(
                            'SELECT COUNT(*) as count FROM queue_history WHERE patient_id = ?',
                            [patient.id],
                            (err, countResult) => {
                                patient.total_visits = countResult ? countResult.count : 0;
                                
                                db.get(
                                    'SELECT MAX(join_time) as last FROM queue_history WHERE patient_id = ?',
                                    [patient.id],
                                    (err, lastResult) => {
                                        patient.last_visit = lastResult ? lastResult.last : null;
                                        
                                        completed++;
                                        if (completed === patients.length) {
                                            resolve({ patients, total });
                                        }
                                    }
                                );
                            }
                        );
                    });
                });
            });
        });
    },

    // Get patient by ID with visit history
    getPatientWithHistory: (patientId) => {
        return new Promise((resolve, reject) => {
            db.get('SELECT * FROM patients WHERE id = ?', [patientId], (err, patient) => {
                if (err) reject(err);
                if (!patient) {
                    resolve(null);
                    return;
                }
                
                db.all(
                    'SELECT * FROM queue_history WHERE patient_id = ? ORDER BY join_time DESC LIMIT 50',
                    [patientId],
                    (err, visits) => {
                        if (err) reject(err);
                        resolve({ patient, visits: visits || [] });
                    }
                );
            });
        });
    }
};

module.exports = { db, dbHelpers };