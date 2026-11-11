import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  Activity,
  HeartPulse,
  Calendar,
  Trash2,
  Edit2,
  TrendingUp,
  BarChart2,
  LogOut,
  X,
  AlertCircle,
  CheckCircle,
  Clock,
  Layers
} from 'lucide-react';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid
} from 'recharts';
import api from './api';

const TIME_SLOTS = [
  { value: 'morning', label: 'Morning (fasting)' },
  { value: 'after_breakfast', label: 'After breakfast' },
  { value: 'after_lunch', label: 'After lunch' },
  { value: 'after_dinner', label: 'After dinner' }
];

function getTodayString() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default function App() {
  const [token, setToken] = useState(localStorage.getItem('sweety_token'));
  const [user, setUser] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem('sweety_user')) || null;
    } catch {
      return null;
    }
  });

  const [activeTab, setActiveTab] = useState('dashboard'); // 'dashboard' | 'history' | 'reports'

  // Auth form state
  const [authMode, setAuthMode] = useState('login'); // 'login' | 'register'
  const [authForm, setAuthForm] = useState({ name: '', email: '', password: '' });
  const [authBusy, setAuthBusy] = useState(false);

  // Selected date for dashboard/reports
  const [selectedDate, setSelectedDate] = useState(getTodayString());

  // Data states
  const [readings, setReadings] = useState([]);
  const [dailyReport, setDailyReport] = useState(null);
  const [mtdReport, setMtdReport] = useState(null);
  const [prevMonthReport, setPrevMonthReport] = useState(null);
  const [dataLoading, setDataLoading] = useState(false);

  // History filter
  const [slotFilter, setSlotFilter] = useState('all');

  // Entry Form state
  const [entryForm, setEntryForm] = useState({
    date: getTodayString(),
    slot: 'morning',
    value: ''
  });
  const [editingId, setEditingId] = useState(null);
  const [formBusy, setFormBusy] = useState(false);

  // Feedback states
  const [errorMessage, setErrorMessage] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [deleteModalItem, setDeleteModalItem] = useState(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  const formRef = useRef(null);

  // Auto-dismiss success message
  useEffect(() => {
    if (successMessage) {
      const timer = setTimeout(() => setSuccessMessage(''), 3500);
      return () => clearTimeout(timer);
    }
  }, [successMessage]);

  const handleLogout = () => {
    const todayStr = getTodayString();
    localStorage.removeItem('sweety_token');
    localStorage.removeItem('sweety_user');
    setToken(null);
    setUser(null);
    setActiveTab('dashboard');
    setSlotFilter('all');
    setSelectedDate(todayStr);
    setReadings([]);
    setDailyReport(null);
    setMtdReport(null);
    setPrevMonthReport(null);
    setEditingId(null);
    setDeleteModalItem(null);
    setEntryForm({ date: todayStr, slot: 'morning', value: '' });
    setAuthMode('login');
    setAuthForm({ name: '', email: '', password: '' });
    setErrorMessage('');
    setSuccessMessage('');
  };

  // Load Dashboard Data
  const loadDashboardData = async (date) => {
    if (!token) return;
    setDataLoading(true);
    try {
      const [readingsRes, dailyRes, mtdRes, prevRes] = await Promise.all([
        api.get('/readings', { params: { limit: 200 } }),
        api.get('/reports/daily', { params: { date } }),
        api.get('/reports/month-to-date', { params: { date } }),
        api.get('/reports/previous-month', { params: { date } })
      ]);

      setReadings(readingsRes.data || []);
      setDailyReport(dailyRes.data || null);
      setMtdReport(mtdRes.data || null);
      setPrevMonthReport(prevRes.data || null);
    } catch (err) {
      if (err.response?.status === 401) {
        handleLogout();
      } else {
        setErrorMessage(err.response?.data?.error || 'Failed to load dashboard data.');
      }
    } finally {
      setDataLoading(false);
    }
  };

  useEffect(() => {
    if (token) {
      loadDashboardData(selectedDate);
    }
  }, [token, selectedDate]);

  // Auth Validation & Submit
  const validateAuthClientSide = () => {
    if (authMode === 'register' && !authForm.name.trim()) {
      return 'Please enter your name.';
    }
    if (!authForm.email.trim()) {
      return 'Please enter your email address.';
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(authForm.email.trim())) {
      return 'Please enter a valid email address.';
    }
    if (!authForm.password) {
      return 'Please enter a password.';
    }
    if (authMode === 'register' && authForm.password.length < 8) {
      return 'Password must be at least 8 characters.';
    }
    return null;
  };

  const handleAuthSubmit = async (e) => {
    e.preventDefault();
    setErrorMessage('');

    const authErr = validateAuthClientSide();
    if (authErr) {
      setErrorMessage(authErr);
      return;
    }

    setAuthBusy(true);
    try {
      const endpoint = authMode === 'login' ? '/auth/login' : '/auth/register';
      const payload = authMode === 'login'
        ? { email: authForm.email.trim(), password: authForm.password }
        : { name: authForm.name.trim(), email: authForm.email.trim(), password: authForm.password };

      const res = await api.post(endpoint, payload);
      const { user: authedUser, token: authToken } = res.data;

      localStorage.setItem('sweety_token', authToken);
      localStorage.setItem('sweety_user', JSON.stringify(authedUser));
      setToken(authToken);
      setUser(authedUser);
      setActiveTab('dashboard');
      setAuthForm({ name: '', email: '', password: '' });
      setSuccessMessage(`Welcome, ${authedUser.name}!`);
    } catch (err) {
      setErrorMessage(err.response?.data?.error || 'Authentication failed. Please try again.');
    } finally {
      setAuthBusy(false);
    }
  };

  // Reading Form Client Validation
  const validateFormClientSide = () => {
    const rawVal = entryForm.value;
    if (rawVal === undefined || rawVal === null || String(rawVal).trim() === '') {
      return 'Please enter a glucose value.';
    }

    const trimmed = String(rawVal).trim();
    if (!/^-?\d+$/.test(trimmed)) {
      return 'Value must be between 40 and 600 mg/dl.';
    }

    const num = Number(trimmed);
    if (!Number.isInteger(num) || num < 40 || num > 600) {
      return 'Value must be between 40 and 600 mg/dl.';
    }

    if (!entryForm.date) {
      return 'Please enter a valid date.';
    }

    const todayStr = getTodayString();
    if (entryForm.date > todayStr) {
      return 'Date cannot be in the future.';
    }

    const existingOnDate = readings.filter(r => r.date === entryForm.date && r.id !== editingId);
    if (existingOnDate.length >= 4) {
      return 'You can add only 4 readings per day.';
    }

    const slotLabelObj = TIME_SLOTS.find(s => s.value === entryForm.slot);
    const slotLabel = slotLabelObj ? slotLabelObj.label : entryForm.slot;
    const article = /^[aeiou]/i.test(slotLabel) ? 'an' : 'a';

    const duplicate = existingOnDate.find(r => r.slot === entryForm.slot);
    if (duplicate) {
      return `You already have ${article} ${slotLabel} reading for this date.`;
    }

    return null;
  };

  // Save Reading (Add or Edit)
  const handleSaveReading = async (e) => {
    e.preventDefault();
    setErrorMessage('');

    const validationErr = validateFormClientSide();
    if (validationErr) {
      setErrorMessage(validationErr);
      return;
    }

    setFormBusy(true);
    try {
      const payload = {
        date: entryForm.date,
        slot: entryForm.slot,
        value: Number(String(entryForm.value).trim())
      };

      if (editingId) {
        await api.put(`/readings/${editingId}`, payload);
        setSuccessMessage('Reading updated successfully!');
      } else {
        await api.post('/readings', payload);
        setSuccessMessage('Reading added successfully!');
      }

      setEditingId(null);
      setEntryForm({
        date: selectedDate,
        slot: 'morning',
        value: ''
      });

      await loadDashboardData(selectedDate);
    } catch (err) {
      setErrorMessage(err.response?.data?.error || 'Could not save reading.');
    } finally {
      setFormBusy(false);
    }
  };

  // Start Editing
  const handleStartEdit = (reading) => {
    setEditingId(reading.id);
    setEntryForm({
      date: reading.date,
      slot: reading.slot,
      value: String(reading.value)
    });
    setErrorMessage('');
    if (formRef.current) {
      formRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  // Cancel Editing
  const handleCancelEdit = () => {
    setEditingId(null);
    setEntryForm({
      date: selectedDate,
      slot: 'morning',
      value: ''
    });
    setErrorMessage('');
  };

  // Delete Reading
  const confirmDeleteReading = async () => {
    if (!deleteModalItem) return;
    setDeleteBusy(true);
    try {
      await api.delete(`/readings/${deleteModalItem.id}`);
      setSuccessMessage('Reading deleted successfully.');
      if (editingId === deleteModalItem.id) {
        setEditingId(null);
        setEntryForm({ date: selectedDate, slot: 'morning', value: '' });
      }
      setDeleteModalItem(null);
      await loadDashboardData(selectedDate);
    } catch (err) {
      setErrorMessage(err.response?.data?.error || 'Could not delete reading.');
    } finally {
      setDeleteBusy(false);
    }
  };

  // Filtered readings for history
  const filteredHistory = useMemo(() => {
    if (slotFilter === 'all') return readings;
    return readings.filter(r => r.slot === slotFilter);
  }, [readings, slotFilter]);

  // Trend chart data for selected month
  const chartData = useMemo(() => {
    const selectedMonth = selectedDate.slice(0, 7);
    return readings
      .filter(r => r.date?.slice(0, 7) === selectedMonth)
      .slice()
      .reverse()
      .map(r => ({
        day: `${r.date.slice(8)} (${(TIME_SLOTS.find(s => s.value === r.slot)?.label || r.slot).split(' ')[0]})`,
        date: r.date,
        value: r.value,
        slot: TIME_SLOTS.find(s => s.value === r.slot)?.label || r.slot
      }));
  }, [readings, selectedDate]);

  // Auth screen
  if (!token) {
    return (
      <div className="auth-container">
        <div className="auth-card">
          <div className="brand-header">
            <div className="brand-icon-box">
              <HeartPulse size={26} />
            </div>
            <div>
              <p className="brand-subtitle">Health &amp; Glucose Journal</p>
              <h2 className="brand-title">Sweety Tracker</h2>
            </div>
          </div>

          <h1>{authMode === 'login' ? 'Welcome Back' : 'Create an Account'}</h1>
          <p className="auth-desc">
            {authMode === 'login'
              ? 'Log in to securely track and view your blood glucose readings.'
              : 'Join Sweety to manage your personal glucose logs and reports.'}
          </p>

          {errorMessage && (
            <div className="alert-banner error" role="alert">
              <span>{errorMessage}</span>
              <button className="alert-close" onClick={() => setErrorMessage('')} aria-label="Dismiss error">
                <X size={16} />
              </button>
            </div>
          )}

          {successMessage && (
            <div className="alert-banner success" role="status">
              <span>{successMessage}</span>
              <button className="alert-close" onClick={() => setSuccessMessage('')} aria-label="Dismiss message">
                <X size={16} />
              </button>
            </div>
          )}

          <form onSubmit={handleAuthSubmit} noValidate>
            {authMode === 'register' && (
              <div className="form-group">
                <label className="form-label" htmlFor="register-name">Full Name</label>
                <input
                  id="register-name"
                  type="text"
                  required
                  className="form-input"
                  placeholder="e.g. Sarah Jenkins"
                  value={authForm.name}
                  onChange={(e) => setAuthForm({ ...authForm, name: e.target.value })}
                />
              </div>
            )}

            <div className="form-group">
              <label className="form-label" htmlFor="auth-email">Email Address</label>
              <input
                id="auth-email"
                type="email"
                required
                className="form-input"
                placeholder="you@domain.com"
                value={authForm.email}
                onChange={(e) => setAuthForm({ ...authForm, email: e.target.value })}
              />
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="auth-password">Password</label>
              <input
                id="auth-password"
                type="password"
                minLength={8}
                required
                className="form-input"
                placeholder="At least 8 characters"
                value={authForm.password}
                onChange={(e) => setAuthForm({ ...authForm, password: e.target.value })}
              />
            </div>

            <button type="submit" className="btn btn-primary btn-full" disabled={authBusy}>
              {authBusy ? 'Please wait…' : authMode === 'login' ? 'Sign In' : 'Create Account'}
            </button>
          </form>

          <div style={{ marginTop: '20px', textAlign: 'center', fontSize: '13px' }}>
            {authMode === 'login' ? (
              <p>
                Don&apos;t have an account?{' '}
                <button
                  type="button"
                  style={{ background: 'none', border: 'none', color: '#2563eb', fontWeight: 'bold' }}
                  onClick={() => {
                    setAuthMode('register');
                    setErrorMessage('');
                  }}
                >
                  Sign up
                </button>
              </p>
            ) : (
              <p>
                Already have an account?{' '}
                <button
                  type="button"
                  style={{ background: 'none', border: 'none', color: '#2563eb', fontWeight: 'bold' }}
                  onClick={() => {
                    setAuthMode('login');
                    setErrorMessage('');
                  }}
                >
                  Log in
                </button>
              </p>
            )}
          </div>

          <div style={{ marginTop: '20px', paddingTop: '14px', borderTop: '1px solid #e2e8f0', textAlign: 'center' }}>
            <p style={{ fontSize: '12px', color: '#64748b' }}>
              For local evaluation, seed the database with <code>npm run seed</code> (see README for demo credentials).
            </p>
          </div>
        </div>
      </div>
    );
  }

  // Authenticated Dashboard
  return (
    <div className="app-container">
      {/* Desktop Sidebar */}
      <aside className="app-sidebar">
        <div className="sidebar-brand">
          <div className="brand-icon-box">
            <HeartPulse size={22} />
          </div>
          <div>
            <div style={{ fontSize: '11px', color: '#0d9488', fontWeight: 700, letterSpacing: '0.8px' }}>HEALTH SUITE</div>
            <div style={{ fontSize: '17px', fontWeight: 800, color: '#0f172a' }}>Sweety</div>
          </div>
        </div>

        <nav className="sidebar-nav" aria-label="Main Navigation">
          <div className="nav-heading">Main Navigation</div>
          <button
            type="button"
            className={`nav-link ${activeTab === 'dashboard' ? 'active' : ''}`}
            onClick={() => setActiveTab('dashboard')}
          >
            <Activity size={18} />
            <span>Dashboard</span>
          </button>
          <button
            type="button"
            className={`nav-link ${activeTab === 'history' ? 'active' : ''}`}
            onClick={() => setActiveTab('history')}
          >
            <Layers size={18} />
            <span>Readings History</span>
          </button>
          <button
            type="button"
            className={`nav-link ${activeTab === 'reports' ? 'active' : ''}`}
            onClick={() => setActiveTab('reports')}
          >
            <BarChart2 size={18} />
            <span>Analytics &amp; Reports</span>
          </button>
        </nav>

        <div className="sidebar-footer">
          <div className="user-profile">
            <div className="user-avatar">
              {user?.name?.[0]?.toUpperCase() || 'U'}
            </div>
            <div className="user-meta">
              <div className="user-name">{user?.name || 'User'}</div>
              <div className="user-email">{user?.email}</div>
            </div>
            <button type="button" className="btn-icon" onClick={handleLogout} title="Log Out" aria-label="Log Out">
              <LogOut size={16} />
            </button>
          </div>
        </div>
      </aside>

      {/* Mobile Top Navbar */}
      <header className="mobile-navbar">
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div className="brand-icon-box" style={{ width: '32px', height: '32px' }}>
            <HeartPulse size={18} />
          </div>
          <span style={{ fontWeight: 800, fontSize: '18px' }}>Sweety</span>
        </div>
        <button type="button" className="btn-icon" onClick={handleLogout} title="Log Out" aria-label="Log Out">
          <LogOut size={18} />
        </button>
      </header>

      {/* Main Content */}
      <main className="app-main">
        {/* Header with Greetings & Date Picker */}
        <div className="main-header">
          <div className="header-title-box">
            <h1>Welcome, {user?.name?.split(' ')[0] || 'User'}</h1>
            <p>Monitor your blood glucose entries and health summaries.</p>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
            {dataLoading && (
              <div className="loading-indicator" role="status" aria-live="polite">
                <span className="spinner" aria-hidden="true" />
                <span>Syncing…</span>
              </div>
            )}

            <label className="date-selector-pill" htmlFor="global-date-selector">
              <Calendar size={18} />
              <input
                type="date"
                id="global-date-selector"
                max={getTodayString()}
                value={selectedDate}
                onChange={(e) => {
                  const newDate = e.target.value;
                  if (!newDate) return;
                  setSelectedDate(newDate);
                  if (!editingId) {
                    setEntryForm((prev) => ({ ...prev, date: newDate }));
                  }
                }}
                aria-label="Select calendar date"
              />
            </label>
          </div>
        </div>

        {/* Banners */}
        {errorMessage && (
          <div className="alert-banner error" role="alert">
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <AlertCircle size={18} />
              <span>{errorMessage}</span>
            </div>
            <button className="alert-close" onClick={() => setErrorMessage('')} aria-label="Dismiss error">
              <X size={16} />
            </button>
          </div>
        )}

        {successMessage && (
          <div className="alert-banner success" role="status">
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <CheckCircle size={18} />
              <span>{successMessage}</span>
            </div>
            <button className="alert-close" onClick={() => setSuccessMessage('')} aria-label="Dismiss message">
              <X size={16} />
            </button>
          </div>
        )}

        {/* Glucose Statistics Cards */}
        <section className="stats-grid" aria-label="Daily glucose statistics">
          <div className="stat-card">
            <div className="stat-top">
              <span className="stat-label">Highest Glucose</span>
              <div className="stat-icon highest"><TrendingUp size={16} /></div>
            </div>
            <div className="stat-value">
              {dailyReport?.highest !== null && dailyReport?.highest !== undefined ? dailyReport.highest : '—'}
              <small>mg/dL</small>
            </div>
            <div className="stat-subtext">Peak on {selectedDate}</div>
          </div>

          <div className="stat-card">
            <div className="stat-top">
              <span className="stat-label">Lowest Glucose</span>
              <div className="stat-icon lowest"><TrendingUp size={16} style={{ transform: 'rotate(180deg)' }} /></div>
            </div>
            <div className="stat-value">
              {dailyReport?.lowest !== null && dailyReport?.lowest !== undefined ? dailyReport.lowest : '—'}
              <small>mg/dL</small>
            </div>
            <div className="stat-subtext">Lowest on {selectedDate}</div>
          </div>

          <div className="stat-card">
            <div className="stat-top">
              <span className="stat-label">Daily Average</span>
              <div className="stat-icon average"><Activity size={16} /></div>
            </div>
            <div className="stat-value">
              {dailyReport?.average !== null && dailyReport?.average !== undefined ? Number(dailyReport.average).toFixed(1) : '—'}
              <small>mg/dL</small>
            </div>
            <div className="stat-subtext">Mean of daily readings</div>
          </div>

          <div className="stat-card">
            <div className="stat-top">
              <span className="stat-label">Total Readings</span>
              <div className="stat-icon readings"><Clock size={16} /></div>
            </div>
            <div className="stat-value">
              {dailyReport?.count || 0}
              <small>/ 4 slots</small>
            </div>
            <div className="stat-subtext">Recorded on {selectedDate}</div>
          </div>
        </section>

        {/* Tab 1: Dashboard View (Add Reading + Daily Report) */}
        {activeTab === 'dashboard' && (
          <div className="dashboard-layout">
            {/* Add / Edit Reading Panel */}
            <div className="panel-card" ref={formRef}>
              <div className="panel-header">
                <div>
                  <div className="panel-tag">{editingId ? 'EDIT MODE' : 'LOG ENTRY'}</div>
                  <h2 className="panel-title" style={{ marginTop: '6px' }}>
                    {editingId ? 'Edit Reading' : 'Add Glucose Reading'}
                  </h2>
                </div>
              </div>

              <form onSubmit={handleSaveReading} noValidate>
                <div className="form-group">
                  <label className="form-label" htmlFor="reading-date">Date</label>
                  <input
                    id="reading-date"
                    type="date"
                    required
                    max={getTodayString()}
                    className="form-input"
                    value={entryForm.date}
                    onChange={(e) => setEntryForm({ ...entryForm, date: e.target.value })}
                  />
                </div>

                <div className="form-group">
                  <label className="form-label" htmlFor="reading-slot">Time Slot</label>
                  <select
                    id="reading-slot"
                    className="form-select"
                    value={entryForm.slot}
                    onChange={(e) => setEntryForm({ ...entryForm, slot: e.target.value })}
                  >
                    {TIME_SLOTS.map((s) => (
                      <option key={s.value} value={s.value}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="form-group">
                  <label className="form-label" htmlFor="reading-value">
                    Glucose Value <span className="optional">(40 – 600 mg/dl)</span>
                  </label>
                  <div className="input-with-unit">
                    <input
                      id="reading-value"
                      type="number"
                      step="1"
                      min="40"
                      max="600"
                      required
                      placeholder="e.g. 110"
                      className="form-input"
                      value={entryForm.value}
                      onChange={(e) => setEntryForm({ ...entryForm, value: e.target.value })}
                    />
                    <span className="input-unit">mg/dL</span>
                  </div>
                </div>

                <div style={{ display: 'flex', gap: '8px', marginTop: '22px' }}>
                  <button type="submit" className="btn btn-primary" style={{ flex: 1 }} disabled={formBusy}>
                    {formBusy ? 'Saving…' : editingId ? 'Update Reading' : 'Add Reading'}
                  </button>
                  {editingId && (
                    <button type="button" className="btn btn-secondary" onClick={handleCancelEdit}>
                      Cancel
                    </button>
                  )}
                </div>
              </form>
            </div>

            {/* Daily Readings List */}
            <div className="panel-card">
              <div className="panel-header">
                <div>
                  <div className="panel-tag">DAILY REPORT</div>
                  <h2 className="panel-title" style={{ marginTop: '6px' }}>
                    Readings for {selectedDate}
                  </h2>
                </div>
                <div style={{ fontSize: '13px', color: '#64748b' }}>
                  {dailyReport?.count || 0} reading{dailyReport?.count === 1 ? '' : 's'}
                </div>
              </div>

              {dailyReport?.readings && dailyReport.readings.length > 0 ? (
                <div className="readings-list">
                  {dailyReport.readings.map((reading) => (
                    <div key={reading.id} className="reading-item">
                      <div className="reading-left">
                        <span className={`slot-indicator ${reading.slot}`} />
                        <div>
                          <div className="slot-title">{reading.slotLabel || reading.slot}</div>
                          <div className="slot-date">{reading.date}</div>
                        </div>
                      </div>

                      <div className="reading-right">
                        <div className="reading-val">
                          {reading.value} <small>mg/dL</small>
                        </div>
                        <div className="reading-actions">
                          <button
                            type="button"
                            className="btn-icon"
                            onClick={() => handleStartEdit(reading)}
                            title="Edit reading"
                            aria-label={`Edit ${reading.slot} reading`}
                          >
                            <Edit2 size={16} />
                          </button>
                          <button
                            type="button"
                            className="btn-icon danger"
                            onClick={() => setDeleteModalItem(reading)}
                            title="Delete reading"
                            aria-label={`Delete ${reading.slot} reading`}
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="empty-state">
                  <div className="empty-icon-circle">
                    <Activity size={24} />
                  </div>
                  <div className="empty-title">No readings for this date</div>
                  <p className="empty-text">
                    You haven&apos;t logged any glucose values for {selectedDate}. Use the form to add your first reading.
                  </p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Tab 2: Full Readings History */}
        {activeTab === 'history' && (
          <div className="panel-card">
            <div className="panel-header" style={{ flexWrap: 'wrap', gap: '12px' }}>
              <div>
                <div className="panel-tag">LOG HISTORY</div>
                <h2 className="panel-title" style={{ marginTop: '6px' }}>All Logged Readings</h2>
              </div>

              <div className="filter-controls">
                <label htmlFor="slot-filter" style={{ fontSize: '13px', color: '#64748b', fontWeight: 600 }}>
                  Filter slot:
                </label>
                <select
                  id="slot-filter"
                  className="filter-select"
                  value={slotFilter}
                  onChange={(e) => setSlotFilter(e.target.value)}
                >
                  <option value="all">All Time Slots ({readings.length})</option>
                  {TIME_SLOTS.map((s) => (
                    <option key={s.value} value={s.value}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {filteredHistory.length > 0 ? (
              <div className="readings-table-wrap">
                <table className="readings-table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Time Slot</th>
                      <th>Glucose Value</th>
                      <th style={{ textAlign: 'right' }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredHistory.map((reading) => (
                      <tr key={reading.id}>
                        <td>{reading.date}</td>
                        <td>
                          <span className="slot-badge">
                            <span className={`slot-indicator ${reading.slot}`} />
                            {reading.slotLabel || reading.slot}
                          </span>
                        </td>
                        <td>
                          <strong>{reading.value}</strong> <span style={{ fontSize: '12px', color: '#64748b' }}>mg/dL</span>
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          <div className="reading-actions" style={{ justifyContent: 'flex-end' }}>
                            <button
                              type="button"
                              className="btn-icon"
                              onClick={() => {
                                handleStartEdit(reading);
                                setActiveTab('dashboard');
                              }}
                              title="Edit reading"
                              aria-label={`Edit ${reading.slotLabel || reading.slot} reading on ${reading.date}`}
                            >
                              <Edit2 size={16} />
                            </button>
                            <button
                              type="button"
                              className="btn-icon danger"
                              onClick={() => setDeleteModalItem(reading)}
                              title="Delete reading"
                              aria-label={`Delete ${reading.slotLabel || reading.slot} reading on ${reading.date}`}
                            >
                              <Trash2 size={16} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="empty-state">
                <div className="empty-icon-circle">
                  <Activity size={24} />
                </div>
                <div className="empty-title">No readings found</div>
                <p className="empty-text">
                  {slotFilter === 'all'
                    ? 'Your glucose history is currently empty. Head over to the Dashboard to add your first reading!'
                    : 'No readings recorded for the selected time slot filter.'}
                </p>
              </div>
            )}
          </div>
        )}

        {/* Tab 3: Analytics & Reports View */}
        {activeTab === 'reports' && (
          <div>
            {/* Reports Comparison Grid (Daily, MTD, Previous Month) */}
            <div className="reports-grid">
              {/* Daily Report */}
              <div className="panel-card">
                <div className="panel-header">
                  <div>
                    <div className="panel-tag">DAILY SUMMARY</div>
                    <h2 className="panel-title" style={{ marginTop: '6px' }}>Daily Report</h2>
                  </div>
                  <span style={{ fontSize: '12px', color: '#64748b' }}>{selectedDate}</span>
                </div>

                {dailyReport?.count ? (
                  <div className="report-summary-box">
                    <div className="report-stat-row">
                      <span className="name">Total Readings:</span>
                      <span className="val">{dailyReport.count}</span>
                    </div>
                    <div className="report-stat-row">
                      <span className="name">Average Glucose:</span>
                      <span className="val">{Number(dailyReport.average).toFixed(1)} mg/dL</span>
                    </div>
                    <div className="report-stat-row">
                      <span className="name">Highest Reading:</span>
                      <span className="val">{dailyReport.highest} mg/dL</span>
                    </div>
                    <div className="report-stat-row">
                      <span className="name">Lowest Reading:</span>
                      <span className="val">{dailyReport.lowest} mg/dL</span>
                    </div>
                  </div>
                ) : (
                  <div className="empty-state" style={{ padding: '24px 12px' }}>
                    <div className="empty-title">No readings on {selectedDate}</div>
                    <p className="empty-text">Select another date or add a reading on the Dashboard.</p>
                  </div>
                )}
              </div>

              {/* Month-to-date Report */}
              <div className="panel-card">
                <div className="panel-header">
                  <div>
                    <div className="panel-tag">PERIOD REPORT</div>
                    <h2 className="panel-title" style={{ marginTop: '6px' }}>Month-to-Date</h2>
                  </div>
                  <span style={{ fontSize: '12px', color: '#64748b' }}>
                    {mtdReport?.startDate} → {mtdReport?.endDate}
                  </span>
                </div>

                {mtdReport?.count ? (
                  <div className="report-summary-box">
                    <div className="report-stat-row">
                      <span className="name">Total Readings:</span>
                      <span className="val">{mtdReport.count}</span>
                    </div>
                    <div className="report-stat-row">
                      <span className="name">Average Glucose:</span>
                      <span className="val">{Number(mtdReport.average).toFixed(1)} mg/dL</span>
                    </div>
                    <div className="report-stat-row">
                      <span className="name">Highest Reading:</span>
                      <span className="val">{mtdReport.highest} mg/dL</span>
                    </div>
                    <div className="report-stat-row">
                      <span className="name">Lowest Reading:</span>
                      <span className="val">{mtdReport.lowest} mg/dL</span>
                    </div>
                  </div>
                ) : (
                  <div className="empty-state" style={{ padding: '24px 12px' }}>
                    <div className="empty-title">No readings this month</div>
                    <p className="empty-text">No entries found between {mtdReport?.startDate} and {mtdReport?.endDate}.</p>
                  </div>
                )}
              </div>

              {/* Previous-Month Report */}
              <div className="panel-card">
                <div className="panel-header">
                  <div>
                    <div className="panel-tag">PERIOD REPORT</div>
                    <h2 className="panel-title" style={{ marginTop: '6px' }}>Previous Month</h2>
                  </div>
                  <span style={{ fontSize: '12px', color: '#64748b' }}>
                    {prevMonthReport?.startDate} → {prevMonthReport?.endDate}
                  </span>
                </div>

                {prevMonthReport?.count ? (
                  <div className="report-summary-box">
                    <div className="report-stat-row">
                      <span className="name">Total Readings:</span>
                      <span className="val">{prevMonthReport.count}</span>
                    </div>
                    <div className="report-stat-row">
                      <span className="name">Average Glucose:</span>
                      <span className="val">{Number(prevMonthReport.average).toFixed(1)} mg/dL</span>
                    </div>
                    <div className="report-stat-row">
                      <span className="name">Highest Reading:</span>
                      <span className="val">{prevMonthReport.highest} mg/dL</span>
                    </div>
                    <div className="report-stat-row">
                      <span className="name">Lowest Reading:</span>
                      <span className="val">{prevMonthReport.lowest} mg/dL</span>
                    </div>
                  </div>
                ) : (
                  <div className="empty-state" style={{ padding: '24px 12px' }}>
                    <div className="empty-title">No readings last month</div>
                    <p className="empty-text">No entries found for {prevMonthReport?.startDate} to {prevMonthReport?.endDate}.</p>
                  </div>
                )}
              </div>
            </div>

            {/* Monthly Trend Chart */}
            <div className="panel-card">
              <div className="panel-header">
                <div>
                  <div className="panel-tag">GLUCOSE TREND</div>
                  <h2 className="panel-title" style={{ marginTop: '6px' }}>Monthly Progression ({selectedDate.slice(0, 7)})</h2>
                </div>
              </div>

              {chartData.length > 0 ? (
                <div className="chart-container">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={chartData} margin={{ top: 10, right: 20, bottom: 10, left: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                      <XAxis dataKey="day" tickLine={false} axisLine={{ stroke: '#cbd5e1' }} />
                      <YAxis domain={['auto', 'auto']} tickLine={false} axisLine={{ stroke: '#cbd5e1' }} />
                      <Tooltip
                        contentStyle={{
                          background: '#ffffff',
                          borderRadius: '8px',
                          border: '1px solid #e2e8f0',
                          boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1)'
                        }}
                        formatter={(val) => [`${val} mg/dL`, 'Glucose']}
                        labelFormatter={(label, payload) => payload?.[0]?.payload?.date ? `${payload[0].payload.date} · ${payload[0].payload.slot}` : label}
                      />
                      <Line
                        type="monotone"
                        dataKey="value"
                        stroke="#2563eb"
                        strokeWidth={3}
                        dot={{ r: 4, fill: '#0d9488', stroke: '#ffffff', strokeWidth: 2 }}
                        activeDot={{ r: 6 }}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <div className="empty-state">
                  <div className="empty-icon-circle">
                    <BarChart2 size={24} />
                  </div>
                  <div className="empty-title">No chart data available</div>
                  <p className="empty-text">
                    Add glucose readings in {selectedDate.slice(0, 7)} to visualize your health progression curve.
                  </p>
                </div>
              )}
            </div>
          </div>
        )}
      </main>

      {/* Delete Confirmation Modal */}
      {deleteModalItem && (
        <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="delete-dialog-title">
          <div className="modal-card">
            <h3 id="delete-dialog-title" className="modal-title">Delete Reading</h3>
            <p className="modal-desc">
              Are you sure you want to delete this {deleteModalItem.slotLabel || deleteModalItem.slot} reading of {deleteModalItem.value} mg/dL recorded on {deleteModalItem.date}? This action cannot be undone.
            </p>
            <div className="modal-actions">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setDeleteModalItem(null)}
                disabled={deleteBusy}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-danger"
                onClick={confirmDeleteReading}
                disabled={deleteBusy}
              >
                {deleteBusy ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Mobile Bottom Tab Navigation */}
      <nav className="mobile-bottom-tabs" aria-label="Mobile Navigation">
        <button
          type="button"
          className={`mobile-tab-btn ${activeTab === 'dashboard' ? 'active' : ''}`}
          onClick={() => setActiveTab('dashboard')}
        >
          <Activity size={18} />
          <span>Dashboard</span>
        </button>
        <button
          type="button"
          className={`mobile-tab-btn ${activeTab === 'history' ? 'active' : ''}`}
          onClick={() => setActiveTab('history')}
        >
          <Layers size={18} />
          <span>History</span>
        </button>
        <button
          type="button"
          className={`mobile-tab-btn ${activeTab === 'reports' ? 'active' : ''}`}
          onClick={() => setActiveTab('reports')}
        >
          <BarChart2 size={18} />
          <span>Reports</span>
        </button>
      </nav>
    </div>
  );
}
