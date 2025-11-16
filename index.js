// ==========================
// ⭐ REQUIRED IMPORTS
// ==========================
const express = require("express");
const cors = require("cors");
const { Pool } = require("pg");
const bcrypt = require("bcrypt");

const app = express();

// ==========================
// ⭐ CORS (ALLOW NETLIFY FRONTEND)
// ==========================
app.use(cors({
  origin: "https://collegerideshare.netlify.app",
  methods: "GET,POST,PUT,DELETE",
  credentials: true
}));

// Middleware
app.use(express.json());

// ==========================
// ⭐ POSTGRESQL CONNECTION
// ==========================
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

pool.connect()
  .then(() => console.log("✅ PostgreSQL Connected"))
  .catch(err => console.error("❌ DB Connection Error:", err));

// ==========================
// ⭐ TEST ROUTE
// ==========================
app.get("/test-db", async (req, res) => {
  try {
    const result = await pool.query("SELECT NOW()");
    res.send("DB OK: " + result.rows[0].now);
  } catch (err) {
    res.status(500).send("DB ERROR: " + err.message);
  }
});

// ==========================
// ⭐ REGISTRATION
// ==========================
app.post('/register', async (req, res) => {
  try {
    const { studentId, fullName, phoneNumber, email, password } = req.body;

    if (!studentId || !fullName || !phoneNumber || !email || !password) {
      return res.json({ success: false, error: 'All fields are required' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    await pool.query(
      `INSERT INTO users (student_id, full_name, phone, email, password)
       VALUES ($1, $2, $3, $4, $5)`,
      [studentId, fullName, phoneNumber, email, hashedPassword]
    );

    res.json({ success: true, message: 'Registration successful!' });
  } catch (err) {
    if (err.code === '23505') {
      res.json({ success: false, error: 'Student ID or Email already exists' });
    } else {
      res.json({ success: false, error: err.message });
    }
  }
});

// ==========================
// ⭐ LOGIN
// ==========================
app.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.json({ success: false, error: 'Email and password are required' });
    }

    const result = await pool.query(
      `SELECT student_id, full_name, phone, email, password
       FROM users WHERE email = $1`,
      [email]
    );

    if (result.rows.length === 0) {
      return res.json({ success: false, error: 'Invalid email or password' });
    }

    const user = result.rows[0];
    const isValid = await bcrypt.compare(password, user.password);

    if (!isValid) {
      return res.json({ success: false, error: 'Invalid email or password' });
    }

    res.json({
      success: true,
      message: 'Login successful!',
      user: {
        studentId: user.student_id,
        fullName: user.full_name,
        phoneNumber: user.phone,
        email: user.email
      },
    });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

// ==========================
// ⭐ POST RIDE
// ==========================
app.post('/post-ride', async (req, res) => {
  try {
    const {
      riderName, phoneNo, source, destination, leaveDate, leaveTime,
      seatsAvailable, note, studentId
    } = req.body;

    if (!riderName || !phoneNo || !source || !destination ||
        !leaveDate || !leaveTime || !seatsAvailable || !studentId) {
      return res.json({ success: false, error: 'Missing required ride fields' });
    }

    await pool.query(
      `INSERT INTO rides (student_id, rider_name, phone, source, destination,
       ride_date, time_to_leave, seats_available, note, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())`,
      [studentId, riderName, phoneNo, source, destination, leaveDate, leaveTime, seatsAvailable, note]
    );

    res.json({ success: true, message: "Ride posted successfully" });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

// ==========================
// ⭐ SEARCH RIDES
// ==========================
app.get('/search-rides', async (req, res) => {
  const destination = req.query.destination || '';
  const searchDate = req.query.date;

  try {
    if (!searchDate) {
      return res.json({ rides: [], error: 'Date is required' });
    }

    const result = await pool.query(
      `SELECT ride_id, rider_name, phone, source, destination, ride_date,
              time_to_leave, seats_available, note 
       FROM rides 
       WHERE destination ILIKE $1
         AND ride_date = $2
         AND seats_available > 0
       ORDER BY time_to_leave`,
      [`%${destination}%`, searchDate]
    );

    res.json({ rides: result.rows });
  } catch (err) {
    res.json({ rides: [], error: err.message });
  }
});

// ==========================
// ⭐ CONFIRM BOOKING
// ==========================
app.post('/confirm-booking', async (req, res) => {
  try {
    const { rideId, seaterName, seaterPhone, seaterStudentId, destination, rideDate, rideTime } = req.body;

    if (!rideId || !seaterName || !seaterPhone || !seaterStudentId) {
      return res.json({ success: false, error: 'Missing booking information' });
    }

    await pool.query(
      `INSERT INTO bookings (ride_id, seater_student_id, seater_name, seater_phone, destination,
       ride_date, ride_time, booking_time, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), 'pending')`,
      [rideId, seaterStudentId, seaterName, seaterPhone, destination, rideDate, rideTime]
    );

    res.json({ success: true, message: 'Booking request sent! Waiting for rider approval.' });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

// ==========================
// ⭐ RIDER BOOKINGS (UPDATED)
// ==========================
app.get('/rider-bookings', async (req, res) => {
  const studentId = req.query.studentId;
  try {
    if (!studentId) {
      return res.json({ bookings: [], error: 'Student ID required' });
    }
    const result = await pool.query(
      `SELECT b.booking_id, b.seater_name, b.seater_phone, b.destination,
              b.ride_date, b.ride_time, b.booking_time, b.status
       FROM bookings b
       JOIN rides r ON b.ride_id = r.ride_id
       WHERE r.student_id = $1
       ORDER BY b.booking_time DESC`,
      [studentId]
    );
    // Format the fields so frontend never gets undefined fields
    const bookings = result.rows.map(row => ({
      bookingId: row.booking_id,
      seaterName: row.seater_name,
      seaterPhone: row.seater_phone,
      destination: row.destination,
      rideDate: row.ride_date ? new Date(row.ride_date).toISOString().split('T')[0] : '',
      rideTime: row.ride_time || '',
      bookingTime: row.booking_time ? new Date(row.booking_time).toISOString() : '',
      status: row.status
    }));
    res.json({ bookings });
  } catch (err) {
    res.json({ bookings: [], error: err.message });
  }
});

// ==========================
// ⭐ ACCEPT BOOKING
// ==========================
app.post('/accept-booking', async (req, res) => {
  const client = await pool.connect();
  try {
    const { bookingId } = req.body;

    if (!bookingId) {
      return res.json({ success: false, error: 'Booking ID required' });
    }

    await client.query('BEGIN');

    const booking = await client.query(
      `SELECT ride_id FROM bookings WHERE booking_id = $1`,
      [bookingId]
    );

    if (booking.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.json({ success: false, error: 'Booking not found' });
    }

    const rideId = booking.rows[0].ride_id;

    await client.query(
      `UPDATE bookings SET status = 'accepted' WHERE booking_id = $1`,
      [bookingId]
    );

    await client.query(
      `UPDATE rides SET seats_available = seats_available - 1 WHERE ride_id = $1`,
      [rideId]
    );

    await client.query('COMMIT');

    res.json({ success: true, message: 'Booking accepted!' });
  } catch (err) {
    await client.query('ROLLBACK');
    res.json({ success: false, error: err.message });
  } finally {
    client.release();
  }
});

// ==========================
// ⭐ REJECT BOOKING
// ==========================
app.post('/reject-booking', async (req, res) => {
  try {
    const { bookingId } = req.body;

    if (!bookingId) {
      return res.json({ success: false, error: 'Booking ID required' });
    }

    await pool.query(
      `UPDATE bookings SET status = 'rejected' WHERE booking_id = $1`,
      [bookingId]
    );

    res.json({ success: true, message: 'Booking rejected!' });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

// ==========================
// ⭐ CANCEL BOOKING
// ==========================
app.post('/cancel-booking', async (req, res) => {
  const client = await pool.connect();
  try {
    const { bookingId } = req.body;

    if (!bookingId) {
      return res.json({ success: false, error: 'Booking ID required' });
    }

    await client.query('BEGIN');

    const booking = await client.query(
      `SELECT ride_id, status FROM bookings WHERE booking_id = $1`,
      [bookingId]
    );

    if (booking.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.json({ success: false, error: 'Booking not found' });
    }

    const { ride_id: rideId, status } = booking.rows[0];

    await client.query(
      `DELETE FROM bookings WHERE booking_id = $1`,
      [bookingId]
    );

    if (status === 'accepted') {
      await client.query(
        `UPDATE rides SET seats_available = seats_available + 1 WHERE ride_id = $1`,
        [rideId]
      );
    }

    await client.query('COMMIT');

    res.json({ success: true, message: 'Booking cancelled successfully!' });
  } catch (err) {
    await client.query('ROLLBACK');
    res.json({ success: false, error: err.message });
  } finally {
    client.release();
  }
});

// ==========================
// ⭐ SEATER BOOKINGS (UPDATED)
// ==========================
app.get('/seater-bookings', async (req, res) => {
  const studentId = req.query.studentId;
  try {
    if (!studentId) {
      return res.json({ bookings: [], error: 'Student ID required' });
    }
    const result = await pool.query(
      `SELECT b.booking_id, r.rider_name, r.phone as rider_phone, b.destination,
              b.ride_date, b.ride_time, b.booking_time, b.status, r.source
       FROM bookings b
       JOIN rides r ON b.ride_id = r.ride_id
       WHERE b.seater_student_id = $1
       ORDER BY b.booking_time DESC`,
      [studentId]
    );
    // Proper field mapping
    const bookings = result.rows.map(row => ({
      bookingId: row.booking_id,
      riderName: row.rider_name,
      riderPhone: row.rider_phone,
      destination: row.destination,
      rideDate: row.ride_date ? new Date(row.ride_date).toISOString().split('T')[0] : '',
      rideTime: row.ride_time || '',
      bookingTime: row.booking_time ? new Date(row.booking_time).toISOString() : '',
      status: row.status,
      source: row.source
    }));
    res.json({ bookings });
  } catch (err) {
    res.json({ bookings: [], error: err.message });
  }
});

// ==========================
// ⭐ START SERVER
// ==========================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});

