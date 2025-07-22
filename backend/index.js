const express = require('express');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');

// Restore `console.log` if overridden
console.log = console.log || ((...args) => process.stdout.write(args.join(' ') + '\n'));

const app = express();
const PORT = process.env.PORT || 3000;
const dbPath = path.resolve(__dirname, 'gamespot.db');

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
        const defaultConsoles = ['PS5 #1', 'PS5 #2', 'PS5 #3', 'PS5 #4', 'Logitech G920'];
        defaultConsoles.forEach(name => {
          db.run('INSERT INTO ps5_consoles (name, booked) VALUES (?, 0)', [name], function(err) {
            if (err) console.error(`Error adding console ${name}:`, err.message);
          });
        });
      }
    });
  });
  
  // First, ensure the basic payments table exists
  db.run(`CREATE TABLE IF NOT EXISTS payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    console TEXT,
    minutes INTEGER,
    method TEXT,
    user TEXT DEFAULT 'Azonix07',
    paid_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`, function(err) {
    if (err) {
      return console.error("Error creating payments table:", err.message);
    }
    console.log("Basic payments table ready.");
    
    // Now check if the photo_data column exists in the payments table
    db.all("PRAGMA table_info(payments)", [], function(err, columns) {
      if (err) {
        return console.error("Error checking payments table columns:", err.message);
      }
      
      // Look for photo_data column
      const hasPhotoData = columns.some(col => col.name === 'photo_data');
      
      if (!hasPhotoData) {
        // Add photo_data column to existing table
        console.log("Adding photo_data column to payments table");
        db.run("ALTER TABLE payments ADD COLUMN photo_data TEXT", function(err) {
          if (err) {
            console.error("Error adding photo_data column:", err.message);
          } else {
            console.log("photo_data column added successfully");
          }
        });
      } else {
        console.log("photo_data column already exists in payments table");
      }
    });
  });
}

// Helper function to ensure base64 data is properly formatted as a data URL
function ensureDataUrlFormat(photoData) {
  if (!photoData) return null;
  
  // If it's already a valid data URL, return it as is
  if (photoData.startsWith('data:image')) {
    return photoData;
  }
  
  // Otherwise, assume it's a raw base64 string and add the prefix
  return `data:image/jpeg;base64,${photoData}`;
}

// Try to initialize the database tables
initializeDatabase();

app.use(cors());
// Increase JSON size limit for base64 encoded images
app.use(express.json({ limit: '20mb' }));

// First try to serve from parent frontend directory
const parentFrontendDir = path.join(__dirname, '..', 'frontend');
if (fs.existsSync(parentFrontendDir)) {
  console.log(`Serving frontend files from parent directory: ${parentFrontendDir}`);
  app.use(express.static(parentFrontendDir));
}

// Then try original frontend directory inside backend
const localFrontendDir = path.join(__dirname, 'frontend');
if (fs.existsSync(localFrontendDir)) {
  console.log(`Serving frontend files from local directory: ${localFrontendDir}`);
  app.use(express.static(localFrontendDir));
}

// Then serve static files from public directory as a fallback
const publicDir = path.join(__dirname, 'public');
if (fs.existsSync(publicDir)) {
  console.log(`Serving public files as fallback from: ${publicDir}`);
  app.use(express.static(publicDir));
}

// Log all API requests
app.use('/api', (req, res, next) => {
  console.log(`API Request: ${req.method} ${req.url}`);
  next();
});

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

// Enhanced payment endpoint that stores photo as Base64
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
  
  // Make sure photoData is properly formatted before storing
  let formattedPhotoData = null;
  if (photoData) {
    formattedPhotoData = ensureDataUrlFormat(photoData);
  }
  
  // Process payment with the properly formatted photoData
  processPaymentWithBase64(console, minutesNumber, method, formattedPhotoData, res);
});

// Helper function to process payment and update database with Base64 photo
function processPaymentWithBase64(console, minutes, method, photoData, res) {
  // Check if photo_data column exists first
  db.get("PRAGMA table_info(payments)", [], function(err, columns) {
    if (err) {
      console.error("Error checking table info:", err.message);
      return res.status(500).json({ error: `Database error: ${err.message}` });
    }
    
    // Set up the SQL based on whether photo_data column exists
    let sql, params;
    
    // Check if columns is an array with items
    if (Array.isArray(columns) && columns.some(col => col.name === 'photo_data')) {
      // Photo_data column exists, use it
      sql = 'INSERT INTO payments (console, minutes, method, user, photo_data) VALUES (?, ?, ?, ?, ?)';
      params = [console, minutes, method, 'Azonix07', photoData || null];
    } else {
      // Fall back to not using photo_data
      sql = 'INSERT INTO payments (console, minutes, method, user) VALUES (?, ?, ?, ?)';
      params = [console, minutes, method, 'Azonix07'];
    }
    
    // Insert payment record
    db.run(sql, params, function(err) {
      if (err) {
        console.error("Database error during payment:", err.message);
        return res.status(500).json({ error: `Database error: ${err.message}` });
      }
      
      console.log(`Payment processed successfully: ID=${this.lastID}, console="${console}", minutes=${minutes}, method="${method}", photo=${photoData ? 'Yes' : 'No'}`);
      
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
            photoUrl: photoData ? true : false
          });
        }
      );
    });
  });
}

// Enhanced payments endpoint with compatibility for both photoData and photoUrl
app.get('/api/payments', (req, res) => {
  // First check if photo_data column exists
  db.all("PRAGMA table_info(payments)", [], function(err, columns) {
    if (err) {
      console.error("Error checking table info:", err.message);
      return res.status(500).json({ error: 'Failed to check payments table schema' });
    }
    
    // Check if photo_data column exists
    const hasPhotoData = Array.isArray(columns) && columns.some(col => col.name === 'photo_data');
    
    // Choose the appropriate query based on schema
    const query = hasPhotoData 
      ? 'SELECT id, console, minutes, method, user, paid_at, photo_data FROM payments ORDER BY paid_at DESC'
      : 'SELECT id, console, minutes, method, user, paid_at FROM payments ORDER BY paid_at DESC';
    
    db.all(query, [], (err, rows) => {
      if (err) {
        console.error("Error fetching payments:", err.message);
        return res.status(500).json({ error: 'Failed to fetch payment history' });
      }
      
      const payments = rows.map(row => {
        // Format the photo data if it exists
        const formattedPhotoData = row.photo_data ? ensureDataUrlFormat(row.photo_data) : null;
        
        return {
          ...row,
          // Return both photoUrl and photoData for compatibility
          photoUrl: formattedPhotoData,
          photoData: formattedPhotoData
        };
      });
      
      res.json(payments);
    });
  });
});

// Endpoint to get system info
app.get('/api/info', (req, res) => {
  // Updated timestamp
  const currentDate = "2025-07-22 17:53:51";
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

// Debug endpoint to check database tables and schema
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

// Serve index.html for client-side routing
app.use((req, res, next) => {
  // Skip API routes, static files, and files with extensions
  if (req.path.startsWith('/api') || req.path.indexOf('.') !== -1) {
    return next();
  }
  
  try {
    // Try parent frontend directory first
    const parentFrontendIndexPath = path.join(__dirname, '..', 'frontend', 'index.html');
    if (fs.existsSync(parentFrontendIndexPath)) {
      return res.sendFile(parentFrontendIndexPath);
    }
    
    // Try local frontend directory next
    const localFrontendIndexPath = path.join(__dirname, 'frontend', 'index.html');
    if (fs.existsSync(localFrontendIndexPath)) {
      return res.sendFile(localFrontendIndexPath);
    }
    
    // Fall back to public directory
    const publicIndexPath = path.join(__dirname, 'public', 'index.html');
    if (fs.existsSync(publicIndexPath)) {
      return res.sendFile(publicIndexPath);
    }
    
    // If none of these exist, return a 404
    res.status(404).send('Cannot find application entry point (index.html)');
  } catch (error) {
    console.error("Error serving index.html:", error);
    res.status(500).send('Server error when trying to serve the application');
  }
});

// Start the server
app.listen(PORT, () => {
  // Updated timestamp
  console.log(`Current Date and Time (UTC - YYYY-MM-DD HH:MM:SS formatted): 2025-07-22 17:53:51`);
  console.log(`Current User's Login: Azonix07`);
  console.log(`🚀 Unified server running on port ${PORT}`);
  console.log(`API endpoints available at http://localhost:${PORT}/api`);
  console.log(`Frontend served from http://localhost:${PORT}`);
});