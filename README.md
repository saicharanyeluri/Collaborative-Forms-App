# **Collaborative Forms App**

This project implements a real-time collaborative form filling system, inspired by Google Docs, where multiple users can simultaneously edit a single shared response for a form. Administrators have the ability to create and manage these dynamic forms.

## **Table of Contents**

* [Features](#bookmark=id.6cvft9qgkhqw)  
* [Architecture & Design Decisions](#bookmark=id.apn5cpp4jva3)  
* [Technologies Used](#bookmark=id.ru4vr8n7yy2v)  
* [Setup & Local Development](#bookmark=id.pks3ghfw61mk)  
  * [Prerequisites](#bookmark=id.euw5bureadn5)  
  * [Backend Setup](#bookmark=id.1y5cd2ak5e3z)  
  * [Frontend Setup](#bookmark=id.2r0a145sgh9p)  
  * [Running the Application](#bookmark=id.4lomo4xk6gi5)  
* [Project Structure](#bookmark=id.kwe30017vk2)  
* [API Endpoints (Backend)](#bookmark=id.rc0wcel6wfer)

## **Features**

The system provides the following core functionalities:

### **Admin Capabilities:**

* **Form Creation:** Admins can create new forms with a custom title.  
* **Dynamic Field Definition:** Define various form fields (text, email, number, textarea, select/dropdown, radio, checkbox, date, telephone, URL).  
* **Form Management:** View, edit the structure, and manage existing forms.  
* **Unique Share Codes:** Each form is assigned a unique 6-character code for easy sharing.  
* **Form Activation/Deactivation:** Admins can control if a form is active and accessible to users.  
* **Form Deletion:** Permanently remove forms and their associated response data.  
* **User Statistics:** View the number of active users and total contributors for a form.

### **User Capabilities:**

* **Collaborative Filling:** Join a shared form using a unique code and fill it in real-time with other users.  
* **Live Updates:** See real-time changes as other collaborators type or edit fields.  
* **Field Locking (Basic):** A simple strategy to indicate when another user is actively typing in a field, preventing simultaneous direct edits and reducing conflicts.  
* **Optimistic Concurrency Control:** Uses versioning on the backend to handle conflicting updates and inform users if their data is outdated.

## **Architecture & Design Decisions**

The application follows a client-server architecture with a clear separation between the backend API and the frontend user interface.

* **Real-time Communication:**  
  * **WebSockets (Socket.IO):** Chosen for real-time, bi-directional communication between clients and the server. This enables instant updates for collaborative form filling. Socket.IO also handles connection management, reconnection, and fallback mechanisms robustly.  
  * **Socket.IO Redis Adapter:** For horizontal scaling of the backend. By using Redis as a message broker, multiple instances of the Node.js backend can share WebSocket events, ensuring that users connected to different server instances can still collaborate in real-time on the same form.  
* **Backend (API & Logic):**  
  * **Node.js with Express:** Provides a lightweight and efficient server for handling API requests and managing WebSocket connections.  
  * **PostgreSQL Database:** Chosen as the primary data store for its relational capabilities, ensuring data integrity and consistency for structured form definitions, admin accounts, and form responses.  
    * forms table: Stores form metadata, including dynamic field definitions (JSONB column for flexibility).  
    * form\_responses table: Stores the single collaborative response for each form (JSONB for flexible key-value pairs of field data) along with a version field for optimistic locking.  
    * admins table: Manages admin user accounts.  
  * **Data Consistency:**  
    * **Optimistic Concurrency Control:** Each form response has a version number. When a user updates a field, the update request includes the expectedVersion from their client. The server verifies this against the current database version. If they don't match, it indicates a conflict, and the update is rejected, prompting the client to refetch the latest data.  
    * **Field Locking (UI/UX Level):** While not a strict concurrency control mechanism, indicating which user is typing in a field visually helps reduce *accidental* simultaneous edits.  
  * **Authentication (Admin):**  
    * **JWT (JSON Web Tokens):** Used for authenticating admin users. Upon successful login/registration, an admin receives a token that is then sent with subsequent protected requests to the backend. This provides a stateless and scalable authentication method.  
    * **Bcrypt:** Used for securely hashing and verifying admin passwords.  
* **Frontend (User Interface):**  
  * **React with Vite:** Provides a fast, modern, and component-based UI for both admin and user interfaces. Vite is used for its quick development server and optimized builds.  
  * **Tailwind CSS:** For rapid and responsive styling.  
  * **Lucide React Icons:** For clean and modern iconography.

## **Technologies Used**

* **Backend:**  
  * Node.js  
  * Express.js  
  * Socket.IO  
  * PostgreSQL (via pg library)  
  * Bcrypt.js (for password hashing)  
  * jsonwebtoken (for JWT authentication)  
  * uuid (for generating unique IDs)  
  * dotenv (for environment variable management)  
* **Frontend:**  
  * React.js  
  * Vite (build tool)  
  * Tailwind CSS  
  * Socket.IO Client  
  * Lucide React (icons)

## **Setup & Local Development**

Follow these steps to get the application running on your local machine.

### **Prerequisites**

* Node.js (v18.x or higher recommended)  
* npm (Node Package Manager)  
* PostgreSQL (local installation or access to a remote instance)  
* Git

### **Backend Setup**

1. **Navigate to the backend directory:**  
   cd collaborative-forms-app/backend

2. **Install backend dependencies:**  
   npm install

3. **Create a .env file** in the backend directory and add the following environment variables:  
   \# PostgreSQL (for local testing)  
   DATABASE\_URL=postgresql://user:password@localhost:5432/your\_database\_name?sslmode=disable 

   \# Port for your backend server  
   PORT=3001

   * **Replace user, password, your\_database\_name** with your local PostgreSQL credentials.

4. **Setup PostgreSQL Database Schema:**  
   * Connect to your local PostgreSQL database (e.g., using psql, pgAdmin, or DBeaver).  
   * Run the following SQL commands to create the necessary tables:  
     \-- Create the 'admins' table  
     CREATE TABLE IF NOT EXISTS admins (  
         id UUID PRIMARY KEY DEFAULT gen\_random\_uuid(),  
         username VARCHAR(255) UNIQUE NOT NULL,  
         password\_hash VARCHAR(255) NOT NULL,  
         created\_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT\_TIMESTAMP  
     );

     \-- Create the 'forms' table  
     CREATE TABLE IF NOT EXISTS forms (  
         id UUID PRIMARY KEY DEFAULT gen\_random\_uuid(),  
         code VARCHAR(6) UNIQUE NOT NULL,  
         title VARCHAR(255) NOT NULL,  
         fields JSONB DEFAULT '\[\]'::jsonb,  
         admin\_id UUID NOT NULL REFERENCES admins(id) ON DELETE CASCADE,  
         created\_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT\_TIMESTAMP,  
         updated\_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT\_TIMESTAMP,  
         is\_active BOOLEAN DEFAULT TRUE  
     );

     \-- Create the 'form\_responses' table  
     CREATE TABLE IF NOT EXISTS form\_responses (  
         form\_id UUID PRIMARY KEY REFERENCES forms(id) ON DELETE CASCADE,  
         data JSONB DEFAULT '{}'::jsonb,  
         last\_updated TIMESTAMP WITH TIME ZONE DEFAULT CURRENT\_TIMESTAMP,  
         contributors TEXT\[\] DEFAULT '{}',  
         version INTEGER DEFAULT 0 \-- For optimistic concurrency control  
     );

     \-- Add an index for faster lookups by form code  
     CREATE INDEX IF NOT EXISTS idx\_forms\_code ON forms (code);

     \-- Update updated\_at timestamp automatically on form changes  
     CREATE OR REPLACE FUNCTION update\_timestamp()  
     RETURNS TRIGGER AS $$  
     BEGIN  
         NEW.updated\_at \= NOW();  
         RETURN NEW;  
     END;  
     $$ LANGUAGE plpgsql;

     CREATE OR REPLACE TRIGGER update\_forms\_updated\_at  
     BEFORE UPDATE ON forms  
     FOR EACH ROW  
     EXECUTE FUNCTION update\_timestamp();

### **Frontend Setup**

1. **Navigate to the frontend directory:**  
   cd ../frontend

2. **Install frontend dependencies:**  
   npm install

### **Running the Application**

1. **Start the Backend Server:**  
   * Open a new terminal window.  
   * Navigate to the backend directory (cd collaborative-forms-app/backend).  
   * Run:  
     npm start

   * You should see a message like Collaborative Forms Server running at http://localhost:3001.  
2. **Start the Frontend Development Server:**  
   * Open another new terminal window.  
   * Navigate to the frontend directory (cd collaborative-forms-app/frontend).  
   * Run:  
     npm run dev

   * This will typically open your browser to http://localhost:5173.

Your collaborative forms application should now be running locally\!

## **Project Structure**

collaborative-forms-app/  
├── backend/  
│   ├── node\_modules/         \# Backend dependencies  
│   ├── .env                  \# Environment variables for backend (local)  
│   ├── package.json          \# Backend project metadata and scripts  
│   ├── server.js             \# Main backend server logic (Express, Socket.IO, DB)  
│   └── ...                   \# Other backend files  
├── frontend/  
│   ├── node\_modules/         \# Frontend dependencies  
│   ├── public/               \# Static assets  
│   ├── src/  
│   │   ├── App.jsx           \# Main React application component  
│   │   ├── index.css         \# Tailwind CSS imports  
│   │   └── main.jsx          \# React app entry point  
│   ├── .env.local            \# Environment variables for frontend (local)  
│   ├── package.json          \# Frontend project metadata and scripts  
│   ├── tailwind.config.js    \# Tailwind CSS configuration  
│   ├── postcss.config.js     \# PostCSS configuration  
│   └── ...                   \# Other frontend files  
├── .gitignore                \# Global Git ignore rules  
└── README.md                 \# This file

## **API Endpoints (Backend)**

Here's a summary of the main API endpoints provided by the backend:

### **Admin Authentication**

* POST /api/admin/register: Register a new admin account.  
* POST /api/admin/login: Log in an admin account and receive a JWT.

### **Forms Management (Admin Protected)**

* POST /api/forms: Create a new form.  
* GET /api/admin/forms: List all forms created by the authenticated admin.  
* GET /api/forms/id/:formId: Retrieve a specific form by its ID (admin only).  
* PUT /api/forms/:formId: Update a form's title.  
* PUT /api/forms/:formId/fields: Update a form's field structure.  
* PUT /api/forms/:formId/status: Toggle a form's active status.  
* DELETE /api/forms/:formId: Delete a form.  
* GET /api/forms/:formId/stats: Get statistics for a form.

### **Public Form Access (User Accessible)**

* GET /api/forms/:code: Retrieve a form and its current response data using the share code.

### **WebSocket Events (Real-time Collaboration)**

* joinForm: User joins a form's collaborative session.  
* updateField: A user updates a field's value.  
* lockField: A user starts editing a field.  
* unlockField: A user stops editing a field.  
* userTyping: A user is actively typing in a field.  
* disconnect: A user disconnects from a session.  
* fieldUpdated: (Emitted by server) Notifies clients of a field update.  
* fieldLocked, fieldUnlocked, userTypingUpdate: (Emitted by server) Real-time updates on field status.  
* formStructureUpdated: (Emitted by server) Notifies clients when admin changes form fields.  
* formDeleted: (Emitted by server) Notifies clients when a form is deleted.  
* formDeactivated: (Emitted by server) Notifies clients when a form is deactivated.  
* fieldUpdateConflict: (Emitted by server) Notifies client of an optimistic locking conflict.

