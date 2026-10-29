require('dotenv').config();
const express = require('express');
const cors    = require('cors');

const authRoutes        = require('./routes/authRoutes');
const customerRoutes    = require('./routes/customerRoutes');
const accountRoutes     = require('./routes/accountRoutes');
const transactionRoutes = require('./routes/transactionRoutes');
const beneficiaryRoutes = require('./routes/beneficiaryRoutes');
const adminRoutes       = require('./routes/adminRoutes');
const errorHandler      = require('./middleware/errorHandler');

const app  = express();
const PORT = process.env.PORT || 5000;

// ── Middleware ──────────────────────────────────────────────────────────────
app.use(cors({
  origin: ['http://localhost:5173', 'http://localhost:3000'],
  credentials: true,
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Request logger
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
});

// ── Routes ──────────────────────────────────────────────────────────────────
app.use('/api/auth',         authRoutes);
app.use('/api/customers',    customerRoutes);
app.use('/api/accounts',     accountRoutes);
app.use('/api/transactions', transactionRoutes);
app.use('/api/beneficiaries',beneficiaryRoutes);
app.use('/api/admin',        adminRoutes);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', service: 'Mini Banking API', timestamp: new Date().toISOString() });
});

// 404
app.use((req, res) => {
  res.status(404).json({ error: `Route ${req.method} ${req.path} not found` });
});

// Global error handler
app.use(errorHandler);

// ── Start ───────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`🚀  Mini Banking API listening on http://localhost:${PORT}`);
  console.log(`📡  Health: http://localhost:${PORT}/api/health`);
});

module.exports = app;
