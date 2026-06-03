import { useState, useEffect, useMemo } from 'react';
import { BrowserRouter, Routes, Route, NavLink } from 'react-router-dom';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

// --- FIREBASE IMPORTS ---
import { auth, db } from './firebase';
import {
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
  signOut,
  onAuthStateChanged,
  updateProfile,
} from "firebase/auth";
import {
  collection,
  addDoc,
  onSnapshot,
  updateDoc,
  deleteDoc,
  doc,
  setDoc,
  getDoc,
  serverTimestamp,
} from "firebase/firestore";

const OVERVIEW_DATE_RANGE_KEY = 'boonhua_overview_date_range';

function getLast7DaysRange() {
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - 6);
  return {
    from: start.toISOString().slice(0, 10),
    to: end.toISOString().slice(0, 10),
  };
}

function loadStoredDateRange() {
  try {
    const raw = localStorage.getItem(OVERVIEW_DATE_RANGE_KEY);
    if (!raw) return null;
    const { dateFrom, dateTo } = JSON.parse(raw);
    if (dateFrom && dateTo) return { dateFrom, dateTo };
  } catch {
    /* ignore */
  }
  return null;
}

function saveStoredDateRange(dateFrom, dateTo) {
  try {
    localStorage.setItem(OVERVIEW_DATE_RANGE_KEY, JSON.stringify({ dateFrom, dateTo }));
  } catch {
    /* ignore */
  }
}

function normalizeSpeciesName(name) {
  return (name || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function formatSpeciesLabel(name) {
  return (name || '').trim().replace(/\s+/g, ' ');
}

function findInventoryMatches(inventory, species) {
  const key = normalizeSpeciesName(species);
  return inventory.filter(item => normalizeSpeciesName(item.species) === key);
}

/** One row per species (weights summed) for sales UI and stock checks. */
function consolidateInventoryBySpecies(inventory) {
  const merged = new Map();
  inventory.forEach(item => {
    const key = normalizeSpeciesName(item.species);
    if (!key) return;
    const weight = parseFloat(item.weight || 0);
    const price = parseFloat(item.price ?? 0);
    if (merged.has(key)) {
      const current = merged.get(key);
      current.weight = parseFloat(current.weight) + weight;
      current.price = price;
      current.sourceIds.push(item.id);
      if (weight > 0) current.primaryId = item.id;
    } else {
      merged.set(key, {
        id: item.id,
        primaryId: item.id,
        sourceIds: [item.id],
        species: formatSpeciesLabel(item.species),
        weight,
        price,
        status: item.status,
      });
    }
  });
  return [...merged.values()];
}

function stockStatusForWeight(weight) {
  if (weight <= 0) return 'Out of Stock';
  if (weight < 5) return 'Low Stock';
  return 'In Stock';
}

async function deductInventoryStock(inventory, species, quantityKg) {
  const matches = findInventoryMatches(inventory, species)
    .filter(item => parseFloat(item.weight || 0) > 0)
    .sort((a, b) => parseFloat(b.weight || 0) - parseFloat(a.weight || 0));

  let remaining = quantityKg;
  for (const item of matches) {
    if (remaining <= 0) break;
    const current = parseFloat(item.weight || 0);
    const deduct = Math.min(current, remaining);
    const nextWeight = Number((current - deduct).toFixed(1));
    remaining = Number((remaining - deduct).toFixed(3));
    await updateDoc(doc(db, 'inventory', item.id), {
      weight: nextWeight,
      status: stockStatusForWeight(nextWeight),
      updatedAt: serverTimestamp(),
    });
  }

  if (remaining > 0.0001) {
    throw new Error(`Could not deduct full quantity. ${remaining.toFixed(1)} kg still unallocated in inventory.`);
  }
}

// ==========================================
// SHARED: Sidebar NavLink helper
// ==========================================
const SidebarLink = ({ to, icon, label }) => (
  <NavLink
    to={to}
    className={({ isActive }) =>
      `flex items-center px-4 py-3 rounded-xl transition-all font-semibold text-sm ${
        isActive
          ? 'bg-[#4379EE] text-white shadow-lg shadow-blue-900/30'
          : 'text-slate-400 hover:bg-slate-800/60 hover:text-white'
      }`
    }
  >
    <span className="mr-3 text-base">{icon}</span>
    {label}
  </NavLink>
);

// ==========================================
// 1. SETTINGS PAGE
// ==========================================
const SettingsPage = ({ currentUser }) => {
  const [activeTab, setActiveTab] = useState('profile');
  const [resetSent, setResetSent] = useState(false);
  const [saveMsg, setSaveMsg] = useState('');
  const [profileData, setProfileData] = useState({ fullName: '', phone: '' });
  const [storeData, setStoreData] = useState({ storeName: '', address: '', openingTime: '', closingTime: '' });
  const [apiConfig, setApiConfig] = useState({ recipeApiBaseUrl: '' });
  const [isLoadingProfile, setIsLoadingProfile] = useState(true);

  // Load existing profile from Firestore on mount
  useEffect(() => {
    if (!currentUser) return;
    const loadProfile = async () => {
      try {
        const snap = await getDoc(doc(db, 'adminProfiles', currentUser.uid));
        if (snap.exists()) {
          const data = snap.data();
          setProfileData({ fullName: data.fullName || '', phone: data.phone || '' });
        }
      } catch (e) {
        console.error('Error loading profile:', e);
      } finally {
        setIsLoadingProfile(false);
      }
    };
    loadProfile();
  }, [currentUser]);

  useEffect(() => {
    const unsubscribe = onSnapshot(doc(db, 'storeSettings', 'main'), (snap) => {
      if (snap.exists()) {
        const data = snap.data();
        setStoreData({
          storeName: data.storeName || '',
          address: data.address || '',
          openingTime: data.openingTime || '',
          closingTime: data.closingTime || '',
        });
      }
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    const unsubscribe = onSnapshot(doc(db, 'app_config', 'public'), (snap) => {
      if (snap.exists()) {
        const data = snap.data();
        setApiConfig({ recipeApiBaseUrl: data.recipeApiBaseUrl || '' });
      }
    });
    return () => unsubscribe();
  }, []);

  // FIX: Profile save actually persists to Firestore + Firebase Auth displayName
  const handleProfileSave = async (e) => {
    e.preventDefault();
    try {
      await setDoc(doc(db, 'adminProfiles', currentUser.uid), {
        fullName: profileData.fullName,
        phone: profileData.phone,
        email: currentUser.email,
        updatedAt: serverTimestamp(),
      }, { merge: true });
      await updateProfile(auth.currentUser, { displayName: profileData.fullName });
      setSaveMsg('✓ Profile saved successfully!');
      setTimeout(() => setSaveMsg(''), 4000);
    } catch (err) {
      setSaveMsg('✕ Error: ' + err.message);
    }
  };

  const handleStoreSave = async (e) => {
    e.preventDefault();
    try {
      await setDoc(doc(db, 'storeSettings', 'main'), {
        ...storeData,
        updatedAt: serverTimestamp(),
      }, { merge: true });
      setSaveMsg('✓ Store settings saved!');
      setTimeout(() => setSaveMsg(''), 4000);
    } catch (err) {
      setSaveMsg('✕ Error: ' + err.message);
    }
  };

  const handlePasswordResetRequest = async () => {
    try {
      await sendPasswordResetEmail(auth, currentUser.email);
      setResetSent(true);
      setTimeout(() => setResetSent(false), 6000);
    } catch (error) {
      alert("Error sending reset email: " + error.message);
    }
  };

  const handleApiConfigSave = async (e) => {
    e.preventDefault();
    const url = (apiConfig.recipeApiBaseUrl || '').trim().replace(/\/+$/, '');
    if (!url) {
      setSaveMsg('✕ Please enter your deployed API URL (e.g. https://api.yourdomain.com)');
      return;
    }
    try {
      await setDoc(doc(db, 'app_config', 'public'), {
        recipeApiBaseUrl: url,
        updatedAt: serverTimestamp(),
      }, { merge: true });
      setSaveMsg('✓ Mobile recipe API saved. All app users will use this URL automatically.');
      setTimeout(() => setSaveMsg(''), 5000);
    } catch (err) {
      setSaveMsg('✕ Error: ' + err.message);
    }
  };

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 flex overflow-hidden min-h-[600px]">
      {/* Sidebar tabs */}
      <div className="w-1/4 bg-slate-50 border-r border-slate-100 p-6">
        <h2 className="text-lg font-bold text-slate-800 mb-6">Settings</h2>
        <ul className="space-y-2">
          {[
            { id: 'profile', icon: '👤', label: 'Profile Settings' },
            { id: 'store', icon: '🏪', label: 'Store Settings' },
            { id: 'api', icon: '📱', label: 'Mobile Recipe API' },
          ].map(tab => (
            <li key={tab.id}>
              <button
                onClick={() => setActiveTab(tab.id)}
                className={`w-full text-left px-4 py-3 rounded-xl text-sm font-bold transition-all ${
                  activeTab === tab.id ? 'bg-blue-600 text-white shadow-md shadow-blue-200' : 'text-slate-500 hover:bg-slate-200'
                }`}
              >
                {tab.icon} {tab.label}
              </button>
            </li>
          ))}
        </ul>
      </div>

      <div className="w-3/4 p-8 overflow-y-auto">
        {/* Global save message */}
        {saveMsg && (
          <div className={`mb-4 p-3 border-l-4 text-xs font-bold rounded ${saveMsg.startsWith('✓') ? 'bg-emerald-50 border-emerald-500 text-emerald-700' : 'bg-red-50 border-red-500 text-red-700'}`}>
            {saveMsg}
          </div>
        )}

        {activeTab === 'profile' && (
          <div>
            <h3 className="text-xl font-bold text-slate-800 mb-6">Profile Settings</h3>

            {isLoadingProfile ? (
              <div className="text-slate-400 text-sm">Loading profile...</div>
            ) : (
              <form onSubmit={handleProfileSave} className="space-y-6">
                <div className="flex items-center gap-6 pb-6 border-b border-slate-100">
                  <div className="w-20 h-20 rounded-full bg-blue-100 border-4 border-white shadow-md flex items-center justify-center text-blue-600 text-2xl font-bold">
                    {currentUser?.email ? currentUser.email.charAt(0).toUpperCase() : 'A'}
                  </div>
                  <div>
                    <label className="bg-white border border-slate-300 text-slate-700 px-4 py-2 rounded-lg text-sm font-bold cursor-pointer hover:bg-slate-50 transition-colors inline-block">
                      Change Photo
                      <input type="file" className="hidden" accept="image/*" />
                    </label>
                    <p className="text-xs text-slate-400 mt-2">JPG, GIF or PNG. Max 2MB.</p>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-6">
                  <div>
                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Full Name</label>
                    <input
                      type="text"
                      value={profileData.fullName}
                      onChange={e => setProfileData({ ...profileData, fullName: e.target.value })}
                      required
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Phone Number</label>
                    <input
                      type="text"
                      value={profileData.phone}
                      onChange={e => setProfileData({ ...profileData, phone: e.target.value })}
                      required
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div className="col-span-2">
                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Registered Email (Firebase)</label>
                    <input
                      type="email"
                      disabled
                      value={currentUser?.email || ''}
                      className="w-full bg-slate-200 border-none rounded-xl px-4 py-2.5 text-sm text-slate-500 cursor-not-allowed"
                    />
                  </div>
                </div>

                <div className="flex justify-end pt-2">
                  <button type="submit" className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2.5 rounded-xl font-bold shadow-lg transition-all active:scale-95">
                    Save Details
                  </button>
                </div>
              </form>
            )}

            {/* Password Reset */}
            <div className="pt-8 mt-8 border-t border-slate-100">
              <h4 className="text-sm font-bold text-slate-800 mb-4">Account Security</h4>
              <div className="bg-orange-50 border border-orange-200 p-4 rounded-xl mb-4">
                <h4 className="text-sm font-bold text-orange-800 mb-1">Secure Password Reset</h4>
                <p className="text-xs text-orange-600">
                  Password changes are handled via verified email links. A reset link will be sent to{' '}
                  <strong>{currentUser?.email}</strong>.
                </p>
              </div>

              {resetSent && (
                <div className="mb-4 p-3 bg-emerald-50 border-l-4 border-emerald-500 text-emerald-700 text-xs font-bold">
                  ✓ Reset link sent! Please check your inbox.
                </div>
              )}

              <div className="flex items-center gap-2 pt-2 mb-6">
                <input type="checkbox" id="logoutAll" defaultChecked className="w-4 h-4 text-blue-600 rounded border-gray-300 focus:ring-blue-500 cursor-pointer" />
                <label htmlFor="logoutAll" className="text-sm font-semibold text-slate-700 cursor-pointer">
                  Require login on all devices after password is changed
                </label>
              </div>

              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={handlePasswordResetRequest}
                  disabled={resetSent}
                  className={`px-6 py-2.5 rounded-xl font-bold shadow-lg transition-all active:scale-95 ${
                    resetSent ? 'bg-slate-300 text-slate-500 cursor-not-allowed' : 'bg-slate-900 hover:bg-slate-800 text-white'
                  }`}
                >
                  {resetSent ? 'Email Sent' : 'Send Password Reset Email'}
                </button>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'store' && (
          <div>
            <h3 className="text-xl font-bold text-slate-800 mb-6">Store Configuration</h3>
            <form onSubmit={handleStoreSave} className="space-y-6">
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Store Name</label>
                <input type="text" value={storeData.storeName} onChange={e => setStoreData({ ...storeData, storeName: e.target.value })} placeholder="Enter store name" className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Operating Address</label>
                <textarea rows="3" value={storeData.address} onChange={e => setStoreData({ ...storeData, address: e.target.value })} placeholder="Enter operating address" className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500"></textarea>
              </div>
              <div className="grid grid-cols-2 gap-6 pt-4 border-t border-slate-100">
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Opening Time</label>
                  <input type="time" value={storeData.openingTime} onChange={e => setStoreData({ ...storeData, openingTime: e.target.value })} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Closing Time</label>
                  <input type="time" value={storeData.closingTime} onChange={e => setStoreData({ ...storeData, closingTime: e.target.value })} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
              </div>
              <div className="flex justify-end pt-4">
                <button type="submit" className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2.5 rounded-xl font-bold shadow-lg transition-all active:scale-95">
                  Save Store Profile
                </button>
              </div>
            </form>
          </div>
        )}

        {activeTab === 'api' && (
          <div>
            <h3 className="text-xl font-bold text-slate-800 mb-2">Mobile Recipe API</h3>
            <p className="text-sm text-slate-500 mb-6 max-w-xl">
              Set your <strong>public</strong> FastAPI URL once. Consumer phones download it automatically — no PC on the same Wi‑Fi needed.
              Deploy <code className="bg-slate-100 px-1 rounded">boon_hua_backend</code> to Render, Railway, or similar, then paste the HTTPS URL here.
            </p>
            <form onSubmit={handleApiConfigSave} className="space-y-6">
              <div className="bg-teal-50 border border-teal-200 rounded-xl p-4 text-sm text-teal-900">
                <p className="font-bold mb-1">Example</p>
                <p className="font-mono text-xs">https://boonhua-api.onrender.com</p>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Recipe API base URL</label>
                <input
                  type="url"
                  value={apiConfig.recipeApiBaseUrl}
                  onChange={e => setApiConfig({ recipeApiBaseUrl: e.target.value })}
                  placeholder="https://your-api.example.com"
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500 font-mono"
                />
              </div>
              <div className="flex justify-end pt-2">
                <button type="submit" className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2.5 rounded-xl font-bold shadow-lg transition-all active:scale-95">
                  Save for All Mobile Users
                </button>
              </div>
            </form>
          </div>
        )}
      </div>
    </div>
  );
};

// ==========================================
// 2. INVENTORY & PRICING (Firestore)
// ==========================================
const InventoryPage = () => {
  const [inventory, setInventory] = useState([]);
  const [isLoading, setIsLoading] = useState(true); // FIX: loading state added
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editItem, setEditItem] = useState(null);
  const [newCatch, setNewCatch] = useState({ species: '', weight: '', price: '' });
  // FIX: track local price edits per item to avoid defaultValue/uncontrolled anti-pattern
  const [localPrices, setLocalPrices] = useState({});

  useEffect(() => {
    const unsubscribe = onSnapshot(collection(db, "inventory"), (snapshot) => {
      const items = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setInventory(items);
      // Sync local price state when Firestore updates
      const priceMap = {};
      items.forEach(item => { priceMap[item.id] = item.price; });
      setLocalPrices(priceMap);
      setIsLoading(false);
    });
    return () => unsubscribe();
  }, []);

  const handleAddCatch = async (e) => {
    e.preventDefault();
    const species = formatSpeciesLabel(newCatch.species);
    if (!species) {
      alert('Please enter a species name.');
      return;
    }
    const addedWeight = parseFloat(newCatch.weight) || 0;
    const newPrice = parseFloat(newCatch.price);
    if (addedWeight <= 0) {
      alert('Weight must be greater than 0 kg.');
      return;
    }
    if (Number.isNaN(newPrice)) {
      alert('Please enter a valid price.');
      return;
    }

    const existingMatches = findInventoryMatches(inventory, species);
    const existing = existingMatches[0];

    try {
      if (existing) {
        const combinedWeight = parseFloat(existing.weight || 0) + addedWeight;
        await updateDoc(doc(db, 'inventory', existing.id), {
          species,
          weight: Number(combinedWeight.toFixed(1)),
          price: newPrice,
          status: stockStatusForWeight(combinedWeight),
          updatedAt: serverTimestamp(),
        });
        if (existingMatches.length > 1) {
          alert(
            `Combined ${addedWeight.toFixed(1)} kg with existing "${species}" (${combinedWeight.toFixed(1)} kg total). Price updated to RM ${newPrice.toFixed(2)}/kg.\n\nNote: ${existingMatches.length - 1} older duplicate record(s) still exist — edit or delete them in the table if needed.`
          );
        } else {
          alert(
            `Combined with existing "${species}": ${combinedWeight.toFixed(1)} kg in stock. Price updated to RM ${newPrice.toFixed(2)}/kg.`
          );
        }
      } else {
        await addDoc(collection(db, 'inventory'), {
          species,
          weight: Number(addedWeight.toFixed(1)),
          price: newPrice,
          status: stockStatusForWeight(addedWeight),
          createdAt: serverTimestamp(),
        });
      }
      setIsModalOpen(false);
      setNewCatch({ species: '', weight: '', price: '' });
    } catch (error) {
      alert('Database Error: ' + error.message);
    }
  };

  const handlePriceUpdate = async (id) => {
    const newPrice = parseFloat(localPrices[id]) || 0;
    try {
      await updateDoc(doc(db, "inventory", id), { price: newPrice });
    } catch (error) {
      alert("Database Error: " + error.message);
    }
  };

  const openEditItem = (item) => {
    setEditItem({
      ...item,
      weight: item.weight ?? '',
      price: item.price ?? '',
      status: item.status || 'In Stock',
    });
  };

  const handleUpdateItem = async (e) => {
    e.preventDefault();
    try {
      await updateDoc(doc(db, "inventory", editItem.id), {
        species: editItem.species,
        weight: parseFloat(editItem.weight),
        price: parseFloat(editItem.price),
        status: editItem.status,
        updatedAt: serverTimestamp(),
      });
      setEditItem(null);
    } catch (error) {
      alert("Database Error: " + error.message);
    }
  };

  const handleDeleteItem = async (item) => {
    const confirmed = window.confirm(`Delete ${item.species} from inventory?`);
    if (!confirmed) return;
    try {
      await deleteDoc(doc(db, "inventory", item.id));
    } catch (error) {
      alert("Database Error: " + error.message);
    }
  };

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 flex flex-col h-full relative">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h2 className="text-2xl font-bold text-slate-800">Inventory & Pricing</h2>
          <p className="text-slate-500 text-sm">Real-time sync with Cloud Firestore.</p>
        </div>
        <button onClick={() => setIsModalOpen(true)} className="bg-blue-600 text-white px-5 py-2.5 rounded-xl font-bold shadow-lg shadow-blue-200 hover:bg-blue-700 transition-colors">
          + Add Catch
        </button>
      </div>

      {/* FIX: proper loading state — no false "empty" flash */}
      {isLoading ? (
        <div className="flex-1 flex flex-col items-center justify-center">
          <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mb-3"></div>
          <p className="text-slate-400 text-sm font-semibold">Loading from Firestore...</p>
        </div>
      ) : inventory.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center border-2 border-dashed border-slate-200 rounded-xl bg-slate-50">
          <span className="text-4xl mb-2">📥</span>
          <h3 className="text-lg font-bold text-slate-700">No Inventory Found</h3>
          <p className="text-slate-500 text-sm">Click "Add Catch" to send your first data to Firebase!</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-[#F5F6FA] text-slate-500 text-xs uppercase">
                <th className="p-4 rounded-tl-lg">Species</th>
                <th className="p-4">Weight (kg)</th>
                <th className="p-4 text-blue-600">Daily Price (RM/kg)</th>
                <th className="p-4">Status</th>
                <th className="p-4 rounded-tr-lg text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {inventory.map((item) => (
                <tr key={item.id} className="border-b hover:bg-slate-50/50">
                  <td className="p-4 font-semibold text-slate-800">{item.species}</td>
                  <td className="p-4 text-slate-600">{item.weight} kg</td>
                  <td className="p-4">
                    {/* FIX: controlled input using localPrices state — no more defaultValue */}
                    <div className="flex items-center gap-1 bg-white border border-slate-300 rounded-lg px-2 py-1 w-28 focus-within:ring-2 focus-within:ring-blue-500">
                      <span className="text-slate-400 font-bold text-sm">RM</span>
                      <input
                        type="number"
                        value={localPrices[item.id] ?? item.price}
                        onChange={e => setLocalPrices(prev => ({ ...prev, [item.id]: e.target.value }))}
                        onBlur={() => handlePriceUpdate(item.id)}
                        className="w-full bg-transparent outline-none font-bold text-slate-800 text-sm"
                      />
                    </div>
                  </td>
                  <td className="p-4">
                    <span className={`py-1 px-3 rounded-full text-xs font-bold ${item.status === 'In Stock' ? 'bg-emerald-100 text-emerald-700' : 'bg-orange-100 text-orange-700'}`}>
                      {item.status}
                    </span>
                  </td>
                  <td className="p-4">
                    <div className="flex justify-end gap-2">
                      <button onClick={() => openEditItem(item)} className="bg-slate-100 text-slate-600 hover:bg-blue-100 hover:text-blue-600 px-3 py-1.5 rounded-lg text-xs font-bold transition-colors">
                        Edit
                      </button>
                      <button onClick={() => handleDeleteItem(item)} className="bg-red-50 text-red-600 hover:bg-red-100 px-3 py-1.5 rounded-lg text-xs font-bold transition-colors">
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {isModalOpen && (
        <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="bg-white w-full max-w-md rounded-2xl p-8 shadow-2xl">
            <h3 className="text-xl font-bold mb-6 text-slate-800">Log New Catch</h3>
            <form onSubmit={handleAddCatch} className="space-y-4">
              <input type="text" placeholder="Species Name" required value={newCatch.species} onChange={e => setNewCatch({ ...newCatch, species: e.target.value })} className="w-full border p-3 rounded-xl outline-none focus:ring-2 focus:ring-blue-500" />
              <div className="flex gap-4">
                <input type="number" placeholder="Weight (KG)" step="0.1" required value={newCatch.weight} onChange={e => setNewCatch({ ...newCatch, weight: e.target.value })} className="w-1/2 border p-3 rounded-xl outline-none focus:ring-2 focus:ring-blue-500" />
                <input type="number" placeholder="Price (RM/KG)" step="0.01" required value={newCatch.price} onChange={e => setNewCatch({ ...newCatch, price: e.target.value })} className="w-1/2 border p-3 rounded-xl outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div className="flex justify-end gap-3 mt-6">
                <button type="button" onClick={() => setIsModalOpen(false)} className="px-5 py-2 font-bold text-slate-500 hover:bg-slate-100 rounded-xl">Cancel</button>
                <button type="submit" className="px-5 py-2 bg-blue-600 text-white font-bold rounded-xl shadow-lg hover:bg-blue-700">Save to Database</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {editItem && (
        <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="bg-white w-full max-w-md rounded-2xl p-8 shadow-2xl">
            <h3 className="text-xl font-bold mb-6 text-slate-800">Edit Inventory Item</h3>
            <form onSubmit={handleUpdateItem} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Species Name</label>
                <input type="text" required value={editItem.species} onChange={e => setEditItem({ ...editItem, species: e.target.value })} className="w-full border p-3 rounded-xl outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Current Stock (kg)</label>
                  <input type="number" step="0.1" required value={editItem.weight} onChange={e => setEditItem({ ...editItem, weight: e.target.value })} className="w-full border p-3 rounded-xl outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Price (RM/kg)</label>
                  <input type="number" step="0.01" required value={editItem.price} onChange={e => setEditItem({ ...editItem, price: e.target.value })} className="w-full border p-3 rounded-xl outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Status</label>
                <select value={editItem.status} onChange={e => setEditItem({ ...editItem, status: e.target.value })} className="w-full border p-3 rounded-xl outline-none focus:ring-2 focus:ring-blue-500">
                  <option value="In Stock">In Stock</option>
                  <option value="Low Stock">Low Stock</option>
                  <option value="Out of Stock">Out of Stock</option>
                </select>
              </div>
              <div className="flex justify-end gap-3 mt-6">
                <button type="button" onClick={() => setEditItem(null)} className="px-5 py-2 font-bold text-slate-500 hover:bg-slate-100 rounded-xl">Cancel</button>
                <button type="submit" className="px-5 py-2 bg-blue-600 text-white font-bold rounded-xl shadow-lg hover:bg-blue-700">Save Changes</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

// ==========================================
// 3. USER MANAGEMENT (Firestore)
// ==========================================
const UserManagementPage = () => {
  const [customers, setCustomers] = useState([]);
  const [isLoading, setIsLoading] = useState(true); // FIX: loading state
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editUser, setEditUser] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('All');

  // FIX: pull customers from Firestore (populated by mobile app) instead of mock data
  useEffect(() => {
    const unsubscribe = onSnapshot(collection(db, "customers"), (snapshot) => {
      const items = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setCustomers(items);
      setIsLoading(false);
    });
    return () => unsubscribe();
  }, []);

  const customerName = (user) => user.name || user.displayName || '—';

  const openEditModal = (user) => {
    setEditUser({
      ...user,
      name: user.name || user.displayName || '',
      phone: user.phone || user.phoneNum || '',
    });
    setIsEditModalOpen(true);
  };

  // FIX: persist edits back to Firestore
  const handleUpdateUser = async (e) => {
    e.preventDefault();
    try {
      const trimmedName = (editUser.name || '').trim();
      await updateDoc(doc(db, "customers", editUser.id), {
        name: trimmedName,
        displayName: trimmedName,
        email: editUser.email,
        phone: editUser.phone,
        phoneNum: editUser.phone,
        status: editUser.status,
        updatedAt: serverTimestamp(),
      });
      setIsEditModalOpen(false);
    } catch (err) {
      alert("Error updating customer: " + err.message);
    }
  };

  const filteredCustomers = customers.filter(user => {
    const text = `${user.name || ''} ${user.displayName || ''} ${user.email || ''} ${user.phone || ''} ${user.phoneNum || ''}`.toLowerCase();
    const matchesSearch = text.includes(searchTerm.toLowerCase());
    const matchesStatus = statusFilter === 'All' || user.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 flex flex-col h-full relative">
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-slate-800">Customer Management</h2>
        <p className="text-slate-500 text-sm">Registered users from the Mobile App — synced via Firestore.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-[1fr_180px] gap-4 mb-6">
        <input
          type="text"
          value={searchTerm}
          onChange={e => setSearchTerm(e.target.value)}
          placeholder="Search by name or email..."
          className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500"
        />
        <select
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value)}
          className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="All">All Status</option>
          <option value="Active">Active</option>
          <option value="Suspended">Suspended</option>
        </select>
      </div>

      {isLoading ? (
        <div className="flex-1 flex flex-col items-center justify-center">
          <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mb-3"></div>
          <p className="text-slate-400 text-sm font-semibold">Loading customers...</p>
        </div>
      ) : customers.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center border-2 border-dashed border-slate-200 rounded-xl bg-slate-50">
          <span className="text-4xl mb-2">👥</span>
          <h3 className="text-lg font-bold text-slate-700">No Customers Yet</h3>
          <p className="text-slate-500 text-sm text-center max-w-xs">Customers will appear here once they register via the Mobile App.</p>
        </div>
      ) : filteredCustomers.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center border-2 border-dashed border-slate-200 rounded-xl bg-slate-50">
          <h3 className="text-lg font-bold text-slate-700">No Matching Customers</h3>
          <p className="text-slate-500 text-sm">Try a different search term or account status.</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-[#F5F6FA] text-slate-500 text-xs uppercase">
                <th className="p-4 rounded-tl-lg">Name</th>
                <th className="p-4">Email</th>
                <th className="p-4">Phone</th>
                <th className="p-4">Join Date</th>
                <th className="p-4 text-center">Orders</th>
                <th className="p-4 text-center">Status</th>
                <th className="p-4 text-center rounded-tr-lg">Action</th>
              </tr>
            </thead>
            <tbody>
              {filteredCustomers.map((user) => (
                <tr key={user.id} className="border-b hover:bg-slate-50/50">
                  <td className="p-4 font-bold text-slate-800">{customerName(user)}</td>
                  <td className="p-4 text-blue-600">{user.email}</td>
                  <td className="p-4 text-slate-600">{user.phone || user.phoneNum || '-'}</td>
                  <td className="p-4 text-slate-600">{user.createdAt?.toDate ? user.createdAt.toDate().toLocaleDateString() : '-'}</td>
                  <td className="p-4 text-center text-slate-600">{user.totalOrders || 0}</td>
                  <td className="p-4 text-center">
                    <span className={`py-1 px-3 rounded-full text-xs font-bold ${user.status === 'Active' ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>
                      {user.status}
                    </span>
                  </td>
                  <td className="p-4 text-center">
                    <button onClick={() => openEditModal(user)} className="bg-slate-100 text-slate-600 hover:bg-blue-100 hover:text-blue-600 px-3 py-1.5 rounded-lg text-xs font-bold transition-colors">
                      Edit
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {isEditModalOpen && editUser && (
        <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="bg-white w-full max-w-md rounded-2xl p-8 shadow-2xl">
            <h3 className="text-xl font-bold mb-6 text-slate-800">Edit Customer</h3>
            <form onSubmit={handleUpdateUser} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Full Name</label>
                <input type="text" value={editUser.name} onChange={e => setEditUser({ ...editUser, name: e.target.value })} className="w-full border p-3 rounded-xl outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Email</label>
                <input type="email" value={editUser.email} onChange={e => setEditUser({ ...editUser, email: e.target.value })} className="w-full border p-3 rounded-xl outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Phone</label>
                <input type="text" value={editUser.phone} onChange={e => setEditUser({ ...editUser, phone: e.target.value })} className="w-full border p-3 rounded-xl outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Account Status</label>
                <select value={editUser.status} onChange={e => setEditUser({ ...editUser, status: e.target.value })} className="w-full border p-3 rounded-xl outline-none focus:ring-2 focus:ring-blue-500">
                  <option value="Active">Active</option>
                  <option value="Suspended">Suspended</option>
                </select>
              </div>
              <div className="flex justify-end gap-3 mt-6">
                <button type="button" onClick={() => setIsEditModalOpen(false)} className="px-5 py-2 font-bold text-slate-500 hover:bg-slate-100 rounded-xl">Cancel</button>
                <button type="submit" className="px-5 py-2 bg-blue-600 text-white font-bold rounded-xl shadow-lg hover:bg-blue-700">Save Updates</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

// ==========================================
// 4. SALES RECORDS (Firestore)
// ==========================================
const SalesRecordsPage = ({ orders, inventory }) => {
  const today = new Date().toISOString().slice(0, 10);
  const [saleForm, setSaleForm] = useState({
    saleDate: today,
    species: '',
    quantityKg: '0',
    pricePerKg: '',
  });
  const [isSaving, setIsSaving] = useState(false);

  const availableInventory = useMemo(
    () => consolidateInventoryBySpecies(inventory).filter(
      item => parseFloat(item.weight || 0) > 0 && item.price != null && item.price !== '' && !Number.isNaN(item.price)
    ),
    [inventory]
  );

  const selectedItem = useMemo(
    () => availableInventory.find(inv => normalizeSpeciesName(inv.species) === normalizeSpeciesName(saleForm.species)) || null,
    [availableInventory, saleForm.species]
  );

  const maxQuantityKg = selectedItem ? parseFloat(selectedItem.weight || 0) : 0;

  const totalAmount = useMemo(() => {
    const quantity = parseFloat(saleForm.quantityKg) || 0;
    const price = parseFloat(saleForm.pricePerKg) || 0;
    return quantity * price;
  }, [saleForm.quantityKg, saleForm.pricePerKg]);

  useEffect(() => {
    if (!selectedItem) return;
    const nextPrice = String(selectedItem.price);
    const max = parseFloat(selectedItem.weight || 0);
    const nextQty = Math.min(parseFloat(saleForm.quantityKg) || 0, max).toFixed(1);
    setSaleForm(prev => {
      if (prev.pricePerKg === nextPrice && prev.quantityKg === nextQty) return prev;
      return { ...prev, pricePerKg: nextPrice, quantityKg: nextQty };
    });
  }, [selectedItem?.id, selectedItem?.price, selectedItem?.weight]);

  const handleSpeciesChange = (species) => {
    const item = availableInventory.find(inv => normalizeSpeciesName(inv.species) === normalizeSpeciesName(species));
    setSaleForm(prev => ({
      ...prev,
      species,
      quantityKg: '0',
      pricePerKg: item ? String(item.price) : '',
    }));
  };

  const handleQuantityChange = (rawValue) => {
    const parsed = parseFloat(rawValue);
    const clamped = Number.isNaN(parsed) ? 0 : Math.min(Math.max(0, parsed), maxQuantityKg);
    setSaleForm(prev => ({ ...prev, quantityKg: clamped.toFixed(1) }));
  };

  const handleAddSale = async (e) => {
    e.preventDefault();
    if (!selectedItem) {
      alert('Please select a seafood item that is available in inventory and pricing.');
      return;
    }
    const quantity = parseFloat(saleForm.quantityKg) || 0;
    if (quantity <= 0) {
      alert('Quantity sold must be greater than 0 kg.');
      return;
    }
    if (quantity > maxQuantityKg) {
      alert(`Cannot sell more than available stock (${maxQuantityKg.toFixed(1)} kg).`);
      return;
    }
    setIsSaving(true);
    try {
      await deductInventoryStock(inventory, saleForm.species, quantity);

      await addDoc(collection(db, "orders"), {
        saleDate: saleForm.saleDate,
        species: formatSpeciesLabel(saleForm.species),
        quantityKg: quantity,
        pricePerKg: parseFloat(saleForm.pricePerKg),
        totalAmount,
        createdAt: serverTimestamp(),
      });

      setSaleForm({ saleDate: today, species: '', quantityKg: '0', pricePerKg: '' });
    } catch (error) {
      alert("Database Error: " + error.message);
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteSale = async (order) => {
    const confirmed = window.confirm(`Delete sales record for ${order.species}?`);
    if (!confirmed) return;
    try {
      await deleteDoc(doc(db, "orders", order.id));
    } catch (error) {
      alert("Database Error: " + error.message);
    }
  };

  return (
    <div className="grid grid-cols-1 xl:grid-cols-[420px_1fr] gap-6">
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 h-fit">
        <h2 className="text-2xl font-bold text-slate-800">Sales Records</h2>
        <p className="text-slate-500 text-sm mt-1 mb-6">Key in completed sales so analytics can calculate revenue and orders.</p>

        <form onSubmit={handleAddSale} className="space-y-4">
          <div>
            <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Sale Date</label>
            <input type="date" required value={saleForm.saleDate} onChange={e => setSaleForm({ ...saleForm, saleDate: e.target.value })} className="w-full border p-3 rounded-xl outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Seafood Item</label>
            <select
              required
              value={saleForm.species}
              onChange={e => handleSpeciesChange(e.target.value)}
              className="w-full border p-3 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 bg-white"
            >
              <option value="">Select from inventory...</option>
              {availableInventory.map(item => (
                <option key={item.id} value={item.species}>
                  {item.species} ({parseFloat(item.weight).toFixed(1)} kg in stock)
                </option>
              ))}
            </select>
            {availableInventory.length === 0 && (
              <p className="text-xs text-amber-600 mt-1 font-semibold">No in-stock items in inventory. Add stock before recording a sale.</p>
            )}
          </div>
          <div>
            <div className="flex justify-between items-center mb-1">
              <label className="block text-xs font-bold text-slate-500 uppercase">Quantity Sold (kg)</label>
              {selectedItem && (
                <span className="text-xs text-slate-500 font-semibold">Max: {maxQuantityKg.toFixed(1)} kg</span>
              )}
            </div>
            <input
              type="range"
              min="0"
              max={maxQuantityKg || 0}
              step="0.1"
              disabled={!selectedItem}
              value={parseFloat(saleForm.quantityKg) || 0}
              onChange={e => handleQuantityChange(e.target.value)}
              className="w-full accent-blue-600 disabled:opacity-40"
            />
            <input
              type="number"
              step="0.1"
              min="0"
              max={maxQuantityKg || undefined}
              required
              disabled={!selectedItem}
              value={saleForm.quantityKg}
              onChange={e => handleQuantityChange(e.target.value)}
              className="w-full border p-3 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 mt-2 disabled:bg-slate-100"
            />
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Price (RM/kg)</label>
            <input
              type="number"
              step="0.01"
              readOnly
              required
              value={saleForm.pricePerKg}
              className="w-full border p-3 rounded-xl bg-slate-50 text-slate-700 font-bold cursor-not-allowed"
            />
            <p className="text-xs text-slate-500 mt-1">Uses the latest price from Inventory &amp; Pricing.</p>
          </div>
          <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 flex justify-between items-center">
            <span className="text-sm font-bold text-slate-500">Calculated Total</span>
            <span className="text-xl font-black text-emerald-600">RM {totalAmount.toFixed(2)}</span>
          </div>

          <button disabled={isSaving} type="submit" className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 text-white px-5 py-3 rounded-xl font-bold shadow-lg shadow-blue-200 transition-colors">
            {isSaving ? 'Saving...' : 'Save Sales Record'}
          </button>
        </form>
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
        <div className="flex justify-between items-center mb-6">
          <div>
            <h3 className="text-xl font-bold text-slate-800">Recent Sales</h3>
            <p className="text-slate-500 text-sm">These records feed the dashboard revenue chart.</p>
          </div>
          <span className="bg-emerald-50 text-emerald-700 px-3 py-1 rounded-full text-xs font-bold">{orders.length} records</span>
        </div>

        {orders.length === 0 ? (
          <div className="h-[300px] border-2 border-dashed border-slate-200 rounded-xl bg-slate-50 flex flex-col items-center justify-center text-center">
            <h4 className="text-slate-700 font-bold">No Sales Records Yet</h4>
            <p className="text-slate-500 text-sm mt-1">Save the first completed sale to start analytics.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-[#F5F6FA] text-slate-500 text-xs uppercase">
                  <th className="p-4 rounded-tl-lg">Date</th>
                  <th className="p-4">Species</th>
                  <th className="p-4">Qty</th>
                  <th className="p-4">Price</th>
                  <th className="p-4">Total</th>
                  <th className="p-4 rounded-tr-lg text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {[...orders].sort((a, b) => (b.saleDate || '').localeCompare(a.saleDate || '')).map(order => (
                  <tr key={order.id} className="border-b hover:bg-slate-50/50">
                    <td className="p-4 text-slate-600">{order.saleDate || '-'}</td>
                    <td className="p-4 font-semibold text-slate-800">{order.species}</td>
                    <td className="p-4 text-slate-600">{order.quantityKg} kg</td>
                    <td className="p-4 text-slate-600">RM {Number(order.pricePerKg || 0).toFixed(2)}</td>
                    <td className="p-4 font-bold text-emerald-600">RM {Number(order.totalAmount || 0).toFixed(2)}</td>
                    <td className="p-4 text-right">
                      <button onClick={() => handleDeleteSale(order)} className="bg-red-50 text-red-600 hover:bg-red-100 px-3 py-1.5 rounded-lg text-xs font-bold transition-colors">
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

// ==========================================
// 5. OVERVIEW / ANALYTICS
// FIX: now derives real stats from live Firestore inventory
// ==========================================
const OverviewPage = ({ inventory, customerCount, orders }) => {
  const [dateFrom, setDateFrom] = useState(() => {
    const stored = loadStoredDateRange();
    if (stored) return stored.dateFrom;
    return getLast7DaysRange().from;
  });
  const [dateTo, setDateTo] = useState(() => {
    const stored = loadStoredDateRange();
    if (stored) return stored.dateTo;
    return getLast7DaysRange().to;
  });

  const setDateRange = (from, to) => {
    setDateFrom(from);
    setDateTo(to);
    saveStoredDateRange(from, to);
  };

  const handleLast7Days = () => {
    const { from, to } = getLast7DaysRange();
    setDateRange(from, to);
  };

  const filteredOrders = useMemo(() => (
    orders.filter(order => {
      const key = order.saleDate;
      if (!key) return true;
      return key >= dateFrom && key <= dateTo;
    })
  ), [orders, dateFrom, dateTo]);

  // Derived stats from real Firestore data
  const totalStock = useMemo(
    () => inventory.reduce((sum, item) => sum + parseFloat(item.weight || 0), 0).toFixed(1),
    [inventory]
  );
  const totalSales = useMemo(
    () => filteredOrders.reduce((sum, order) => sum + parseFloat(order.totalAmount || order.total || 0), 0),
    [filteredOrders]
  );
  const salesData = useMemo(() => {
    const start = new Date(dateFrom);
    const end = new Date(dateTo);
    const dayCount = Math.min(31, Math.max(1, Math.floor((end - start) / 86400000) + 1));
    const days = [...Array(dayCount)].map((_, index) => {
      const date = new Date(start);
      date.setDate(start.getDate() + index);
      const key = date.toISOString().slice(0, 10);
      return {
        key,
        name: date.toLocaleDateString('en-MY', { weekday: 'short' }),
        revenue: 0,
      };
    });

    filteredOrders.forEach(order => {
      let key = order.saleDate;
      if (!key) {
        const rawDate = order.createdAt?.toDate?.() || order.orderDate?.toDate?.() || order.createdAt || order.orderDate;
        const date = rawDate ? new Date(rawDate) : null;
        if (!date || Number.isNaN(date.getTime())) return;
        key = date.toISOString().slice(0, 10);
      }
      const day = days.find(item => item.key === key);
      if (day) day.revenue += parseFloat(order.totalAmount || order.total || 0);
    });

    return days;
  }, [filteredOrders, dateFrom, dateTo]);

  const topSellingItems = useMemo(() => {
    const totals = {};
    filteredOrders.forEach(order => {
      const species = order.species || 'Unknown';
      if (!totals[species]) totals[species] = { species, quantityKg: 0, revenue: 0 };
      totals[species].quantityKg += parseFloat(order.quantityKg || 0);
      totals[species].revenue += parseFloat(order.totalAmount || 0);
    });
    return Object.values(totals).sort((a, b) => b.quantityKg - a.quantityKg).slice(0, 5);
  }, [filteredOrders]);

  const stats = [
    { icon: '📦', label: 'Total Stock', value: `${totalStock} kg`, color: 'blue' },
    { icon: '💰', label: 'Total Sales', value: `RM ${totalSales.toFixed(2)}`, color: 'emerald' },
    { icon: '👥', label: 'Registered Users', value: customerCount, color: 'purple' },
    { icon: '📈', label: 'Total Orders', value: filteredOrders.length, color: 'orange' },
  ];

  const colorMap = {
    blue: 'bg-blue-100 text-blue-600',
    emerald: 'bg-emerald-100 text-emerald-600',
    purple: 'bg-purple-100 text-purple-600',
    orange: 'bg-orange-100 text-orange-600',
  };

  return (
    <div id="dashboard-overview" className="space-y-6 print:m-0 print:p-0 print:space-y-4">
      <div className="flex justify-between items-end print:mb-2">
        <h2 className="text-2xl font-bold text-slate-800 print:text-xl">Dashboard Overview</h2>
        <button onClick={() => window.print()} className="bg-slate-800 hover:bg-slate-900 text-white px-5 py-2.5 rounded-xl text-sm font-bold flex items-center shadow-lg active:scale-95 print:hidden">
          📄 Generate PDF Report
        </button>
      </div>

      <p className="hidden print:block text-sm text-slate-600 -mt-4 mb-2">
        Report period: {dateFrom} to {dateTo}
      </p>

      <div className="bg-white rounded-2xl shadow-sm p-4 border border-slate-100 print:hidden">
        <div className="grid grid-cols-1 md:grid-cols-[1fr_1fr_auto] gap-4 items-end">
          <div>
            <label className="block text-xs font-bold text-slate-500 uppercase mb-1">From</label>
            <input type="date" value={dateFrom} onChange={e => setDateRange(e.target.value, dateTo)} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-500 uppercase mb-1">To</label>
            <input type="date" value={dateTo} onChange={e => setDateRange(dateFrom, e.target.value)} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <button type="button" onClick={handleLast7Days} className="bg-slate-100 text-slate-600 hover:bg-slate-200 px-5 py-2.5 rounded-xl text-sm font-bold">
            Last 7 Days
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 print:grid-cols-2 print:gap-4">
        {stats.map((stat) => (
          <div key={stat.label} className="bg-white rounded-2xl p-6 shadow-sm border border-slate-100 flex justify-between items-center print:break-inside-avoid print:p-4 transition-all duration-300 hover:-translate-y-1 hover:shadow-lg hover:border-blue-100 group">
            <div className={`w-14 h-14 rounded-2xl ${colorMap[stat.color]} flex items-center justify-center text-2xl transition-transform group-hover:scale-110`}>
              {stat.icon}
            </div>
            <div className="text-right">
              <p className="text-sm text-slate-500 font-semibold mb-1">{stat.label}</p>
              <h3 className={`text-2xl font-bold ${stat.color === 'emerald' ? 'text-emerald-600' : 'text-slate-800'}`}>
                {stat.value}
              </h3>
              {stat.note && <p className="text-[10px] text-slate-400 mt-0.5">{stat.note}</p>}
            </div>
          </div>
        ))}
      </div>

      <div className="bg-white rounded-2xl shadow-sm p-6 border border-slate-100 print:break-inside-avoid">
        <h3 className="text-lg font-bold text-slate-800 mb-6 print:mb-3">Revenue Trends</h3>
        {filteredOrders.length === 0 ? (
          <div className="h-[300px] border-2 border-dashed border-slate-200 rounded-xl bg-slate-50 flex flex-col items-center justify-center text-center print:h-auto print:py-8">
            <h4 className="text-slate-700 font-bold">No Sales Data Yet</h4>
            <p className="text-slate-500 text-sm mt-1">Revenue charts will appear when real orders are saved in Firebase.</p>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={300} className="print:!h-[220px] min-h-[220px]">
            <BarChart data={salesData}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
              <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: '#64748b', fontSize: 12 }} dy={10} />
              <YAxis axisLine={false} tickLine={false} tick={{ fill: '#64748b', fontSize: 12 }} dx={-10} tickFormatter={(val) => `RM${val}`} />
              <Tooltip cursor={{ fill: '#f8fafc' }} contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)', fontWeight: 'bold' }} formatter={(value) => [`RM ${Number(value).toFixed(2)}`, "Revenue"]} />
              <defs>
                <linearGradient id="revenueGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#5DC0AE" />
                  <stop offset="100%" stopColor="#4379EE" />
                </linearGradient>
              </defs>
              <Bar dataKey="revenue" fill="url(#revenueGradient)" radius={[8, 8, 0, 0]} barSize={44} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

      <div className="bg-white rounded-2xl shadow-sm p-6 border border-slate-100 print:break-inside-avoid print:page-break-inside-avoid">
        <h3 className="text-lg font-bold text-slate-800 mb-4">Top-Selling Seafood</h3>
        {topSellingItems.length === 0 ? (
          <p className="text-slate-500 text-sm">Top-selling items will appear after sales records are saved.</p>
        ) : (
          <div className="space-y-3 print:space-y-2">
            {topSellingItems.map(item => (
              <div key={item.species} className="flex items-center justify-between border border-slate-100 rounded-xl p-4 print:break-inside-avoid print:p-3">
                <div>
                  <p className="font-bold text-slate-800">{item.species}</p>
                  <p className="text-xs text-slate-500">{item.quantityKg.toFixed(1)} kg sold</p>
                </div>
                <p className="font-black text-emerald-600">RM {item.revenue.toFixed(2)}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

// ==========================================
// MAIN APP
// ==========================================
export default function App() {
  const [currentUser, setCurrentUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authView, setAuthView] = useState('login');
  const [formData, setFormData] = useState({ email: '', password: '' });
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  // FIX: lift inventory + customers to App so OverviewPage gets real counts
  const [inventory, setInventory] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [orders, setOrders] = useState([]);

  // Monitor auth state
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (user) => {
      setCurrentUser(user || null);
      setAuthLoading(false);
    });
    return () => unsub();
  }, []);

  // Load shared data once logged in
  useEffect(() => {
    if (!currentUser) return;
    const u1 = onSnapshot(collection(db, "inventory"), snap => {
      setInventory(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });
    const u2 = onSnapshot(collection(db, "customers"), snap => {
      setCustomers(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });
    const u3 = onSnapshot(collection(db, "orders"), snap => {
      setOrders(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });
    return () => { u1(); u2(); u3(); };
  }, [currentUser]);

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
    setError('');
    setSuccessMsg('');
  };

  const handleAuthSubmit = async (e) => {
    e.preventDefault();
    try {
      if (authView === 'login') {
        await signInWithEmailAndPassword(auth, formData.email, formData.password);
      } else if (authView === 'forgot') {
        await sendPasswordResetEmail(auth, formData.email);
        setSuccessMsg(`✓ Reset link sent to ${formData.email}.`);
      }
    } catch (err) {
      setError("✕ " + err.message.replace("Firebase: ", ""));
    }
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
      setAuthView('login');
      setFormData({ email: '', password: '' });
    } catch (err) {
      alert("Logout Error: " + err.message);
    }
  };

  // Show nothing while Firebase resolves session
  if (authLoading) {
    return (
      <div className="min-h-screen bg-[#F5F6FA] flex items-center justify-center">
        <div className="w-10 h-10 border-4 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
      </div>
    );
  }

  // --- LOGIN / FORGOT SCREEN (admin sign-in only) ---
  if (!currentUser) {
    return (
      <div className="min-h-screen bh-login-bg flex items-center justify-center p-4 font-sans text-slate-900 relative overflow-hidden">
        <div className="absolute inset-0 pointer-events-none">
          <div className="bh-float absolute top-[12%] left-[8%] text-5xl opacity-20">🐟</div>
          <div className="bh-float-delay absolute bottom-[18%] right-[10%] text-6xl opacity-15">🌊</div>
        </div>
        <div className="bg-white/95 backdrop-blur w-full max-w-md rounded-2xl shadow-2xl p-8 border border-white/60 relative z-10 bh-card-enter">
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center bg-gradient-to-br from-[#2F3C95] to-[#4379EE] text-white w-14 h-14 rounded-2xl mb-3 shadow-lg shadow-blue-900/30">
              <span className="text-3xl">🐟</span>
            </div>
            <h1 className="text-xl font-black tracking-tight uppercase">BOON HUA FISHERY</h1>
            <p className="text-[10px] font-bold tracking-widest text-slate-400 mt-1 uppercase">Admin Portal</p>
          </div>

          <h2 className="text-xl font-bold mb-6 text-center uppercase tracking-wide">
            {authView === 'login' ? 'System Sign In' : 'Reset Password'}
          </h2>

          {error && <div className="mb-4 p-3 bg-red-50 border-l-4 border-red-500 text-red-700 text-xs font-bold">{error}</div>}
          {successMsg && <div className="mb-4 p-3 bg-emerald-50 border-l-4 border-emerald-500 text-emerald-700 text-xs font-bold">{successMsg}</div>}

          <form onSubmit={handleAuthSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-bold text-slate-500 uppercase mb-1 ml-1">Email Address</label>
              <input
                type="email" name="email" onChange={handleInputChange}
                placeholder="admin@boonhua.com" required
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            {authView !== 'forgot' && (
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1 ml-1">Password</label>
                <input type="password" name="password" onChange={handleInputChange} placeholder="••••••••" required className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
            )}

            {authView === 'login' && (
              <div className="flex justify-end">
                <button type="button" onClick={() => { setAuthView('forgot'); setError(''); setSuccessMsg(''); }} className="text-xs font-bold text-blue-600 hover:underline">
                  Forgot Password?
                </button>
              </div>
            )}

            {authView === 'forgot' && (
              <div className="text-center">
                <button type="button" onClick={() => { setAuthView('login'); setError(''); setSuccessMsg(''); }} className="text-xs font-bold text-blue-600 hover:underline">
                  Back to Sign In
                </button>
              </div>
            )}

            <button type="submit" className="w-full bg-[#1E2640] text-white rounded-xl py-3.5 text-sm font-bold hover:bg-blue-600 transition-all shadow-lg active:scale-95 mt-4 uppercase tracking-widest">
              {authView === 'login' ? 'Sign In' : 'Send Reset Link'}
            </button>
          </form>
        </div>
      </div>
    );
  }

  // --- DASHBOARD LAYOUT ---
  return (
    <BrowserRouter>
      <div className="flex h-screen bg-[#F5F6FA] font-sans text-slate-900 overflow-hidden print:h-auto print:min-h-0 print:overflow-visible print:block">

        {/* SIDEBAR */}
        <aside className="w-[250px] bg-[#1E2640] text-white flex flex-col z-20 print:hidden">
          <div className="h-[76px] flex items-center px-8 border-b border-slate-700/50">
            <span className="text-2xl mr-3">🐟</span>
            <h1 className="text-xl font-bold tracking-wide">Boon Hua Fishery</h1>
          </div>

          <nav className="flex-1 px-4 py-8 space-y-1">
            <p className="px-4 text-xs text-slate-500 font-semibold mb-4 uppercase tracking-wider">Admin Modules</p>
            {/* FIX: NavLink with isActive highlight instead of focus: */}
            <SidebarLink to="/" icon="📊" label="Overview" />
            <SidebarLink to="/inventory" icon="📦" label="Inventory & Pricing" />
            <SidebarLink to="/sales" icon="💰" label="Sales Records" />
            <SidebarLink to="/users" icon="👥" label="User Management" />
            <SidebarLink to="/settings" icon="⚙️" label="Settings" />
          </nav>

          {/* FIX: Logout is now a prominent red button */}
          <div className="p-4 mb-4">
            <button
              onClick={handleLogout}
              className="w-full py-3 bg-red-500 hover:bg-red-600 text-white rounded-xl text-sm font-bold transition-all flex items-center justify-center shadow-lg shadow-red-900/30 active:scale-95"
            >
              <span className="mr-2">🚪</span> Log Out
            </button>
          </div>
        </aside>

        {/* RIGHT CONTENT AREA */}
        <div className="flex-1 flex flex-col overflow-hidden print:overflow-visible print:h-auto">

          <header className="h-[76px] bg-white flex items-center justify-between px-8 shadow-sm z-10 print:hidden">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-[#4379EE] flex items-center justify-center text-white font-bold shadow-md">
                {currentUser?.email ? currentUser.email.charAt(0).toUpperCase() : 'A'}
              </div>
              <div>
                <p className="text-sm font-bold leading-tight">
                  {currentUser?.displayName || 'System Admin'}
                </p>
                <p className="text-[10px] uppercase font-bold tracking-widest text-slate-400">{currentUser?.email}</p>
              </div>
            </div>
          </header>

          <main className="flex-1 p-8 overflow-y-auto print:p-4 print:overflow-visible print:h-auto print:max-h-none">
            <Routes>
              {/* FIX: pass live data to OverviewPage so stats are real */}
              <Route path="/" element={<OverviewPage inventory={inventory} customerCount={customers.length} orders={orders} />} />
              <Route path="/inventory" element={<InventoryPage />} />
              <Route path="/sales" element={<SalesRecordsPage orders={orders} inventory={inventory} />} />
              <Route path="/users" element={<UserManagementPage />} />
              <Route path="/settings" element={<SettingsPage currentUser={currentUser} />} />
            </Routes>
          </main>
        </div>
      </div>
    </BrowserRouter>
  );
}
