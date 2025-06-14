// server.js
require('dotenv').config(); // Load environment variables from .env file

const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const { Pool } = require('pg');
const bcrypt = require('bcrypt'); // For password hashing

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*", // Allow all origins for development (consider restricting in production)
    methods: ["GET", "POST", "PUT", "DELETE"]
  }
});

app.use(cors());
app.use(express.json());

// ----------------------
// 📌 PostgreSQL Database Configuration
// Using your provided credentials. In production, always use environment variables.
// ----------------------
const pool = new Pool({
  user: 'postgres',
  host: 'localhost',
  database: 'collaborative_forms',
  password: 'root',
  port: 5432,
});

// Test database connection
pool.on('connect', () => {
  console.log('✅ Connected to PostgreSQL database');
});

pool.on('error', (err) => {
  console.error('❌ Unexpected error on idle client', err);
  // In a real application, you might want to gracefully exit or retry connection
});

// In-memory store for active user sockets (volatile, not persisted in DB)
// This map stores: formId -> Map<socketId, {userId, userName, joinedAt, socketId}>
const activeSessions = new Map();

/**
 * Generates a short, random alphanumeric code for forms.
 * @returns {string} A 6-character uppercase alphanumeric string.
 */
function generateFormCode() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

/**
 * Validates the structure and content of a form field object.
 * @param {object} field - The field object to validate.
 * @returns {boolean} True if the field is valid, false otherwise.
 */
function validateField(field) {
  const validTypes = ['text', 'email', 'number', 'textarea', 'select', 'radio', 'checkbox', 'date', 'tel', 'url'];
  
  if (!field.id || !field.label || !validTypes.includes(field.type)) {
    console.warn(`Invalid field: missing id, label, or invalid type. Field: ${JSON.stringify(field)}`);
    return false;
  }
  
  if ((field.type === 'select' || field.type === 'radio') && (!field.options || !Array.isArray(field.options) || field.options.length === 0)) {
    console.warn(`Invalid field options for type ${field.type}. Field: ${JSON.stringify(field)}`);
    return false;
  }
  
  return true;
}

// ----------------------
// 🔑 Admin Authentication & Authorization Endpoints (Simplified)
// ----------------------

// POST /api/admin/register: Register a new admin account
// Stores hashed password. Returns new admin's ID and username.
app.post('/api/admin/register', async (req, res) => {
  const { username, password } = req.body;
  // --- Validation: Check if username or password are missing ---
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }

  try {
    const hashedPassword = await bcrypt.hash(password, 10); // Hash the password
    const insertQuery = `
      INSERT INTO admins (username, password_hash)
      VALUES ($1, $2)
      RETURNING id, username, created_at;
    `;
    const { rows } = await pool.query(insertQuery, [username, hashedPassword]);
    const newAdmin = rows[0];
    console.log(`✅ New admin registered: ${newAdmin.username} (ID: ${newAdmin.id})`);
    // Return admin ID and username so frontend can set user context
    res.status(201).json({ success: true, message: 'Admin registered successfully', admin: { id: newAdmin.id, username: newAdmin.username } });
  } catch (error) {
    console.error('Error registering admin:', error);
    if (error.code === '23505') { // PostgreSQL unique violation error code (username already exists)
      res.status(409).json({ error: 'Username already exists. Please choose a different one.' });
    } else {
      res.status(500).json({ error: 'Failed to register admin. Please try again.' });
    }
  }
});

// POST /api/admin/login: Authenticate admin
// Checks username/password against database. Returns admin's ID and username on success.
app.post('/api/admin/login', async (req, res) => {
  const { username, password } = req.body;
  // --- Validation: Check if username or password are missing ---
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }

  try {
    const findQuery = `SELECT id, username, password_hash FROM admins WHERE username = $1;`;
    const { rows } = await pool.query(findQuery, [username]);
    const admin = rows[0];

    // --- Validation: Check if admin exists ---
    if (!admin) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    // --- Validation: Compare provided password with stored hash ---
    const isPasswordValid = await bcrypt.compare(password, admin.password_hash);
    if (!isPasswordValid) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    console.log(`✅ Admin logged in: ${admin.username} (ID: ${admin.id})`);
    // Return admin ID and username for frontend state management
    res.json({ success: true, message: 'Logged in successfully', admin: { id: admin.id, username: admin.username } });
  } catch (error) {
    console.error('Error logging in admin:', error);
    res.status(500).json({ error: 'Failed to log in. Please try again later.' });
  }
});


// ----------------------
// 📌 REST API ENDPOINTS (Admin-specific routes now require explicit adminId)
// ----------------------

// POST /api/forms: Create a new form (Admin action)
// Expects title, fields, and adminId in request body.
app.post('/api/forms', async (req, res) => {
  const { title, fields, adminId } = req.body;
  // --- Validation: Check if title or adminId are missing ---
  if (!title || !adminId) {
    return res.status(400).json({ error: 'Form title and admin ID are required' });
  }

  // Optional: Verify if the adminId exists in the admins table (for better integrity)
  try {
    const adminExists = await pool.query('SELECT 1 FROM admins WHERE id = $1', [adminId]);
    if (adminExists.rows.length === 0) {
      return res.status(403).json({ error: 'Unauthorized: Invalid admin ID.' });
    }
  } catch (error) {
    console.error('Error verifying admin ID:', error);
    return res.status(500).json({ error: 'Server error during admin verification.' });
  }

  // --- Validation: Validate fields if provided using the helper function ---
  if (fields && Array.isArray(fields)) {
    for (const field of fields) {
      if (!validateField(field)) {
        return res.status(400).json({ error: `Invalid field structure: ${field.label || field.id || 'unknown'}` });
      }
    }
  }

  const formId = uuidv4(); // Generate a unique ID for the new form
  const formCode = generateFormCode(); // Generate a short, shareable code
  const createdAt = new Date().toISOString();

  try {
    // Insert new form into the 'forms' table, linking it to the creating admin
    const formQuery = `
      INSERT INTO forms (id, code, title, fields, admin_id, created_at, is_active)
      VALUES ($1, $2, $3, $4, $5, $6, TRUE)
      RETURNING id, code, title, fields, admin_id, created_at, updated_at, is_active;
    `;
    const formValues = [formId, formCode, title.trim(), JSON.stringify(fields || []), adminId, createdAt]; 
    const { rows: formRows } = await pool.query(formQuery, formValues);
    const newForm = formRows[0];

    // Create an initial empty response entry for the new form in 'form_responses'
    const responseQuery = `
      INSERT INTO form_responses (form_id, data, last_updated, contributors)
      VALUES ($1, $2, $3, $4)
      RETURNING form_id, data, last_updated, contributors;
    `;
    const responseValues = [formId, {}, createdAt, '{}']; 
    const { rows: responseRows } = await pool.query(responseQuery, responseValues);
    const newResponse = responseRows[0];

    console.log(`📝 Form created: "${newForm.title}" (Code: ${newForm.code}) by admin ${adminId}`); 
    res.status(201).json({ success: true, form: newForm, shareCode: newForm.code, response: newResponse });
  } catch (error) {
    console.error('Error creating form:', error);
    if (error.code === '23505') { // PostgreSQL unique violation error code (e.g., code collision)
        res.status(409).json({ error: 'A form with a similar code already exists. Please try again.' });
    } else {
        res.status(500).json({ error: 'Failed to create form.' });
    }
  }
});

// GET /api/forms/:code: Retrieve a form by its share code (UNPROTECTED - accessible by any user)
app.get('/api/forms/:code', async (req, res) => {
  const { code } = req.params;
  try {
    const formQuery = `
      SELECT id, code, title, fields, admin_id, created_at, updated_at, is_active FROM forms
      WHERE code = $1 AND is_active = TRUE; -- SELECT query only returns active forms
    `;
    const { rows: formRows } = await pool.query(formQuery, [code.toUpperCase()]);
    const form = formRows[0];

    // --- Validation: Check if form was found AND is active (based on query result) ---
    if (!form || !form.is_active) {
      // This is the check that responds if the form code is wrong or the form is inactive
      return res.status(404).json({ error: 'Form not found or inactive. Please check the code.' });
    }

    // Retrieve the associated form response data
    const responseQuery = `
      SELECT form_id, data, last_updated, contributors FROM form_responses
      WHERE form_id = $1;
    `;
    const { rows: responseRows } = await pool.query(responseQuery, [form.id]);
    const response = responseRows[0] ? {
      form_id: responseRows[0].form_id,
      data: responseRows[0].data || {},
      last_updated: responseRows[0].last_updated,
      contributors: responseRows[0].contributors || []
    } : { form_id: form.id, data: {}, last_updated: form.created_at, contributors: [] };

    res.json({ success: true, form, response });
  } catch (error) {
    console.error('Error getting form by code:', error);
    res.status(500).json({ error: 'Failed to retrieve form.' });
  }
});

// GET /api/forms/id/:formId: Retrieve a form by its ID (Admin access)
// Expects adminId as query parameter.
app.get('/api/forms/id/:formId', async (req, res) => {
  const { formId } = req.params;
  const { adminId } = req.query; 
  // --- Validation: Check if adminId is provided for this protected route ---
  if (!adminId) {
    return res.status(400).json({ error: 'Admin ID is required for this action.' });
  }

  try {
    const formQuery = `
      SELECT id, code, title, fields, admin_id, created_at, updated_at, is_active FROM forms
      WHERE id = $1;
    `;
    const { rows: formRows } = await pool.query(formQuery, [formId]);
    const form = formRows[0];

    // --- Validation: Check if form was found ---
    if (!form) {
      return res.status(404).json({ error: 'Form not found.' });
    }
    
    // --- Authorization check: Ensure the requesting admin is the owner of this form ---
    if (form.admin_id !== adminId) {
      return res.status(403).json({ error: 'Not authorized to access this form. You are not its creator.' });
    }

    // Retrieve the associated form response data
    const responseQuery = `
      SELECT form_id, data, last_updated, contributors FROM form_responses
      WHERE form_id = $1;
    `;
    const { rows: responseRows } = await pool.query(responseQuery, [formId]);
    const response = responseRows[0] ? {
      form_id: responseRows[0].form_id,
      data: responseRows[0].data || {},
      last_updated: responseRows[0].last_updated,
      contributors: responseRows[0].contributors || []
    } : { form_id: form.id, data: {}, last_updated: form.created_at, contributors: [] };

    res.json({ success: true, form, response });
  } catch (error) {
    console.error('Error getting form by ID:', error);
    res.status(500).json({ error: 'Failed to retrieve form.' });
  }
});

// GET /api/admin/forms: List all forms created by a specific admin
// Expects adminId as query parameter.
app.get('/api/admin/forms', async (req, res) => {
  const { adminId } = req.query; 
  // --- Validation: Check if adminId is provided for this protected route ---
  if (!adminId) {
    return res.status(400).json({ error: 'Admin ID is required to list forms.' });
  }

  try {
    const formsQuery = `
      SELECT 
        f.id, f.code, f.title, f.fields, f.admin_id, f.created_at, f.updated_at, f.is_active,
        fr.data, fr.last_updated AS response_last_updated, fr.contributors
      FROM forms f
      LEFT JOIN form_responses fr ON f.id = fr.form_id
      WHERE f.admin_id = $1 AND f.is_active = TRUE
      ORDER BY f.created_at DESC;
    `;
    const { rows: adminForms } = await pool.query(formsQuery, [adminId]);

    console.log('Admin Forms raw data from DB:', JSON.stringify(adminForms, null, 2));

    const formsWithActiveUsers = adminForms.map(f => ({
      id: f.id,
      code: f.code,
      title: f.title,
      fields: f.fields, 
      adminId: f.admin_id, 
      createdAt: f.created_at,
      updatedAt: f.updated_at,
      isActive: f.is_active,
      response: { 
        formId: f.id,
        data: f.data || {}, 
        contributors: f.contributors || [], 
        lastUpdated: f.response_last_updated || f.created_at 
      },
      activeUsers: activeSessions.get(f.id)?.size || 0 
    }));
    
    console.log('Admin Forms formatted for frontend:', JSON.stringify(formsWithActiveUsers, null, 2));

    res.json({ success: true, forms: formsWithActiveUsers });
  } catch (error) {
    console.error('Error listing admin forms:', error);
    res.status(500).json({ error: 'Failed to retrieve forms for admin.' });
  }
});

// PUT /api/forms/:formId: Update a form's basic information (e.g., title) (Admin action)
// Expects title and adminId in request body.
app.put('/api/forms/:formId', async (req, res) => {
  const { formId } = req.params;
  const { title, adminId } = req.body; 
  // --- Validation: Check if adminId is provided for this protected route ---
  if (!adminId) {
    return res.status(400).json({ error: 'Admin ID is required for this action.' });
  }

  try {
    // --- Authorization check: Verify admin ownership before allowing update ---
    const formCheckQuery = `SELECT admin_id FROM forms WHERE id = $1;`;
    const { rows: formCheckRows } = await pool.query(formCheckQuery, [formId]);
    const formExists = formCheckRows[0];

    if (!formExists) return res.status(404).json({ error: 'Form not found.' });
    if (formExists.admin_id !== adminId) return res.status(403).json({ error: 'Not authorized to update this form.' });

    if (title) {
      const updateQuery = `
        UPDATE forms
        SET title = $1, updated_at = CURRENT_TIMESTAMP
        WHERE id = $2
        RETURNING id, code, title, fields, admin_id, created_at, updated_at, is_active;
      `;
      const { rows } = await pool.query(updateQuery, [title.trim(), formId]);
      const updatedForm = rows[0];
      
      io.to(`form-${formId}`).emit('formTitleUpdated', { title: updatedForm.title });
      res.json({ success: true, form: updatedForm });
    } else {
      res.json({ success: true, message: 'No title provided for update.' });
    }
  } catch (error) {
    console.error('Error updating form info:', error);
    res.status(500).json({ error: 'Failed to update form information.' });
  }
});

// PUT /api/forms/:formId/fields: Update a form's field structure (Admin action)
// Expects fields and adminId in request body.
app.put('/api/forms/:formId/fields', async (req, res) => {
  const { formId } = req.params;
  const { fields, adminId } = req.body; 
  // --- Validation: Check if adminId is provided for this protected route ---
  if (!adminId) {
    return res.status(400).json({ error: 'Admin ID is required for this action.' });
  }

  try {
    // --- Authorization check: Verify admin ownership and retrieve current fields for validation/cleanup ---
    const formCheckQuery = `SELECT admin_id, fields FROM forms WHERE id = $1;`;
    const { rows: formCheckRows } = await pool.query(formCheckQuery, [formId]);
    const form = formCheckRows[0];

    if (!form) return res.status(404).json({ error: 'Form not found.' });
    if (form.admin_id !== adminId) return res.status(403).json({ error: 'Not authorized to modify this form structure.' });

    // --- Validation: Validate incoming field structures before updating ---
    if (fields && Array.isArray(fields)) {
      for (const field of fields) {
        if (!validateField(field)) {
          return res.status(400).json({ error: `Invalid field structure: ${field.label || field.id || 'unknown'}` });
        }
      }
    }

    const updateFormQuery = `
      UPDATE forms
      SET fields = $1, updated_at = CURRENT_TIMESTAMP
      WHERE id = $2
      RETURNING id, code, title, fields, admin_id, created_at, updated_at, is_active;
    `;
    const { rows: updatedFormRows } = await pool.query(updateFormQuery, [JSON.stringify(fields || []), formId]);
    const updatedForm = updatedFormRows[0];

    // Clean up response data: remove data for fields that no longer exist in the updated schema
    const getResponseQuery = `SELECT data FROM form_responses WHERE form_id = $1;`;
    const { rows: responseRows } = await pool.query(getResponseQuery, [formId]);
    const response = responseRows[0];

    if (response) {
      const validFieldIds = new Set(fields.map(f => f.id));
      const cleanedData = {};
      
      Object.keys(response.data || {}).forEach(fieldId => {
        if (validFieldIds.has(fieldId)) {
          cleanedData[fieldId] = response.data[fieldId];
        }
      });
      
      const updateResponseQuery = `
        UPDATE form_responses
        SET data = $1, last_updated = CURRENT_TIMESTAMP
        WHERE form_id = $2;
      `;
      await pool.query(updateResponseQuery, [JSON.stringify(cleanedData), formId]);
    }

    console.log(`🔧 Form fields updated for form "${updatedForm.title}" by admin ${adminId}`);
    io.to(`form-${formId}`).emit('formStructureUpdated', { fields: updatedForm.fields });
    res.json({ success: true, form: updatedForm });
  } catch (error) {
    console.error('Error updating form fields:', error);
    res.status(500).json({ error: 'Failed to update form fields.' });
  }
});

// PUT /api/forms/:formId/status: Toggle form active status (Admin action)
// Expects isActive and adminId in request body.
app.put('/api/forms/:formId/status', async (req, res) => {
  const { formId } = req.params;
  const { isActive, adminId } = req.body;
  // --- Validation: Check if adminId is provided for this protected route ---
  if (!adminId) {
    return res.status(400).json({ error: 'Admin ID is required for this action.' });
  }

  try {
    // --- Authorization check: Verify admin ownership ---
    const formCheckQuery = `SELECT admin_id, title, code FROM forms WHERE id = $1;`;
    const { rows: formCheckRows } = await pool.query(formCheckQuery, [formId]);
    const form = formCheckRows[0];

    if (!form) return res.status(404).json({ error: 'Form not found.' });
    if (form.admin_id !== adminId) return res.status(403).json({ error: 'Not authorized to change this form\'s status.' });

    const updateQuery = `
      UPDATE forms
      SET is_active = $1, updated_at = CURRENT_TIMESTAMP
      WHERE id = $2
      RETURNING id, code, title, fields, admin_id, created_at, updated_at, is_active;
    `;
    const { rows } = await pool.query(updateQuery, [Boolean(isActive), formId]);
    const updatedForm = rows[0];

    if (!updatedForm.is_active) {
      io.to(`form-${formId}`).emit('formDeactivated', { message: 'This form has been deactivated by the admin.' });
    }

    res.json({ success: true, form: updatedForm });
  } catch (error) {
    console.error('Error toggling form status:', error);
    res.status(500).json({ error: 'Failed to toggle form status.' });
  }
});

// DELETE /api/forms/:formId: Delete a form (Admin action)
// Expects adminId as query parameter.
app.delete('/api/forms/:formId', async (req, res) => {
  const { formId } = req.params;
  const { adminId } = req.query; 
  // --- Validation: Check if adminId is provided for this protected route ---
  if (!adminId) {
    return res.status(400).json({ error: 'Admin ID is required for this action.' });
  }

  try {
    // --- Authorization check: Verify admin ownership before deleting ---
    const formCheckQuery = `SELECT admin_id, title, code FROM forms WHERE id = $1;`;
    const { rows: formCheckRows } = await pool.query(formCheckQuery, [formId]);
    const form = formCheckRows[0];

    if (!form) return res.status(404).json({ error: 'Form not found.' });
    if (form.admin_id !== adminId) return res.status(403).json({ error: 'Not authorized to delete this form.' });

    io.to(`form-${formId}`).emit('formDeleted', { message: 'This form has been deleted by the admin.' });
    activeSessions.delete(formId); 

    const deleteFormQuery = `DELETE FROM forms WHERE id = $1 RETURNING id;`;
    await pool.query(deleteFormQuery, [formId]);

    console.log(`🗑️ Form deleted: "${form.title}" (Code: ${form.code}) by admin ${adminId}`);
    res.json({ success: true, message: 'Form deleted successfully.' });
  } catch (error) {
    console.error('Error deleting form:', error);
    res.status(500).json({ error: 'Failed to delete form.' });
  }
});

// GET /api/forms/:formId/stats: Get statistics for a specific form (Admin action)
// Expects adminId as query parameter.
app.get('/api/forms/:formId/stats', async (req, res) => {
  const { formId } = req.params;
  const { adminId } = req.query;
  // --- Validation: Check if adminId is provided for this protected route ---
  if (!adminId) {
    return res.status(400).json({ error: 'Admin ID is required for this action.' });
  }

  try {
    // --- Authorization check: Retrieve form details and verify admin ownership ---
    const formQuery = `SELECT id, code, title, fields, admin_id, created_at FROM forms WHERE id = $1;`;
    const { rows: formRows } = await pool.query(formQuery, [formId]);
    const form = formRows[0];

    if (!form) return res.status(404).json({ error: 'Form not found.' });
    if (form.admin_id !== adminId) return res.status(403).json({ error: 'Not authorized to view stats for this form.' });

    const responseQuery = `SELECT data, contributors, last_updated FROM form_responses WHERE form_id = $1;`;
    const { rows: responseRows } = await pool.query(responseQuery, [formId]);
    const response = responseRows[0] ? {
      data: responseRows[0].data || {},
      contributors: responseRows[0].contributors || [],
      last_updated: responseRows[0].last_updated
    } : { data: {}, contributors: [], last_updated: form.created_at };

    const activeSessionsForForm = activeSessions.get(formId) || new Map();

    const stats = {
      formId: form.id,
      title: form.title,
      code: form.code,
      createdAt: form.created_at,
      totalFields: form.fields ? form.fields.length : 0,
      filledFields: response.data ? Object.keys(response.data).filter(key => response.data[key] !== '' && response.data[key] !== null).length : 0,
      contributors: response.contributors ? response.contributors.length : 0,
      activeUsers: activeSessionsForForm.size,
      lastUpdated: response.last_updated
    };

    res.json({ success: true, stats });
  } catch (error) {
    console.error('Error getting form stats:', error);
    res.status(500).json({ error: 'Failed to retrieve form statistics.' });
  }
});


// ----------------------
// 🔄 SOCKET.IO EVENTS (Real-time collaborative updates)
// These events directly handle real-time data synchronization.
// ----------------------
io.on('connection', (socket) => {
  console.log('🔌 User connected:', socket.id);

  // Event: User joins a specific form room
  socket.on('joinForm', async ({ formId, userId, userName }) => {
    try {
      // Fetch form details to validate existence and active status
      const formQuery = `SELECT id, code, title, is_active, fields FROM forms WHERE id = $1;`;
      const { rows: formRows } = await pool.query(formQuery, [formId]);
      const form = formRows[0];

      // --- Validation: Check if form exists or is active when joining via socket ---
      if (!form || !form.is_active) {
        socket.emit('error', { message: 'Form not found or inactive. Cannot join.' });
        return;
      }

      socket.join(`form-${formId}`); 
      
      if (!activeSessions.has(formId)) activeSessions.set(formId, new Map());
      
      activeSessions.get(formId).set(socket.id, { 
        userId, 
        userName, 
        joinedAt: new Date().toISOString(),
        socketId: socket.id
      });

      const users = [...activeSessions.get(formId).values()];
      socket.to(`form-${formId}`).emit('userJoined', { userId, userName, activeUsers: users });
      socket.emit('activeUsers', { activeUsers: users });

      console.log(`👥 ${userName} joined form "${form.title}" (Code: ${form.code})`);
    } catch (error) {
      console.error('Error joining form (socket):', error);
      socket.emit('error', { message: 'Failed to join form.' });
    }
  });

  // Event: A field's value is updated by a user
  socket.on('updateField', async ({ formId, fieldId, value, userId, userName }) => {
    try {
      const formQuery = `SELECT id, title, code, fields, is_active FROM forms WHERE id = $1;`;
      const { rows: formRows } = await pool.query(formQuery, [formId]);
      const form = formRows[0];

      // --- Validation: Check if form exists or is active before updating a field ---
      if (!form || !form.is_active) {
        socket.emit('error', { message: 'Form not found or inactive. Cannot update.' });
        return;
      }

      const field = form.fields.find(f => f.id === fieldId);
      // --- Validation: Check if the field exists in the form's definition ---
      if (!field) {
        socket.emit('error', { message: 'Field not found in form definition.' });
        return;
      }

      let sanitizedValue = value;
      if (field.type === 'number') {
        sanitizedValue = value === '' ? '' : String(Number(value) || 0);
      } else if (field.type === 'email') {
        sanitizedValue = String(value).toLowerCase().trim();
      } else if (field.type === 'checkbox') {
        sanitizedValue = value === 'true' ? 'true' : 'false';
      } else {
        sanitizedValue = String(value).substring(0, 10000); 
      }

      const currentResponseQuery = `SELECT data, contributors FROM form_responses WHERE form_id = $1;`;
      const { rows: currentResponseRows } = await pool.query(currentResponseQuery, [formId]);
      let currentResponse = currentResponseRows[0];

      if (!currentResponse) {
        console.warn(`No response entry found for formId: ${formId}. Creating a new one for update.`);
        const insertResponseQuery = `
          INSERT INTO form_responses (form_id, data, last_updated, contributors)
          VALUES ($1, $2, CURRENT_TIMESTAMP, $3)
          RETURNING form_id, data, last_updated, contributors;
        `;
        const initialData = {};
        initialData[fieldId] = sanitizedValue;
        const initialContributors = [userName]; 
        const { rows: newRespRows } = await pool.query(insertResponseQuery, [formId, initialData, initialContributors]);
        currentResponse = newRespRows[0];
      } else {
        currentResponse.data[fieldId] = sanitizedValue;

        if (!currentResponse.contributors.includes(userName)) {
          currentResponse.contributors.push(userName);
        }

        const updateResponseQuery = `
          UPDATE form_responses
          SET data = $1, last_updated = CURRENT_TIMESTAMP, contributors = $2
          WHERE form_id = $3
          RETURNING last_updated;
        `;
        const { rows: updatedRows } = await pool.query(updateResponseQuery, [
          currentResponse.data, 
          currentResponse.contributors, 
          formId
        ]);
        currentResponse.last_updated = updatedRows[0].last_updated;
      }
      
      io.to(`form-${formId}`).emit('fieldUpdated', {
        fieldId,
        fieldLabel: field.label, 
        value: sanitizedValue,
        updatedBy: userName,
        timestamp: currentResponse.last_updated
      });

      console.log(`📝 Field "${field.label}" (${fieldId}) updated in form "${form.title}" by ${userName}. Data saved:`, JSON.stringify(currentResponse.data));
    } catch (error) {
      console.error('Error updating field via socket:', error);
      socket.emit('error', { message: 'Failed to update field.' });
    }
  });

  socket.on('lockField', ({ formId, fieldId, userId, userName }) => {
    socket.to(`form-${formId}`).emit('fieldLocked', { fieldId, lockedBy: userName, userId });
  });

  socket.on('unlockField', ({ formId, fieldId, userId }) => {
    socket.to(`form-${formId}`).emit('fieldUnlocked', { fieldId, userId });
  });

  socket.on('userTyping', ({ formId, fieldId, userName, isTyping }) => {
    socket.to(`form-${formId}`).emit('userTypingUpdate', { fieldId, userName, isTyping });
  });

  socket.on('disconnect', () => {
    console.log('❌ Disconnected:', socket.id);
    for (const [formId, sessions] of activeSessions.entries()) {
      if (sessions.has(socket.id)) {
        const user = sessions.get(socket.id);
        sessions.delete(socket.id); 

        (async () => {
          let formTitle = 'Unknown Form';
          try {
            const formQuery = `SELECT title FROM forms WHERE id = $1;`;
            const { rows } = await pool.query(formQuery, [formId]);
            if (rows[0]) formTitle = rows[0].title;
          } catch (error) {
            console.error('Error fetching form title on disconnect:', error);
          }

          socket.to(`form-${formId}`).emit('userLeft', {
            userId: user.userId,
            userName: user.userName,
            activeUsers: [...sessions.values()] 
          });

          io.to(`form-${formId}`).emit('unlockAllFieldsForUser', { userId: user.userId });
          
          console.log(`👋 ${user.userName} left form "${formTitle}"`);
        })();
      }
    }
  });
});

// ----------------------
// 🚀 START SERVER
// ----------------------
const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`✅ Collaborative Forms Server running at http://localhost:${PORT}`);
  console.log(`📊 Server started at ${new Date().toISOString()}`);
});

// Graceful shutdown on SIGTERM (e.g., from process manager or Kubernetes)
process.on('SIGTERM', () => {
  console.log('🔻 SIGTERM received. Gracefully shutting down...');
  server.close(() => {
    pool.end(() => { 
      console.log('🛑 Server closed and DB pool ended');
      process.exit(0);
    });
  });
});

// Graceful shutdown on SIGINT (e.g., Ctrl+C in terminal)
process.on('SIGINT', () => {
  console.log('🔻 SIGINT received. Gracefully shutting down...');
  server.close(() => {
    pool.end(() => { 
      console.log('🛑 Server closed and DB pool ended');
      process.exit(0);
    });
  });
});

// Health check endpoint for monitoring (e.g., by load balancers or uptime tools)
app.get('/health', async (req, res) => {
  let dbStatus = 'disconnected';
  try {
    await pool.query('SELECT 1'); 
    dbStatus = 'connected';
  } catch (err) {
    dbStatus = 'error: ' + err.message;
  }

  try {
    const { rows: formCountRows } = await pool.query('SELECT COUNT(*) FROM forms WHERE is_active = TRUE;');
    const activeFormsCount = parseInt(formCountRows[0].count, 10);

    const totalActiveSessions = [...activeSessions.values()].reduce((sum, sessions) => sum + sessions.size, 0);

    res.json({ 
      status: 'healthy', 
      timestamp: new Date().toISOString(),
      dbStatus: dbStatus,
      persistedForms: activeFormsCount,
      totalActiveSessions: totalActiveSessions
    });
  } catch (error) {
    console.error('Error in health check while querying forms:', error);
    res.status(500).json({ status: 'unhealthy', timestamp: new Date().toISOString(), dbStatus, error: error.message });
  }
});

module.exports = app; 
