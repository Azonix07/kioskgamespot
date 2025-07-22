const express = require('express');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');


// Restore `console.log` if overridden
console.log = console.log || ((...args) => process.stdout.write(args.join(' ') + '\n'));

const app = express();
const dbPath = path.resolve(__dirname, 'gamespot.db');

// Create uploads directory for photos
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Global error handlers
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err.message, err.stack);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection:', reason);
});

// Initialize database connection with more robust error handling
console.log(`Attempting to connect to database at: ${dbPath}`);
let db;
try {
  db = new sqlite3.Database(dbPath, sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE, (err) => {
    if (err) {
      console.error(`Database connection error: ${err.message}`);
    } else {
      console.log('Connected to the SQLite database.');
    }
  });
} catch (error) {
  console.error(`Failed to create database connection: ${error.message}`);
  db = new sqlite3.Database(':memory:'); // Fallback to memory database
}

// Initialize the database with payments table
function initializeDatabase() {
  console.log("Initializing database...");
  
  // First, ensure the ps5_consoles table exists
  db.run(`CREATE TABLE IF NOT EXISTS ps5_consoles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE,
    booked INTEGER DEFAULT 0,
    end_time INTEGER
  )`, function(err) {
    if (err) {
      return console.error("Error creating ps5_consoles table:", err.message);
    }
    console.log("ps5_consoles table ready.");
    
    // Check if table has any records
    db.get('SELECT COUNT(*) as count FROM ps5_consoles', [], function(err, row) {
      if (err) {
        return console.error("Error checking ps5_consoles count:", err.message);
      }
      
      // Add default consoles if none exist
      if (row && row.count === 0) {
        console.log("Adding default PS5 consoles...");
        const defaultConsoles = ['PS5 #1', 'PS5 #2', 'PS5 #3', 'PS5 #4'];
        defaultConsoles.forEach(name => {
          db.run('INSERT INTO ps5_consoles (name, booked) VALUES (?, 0)', [name], function(err) {
            if (err) console.error(`Error adding console ${name}:`, err.message);
          });
        });
      }
    });
  });
  
  // Ensure payments table exists with all necessary columns including photo_url
  db.run(`CREATE TABLE IF NOT EXISTS payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    console TEXT,
    minutes INTEGER,
    method TEXT,
    user TEXT DEFAULT 'Azonix07',
    paid_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    photo_url TEXT
  )`, function(err) {
    if (err) {
      return console.error("Error creating payments table:", err.message);
    }
    console.log("payments table ready.");
  });
}

// Try to initialize the database tables
initializeDatabase();

app.use(cors());
// Increase JSON size limit for base64 encoded images
app.use(express.json({ limit: '10mb' }));
// Serve the uploaded photos
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Endpoint to get the status of consoles
app.get('/api/status', (req, res) => {
  db.all(
    'SELECT DISTINCT name, booked, end_time FROM ps5_consoles',
    [],
    (err, rows) => {
      if (err) {
        console.error("Error fetching console status:", err.message);
        return res.status(500).json({ error: 'Failed to fetch console status' });
      }
      const consoles = rows.map((row) => {
        const remainingTime =
          row.booked && row.end_time ? Math.max(0, row.end_time - Date.now()) : null;
        return { name: row.name, booked: row.booked, remainingTime };
      });
      res.json(consoles);
    }
  );
});

// Endpoint to book a console
app.post('/api/book', (req, res) => {
  const { console, minutes } = req.body;

  // Validate request data
  if (!console || !minutes || minutes <= 0) {
    console.warn("Invalid booking data:", req.body);
    return res.status(400).json({ error: 'Invalid booking data' });
  }

  const endTime = Date.now() + minutes * 60 * 1000; // Calculate end time in milliseconds

  db.run(
    'UPDATE ps5_consoles SET booked = 1, end_time = ? WHERE name = ? AND booked = 0',
    [endTime, console],
    function (err) {
      if (err) {
        console.error("Database error during booking:", err.message);
        return res.status(500).json({ error: 'Database error occurred' });
      }

      if (this.changes === 0) {
        console.warn(`Console "${console}" is already booked.`);
        return res.status(400).json({ error: 'Console is already booked' });
      }

      console.log(`Console "${console}" booked successfully until ${new Date(endTime).toISOString()}`);
      res.json({ success: true, console, endTime });
    }
  );
});

// Enhanced payment endpoint that accepts and processes photos
app.post('/api/pay', (req, res) => {
  const { console, minutes, method, photoData } = req.body;
  
  console.log('Payment request received:', { console, minutes, method, hasPhoto: !!photoData });
  
  // Convert minutes to a number if it's a string
  const minutesNumber = parseInt(minutes, 10);
  
  // Validate request data with better error messages
  if (!console) {
    console.warn("Missing console in payment data:", req.body);
    return res.status(400).json({ error: 'Missing console name' });
  }
  
  if (!minutes || isNaN(minutesNumber) || minutesNumber <= 0) {
    console.warn("Invalid minutes in payment data:", req.body);
    return res.status(400).json({ error: 'Invalid minutes value' });
  }
  
  if (!method) {
    console.warn("Missing payment method:", req.body);
    return res.status(400).json({ error: 'Missing payment method' });
  }
  
  // Process the photo if provided
  if (photoData && photoData.startsWith('data:image')) {
    try {
      // Extract base64 data
      const base64Data = photoData.replace(/^data:image\/\w+;base64,/, "");
      const buffer = Buffer.from(base64Data, 'base64');
      
      // Create a filename with timestamp to ensure uniqueness
      const filename = `user_${Date.now()}.jpg`;
      const filePath = path.join(uploadsDir, filename);
      
      // Save the image file
      fs.writeFile(filePath, buffer, (err) => {
        if (err) {
          console.error("Error saving photo:", err);
          // Continue without photo if saving fails
          processPayment(console, minutesNumber, method, null, res);
        } else {
          // Process payment with photo URL
          const photoUrl = `/uploads/${filename}`;
          processPayment(console, minutesNumber, method, photoUrl, res);
        }
      });
    } catch (error) {
      console.error("Error processing photo:", error);
      // Continue without photo if processing fails
      processPayment(console, minutesNumber, method, null, res);
    }
  } else {
    // No photo provided, process payment normally
    processPayment(console, minutesNumber, method, null, res);
  }
});

// Helper function to process payment and update database
function processPayment(console, minutes, method, photoUrl, res) {
  // SQL query based on whether photo is available
  const sql = photoUrl 
    ? 'INSERT INTO payments (console, minutes, method, user, photo_url) VALUES (?, ?, ?, ?, ?)'
    : 'INSERT INTO payments (console, minutes, method, user) VALUES (?, ?, ?, ?)';
  
  // Parameters based on whether photo is available
  const params = photoUrl
    ? [console, minutes, method, 'Azonix07', photoUrl]
    : [console, minutes, method, 'Azonix07'];
  
  // Insert payment record
  db.run(sql, params, function(err) {
    if (err) {
      console.error("Database error during payment:", err.message);
      return res.status(500).json({ error: `Database error: ${err.message}` });
    }
    
    console.log(`Payment processed successfully: ID=${this.lastID}, console="${console}", minutes=${minutes}, method="${method}", photo=${photoUrl ? 'Yes' : 'No'}`);
    
    // Book the console
    const endTime = Date.now() + minutes * 60 * 1000;
    
    db.run(
      'UPDATE ps5_consoles SET booked = 1, end_time = ? WHERE name = ?',
      [endTime, console],
      function(err) {
        if (err) {
          console.error("Error updating console status after payment:", err.message);
          // Payment was successful even if booking fails
        } else {
          console.log(`Console "${console}" marked as booked until ${new Date(endTime).toISOString()}`);
        }
        
        // Return success even if booking update failed
        res.json({ 
          success: true,
          message: "Payment processed successfully",
          paymentId: this.lastID,
          timestamp: new Date().toISOString(),
          photoUrl: photoUrl
        });
      }
    );
  });
}

// Enhanced payments endpoint to include photos
app.get('/api/payments', (req, res) => {
  db.all('SELECT id, console, minutes, method, user, paid_at, photo_url FROM payments ORDER BY paid_at DESC', [], (err, rows) => {
    if (err) {
      console.error("Error fetching payments:", err.message);
      return res.status(500).json({ error: 'Failed to fetch payment history' });
    }
    
    // Convert relative URLs to absolute URLs for photos
    const baseUrl = `http://${req.headers.host}`;
    const payments = rows.map(row => ({
      ...row,
      photoUrl: row.photo_url ? `${baseUrl}${row.photo_url}` : null
    }));
    
    res.json(payments);
  });
});

// Endpoint to get system info
app.get('/api/info', (req, res) => {
  const currentDate = new Date().toISOString().slice(0, 19).replace('T', ' ');
  const currentUser = 'Azonix07';
  
  res.json({
    date: currentDate,
    user: currentUser,
    server: {
      uptime: process.uptime(),
      nodeVersion: process.version
    }
  });
});

// Debug endpoint to check database tables
app.get('/api/debug/tables', (req, res) => {
  db.all("SELECT name FROM sqlite_master WHERE type='table'", [], (err, tables) => {
    if (err) return res.status(500).json({ error: err.message });
    
    const tableData = {};
    let completedTables = 0;
    
    if (tables.length === 0) {
      return res.json({ tables: [] });
    }
    
    tables.forEach(table => {
      db.all(`PRAGMA table_info(${table.name})`, [], (err, columns) => {
        if (err) {
          tableData[table.name] = { error: err.message };
        } else {
          tableData[table.name] = { columns };
        }
        
        completedTables++;
        if (completedTables === tables.length) {
          res.json({ 
            tables: tables.map(t => t.name),
            schema: tableData 
          });
        }
      });
    });
  });
});

// Reset endpoint to clear all bookings (for admin use)
app.post('/api/reset', (req, res) => {
  try {
    db.run('UPDATE ps5_consoles SET booked = 0, end_time = NULL', function(err) {
      if (err) {
        console.error("Error resetting console bookings:", err.message);
        return res.status(500).json({ error: 'Failed to reset bookings' });
      }
      
      console.log(`All console bookings reset by Azonix07 at ${new Date().toISOString()}`);
      res.json({ success: true, message: 'All bookings have been reset' });
    });
  } catch (error) {
    console.error("Unexpected error in /api/reset:", error);
    res.status(500).json({ error: 'An unexpected error occurred' });
  }
});

// Endpoint to reset a single console
app.post('/api/reset-single', (req, res) => {
  try {
    const { console: consoleName } = req.body;
    
    if (!consoleName) {
      return res.status(400).json({ error: 'Missing console name' });
    }
    
    // Update the specific console's booking status
    db.run(
      'UPDATE ps5_consoles SET booked = 0, end_time = NULL WHERE name = ?',
      [consoleName],
      function(err) {
        if (err) {
          console.error("Error resetting console booking:", err.message);
          return res.status(500).json({ error: 'Failed to reset booking' });
        }
        
        if (this.changes === 0) {
          return res.status(404).json({ error: 'Console not found' });
        }
        
        console.log(`Console ${consoleName} booking reset by Azonix07 at ${new Date().toISOString()}`);
        res.json({ success: true, message: `Booking for ${consoleName} has been reset` });
      }
    );
  } catch (error) {
    console.error("Unexpected error in /api/reset-single:", error);
    res.status(500).json({ error: 'An unexpected error occurred' });
  }
});

// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  const now = new Date().toISOString();
  console.log(`🚀 Backend running at http://localhost:${PORT} (${now})`);
  console.log(`Current User: Azonix07`);
});