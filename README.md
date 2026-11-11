# Sweety – Blood Glucose Tracker

A full-stack healthcare web application designed for diabetic and health-conscious individuals to monitor and analyze their daily blood glucose levels across standard meals. Built using React, Node.js, Express, and PostgreSQL.

---

## 📋 Table of Contents
- [Project Overview](#project-overview)
- [Screenshots](#screenshots)
- [Key Features](#key-features)
- [Technology Stack](#technology-stack)
- [Prerequisites](#prerequisites)
- [Database Setup (PostgreSQL)](#database-setup-postgresql)
- [Environment Configuration](#environment-configuration)
- [Installation and Running Locally](#installation-and-running-locally)
  - [Backend Setup](#backend-setup)
  - [Frontend Setup](#frontend-setup)
  - [Database Seeding](#database-seeding)
- [Running Automated Tests](#running-automated-tests)
- [Demo Login Credentials](#demo-login-credentials)
- [API Endpoints Reference](#api-endpoints-reference)
- [Architecture & Design Details](#architecture--design-details)
- [Assumptions and Future Improvements](#assumptions-and-future-improvements)

---

## 🌟 Project Overview

**Sweety** is a personal blood glucose tracking SaaS dashboard that enables patients to log blood sugar readings across four crucial daily slots:
1. **Morning (fasting)**
2. **After breakfast**
3. **After lunch**
4. **After dinner**

The system provides instant statistical summaries (Daily Highest, Lowest, and Average readings), period analytics (Month-to-Date and Previous Calendar Month), and monthly visualization charts. Strict validation and relational constraints ensure patients cannot input impossible readings, log future dates, or create duplicate entries for the same meal slot on any single day.

> **Disclaimer**: This application is intended for personal health journaling and tracking. It is not an FDA-approved medical device and does not provide clinical diagnosis or medical prescriptions.

---

## 📸 Screenshots

### Dashboard & Quick Reading Entry
![Sweety Dashboard](docs/screenshots/dashboard.png)

### Readings History & Time-Slot Filtering
![Sweety Readings History](docs/screenshots/readings-history.png)

### Analytics & Clinical Reports
![Sweety Analytics and Reports](docs/screenshots/analytics-reports.png)

---

## 🚀 Key Features

### 1. User Authentication & Security
- Secure user registration and login with name, email, and password.
- Passwords hashed using industry-standard **bcrypt** (cost factor 12).
- Zero plain-text password storage; passwords never returned in API payloads.
- **JWT (JSON Web Token)** stateless authorization protecting all user-specific routes.
- **Strict User Data Isolation**: Every reading and report is partitioned strictly by authenticated `user_id`. Users can never view, update, or delete readings belonging to another user.

### 2. Blood Glucose Reading Management (CRUD)
- **Add Reading**: Log date, time slot, and glucose value in mg/dL.
- **View Readings**: Real-time display of daily readings and complete log history.
- **Edit Reading**: Modify any previous reading with full re-validation.
- **Delete Reading**: Remove an entry with an accessible, in-app confirmation modal.

### 3. Strict Input & Business Validation (Frontend & Backend)
- **Required Value**: `"Please enter a glucose value."`
- **Integer Value Range**: Whole number strictly between 40 and 600 mg/dL: `"Value must be between 40 and 600 mg/dl."`
- **Duplicate Slot Prevention**: Only 1 reading permitted per slot per day: `"You already have a(n) [slot] reading for this date."` (enforced on frontend, in route handlers, and via a `UNIQUE(user_id, reading_date, slot)` database constraint).
- **Daily Quota**: Maximum of 4 readings allowed per calendar day: `"You can add only 4 readings per day."`
- **No Future Dates**: Disallows selection of future calendar dates: `"Date cannot be in the future."`

### 4. Comprehensive Clinical Reports
- **Daily Report**:
  - Selected calendar date.
  - Highest reading on that date.
  - Lowest reading on that date.
  - Average reading rounded to one decimal place (e.g. `124.5 mg/dL`).
  - Total number of readings recorded on that date.
  - Complete list of readings for that date with meal slot labels.
- **Month-to-Date (MTD) Report**:
  - Period from the 1st day of the selected month through the selected date.
  - Highest, lowest, average (1 decimal), and total count.
- **Previous Calendar Month Report**:
  - Entire previous month (e.g., from `2026-10-01` to `2026-10-31` when November is selected).
  - Highest, lowest, average (1 decimal), and total count.
- **Friendly Empty States**: Helpful, informative empty states whenever no data exists for a given period.

### 5. Modern Healthcare Dashboard UI
- Clean healthcare SaaS aesthetic with soft blue (`#2563eb`) and teal (`#0d9488`) accents on a pure white background.
- Desktop sidebar navigation with active indicator tabs.
- Mobile-friendly responsive top header and bottom tab navigation.
- Statistics metric cards for rapid overview.
- Interactive Recharts monthly progression line chart.
- Accessible form controls (`htmlFor`, keyboard navigability, contrast ratios).

---

## 🛠️ Technology Stack

| Layer | Technology |
|---|---|
| **Frontend** | React 18, Vite, Lucide React (Icons), Recharts (Data Visualization), Axios |
| **Backend** | Node.js (v18+ / v20+ / v24+), Express.js |
| **Database** | PostgreSQL (Relational schema, foreign keys, CHECK & UNIQUE constraints) |
| **Auth & Security** | JWT (jsonwebtoken), bcryptjs, CORS |
| **Testing** | Node.js Test Runner (`node:test`, `node:assert/strict`), Supertest |

---

## 📦 Prerequisites

Ensure you have the following installed on your machine:
- **Node.js** (v18.0.0 or higher; tested on Node v24.19.0)
- **npm** (v9.0.0 or higher)
- **PostgreSQL** (v14 or higher; optional if using the embedded zero-config PostgreSQL engine fallback)

---

## 🗄️ Database Setup (PostgreSQL)

### Option A: Standard PostgreSQL Server
1. Connect to your PostgreSQL instance using `psql` or pgAdmin:
   ```bash
   psql -U postgres
   ```
2. Create the application database:
   ```sql
   CREATE DATABASE sweety_glucose;
   ```
3. The server automatically initializes all required tables and indexes upon boot. Alternatively, you can execute the schema manually:
   ```bash
   psql -U postgres -d sweety_glucose -f server/schema.sql
   ```

### Option B: Embedded PostgreSQL Fallback (Local Offline Mode Only)
When `DATABASE_URL` is not configured (or when `FORCE_EMBEDDED_DB=true` is set), the backend uses an embedded PostgreSQL WASM engine (`PGlite`), persisting data to `server/data/pgdata` (or in-memory during tests). When `DATABASE_URL` **is** configured, the server connects strictly to that PostgreSQL database and reports connection errors explicitly rather than silently switching to PGlite (unless `ALLOW_EMBEDDED_DB_FALLBACK=true` is explicitly enabled).

### PostgreSQL Schema Overview
```sql
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS readings (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reading_date DATE NOT NULL,
  slot VARCHAR(30) NOT NULL CHECK (slot IN ('morning','after_breakfast','after_lunch','after_dinner')),
  value INTEGER NOT NULL CHECK (value BETWEEN 40 AND 600),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, reading_date, slot)
);

CREATE INDEX IF NOT EXISTS readings_user_date_idx ON readings(user_id, reading_date);
```

---

## ⚙️ Environment Configuration

### Backend (`server/.env`)
Copy `server/.env.example` to `server/.env`:
```powershell
# Windows PowerShell:
Copy-Item server/.env.example server/.env
```
Contents of `server/.env`:
```env
PORT=5000
DATABASE_URL=postgresql://postgres:your_password@localhost:5432/sweety_glucose
DATABASE_SSL=false
# For Supabase Session Pooler (SSL required; percent-encode any special password chars like # as %23):
# DATABASE_URL=postgresql://postgres.<project-ref>:your_password@aws-0-<region>.pooler.supabase.com:5432/postgres
# DATABASE_SSL=true
# TEST_SCHEMA=sweety_test
JWT_SECRET=replace_with_a_long_random_secret
CLIENT_ORIGIN=http://localhost:5173
```
> **Important**: `JWT_SECRET` is required to start the backend API server. Always set a long random value in `server/.env` and never commit `server/.env` to source control.

### Frontend (`client/.env`)
Copy `client/.env.example` to `client/.env`:
```powershell
# Windows PowerShell:
Copy-Item client/.env.example client/.env
```
Contents of `client/.env`:
```env
VITE_API_URL=http://localhost:5000/api
```

---

## 🚀 Installation and Running Locally (Windows 11 / macOS / Linux)

### 1. Install Backend Dependencies & Start Server
Open a terminal in the project root, configure `server/.env`, and start the backend:
```powershell
cd server
Copy-Item .env.example .env
# Edit server/.env and set a secure random JWT_SECRET (and DATABASE_URL for PostgreSQL)
npm install
npm run dev
```
> The API server will start on `http://localhost:5000`.

### 2. Seed Demo Data
In a second terminal window:
```powershell
cd server
npm run seed
```
This populates the database with a pre-configured demo account and sample readings across current and previous months.

### 3. Install Frontend Dependencies & Start Client
In a third terminal window:
```powershell
cd client
Copy-Item .env.example .env
npm install
npm run dev
```
> The React dashboard will be accessible at `http://localhost:5173`.

---

## 🧪 Running Automated Tests

Sweety includes an automated backend unit and integration test suite with **38 tests** covering:
- User registration and login flow
- Bcrypt password hashing verification and JWT expiry/signature protection
- Database schema, `CHECK`/`UNIQUE` constraints, `ON DELETE CASCADE`, and seed verification
- Valid glucose reading creation
- Range and non-integer value rejections
- Duplicate slot prevention and chronological slot ordering
- Maximum 4 readings per day enforcement (plus editing on a full 4-reading day)
- Future-date and invalid-date rejections
- Editing and deleting readings
- Multi-user data isolation
- Daily, Month-to-date, and Previous-month report calculations (rounding, month boundaries, leap years, and year transitions)

To execute the test suite:
```powershell
cd server
npm test
```

### Test Summary
```text
✔ User Authentication & Authorization Tests (9 tests passing)
✔ Database Schema, Constraints, Cascade & Seed Tests (4 tests passing)
✔ Glucose Readings API Tests (10 tests passing)
✔ Reports API Tests (7 tests passing)
✔ Validation Helper Tests (7 tests passing)
✔ test/helpers.js (1 test passing)
ℹ tests 38
ℹ suites 4
ℹ pass 38
ℹ fail 0
```

> Note: When `DATABASE_URL` is configured, `npm test` automatically runs each test suite inside its own isolated temporary PostgreSQL schema (`${TEST_SCHEMA}_<pid>`, defaulting to `sweety_test_<pid>`, or `TEST_DATABASE_URL` if provided) and drops only that temporary schema in teardown so `public` data is never modified. If `DATABASE_URL` is unset (or `FORCE_EMBEDDED_DB=true`), tests run against in-memory PGlite.

---

## 🔑 Demo Login Credentials

After running `npm run seed` in `server/`, you can log in using the seeded demo account:

- **Email**: `demo@sweety.local`
- **Password**: `DemoPass123!`

---

## 📡 API Endpoints Reference

All endpoints accept and return JSON. Authenticated endpoints require the header:  
`Authorization: Bearer <jwt_token>`

### Authentication Endpoints
| Method | Endpoint | Description | Auth Required |
|---|---|---|---|
| `POST` | `/api/auth/register` | Register new account (`name`, `email`, `password`) | No |
| `POST` | `/api/auth/login` | Authenticate and obtain JWT token | No |
| `GET` | `/api/auth/me` | Fetch authenticated user profile | Yes |

### Readings Endpoints
| Method | Endpoint | Description | Auth Required |
|---|---|---|---|
| `GET` | `/api/readings` | List readings for current user (optional `?date=YYYY-MM-DD`) | Yes |
| `POST` | `/api/readings` | Create a new glucose reading (`date`, `slot`, `value`) | Yes |
| `PUT` | `/api/readings/:id` | Update an existing reading owned by the user | Yes |
| `DELETE` | `/api/readings/:id` | Delete an existing reading owned by the user | Yes |

### Reports Endpoints
| Method | Endpoint | Description | Auth Required |
|---|---|---|---|
| `GET` | `/api/reports/daily?date=YYYY-MM-DD` | Daily highest, lowest, average, count & slot list | Yes |
| `GET` | `/api/reports/month-to-date?date=YYYY-MM-DD` | MTD statistics from 1st of month to selected date | Yes |
| `GET` | `/api/reports/previous-month?date=YYYY-MM-DD` | Entire previous calendar month statistics | Yes |

### System Health
| Method | Endpoint | Description | Auth Required |
|---|---|---|---|
| `GET` | `/api/health` | Health check endpoint returning `{ status: 'ok', dbEngine, timestamp }` | No |

---

## 🏗️ Architecture & Design Details

- **Modular Backend Architecture**: Clear separation of database connection pooling (`db.js`), route handlers (`/routes`), validation schemas (`validation.js`), and auth middleware (`auth.js`).
- **Data Integrity & Consistency**: Enforces integrity at the database layer with check constraints (`value BETWEEN 40 AND 600`) and unique composite indexes (`UNIQUE(user_id, reading_date, slot)`).
- **Timezone Safety**: Dates are stored in standard SQL `DATE` format (`YYYY-MM-DD`), preventing timezone shifts from altering patient calendar dates.
- **Explicit PostgreSQL Connectivity**: Connects via `pg.Pool` (with SSL support via `DATABASE_SSL` / remote host detection and `10000ms` connection timeout) whenever `DATABASE_URL` is configured without silent fallback to embedded storage. Isolated test schemas (`TEST_SCHEMA`) protect production `public` tables during automated tests.

---

## 🔮 Assumptions and Future Improvements

### Assumptions
- Each user tracks up to 4 predefined clinical meal slots per day: Morning (fasting), After breakfast, After lunch, and After dinner.
- Dates are selected in the patient's local calendar context (`YYYY-MM-DD`).
- Blood glucose values are stored in milligrams per deciliter (`mg/dL`) as whole integers.

### Future Improvements
- **Exporting Records**: PDF and CSV download options for sharing daily/monthly logs with healthcare providers.
- **Insulin & Medication Tagging**: Tracking insulin units or oral medications taken alongside meal slots.
- **Target Range Customization**: Allowing patients to set personalized target ranges (e.g., fasting target: 80–110 mg/dL).
- **Continuous Glucose Monitor (CGM) Integration**: Direct synchronization via Apple HealthKit or Google Health Connect.

---

## 📄 License
This project is developed for assignment and evaluation purposes.
