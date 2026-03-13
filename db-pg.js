// db-pg.js - PostgreSQL version for Render
const { Pool } = require('pg');

let pool;

if (process.env.NODE_ENV === 'production') {
  // In production (Render), use the environment variable
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
      rejectUnauthorized: false // Required for Render's PostgreSQL
    }
  });
} else {
  // For local development, you can use a local PostgreSQL or keep using SQLite
  pool = new Pool({
    user: 'postgres',
    host: 'localhost',
    database: 'clinicdb',
    password: 'yourpassword',
    port: 5432,
  });
}

// Test the connection
pool.connect((err, client, release) => {
  if (err) {
    return console.error('❌ Error connecting to PostgreSQL:', err.stack);
  }
  console.log('✅ Connected to PostgreSQL');
  release();
});

// Initialize database tables
async function initDb() {
  try {
    // Create patients table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS patients (
        id SERIAL PRIMARY KEY,
        phone_digits TEXT UNIQUE,
        name TEXT NOT NULL,
        area TEXT,
        first_visit_date TEXT,
        last_visit_date TEXT,
        total_visits INTEGER DEFAULT 1,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    // Create queue_history table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS queue_history (
        id SERIAL PRIMARY KEY,
        patient_id INTEGER REFERENCES patients(id) ON DELETE SET NULL,
        queue_number INTEGER,
        join_time TEXT,
        call_time TEXT,
        complete_time TEXT,
        is_priority BOOLEAN DEFAULT false,
        is_missed BOOLEAN DEFAULT false,
        waiting_time INTEGER,
        doctor_notes TEXT
      )
    `);
    
    // Create current_queue table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS current_queue (
        id INTEGER PRIMARY KEY,
        patient_id INTEGER UNIQUE REFERENCES patients(id) ON DELETE SET NULL,
        queue_number INTEGER UNIQUE,
        name TEXT,
        phone_digits TEXT,
        area TEXT,
        join_time TEXT,
        is_priority BOOLEAN DEFAULT false,
        is_missed BOOLEAN DEFAULT false,
        position INTEGER
      )
    `);
    
    // Create current_serving table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS current_serving (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        patient_id INTEGER REFERENCES patients(id) ON DELETE SET NULL,
        name TEXT,
        phone_digits TEXT,
        call_time TEXT
      )
    `);
    
    console.log('✅ PostgreSQL tables initialized');
  } catch (err) {
    console.error('❌ Error initializing tables:', err);
  }
}

initDb();

// Helper functions
const dbHelpers = {
  // Find patient by phone
  findPatientByPhone: async (phoneDigits) => {
    try {
      const result = await pool.query(
        'SELECT * FROM patients WHERE phone_digits = $1',
        [phoneDigits]
      );
      return result.rows[0];
    } catch (err) {
      console.error('Error finding patient:', err);
      return null;
    }
  },

  // Add new patient
  addPatient: async (patientData) => {
    try {
      const { phoneDigits, name, area, lastVisitDate } = patientData;
      const today = new Date().toISOString().split('T')[0];
      
      const result = await pool.query(
        `INSERT INTO patients (phone_digits, name, area, first_visit_date, last_visit_date, total_visits)
         VALUES ($1, $2, $3, $4, $5, 1) RETURNING id`,
        [phoneDigits, name, area, today, lastVisitDate || today]
      );
      
      return { id: result.rows[0].id };
    } catch (err) {
      console.error('Error adding patient:', err);
      throw err;
    }
  },

  // Update patient last visit
  updatePatientVisit: async (patientId) => {
    try {
      const today = new Date().toISOString().split('T')[0];
      await pool.query(
        `UPDATE patients 
         SET last_visit_date = $1, total_visits = total_visits + 1 
         WHERE id = $2`,
        [today, patientId]
      );
    } catch (err) {
      console.error('Error updating patient visit:', err);
      throw err;
    }
  },

  // Save current queue
  saveQueue: async (queue, currentServing, nextId) => {
    try {
      // Start a transaction
      await pool.query('BEGIN');
      
      // Clear existing queue
      await pool.query('DELETE FROM current_queue');
      await pool.query('DELETE FROM current_serving WHERE id = 1');
      
      // Insert current queue
      for (let i = 0; i < queue.length; i++) {
        const patient = queue[i];
        await pool.query(
          `INSERT INTO current_queue 
           (id, patient_id, queue_number, name, phone_digits, area, join_time, is_priority, is_missed, position)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [
            patient.id,
            patient.patientId || null,
            patient.id,
            patient.name,
            patient.phoneDigits,
            patient.area || 'Unknown',
            patient.joinTime,
            patient.isPriority,
            patient.isMissed,
            i + 1
          ]
        );
      }
      
      // Insert current serving
      if (currentServing) {
        await pool.query(
          `INSERT INTO current_serving (id, patient_id, name, phone_digits, call_time)
           VALUES (1, $1, $2, $3, $4)`,
          [
            currentServing.patientId || null,
            currentServing.name,
            currentServing.phoneDigits,
            new Date().toISOString()
          ]
        );
      }
      
      // Commit transaction
      await pool.query('COMMIT');
    } catch (err) {
      await pool.query('ROLLBACK');
      console.error('Error saving queue:', err);
      throw err;
    }
  },

  // Load queue from database
  loadQueue: async () => {
    try {
      const queueResult = await pool.query(
        'SELECT * FROM current_queue ORDER BY position'
      );
      
      const servingResult = await pool.query(
        'SELECT * FROM current_serving WHERE id = 1'
      );
      
      const formattedQueue = queueResult.rows.map(row => ({
        id: row.queue_number,
        patientId: row.patient_id,
        name: row.name,
        phoneDigits: row.phone_digits,
        area: row.area,
        joinTime: row.join_time,
        isPriority: row.is_priority,
        isMissed: row.is_missed
      }));
      
      const formattedCurrentServing = servingResult.rows[0] ? {
        id: servingResult.rows[0].patient_id,
        name: servingResult.rows[0].name,
        phoneDigits: servingResult.rows[0].phone_digits
      } : null;
      
      // Get next ID (max id + 1)
      const maxIdResult = await pool.query('SELECT COALESCE(MAX(id), 0) + 1 as next_id FROM current_queue');
      const nextId = parseInt(maxIdResult.rows[0].next_id) || 1;
      
      return { 
        queue: formattedQueue, 
        currentServing: formattedCurrentServing, 
        nextId 
      };
    } catch (err) {
      console.error('Error loading queue:', err);
      return { queue: [], currentServing: null, nextId: 1 };
    }
  },

  // Add to history
  addToHistory: async (patient, callTime, completeTime, waitingTime, doctorNotes = '') => {
    try {
      await pool.query(
        `INSERT INTO queue_history 
         (patient_id, queue_number, join_time, call_time, complete_time, is_priority, is_missed, waiting_time, doctor_notes)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          patient.patientId || null,
          patient.id,
          patient.joinTime,
          callTime,
          completeTime,
          patient.isPriority,
          patient.isMissed,
          waitingTime,
          doctorNotes
        ]
      );
    } catch (err) {
      console.error('Error adding to history:', err);
      throw err;
    }
  },

  // Get all patients with pagination
  getAllPatients: async (limit = 20, offset = 0, search = '') => {
    try {
      let query = 'SELECT * FROM patients';
      let countQuery = 'SELECT COUNT(*) as total FROM patients';
      let params = [];
      let countParams = [];
      
      if (search) {
        query += ' WHERE name ILIKE $1 OR phone_digits ILIKE $2 OR area ILIKE $3';
        countQuery += ' WHERE name ILIKE $1 OR phone_digits ILIKE $2 OR area ILIKE $3';
        const searchPattern = `%${search}%`;
        params = [searchPattern, searchPattern, searchPattern, limit, offset];
        countParams = [searchPattern, searchPattern, searchPattern];
      } else {
        query += ' ORDER BY id DESC LIMIT $1 OFFSET $2';
        params = [limit, offset];
      }
      
      const patientsResult = await pool.query(query, params);
      const countResult = await pool.query(countQuery, countParams);
      
      // Get visit counts for each patient
      for (let patient of patientsResult.rows) {
        const visitCount = await pool.query(
          'SELECT COUNT(*) as count FROM queue_history WHERE patient_id = $1',
          [patient.id]
        );
        patient.total_visits = parseInt(visitCount.rows[0].count) || 1;
        
        const lastVisit = await pool.query(
          'SELECT MAX(join_time) as last FROM queue_history WHERE patient_id = $1',
          [patient.id]
        );
        patient.last_visit = lastVisit.rows[0].last;
      }
      
      return { 
        patients: patientsResult.rows, 
        total: parseInt(countResult.rows[0].total) 
      };
    } catch (err) {
      console.error('Error getting patients:', err);
      return { patients: [], total: 0 };
    }
  },

  // Get patient with history
  getPatientWithHistory: async (patientId) => {
    try {
      const patientResult = await pool.query(
        'SELECT * FROM patients WHERE id = $1',
        [patientId]
      );
      
      if (patientResult.rows.length === 0) return null;
      
      const visitsResult = await pool.query(
        `SELECT * FROM queue_history 
         WHERE patient_id = $1 
         ORDER BY join_time DESC 
         LIMIT 50`,
        [patientId]
      );
      
      return { 
        patient: patientResult.rows[0], 
        visits: visitsResult.rows 
      };
    } catch (err) {
      console.error('Error getting patient history:', err);
      return null;
    }
  }
};

module.exports = { dbHelpers, pool };