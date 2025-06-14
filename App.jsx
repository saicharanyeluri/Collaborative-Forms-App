// src/App.jsx
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Users, Plus, Trash2, Settings, Share2, UserCheck, Clock, Eye, Edit3, Copy, Check, X, Lock, Facebook, Twitter, Linkedin, Mail, Share, UserPlus, LogIn } from 'lucide-react';
import io from 'socket.io-client';

const CollaborativeFormSystem = () => {
  const [currentView, setCurrentView] = useState('home'); // 'home', 'admin', 'form'
  // User state no longer includes 'token'
  const [user, setUser] = useState({ id: '', name: '', role: 'user' }); 
  const [socket, setSocket] = useState(null);
  const [forms, setForms] = useState([]); // List of forms for admin dashboard
  const [currentForm, setCurrentForm] = useState(null); // The form currently being viewed/edited
  const [formResponse, setFormResponse] = useState({}); // Current collaborative response data
  const [activeUsers, setActiveUsers] = useState([]); // Users currently in the same form room
  const [lockedFields, setLockedFields] = useState({}); // Fields locked by other users
  const [typingUsers, setTypingUsers] = useState({}); // Users currently typing in a field
  const [joinCode, setJoinCode] = useState(''); // State for user-entered join code
  const [userName, setUserName] = useState(''); // State for user-entered name
  const [isConnected, setIsConnected] = useState(false); // Socket connection status
  const [editingForm, setEditingForm] = useState(null); // Form being edited in the builder
  const [copiedCode, setCopiedCode] = useState(''); // For copy-to-clipboard feedback
  const [showDeleteModal, setShowDeleteModal] = useState(null); // Form object for delete confirmation
  const [showShareModal, setShowShareModal] = useState(null); // Form object for share modal
  const [newFormTitle, setNewFormTitle] = useState(''); // Input for new form title
  // Admin credentials for login/registration
  const [adminCredentials, setAdminCredentials] = useState({ username: '', password: '' }); 
  const [adminError, setAdminError] = useState(''); // Admin login/registration error message
  const [showCreateFormModal, setShowCreateFormModal] = useState(false); // Visibility of create form modal
  // 'landing', 'user-join', 'admin-login', 'admin-register'
  const [currentPage, setCurrentPage] = useState('landing'); 
  const typingTimers = useRef({}); // Ref to manage typing timeouts
  const [showSavedMessage, setShowSavedMessage] = useState(false); // State for "Saved!" message


  // Initialize socket connection on component mount
  useEffect(() => {
    const newSocket = io('http://localhost:3001'); // Connect to your backend server
    setSocket(newSocket);
    
    // Socket connection event listeners
    newSocket.on('connect', () => {
      setIsConnected(true);
      console.log('Socket Connected!');
    });
    
    newSocket.on('disconnect', () => {
      setIsConnected(false);
      console.log('Socket Disconnected!');
    });

    // Clean up socket connection on component unmount
    return () => newSocket.close();
  }, []);

  // Socket event listeners for real-time collaboration
  useEffect(() => {
    if (!socket) return;

    socket.on('userJoined', ({ activeUsers }) => { setActiveUsers(activeUsers); });
    socket.on('userLeft', ({ activeUsers }) => { setActiveUsers(activeUsers); });
    socket.on('activeUsers', ({ activeUsers }) => { setActiveUsers(activeUsers); });
    
    socket.on('fieldUpdated', ({ fieldId, value, timestamp }) => {
      setFormResponse(prev => ({
        ...prev,
        [fieldId]: value,
        lastUpdated: timestamp 
      }));
      setShowSavedMessage(true);
      setTimeout(() => setShowSavedMessage(false), 2000);
    });

    socket.on('fieldLocked', ({ fieldId, lockedBy, userId }) => {
      setLockedFields(prev => ({ ...prev, [fieldId]: { lockedBy, userId } }));
    });
    socket.on('fieldUnlocked', ({ fieldId }) => {
      setLockedFields(prev => {
        const updated = { ...prev };
        delete updated[fieldId];
        return updated;
      });
    });
    socket.on('unlockAllFieldsForUser', ({ userId }) => {
      setLockedFields(prev => {
        const updated = {};
        Object.entries(prev).forEach(([fieldId, lock]) => {
          if (lock.userId !== userId) { updated[fieldId] = lock; }
        });
        return updated;
      });
    });

    socket.on('userTypingUpdate', ({ fieldId, userName, isTyping }) => {
      setTypingUsers(prev => {
        const updated = { ...prev };
        if (isTyping) { updated[fieldId] = userName; } else { delete updated[fieldId]; }
        return updated;
      });
    });

    socket.on('formStructureUpdated', ({ fields }) => {
      if (currentForm) { setCurrentForm(prev => ({ ...prev, fields })); }
    });

    // Handle generic socket errors
    socket.on('error', (data) => {
      console.error("Socket Error:", data.message);
      // Display a user-friendly error message, e.g., using a toast notification
    });

    return () => {
      socket.off('userJoined');
      socket.off('userLeft');
      socket.off('activeUsers');
      socket.off('fieldUpdated');
      socket.off('fieldLocked');
      socket.off('fieldUnlocked');
      socket.off('unlockAllFieldsForUser');
      socket.off('userTypingUpdate');
      socket.off('formStructureUpdated');
      socket.off('error'); // Clean up custom error listener
    };
  }, [socket, currentForm]);

  // Utility function to generate a unique user ID for session (for non-admin users)
  const generateUserId = () => {
    return Math.random().toString(36).substring(2, 9);
  };

  // ----------------------
  // 🔑 Admin Authentication Functions (Simplified - No JWT)
  // ----------------------

  // Function to register a new admin
  const registerAdmin = async () => {
    if (!adminCredentials.username.trim() || !adminCredentials.password.trim()) {
      setAdminError('Username and password cannot be empty.');
      return;
    }
    setAdminError(''); // Clear previous errors
    try {
      const response = await fetch('http://localhost:3001/api/admin/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(adminCredentials)
      });
      const data = await response.json();
      if (data.success && data.admin) { // Backend should return the admin ID on success
        console.log("Admin registered successfully. Logging in...");
        // Directly set user state and navigate to admin view
        setUser({ id: data.admin.id, name: data.admin.username, role: 'admin' });
        setCurrentView('admin'); // Navigate to admin dashboard
        setCurrentPage(''); // Clear landing page state
        setAdminCredentials({ username: '', password: '' }); // Clear inputs
      } else {
        setAdminError(data.error || 'Failed to register admin.');
      }
    } catch (error) {
      console.error('Error registering admin:', error);
      setAdminError('Network error or server unreachable during registration.');
    }
  };

  // Function to log in an admin
  const adminLogin = async () => {
    if (!adminCredentials.username.trim() || !adminCredentials.password.trim()) {
      setAdminError('Username and password are required.');
      return;
    }
    setAdminError(''); // Clear previous errors
    try {
      const response = await fetch('http://localhost:3001/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(adminCredentials)
      });
      const data = await response.json();
      if (data.success && data.admin) { // Backend should return admin details on success
        // Directly set user state without a token
        setUser({ id: data.admin.id, name: data.admin.username, role: 'admin' });
        setCurrentView('admin'); // Navigate to admin dashboard
        setCurrentPage(''); // Clear landing page state
        setAdminCredentials({ username: '', password: '' }); // Clear inputs after successful login
      } else {
        setAdminError(data.error || 'Invalid credentials.');
      }
    } catch (error) {
      console.error('Error logging in admin:', error);
      setAdminError('Network error or server unreachable during login.');
    }
  };

  // Admin Logout function
  const adminLogout = () => {
    setUser({ id: '', name: '', role: 'user' }); // Reset user state
    setCurrentView('home'); // Go back to home view
    setCurrentPage('landing'); // Go back to landing page
    setAdminError(''); // Clear any admin errors
  };

  // ----------------------
  // 📝 Form Management Functions (Admin-only, now passing adminId directly)
  // ----------------------

  const createForm = async () => {
    if (!newFormTitle.trim()) {
      console.warn('Form title cannot be empty.');
      return; 
    }
    if (!user.id) { // Ensure adminId is available from user state
      console.error('Admin ID not available for form creation.');
      adminLogout(); // Force logout if admin ID is missing unexpectedly
      return;
    }
    try {
      const response = await fetch('http://localhost:3001/api/forms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // Pass adminId directly in the body
        body: JSON.stringify({ title: newFormTitle, fields: [], adminId: user.id }) 
      });
      
      const data = await response.json();
      if (data.success) {
        setForms(prev => [...prev, {
          ...data.form,
          createdAt: data.form.created_at || data.form.createdAt, 
          activeUsers: 0,
          response: data.response ? { // Ensure response object from backend is used
            data: data.response.data || {},
            contributors: data.response.contributors || [],
            lastUpdated: data.response.last_updated || data.form.created_at
          } : { data: {}, contributors: [], lastUpdated: data.form.created_at }
        }]);
        setNewFormTitle('');
        setShowCreateFormModal(false);
      } else {
        console.error('Failed to create form:', data.error || 'Unknown error');
      }
    } catch (error) {
      console.error('Error creating form:', error);
    }
  };

  const deleteForm = async (formId) => {
    if (!user.id) {
      console.error('Admin ID not available for form deletion.');
      adminLogout();
      return;
    }
    try {
      // Pass adminId as a query parameter for DELETE request
      const response = await fetch(`http://localhost:3001/api/forms/${formId}?adminId=${user.id}`, {
        method: 'DELETE',
      });
      
      const data = await response.json();
      if (data.success) {
        setShowDeleteModal(null);
        setForms(prev => prev.filter(form => form.id !== formId));
      } else {
        console.error('Failed to delete form:', data.error);
      }
    } catch (error) {
      console.error('Error deleting form:', error);
    }
  };

  // Using useCallback to memoize loadAdminForms to prevent unnecessary re-renders
  const loadAdminForms = useCallback(async () => {
    if (!user.id || user.role !== 'admin') return; // Only load if admin is logged in
    try {
      // Pass adminId as a query parameter for GET request
      const response = await fetch(`http://localhost:3001/api/admin/forms?adminId=${user.id}`);
      const data = await await response.json(); // Double await just in case
      console.log("Forms data received for admin:", data); // Log the raw data received

      if (data.success) {
        const formattedForms = data.forms.map(form => ({
          ...form,
          createdAt: form.created_at,
          adminId: form.admin_id,
          isActive: form.is_active,
          // Ensure response.data and response.contributors are always valid
          response: form.response ? {
            data: form.response.data || {}, // Ensure data is an object
            contributors: form.response.contributors || [], // Ensure contributors is an array
            lastUpdated: form.response.lastUpdated || form.created_at // Ensure lastUpdated is available
          } : { data: {}, contributors: [], lastUpdated: form.created_at } // Fallback for forms without response
        }));
        console.log("Formatted forms for admin dashboard:", formattedForms); // Log formatted data
        setForms(formattedForms);
      } else {
        console.error('Failed to load admin forms:', data.error);
      }
    } catch (error) {
      console.error('Error loading admin forms:', error);
    }
  }, [user.id, user.role]); // Dependency: user.id and user.role

  // Effect to load admin forms when admin dashboard is active and user ID changes
  useEffect(() => {
    if (user.role === 'admin' && currentView === 'admin' && user.id) {
      loadAdminForms();
    }
  }, [user.role, currentView, user.id, loadAdminForms]);


  // ----------------------
  // 👥 User-Side Form Interaction (still uses form code, no token required for user viewing)
  // ----------------------

  const joinForm = async (code) => {
    if (!userName.trim() || !code.trim()) {
      console.warn('Please enter your name and the form code.');
      return;
    }
    try {
      const response = await fetch(`http://localhost:3001/api/forms/${code}`);
      const data = await response.json();
      
      if (data.success) {
        const userId = generateUserId();
        setUser({ id: userId, name: userName, role: 'user' }); // Regular users don't have tokens
        
        setCurrentForm({
          ...data.form,
          createdAt: data.form.created_at
        });
        setFormResponse(data.response.data || {});
        
        socket.emit('joinForm', {
          formId: data.form.id,
          userId: userId,
          userName: userName
        });
        
        setCurrentView('form');
        setCurrentPage('');
      } else {
        console.warn('Form not found or inactive:', data.error);
      }
    }
    catch (error) {
      console.error('Error joining form:', error);
    }
  };

  const updateField = (fieldId, value) => {
    setFormResponse(prev => ({ ...prev, [fieldId]: value }));
    socket.emit('updateField', {
      formId: currentForm.id,
      fieldId,
      value,
      userId: user.id,
      userName: user.name
    });
  };

  const handleFieldFocus = (fieldId) => {
    socket.emit('lockField', { formId: currentForm.id, fieldId, userId: user.id, userName: user.name });
  };
  const handleFieldBlur = (fieldId) => {
    socket.emit('unlockField', { formId: currentForm.id, fieldId, userId: user.id });
  };
  const handleTyping = (fieldId, isTyping) => {
    socket.emit('userTyping', { fieldId, userName: user.name, isTyping, formId: currentForm.id });
  };

  // ----------------------
  // 🎨 UI/Helper Functions
  // ----------------------

  const copyToClipboard = async (text) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedCode(text);
      setTimeout(() => setCopiedCode(''), 2000);
    } catch (err) {
      console.error('Failed to copy using clipboard API:', err);
      const textArea = document.createElement("textarea");
      textArea.value = text;
      textArea.style.position = "fixed"; textArea.style.left = "-999999px";
      document.body.appendChild(textArea);
      textArea.focus(); textArea.select();
      try { document.execCommand('copy'); setCopiedCode(text); setTimeout(() => setCopiedCode(''), 2000); } 
      catch (copyErr) { console.error('Fallback: Oops, unable to copy text', copyErr); }
      finally { document.body.removeChild(textArea); }
    }
  };

  const shareForm = (form) => {
    const formUrl = `${window.location.origin}?join=${form.code}`;
    const shareData = { title: form.title, text: `Join me in filling out the form: ${form.title}`, url: formUrl };
    if (navigator.share) { navigator.share(shareData).catch(console.error); } else { copyToClipboard(formUrl); }
  };

  const handleSocialShare = (platform, form) => {
    const formUrl = encodeURIComponent(`${window.location.origin}?join=${form.code}`);
    const title = encodeURIComponent(`Join me in filling out: ${form.title}`);
    let url = '';
    switch(platform) {
      case 'facebook': url = `https://www.facebook.com/sharer/sharer.php?u=${formUrl}`; break;
      case 'twitter': url = `https://twitter.com/intent/tweet?text=${title}&url=${formUrl}`; break;
      case 'linkedin': url = `https://www.linkedin.com/shareArticle?mini=true&url=${formUrl}&title=${title}`; break;
      case 'whatsapp': url = `https://wa.me/?text=${title} ${formUrl}`; break;
      case 'email': url = `mailto:?subject=${title}&body=${title}%0D%0A${formUrl}`; break;
      default: return;
    }
    window.open(url, '_blank');
  };

  // ----------------------
  // 🛠️ Form Builder Functions (Admin-only)
  // ----------------------

  const addField = () => {
    const newField = { id: `field_${Date.now()}`, type: 'text', label: 'New Field', required: false, options: [] };
    setEditingForm(prev => ({ ...prev, fields: [...prev.fields, newField] }));
  };
  const updateFormField = (fieldId, updates) => {
    setEditingForm(prev => ({
      ...prev,
      fields: prev.fields.map(field => field.id === fieldId ? { ...field, ...updates } : field)
    }));
  };
  const removeField = (fieldId) => {
    setEditingForm(prev => ({ ...prev, fields: prev.fields.filter(field => field.id !== fieldId) }));
  };
  const saveFormStructure = async () => {
    if (!user.id) {
      console.error('Admin ID not available for saving form structure.');
      adminLogout();
      return;
    }
    try {
      // Pass adminId directly in the body
      const response = await fetch(`http://localhost:3001/api/forms/${editingForm.id}/fields`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields: editingForm.fields, adminId: user.id }) 
      });
      const data = await response.json();
      if (data.success) {
        setEditingForm(null);
        loadAdminForms();
      } else {
        console.error('Failed to save form structure:', data.error);
      }
    } catch (error) {
      console.error('Error saving form structure:', error);
    }
  };
  const addFieldOption = (fieldId) => {
    setEditingForm(prev => ({
      ...prev,
      fields: prev.fields.map(field => 
        field.id === fieldId ? { ...field, options: [...(field.options || []), 'New Option'] } : field
      )
    }));
  };
  const updateFieldOption = (fieldId, optionIndex, value) => {
    setEditingForm(prev => ({
      ...prev,
      fields: prev.fields.map(field => 
        field.id === fieldId ? { ...field, options: field.options.map((option, index) => index === optionIndex ? value : option) } : field
      )
    }));
  };
  const removeFieldOption = (fieldId, optionIndex) => {
    setEditingForm(prev => ({
      ...prev,
      fields: prev.fields.map(field => 
        field.id === fieldId 
          ? { ...field, options: field.options.filter((_, index) => index !== optionIndex) }
          : field
      )
    }));
  };

  // Auto-join from URL parameter
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    // Corrected: Use urlParams.get instead of a potentially undefined 'url.get'
    const joinCodeFromUrl = urlParams.get('join'); 
    if (joinCodeFromUrl && !sessionStorage.getItem('hasAutoJoined')) {
      setJoinCode(joinCodeFromUrl);
      sessionStorage.setItem('hasAutoJoined', 'true'); 
    }
  }, []);

  // ----------------------
  // 🖥️ Render Modals
  // ----------------------

  const renderFormBuilder = () => {
    if (!editingForm) return null;
    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4 font-inter">
        <div className="bg-white rounded-lg shadow-xl w-full max-w-4xl max-h-[90vh] flex flex-col">
          <div className="p-6 border-b border-gray-200 flex justify-between items-center flex-shrink-0">
            <h2 className="text-2xl font-bold text-gray-800">Edit Form: <span className="text-blue-600">{editingForm.title}</span></h2>
            <div className="flex space-x-3">
              <button onClick={saveFormStructure} className="bg-green-600 text-white px-5 py-2 rounded-lg hover:bg-green-700 flex items-center space-x-2 transition duration-200 shadow-md">
                <Check size={18} /><span className="font-semibold">Save Changes</span>
              </button>
              <button onClick={() => setEditingForm(null)} className="bg-gray-500 text-white px-5 py-2 rounded-lg hover:bg-gray-600 flex items-center space-x-2 transition duration-200 shadow-md">
                <X size={18} /><span className="font-semibold">Cancel</span>
              </button>
            </div>
          </div>
          <div className="p-6 overflow-y-auto flex-grow">
            <div className="space-y-6">
              {editingForm.fields?.length === 0 && (<div className="text-center py-10 text-gray-500 text-lg">No fields added yet. Click "Add New Field" to start!</div>)}
              {editingForm.fields?.map((field, index) => (
                <div key={field.id} className="border border-gray-200 rounded-lg p-5 bg-white shadow-sm hover:shadow-md transition duration-200">
                  <div className="flex justify-between items-center mb-4 pb-2 border-b border-gray-100">
                    <h3 className="text-lg font-semibold text-gray-700">Field {index + 1}: <span className="text-purple-600">{field.label}</span></h3>
                    <button onClick={() => removeField(field.id)} className="text-red-500 hover:text-red-700 transition duration-200 p-2 rounded-full hover:bg-red-50" title="Remove Field"><Trash2 size={18} /></button>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-5 mb-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Field Label</label>
                      <input type="text" value={field.label} onChange={(e) => updateFormField(field.id, { label: e.target.value })}
                        className="w-full px-4 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 transition duration-200" placeholder="e.g., Your Full Name"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Field Type</label>
                      <select value={field.type} onChange={(e) => updateFormField(field.id, { type: e.target.value, options: (e.target.value === 'select' || e.target.value === 'radio') ? ['Option 1'] : [] })}
                        className="w-full px-4 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 transition duration-200 bg-white"
                      >
                        <option value="text">Text Input</option>
                        <option value="email">Email</option>
                        <option value="number">Number</option>
                        <option value="textarea">Multi-line Text (Textarea)</option>
                        <option value="select">Dropdown (Select)</option>
                        <option value="radio">Radio Buttons</option>
                        <option value="checkbox">Checkbox</option>
                        <option value="date">Date Picker</option>
                        <option value="tel">Phone Number</option>
                        <option value="url">URL</option>
                      </select>
                    </div>
                  </div>
                  <div className="mt-4 flex items-center">
                    <label className="flex items-center space-x-2 cursor-pointer">
                      <input type="checkbox" checked={field.required} onChange={(e) => updateFormField(field.id, { required: e.target.checked })}
                        className="rounded border-gray-300 text-blue-600 focus:ring-blue-500 h-5 w-5 transition duration-200"
                      /><span className="text-sm text-gray-700">Required field</span>
                    </label>
                  </div>
                  {(field.type === 'select' || field.type === 'radio') && (
                    <div className="mt-5 p-4 border border-gray-100 rounded-md bg-gray-50">
                      <label className="block text-sm font-medium text-gray-700 mb-3">Options</label>
                      <div className="space-y-3">
                        {field.options?.map((option, optionIndex) => (
                          <div key={optionIndex} className="flex space-x-2 items-center">
                            <input type="text" value={option} onChange={(e) => updateFieldOption(field.id, optionIndex, e.target.value)}
                              className="flex-1 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 transition duration-200"
                              placeholder={`Option ${optionIndex + 1}`}
                            />
                            <button onClick={() => removeFieldOption(field.id, optionIndex)} className="text-red-500 hover:text-red-700 transition duration-200 p-1 rounded-full hover:bg-red-100" title="Remove Option">
                              <X size={16} />
                            </button>
                          </div>
                        ))}
                        <button onClick={() => addFieldOption(field.id)} className="text-blue-600 hover:text-blue-800 text-sm flex items-center space-x-1 transition duration-200 px-3 py-1 rounded-md hover:bg-blue-100">
                          <Plus size={14} /><span>Add Option</span>
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
              <button onClick={addField} className="w-full border-2 border-dashed border-blue-300 text-blue-600 rounded-lg p-5 text-lg hover:border-blue-400 hover:text-blue-700 flex items-center justify-center space-x-2 transition duration-200 bg-blue-50 hover:bg-blue-100">
                <Plus size={24} /><span className="font-semibold">Add New Field</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  };

  const renderDeleteModal = (form) => {
    if (!form) return null;
    return (
      <div className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center z-50 p-4 font-inter">
        <div className="bg-white rounded-xl shadow-2xl p-7 w-full max-w-md scale-animation">
          <div className="flex justify-between items-center mb-5 border-b pb-3 border-gray-100">
            <h3 className="text-xl font-bold text-gray-800">Confirm Deletion</h3>
            <button onClick={() => setShowDeleteModal(null)} className="text-gray-500 hover:text-gray-700 transition duration-200 p-1 rounded-full hover:bg-gray-100">
              <X size={20} />
            </button>
          </div>
          <p className="text-gray-700 mb-7 text-center leading-relaxed">
            Are you sure you want to delete form <br/><strong className="text-red-600">"{form.title}"</strong>? 
            This action cannot be undone and all data will be lost.
          </p>
          <div className="flex justify-end space-x-4">
            <button onClick={() => setShowDeleteModal(null)}
              className="px-6 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-100 transition duration-200 font-medium">Cancel</button>
            <button onClick={() => deleteForm(form.id)}
              className="px-6 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition duration-200 font-semibold shadow-md">
              Delete Permanently
            </button>
          </div>
        </div>
      </div>
    );
  };

  const renderShareModal = (form) => {
    if (!form) return null;
    const formUrl = `${window.location.origin}?join=${form.code}`;
    return (
      <div className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center z-50 p-4 font-inter">
        <div className="bg-white rounded-xl shadow-2xl p-7 w-full max-w-md scale-animation">
          <div className="flex justify-between items-center mb-5 border-b pb-3 border-gray-100">
            <h3 className="text-xl font-bold text-gray-800">Share Form: <span className="text-blue-600">{form.title}</span></h3>
            <button onClick={() => setShowShareModal(null)} className="text-gray-500 hover:text-gray-700 transition duration-200 p-1 rounded-full hover:bg-gray-100">
              <X size={20} />
            </button>
          </div>
          <div className="mb-6">
            <div className="flex items-center justify-between mb-3">
              <span className="text-base font-medium text-gray-700">Direct Share Link:</span>
              <button onClick={() => copyToClipboard(formUrl)}
                className="text-blue-600 hover:text-blue-800 flex items-center space-x-1 transition duration-200 text-sm font-semibold">
                {copiedCode === formUrl ? (<><Check size={16} className="text-green-500" /><span>Copied!</span></>) : (<><Copy size={16} /><span>Copy Link</span></>)}
              </button>
            </div>
            <div className="bg-gray-100 p-4 rounded-lg text-gray-700 text-base break-all font-mono border border-gray-200">{formUrl}</div>
          </div>
          <div className="mb-7">
            <h4 className="text-base font-medium text-gray-700 mb-3">Share via Social Media:</h4>
            <div className="flex justify-center space-x-5">
              <button onClick={() => handleSocialShare('facebook', form)}
                className="w-14 h-14 rounded-full bg-blue-600 text-white flex items-center justify-center hover:bg-blue-700 transition duration-200 shadow-md hover:scale-105" title="Share on Facebook">
                <Facebook size={24} />
              </button>
              <button onClick={() => handleSocialShare('twitter', form)}
                className="w-14 h-14 rounded-full bg-blue-400 text-white flex items-center justify-center hover:bg-blue-500 transition duration-200 shadow-md hover:scale-105" title="Share on X (Twitter)">
                <Twitter size={24} />
              </button>
              <button onClick={() => handleSocialShare('linkedin', form)}
                className="w-14 h-14 rounded-full bg-blue-700 text-white flex items-center justify-center hover:bg-blue-800 transition duration-200 shadow-md hover:scale-105" title="Share on LinkedIn">
                <Linkedin size={24} />
              </button>
              <button onClick={() => handleSocialShare('whatsapp', form)}
                className="w-14 h-14 rounded-full bg-green-500 text-white flex items-center justify-center hover:bg-green-600 transition duration-200 shadow-md hover:scale-105" title="Share on WhatsApp">
                <Share size={24} />
              </button>
              <button onClick={() => handleSocialShare('email', form)}
                className="w-14 h-14 rounded-full bg-gray-500 text-white flex items-center justify-center hover:bg-gray-600 transition duration-200 shadow-md hover:scale-105" title="Share via Email">
                <Mail size={24} />
              </button>
            </div>
          </div>
          <button onClick={() => shareForm(form)}
            className="w-full py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 flex items-center justify-center space-x-2 transition duration-200 font-semibold shadow-md">
            <Share2 size={18} /><span>Share via Device (Native Share)</span>
          </button>
        </div>
      </div>
    );
  };

  const renderCreateFormModal = () => {
    return (
      <div className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center z-50 p-4 font-inter">
        <div className="bg-white rounded-xl shadow-2xl p-7 w-full max-w-md scale-animation">
          <div className="flex justify-between items-center mb-5 border-b pb-3 border-gray-100">
            <h3 className="text-xl font-bold text-gray-800">Create New Form</h3>
            <button onClick={() => setShowCreateFormModal(false)} className="text-gray-500 hover:text-gray-700 transition duration-200 p-1 rounded-full hover:bg-gray-100">
              <X size={20} />
            </button>
          </div>
          
          <div className="mb-6">
            <label htmlFor="newFormTitle" className="block text-base font-medium text-gray-700 mb-2">
              Form Title
            </label>
            <input
              type="text" id="newFormTitle" value={newFormTitle} onChange={(e) => setNewFormTitle(e.target.value)}
              placeholder="e.g., Team Project Feedback"
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-800 transition duration-200"
            />
          </div>
          
          <div className="flex justify-end space-x-4">
            <button onClick={() => setShowCreateFormModal(false)}
              className="px-6 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-100 transition duration-200 font-medium">Cancel</button>
            <button onClick={createForm} disabled={!newFormTitle.trim()}
              className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition duration-200 font-semibold shadow-md">
              Create Form
            </button>
          </div>
        </div>
      </div>
    );
  };

  const renderField = (field) => {
    const isLocked = lockedFields[field.id] && lockedFields[field.id].userId !== user.id;
    const lockInfo = lockedFields[field.id];
    const typingUser = typingUsers[field.id];
    const isAdmin = user.role === 'admin';

    // Determine the actual value to display in the field
    const displayValue = formResponse[field.id] !== undefined && formResponse[field.id] !== null
      ? String(formResponse[field.id])
      : '';

    return (
      <div key={field.id} className="mb-6 bg-white p-5 rounded-lg shadow-sm border border-gray-100 relative group transition-all duration-200">
        <label htmlFor={`field-${field.id}`} className="block text-base font-medium text-gray-700 mb-2">
          {field.label} {field.required && <span className="text-red-500 ml-1">*</span>}
        </label>
        
        <div className="relative">
          {field.type === 'text' || field.type === 'email' || field.type === 'url' || field.type === 'tel' ? (
            <input id={`field-${field.id}`} type={field.type} value={displayValue} onChange={(e) => updateField(field.id, e.target.value)}
              onFocus={() => handleFieldFocus(field.id)} onBlur={() => handleFieldBlur(field.id)}
              onKeyDown={() => { handleTyping(field.id, true); clearTimeout(typingTimers.current[field.id]); typingTimers.current[field.id] = setTimeout(() => { handleTyping(field.id, false); }, 1000); }}
              disabled={isLocked || isAdmin}
              className={`w-full px-4 py-2 border border-gray-300 rounded-lg text-gray-800 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 transition duration-200 ${ (isLocked || isAdmin) ? 'bg-gray-100 cursor-not-allowed' : '' }`}
              placeholder={`Enter ${field.label.toLowerCase()}`}
            />
          ) : field.type === 'number' ? (
            <input id={`field-${field.id}`} type="number" value={displayValue} onChange={(e) => updateField(field.id, e.target.value)}
              onFocus={() => handleFieldFocus(field.id)} onBlur={() => handleFieldBlur(field.id)} disabled={isLocked || isAdmin}
              className={`w-full px-4 py-2 border border-gray-300 rounded-lg text-gray-800 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 transition duration-200 ${ (isLocked || isAdmin) ? 'bg-gray-100 cursor-not-allowed' : '' }`}
              placeholder={`Enter ${field.label.toLowerCase()}`}
            />
          ) : field.type === 'date' ? (
            <input id={`field-${field.id}`} type="date" value={displayValue} onChange={(e) => updateField(field.id, e.target.value)}
              onFocus={() => handleFieldFocus(field.id)} onBlur={() => handleFieldBlur(field.id)} disabled={isLocked || isAdmin}
              className={`w-full px-4 py-2 border border-gray-300 rounded-lg text-gray-800 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 transition duration-200 ${ (isLocked || isAdmin) ? 'bg-gray-100 cursor-not-allowed' : '' }`}
            />
          ) : field.type === 'textarea' ? (
            <textarea id={`field-${field.id}`} value={displayValue} onChange={(e) => updateField(field.id, e.target.value)}
              onFocus={() => handleFieldFocus(field.id)} onBlur={() => handleFieldBlur(field.id)} disabled={isLocked || isAdmin} rows={4}
              className={`w-full px-4 py-2 border border-gray-300 rounded-lg text-gray-800 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 transition duration-200 ${ (isLocked || isAdmin) ? 'bg-gray-100 cursor-not-allowed' : '' }`}
              placeholder={`Enter detailed ${field.label.toLowerCase()}`}
            />
          ) : field.type === 'select' ? (
            <select id={`field-${field.id}`} value={displayValue} onChange={(e) => updateField(field.id, e.target.value)} 
              onFocus={() => handleFieldFocus(field.id)} onBlur={() => handleFieldBlur(field.id)} disabled={isLocked || isAdmin}
              className={`w-full px-4 py-2 border border-gray-300 rounded-lg text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500 transition duration-200 bg-white ${ (isLocked || isAdmin) ? 'bg-gray-100 cursor-not-allowed' : '' }`}
            >
              <option value="">Select an option</option>
              {field.options?.map(option => (<option key={option} value={option}>{option}</option>))}
            </select>
          ) : field.type === 'radio' ? (
            <div className="space-y-3 pt-1">
              {field.options?.map(option => (
                <label key={option} className="flex items-center space-x-2 cursor-pointer">
                  <input type="radio" name={field.id} value={option} checked={displayValue === option} // Use displayValue here
                    onChange={(e) => updateField(field.id, e.target.value)} disabled={isLocked || isAdmin}
                    className="h-5 w-5 text-blue-600 border-gray-300 focus:ring-blue-500 transition duration-200"
                  /><span className="text-base text-gray-800">{option}</span>
                </label>
              ))}
            </div>
          ) : field.type === 'checkbox' ? (
            <label className="flex items-center space-x-2 cursor-pointer pt-1">
              <input type="checkbox" checked={displayValue === 'true'} // Use displayValue here
                onChange={(e) => updateField(field.id, e.target.checked ? 'true' : 'false')} disabled={isLocked || isAdmin}
                className="rounded border-gray-300 text-blue-600 focus:ring-blue-500 h-5 w-5 transition duration-200"
              /><span className="text-base text-gray-800">Check this box</span>
            </label>
          ) : null}
          
          {isLocked && (<div className="absolute top-1/2 right-3 -translate-y-1/2 bg-yellow-100 text-yellow-800 px-3 py-1 rounded-full text-xs font-semibold flex items-center space-x-1 shadow-sm opacity-90">
              <Lock size={14} /><span>{lockInfo.lockedBy} editing</span>
            </div>)}
          {isAdmin && (<div className="absolute top-1/2 right-3 -translate-y-1/2 bg-blue-100 text-blue-800 px-3 py-1 rounded-full text-xs font-semibold shadow-sm opacity-90">
              Admin View Only
            </div>)}
        </div>
        
        {typingUser && typingUser !== user.name && !isAdmin && (
            <div className="absolute -bottom-7 left-0 text-xs text-blue-600 font-medium px-2 py-1 bg-blue-50 rounded-md">
              {typingUser} is typing...
            </div>
          )}
      </div>
    );
  };

  // --- Render different pages based on current state ---

  // Landing page: Choose role (User/Admin)
  if (currentPage === 'landing') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center font-inter text-gray-800">
        <div className="bg-white p-10 rounded-2xl shadow-xl w-full max-w-sm border border-gray-100">
          <h1 className="text-3xl font-extrabold text-center text-blue-700 mb-8">Collaborative Forms</h1>
          
          <div className="space-y-6">
            <div className="border border-blue-200 rounded-xl p-6 bg-blue-50 flex flex-col items-center shadow-inner">
              <h2 className="text-xl font-semibold text-blue-800 mb-4">Select Your Role</h2>
              
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 w-full">
                <button
                  onClick={() => setCurrentPage('user-join')}
                  className="bg-blue-600 text-white px-5 py-3 rounded-lg hover:bg-blue-700 flex flex-col items-center justify-center transition duration-300 transform hover:scale-105 shadow-md font-semibold"
                >
                  <Users size={28} className="mb-2" />
                  <span>Join as User</span>
                </button>
                
                <button
                  onClick={() => setCurrentPage('admin-login')}
                  className="bg-green-600 text-white px-5 py-3 rounded-lg hover:bg-green-700 flex flex-col items-center justify-center transition duration-300 transform hover:scale-105 shadow-md font-semibold"
                >
                  <LogIn size={28} className="mb-2" />
                  <span>Admin Login</span>
                </button>
                 <button
                  onClick={() => setCurrentPage('admin-register')} // Navigate to the new registration page
                  className="w-full bg-indigo-600 text-white px-5 py-3 rounded-lg hover:bg-indigo-700 flex flex-col items-center justify-center transition duration-300 transform hover:scale-105 shadow-md font-semibold sm:col-span-2"
                >
                  <UserPlus size={28} className="mb-2" />
                  <span>Register New Admin</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // User Join page: Enter name and form code
  if (currentPage === 'user-join') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center font-inter text-gray-800">
        <div className="bg-white p-10 rounded-2xl shadow-xl w-full max-w-sm border border-gray-100">
          <div className="flex justify-between items-center mb-6 border-b pb-4 border-gray-100">
            <h1 className="text-2xl font-bold text-blue-700">Join as User</h1>
            <button 
              onClick={() => setCurrentPage('landing')}
              className="text-gray-500 hover:text-gray-700 transition duration-200 p-2 rounded-full hover:bg-gray-100"
              title="Back to roles"
            >
              <X size={20} />
            </button>
          </div>
          
          <div className="space-y-6">
            <div className="space-y-4">
              <input
                type="text"
                placeholder="Your Name"
                value={userName}
                onChange={(e) => setUserName(e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-800 transition duration-200"
              />
              
              <input
                type="text"
                placeholder="Form Code"
                value={joinCode}
                onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-800 transition duration-200 uppercase"
              />
              
              <button
                onClick={() => joinForm(joinCode)}
                disabled={!userName.trim() || !joinCode.trim()}
                className="w-full bg-blue-600 text-white px-5 py-2 rounded-lg hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed flex items-center justify-center space-x-2 transition duration-200 font-semibold shadow-md"
              >
                <Users size={18} />
                <span>Join Form</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Admin Login page
  if (currentPage === 'admin-login') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center font-inter text-gray-800">
        <div className="bg-white p-10 rounded-2xl shadow-xl w-full max-w-sm border border-gray-100">
          <div className="flex justify-between items-center mb-6 border-b pb-4 border-gray-100">
            <h1 className="text-2xl font-bold text-green-700">Admin Login</h1>
            <button 
              onClick={() => setCurrentPage('landing')}
              className="text-gray-500 hover:text-gray-700 transition duration-200 p-2 rounded-full hover:bg-gray-100"
              title="Back to roles"
            >
              <X size={20} />
            </button>
          </div>
          
          <div className="space-y-4">
            <input
              type="text"
              placeholder="Username"
              value={adminCredentials.username}
              onChange={(e) => setAdminCredentials({...adminCredentials, username: e.target.value})}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 text-gray-800 transition duration-200"
            />
            
            <input
              type="password"
              placeholder="Password"
              value={adminCredentials.password}
              onChange={(e) => setAdminCredentials({...adminCredentials, password: e.target.value})}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 text-gray-800 transition duration-200"
            />
            
            {adminError && (
              <div className="text-red-500 text-sm mt-3">{adminError}</div>
            )}
            
            <button
              onClick={adminLogin}
              disabled={!adminCredentials.username || !adminCredentials.password}
              className="w-full bg-green-600 text-white px-5 py-2 rounded-lg hover:bg-green-700 disabled:bg-gray-400 disabled:cursor-not-allowed flex items-center justify-center space-x-2 transition duration-200 font-semibold shadow-md"
            >
              <LogIn size={18} />
              <span>Login</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Admin Registration page
  if (currentPage === 'admin-register') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center font-inter text-gray-800">
        <div className="bg-white p-10 rounded-2xl shadow-xl w-full max-w-sm border border-gray-100">
          <div className="flex justify-between items-center mb-6 border-b pb-4 border-gray-100">
            <h1 className="text-2xl font-bold text-indigo-700">Register Admin</h1>
            <button 
              onClick={() => setCurrentPage('landing')}
              className="text-gray-500 hover:text-gray-700 transition duration-200 p-2 rounded-full hover:bg-gray-100"
              title="Back to roles"
            >
              <X size={20} />
            </button>
          </div>
          
          <div className="space-y-4">
            <input
              type="text"
              placeholder="Choose Username"
              value={adminCredentials.username}
              onChange={(e) => setAdminCredentials({...adminCredentials, username: e.target.value})}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 text-gray-800 transition duration-200"
            />
            
            <input
              type="password"
              placeholder="Choose Password"
              value={adminCredentials.password}
              onChange={(e) => setAdminCredentials({...adminCredentials, password: e.target.value})}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 text-gray-800 transition duration-200"
            />
            
            {adminError && (
              <div className="text-red-500 text-sm mt-3">{adminError}</div>
            )}
            
            <button
              onClick={registerAdmin}
              disabled={!adminCredentials.username || !adminCredentials.password}
              className="w-full bg-indigo-600 text-white px-5 py-2 rounded-lg hover:bg-indigo-700 disabled:bg-gray-400 disabled:cursor-not-allowed flex items-center justify-center space-x-2 transition duration-200 font-semibold shadow-md"
            >
              <UserPlus size={18} />
              <span>Register</span>
            </button>
          </div>
        </div>
      </div>
    );
  }


  // Admin Dashboard View (The "Admin Home Thing")
  if (currentView === 'admin') {
    return (
      <div className="min-h-screen bg-gray-50 font-inter text-gray-800">
        <div className="bg-white shadow-sm border-b">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-5">
            <div className="flex justify-between items-center flex-wrap gap-4">
              <div>
                <h1 className="text-3xl font-bold text-blue-700">Admin Dashboard</h1>
                <p className="text-gray-600 text-lg mt-1">Welcome, <span className="font-semibold">{user.name}</span></p>
              </div>
              <div className="flex items-center space-x-4">
                <div className={`flex items-center space-x-2 px-3 py-1 rounded-full ${isConnected ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'} text-sm font-medium`}>
                  <div className={`w-2.5 h-2.5 rounded-full ${isConnected ? 'bg-green-500' : 'bg-red-500'}`}></div>
                  <span>{isConnected ? 'Connected' : 'Disconnected'}</span>
                </div>
                <button
                  onClick={() => setShowCreateFormModal(true)}
                  className="bg-blue-600 text-white px-5 py-2.5 rounded-lg hover:bg-blue-700 flex items-center space-x-2 transition duration-200 shadow-md font-semibold"
                >
                  <Plus size={18} />
                  <span>New Form</span>
                </button>
                <button
                  onClick={adminLogout} // Calls the secure adminLogout function
                  className="bg-gray-600 text-white px-5 py-2.5 rounded-lg hover:bg-gray-700 transition duration-200 shadow-md font-semibold"
                >
                  Logout
                </button>
              </div>
            </div>
          </div>
        </div>

        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
          <div className="grid gap-8 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {forms.map(form => (
              <div key={form.id} className="bg-white p-7 rounded-xl shadow-lg border border-gray-100 relative transform hover:scale-[1.02] hover:shadow-xl transition duration-300">
                <button 
                  onClick={() => setShowDeleteModal(form)}
                  className="absolute top-4 right-4 text-red-500 hover:text-red-700 transition duration-200 p-2 rounded-full hover:bg-red-50"
                  title="Delete Form"
                >
                  <Trash2 size={18} />
                </button>
                
                <h3 className="text-xl font-bold text-blue-700 mb-3 pr-8">{form.title}</h3>
                
                <div className="mb-5 border-t border-gray-100 pt-3">
                  <div className="flex items-center justify-between text-gray-600 mb-2">
                    <span className="text-sm font-medium">Share Code:</span>
                    <div className="flex items-center space-x-1">
                      <button
                        onClick={() => copyToClipboard(form.code)}
                        className="flex items-center space-x-1 text-blue-600 hover:text-blue-800 transition duration-200 text-sm font-semibold"
                      >
                        {copiedCode === form.code ? (
                          <Check size={16} className="text-green-500" />
                        ) : (
                          <Copy size={16} />
                        )}
                        <span>{copiedCode === form.code ? 'Copied!' : 'Copy Code'}</span>
                      </button>
                      <span className="font-mono text-base bg-gray-100 px-2 py-1 rounded">{form.code}</span>
                    </div>
                  </div>
                </div>
                
                <div className="flex flex-wrap items-center gap-4 text-sm text-gray-500 mb-6">
                  <div className="flex items-center space-x-1">
                    <Users size={16} className="text-blue-500" />
                    <span>{form.activeUsers} Active</span>
                  </div>
                  <div className="flex items-center space-x-1">
                    <UserCheck size={16} className="text-green-500" />
                    <span>{form.response?.contributors?.length || 0} Contributors</span>
                  </div>
                  <div className="flex items-center space-x-1">
                    <Clock size={16} className="text-purple-500" />
                    <span className="text-xs">Created: {new Date(form.createdAt).toLocaleDateString()}</span>
                  </div>
                </div>

                <div className="flex flex-col space-y-3">
                  <button
                    onClick={() => setEditingForm(form)}
                    className="w-full bg-blue-500 text-white px-4 py-2.5 rounded-lg text-base hover:bg-blue-600 flex items-center justify-center space-x-2 transition duration-200 font-semibold shadow-md"
                  >
                    <Edit3 size={16} />
                    <span>Edit Fields</span>
                  </button>
                  
                  <div className="flex space-x-3">
                    <button
                      onClick={() => {
                        console.log('Admin View Form Clicked. Form fields from "forms" state:', form.fields); 
                        console.log('Admin View Form Clicked. Form response data from "forms" state:', form.response?.data);
                        setCurrentForm(form);
                        setFormResponse(form.response?.data || {}); // Load existing response data
                        setCurrentView('form');
                        socket.emit('joinForm', { // Join the form's socket room
                          formId: form.id,
                          userId: user.id,
                          userName: user.name
                        });
                      }}
                      className="flex-1 bg-green-500 text-white px-4 py-2.5 rounded-lg text-base hover:bg-green-600 flex items-center justify-center space-x-2 transition duration-200 font-semibold shadow-md"
                    >
                      <Eye size={16} />
                      <span>View Form</span>
                    </button>
                    
                    <button
                      onClick={() => setShowShareModal(form)}
                      className="flex-1 bg-purple-500 text-white px-4 py-2.5 rounded-lg text-base hover:bg-purple-600 flex items-center justify-center space-x-2 transition duration-200 font-semibold shadow-md"
                    >
                      <Share2 size={16} />
                      <span>Share</span>
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {forms.length === 0 && (
            <div className="text-center py-20 bg-white rounded-xl shadow-lg mt-8 border border-gray-100">
              <p className="text-gray-600 text-xl font-medium mb-6">No forms created yet.</p>
              <button
                onClick={() => setShowCreateFormModal(true)}
                className="bg-blue-600 text-white px-8 py-4 rounded-xl hover:bg-blue-700 flex items-center space-x-3 mx-auto transition duration-300 transform hover:scale-105 shadow-lg font-semibold text-lg"
              >
                <Plus size={24} />
                <span>Create Your First Form</span>
              </button>
            </div>
          )}
        </div>

        {renderFormBuilder()}
        {showDeleteModal && renderDeleteModal(showDeleteModal)}
        {showShareModal && renderShareModal(showShareModal)}
        {showCreateFormModal && renderCreateFormModal()}
      </div>
    );
  }

  // Collaborative Form View (for both users and admins)
  if (currentView === 'form') {
    console.log('Rendering Form View. CurrentForm fields:', currentForm?.fields, 'Length:', currentForm?.fields?.length); 
    console.log('Rendering Form View. Current formResponse:', formResponse);


    return (
      <div className="min-h-screen bg-gray-50 font-inter text-gray-800">
        <div className="bg-white shadow-md border-b">
          <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-5">
            <div className="flex justify-between items-center flex-wrap gap-4">
              <div>
                <h1 className="text-3xl font-bold text-blue-700">{currentForm?.title}</h1>
                <div className="flex items-center space-x-4 text-base text-gray-600 mt-1">
                  <span>Code: <span className="font-mono bg-gray-100 px-2.5 py-1 rounded-md text-sm font-semibold text-purple-700">{currentForm?.code}</span></span>
                  {user.role === 'admin' && (
                    <span className="bg-green-100 text-green-800 px-3 py-1 rounded-full text-xs font-semibold">
                      Admin View
                    </span>
                  )}
                </div>
              </div>
              
              <div className="flex items-center space-x-4">
                <div className={`flex items-center space-x-2 px-3 py-1 rounded-full ${isConnected ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'} text-sm font-medium`}>
                  <div className={`w-2.5 h-2.5 rounded-full ${isConnected ? 'bg-green-500' : 'bg-red-500'}`}></div>
                  <span>{isConnected ? 'Connected' : 'Disconnected'}</span>
                </div>
                
                <div className="flex items-center space-x-2 text-gray-600">
                  <Users size={18} className="text-gray-500" />
                  <span className="text-base">{activeUsers.length} Active</span>
                </div>

                {user.role === 'admin' && (
                  <button
                    onClick={() => setShowShareModal(currentForm)}
                    className="bg-purple-600 text-white px-5 py-2.5 rounded-lg hover:bg-purple-700 flex items-center space-x-2 transition duration-200 font-semibold shadow-md"
                  >
                    <Share2 size={18} />
                    <span>Share</span>
                  </button>
                )}
                
                {/* Conditional Logout/Back button */}
                <button
                  onClick={() => {
                    if (socket && currentForm) {
                      socket.emit('leaveForm', { // Optional: notify backend user is leaving
                        formId: currentForm.id,
                        userId: user.id
                      });
                    }
                    
                    if (user.role === 'admin') {
                      setCurrentView('admin'); // Admin goes back to dashboard
                    } else {
                      setCurrentPage('landing'); // User goes back to landing page
                      setUser({ id: '', name: '', role: 'user' }); // Clear user data for regular user
                      setUserName(''); // Clear username input
                      setJoinCode(''); // Clear join code input
                      sessionStorage.removeItem('hasAutoJoined'); // Allow auto-join again if desired
                    }
                    
                    // Reset form-specific states regardless of role
                    setCurrentForm(null);
                    setFormResponse({});
                    setActiveUsers([]);
                    setLockedFields({});
                    setTypingUsers({});
                  }}
                  className="bg-gray-600 text-white px-5 py-2.5 rounded-lg hover:bg-gray-700 transition duration-200 font-semibold shadow-md"
                >
                  {user.role === 'admin' ? 'Back to Dashboard' : 'Logout'} {/* Changed to Logout for users */}
                </button>
              </div>
            </div>
          </div>
        </div>

        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
          <div className="bg-white p-8 rounded-xl shadow-lg border border-gray-100">
            <div className="mb-8 pb-6 border-b border-gray-100">
              <h2 className="text-xl font-semibold text-gray-700 mb-3">Active Collaborators</h2>
              <div className="flex flex-wrap gap-3">
                {activeUsers.map(activeUser => (
                  <span
                    key={`${activeUser.userId}-${activeUser.userName}`}
                    className={`px-4 py-1.5 rounded-full text-sm flex items-center space-x-2 ${
                      activeUser.userName === user.name
                        ? 'bg-blue-100 text-blue-800 border border-blue-200' // Highlight current user
                        : 'bg-gray-100 text-gray-700 border border-gray-200'
                    } font-medium`}
                  >
                    <UserCheck size={16} />
                    <span>
                      {activeUser.userName}
                      {activeUser.userName === user.name ? ' (You)' : ''}
                    </span>
                  </span>
                ))}
              </div>
            </div>

            {currentForm?.fields?.length > 0 ? (
              <div className="space-y-6">
                {currentForm.fields.map(field => renderField(field))}
              </div>
            ) : (
              <div className="text-center py-12 bg-gray-50 rounded-lg border border-dashed border-gray-200 text-gray-500">
                <p className="text-lg mb-2">No fields added to this form yet</p>
                {user.role === 'admin' && (
                  <p className="text-sm">
                    Go back to the admin dashboard to add fields
                  </p>
                )}
              </div>
            )}

            <div className="mt-8 pt-6 border-t border-gray-200">
              <div className="flex items-center justify-between text-base text-gray-500">
                <span>
                  {user.role === 'admin' 
                    ? 'Admin view - responses are read-only' 
                    : 'Collaborative response - all changes are saved automatically'
                  }
                </span>
                <div className="flex items-center space-x-2">
                  <Clock size={16} />
                  <span>
                    Last updated: {' '}
                    {/* Display actual last updated timestamp from formResponse state, or initial form creation time */}
                    {currentForm && (formResponse?.lastUpdated || currentForm.createdAt) ? (
                      new Date(formResponse.lastUpdated || currentForm.createdAt).toLocaleString()
                    ) : (
                      'N/A'
                    )}
                  </span>
                  {showSavedMessage && ( // "Saved!" indicator
                    <span className="text-green-600 ml-2 font-semibold animate-pulse">Saved!</span>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
        
        {showShareModal && renderShareModal(showShareModal)}
      </div>
    );
  }

  return null; // Fallback for any unhandled states/views
};

export default CollaborativeFormSystem;
