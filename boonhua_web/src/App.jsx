import { useState, useEffect, useMemo } from 'react';
import { BrowserRouter, Routes, Route, Link, useSearchParams } from 'react-router-dom';
import {
  AdminDashboardShell,
  PageHeader,
  StatCard,
  AlertBanner,
  StatusBadge,
  generateSaleReference,
} from './components/adminUi';
import { RevenueTrendChart } from './components/RevenueTrendChart';
import {
  buildDailySeriesForForecast,
  computeSalesForecastLocal,
  confidenceBadgeClass,
  confidenceLabel,
  forecastNote,
  forecastSubtitle,
  DEFAULT_FORECAST_API,
  fetchMlSalesForecast,
} from './utils/salesForecast';
import {
  formatLocalDate,
  parseLocalDate,
  eachDayInRange,
  getLast7DaysRange,
  loadStoredDateRange,
  saveStoredDateRange,
} from './utils/dateUtils';
import {
  getOrderDateKey,
  getOrderTotal,
  getOrderPaymentStatus,
  getOrderAmountPaid,
  getOrderAmountOwing,
  isOrderOutstanding,
  orderInMonthKey,
  paymentStatusReportLabel,
  getBuyerTypeLabel,
  BUYER_TYPES,
  SALE_TYPES,
} from './domain/Order';
import {
  movementInOutKg,
  formatMovementDateTime,
  movementTypeLabel,
  movementTypeBadgeClass,
  STOCK_REMOVAL_REASONS,
} from './domain/InventoryMovement';
import {
  normalizeSpeciesName,
  formatSpeciesLabel,
  findInventoryMatches,
  consolidateInventoryBySpecies,
  stockStatusForWeight,
} from './domain/InventorySpecies';
import {
  inventoryService,
  deductInventoryStock,
  restoreInventoryStock,
  recordInventoryHistory,
  recordInventoryEditHistory,
  patchSaleInventoryHistory,
  adjustStockForSaleCorrection,
} from './services/InventoryService';
import {
  normalizeWhatsAppDigits,
  openBuyerWhatsApp,
  buyerCollectionMessage,
} from './utils/whatsapp';

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
  getDocs,
  query,
  where,
  serverTimestamp,
} from "firebase/firestore";

function getMonthBounds(monthKey) {
  const [year, month] = monthKey.split('-').map(Number);
  const from = `${year}-${String(month).padStart(2, '0')}-01`;
  const lastDay = new Date(year, month, 0).getDate();
  const to = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
  const label = new Date(year, month - 1, 1).toLocaleDateString('en-MY', { month: 'long', year: 'numeric' });
  return { year, month, from, to, label };
}

// ==========================================
// 1. SETTINGS PAGE
// ==========================================
const SettingsPage = ({ currentUser }) => {
  const [activeTab, setActiveTab] = useState('profile');
  const [resetSent, setResetSent] = useState(false);
  const [saveMsg, setSaveMsg] = useState('');
  const [profileData, setProfileData] = useState({ fullName: '', phone: '' });
  const [storeData, setStoreData] = useState({
    storeName: '',
    address: '',
    openingTime: '',
    closingTime: '',
    phone: '',
    email: '',
    contactNote: '',
  });
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
          phone: data.phone || '',
          email: data.email || '',
          contactNote: data.contactNote || '',
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
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-4 border-t border-slate-100">
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Store phone / WhatsApp</label>
                  <input type="tel" value={storeData.phone} onChange={e => setStoreData({ ...storeData, phone: e.target.value })} placeholder="e.g. 012-345 6789" className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500" />
                  <p className="text-xs text-slate-500 mt-1">Shown in the mobile app <strong>Contact Us</strong> screen for consumers.</p>
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Store email</label>
                  <input type="email" value={storeData.email} onChange={e => setStoreData({ ...storeData, email: e.target.value })} placeholder="contact@boonhua.com" className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-6">
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Opening Time</label>
                  <input type="time" value={storeData.openingTime} onChange={e => setStoreData({ ...storeData, openingTime: e.target.value })} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Closing Time</label>
                  <input type="time" value={storeData.closingTime} onChange={e => setStoreData({ ...storeData, closingTime: e.target.value })} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Contact note (optional)</label>
                <textarea rows={2} value={storeData.contactNote} onChange={e => setStoreData({ ...storeData, contactNote: e.target.value })} placeholder="e.g. Visit our counter at Pasar Borong…" className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500 resize-none" />
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
              <div className="bg-teal-50 border border-teal-200 rounded-xl p-4 text-sm text-teal-900 space-y-2">
                <p className="font-bold">Current production API</p>
                <p className="font-mono text-xs break-all">https://boon-hua-fishery.onrender.com</p>
                <p className="text-xs text-teal-800">
                  When configured, <code className="bg-teal-100 px-1 rounded">GET /</code> returns{' '}
                  <code className="bg-teal-100 px-1 rounded">aiRecipes: true</code> (Gemini key on Render) and{' '}
                  <code className="bg-teal-100 px-1 rounded">firebase: true</code> (service account JSON on Render).
                </p>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Recipe API base URL</label>
                <input
                  type="url"
                  value={apiConfig.recipeApiBaseUrl}
                  onChange={e => setApiConfig({ recipeApiBaseUrl: e.target.value })}
                  placeholder="https://boon-hua-fishery.onrender.com"
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
  const [searchParams, setSearchParams] = useSearchParams();
  const ledgerTabFromUrl = () => {
    const t = searchParams.get('tab');
    return t === 'ledger' || t === 'history';
  };
  const [inventory, setInventory] = useState([]);
  const [isLoading, setIsLoading] = useState(true); // FIX: loading state added
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editItem, setEditItem] = useState(null);
  const [newCatch, setNewCatch] = useState({ species: '', weight: '', price: '' });
  // FIX: track local price edits per item to avoid defaultValue/uncontrolled anti-pattern
  const [localPrices, setLocalPrices] = useState({});
  const [activeTab, setActiveTab] = useState(() => (ledgerTabFromUrl() ? 'history' : 'stock'));
  const [history, setHistory] = useState([]);
  const [isRemovalOpen, setIsRemovalOpen] = useState(false);
  const [removalForm, setRemovalForm] = useState({
    species: '',
    quantityKg: '',
    reason: 'spoiled',
    note: '',
  });
  const [isRemoving, setIsRemoving] = useState(false);

  useEffect(() => {
    setActiveTab(ledgerTabFromUrl() ? 'history' : 'stock');
  }, [searchParams]);

  useEffect(() => {
    const unsubscribe = onSnapshot(collection(db, 'inventoryHistory'), (snapshot) => {
      const items = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
      items.sort((a, b) => {
        const ta = a.createdAt?.toDate?.() ?? new Date(0);
        const tb = b.createdAt?.toDate?.() ?? new Date(0);
        return tb - ta;
      });
      setHistory(items);
    });
    return () => unsubscribe();
  }, []);

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
        await recordInventoryHistory({
          type: 'restock',
          direction: 'in',
          species,
          quantityKg: addedWeight,
          pricePerKg: newPrice,
          totalAmountRm: Number((addedWeight * newPrice).toFixed(2)),
          note: `Added ${addedWeight.toFixed(1)} kg to existing stock`,
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
        await recordInventoryHistory({
          type: 'restock',
          direction: 'in',
          species,
          quantityKg: addedWeight,
          pricePerKg: newPrice,
          totalAmountRm: Number((addedWeight * newPrice).toFixed(2)),
          note: 'New catch logged',
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
      await inventoryService.updateItemPrice(id, newPrice);
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
      _snapshot: {
        species: item.species || '',
        weight: parseFloat(item.weight) || 0,
        price: parseFloat(item.price) || 0,
        status: item.status || 'In Stock',
      },
    });
  };

  const handleUpdateItem = async (e) => {
    e.preventDefault();
    const newWeight = parseFloat(editItem.weight);
    const newPrice = parseFloat(editItem.price);
    if (Number.isNaN(newWeight) || newWeight < 0) {
      alert('Stock (kg) must be zero or greater.');
      return;
    }
    if (Number.isNaN(newPrice)) {
      alert('Please enter a valid price.');
      return;
    }
    const after = {
      species: editItem.species,
      weight: newWeight,
      price: newPrice,
      status: editItem.status,
    };
    const before = editItem._snapshot || after;
    try {
      await updateDoc(doc(db, "inventory", editItem.id), {
        species: formatSpeciesLabel(after.species),
        weight: Number(newWeight.toFixed(1)),
        price: newPrice,
        status: after.status,
        updatedAt: serverTimestamp(),
      });
      await recordInventoryEditHistory(editItem.id, before, after);
      setEditItem(null);
    } catch (error) {
      alert("Database Error: " + error.message);
    }
  };

  const handleDeleteItem = async (item) => {
    const weight = parseFloat(item.weight || 0);
    const confirmed = window.confirm(
      `Delete ${item.species} from inventory?${weight > 0 ? ` This removes ${weight.toFixed(1)} kg from stock and is logged in history.` : ''}`,
    );
    if (!confirmed) return;
    try {
      if (weight > 0) {
        await recordInventoryHistory({
          type: 'inventory_delete',
          direction: 'out',
          species: item.species,
          quantityKg: weight,
          pricePerKg: parseFloat(item.price) || null,
          totalAmountRm: weight * (parseFloat(item.price) || 0),
          inventoryId: item.id,
          note: `Admin deleted inventory batch — ${weight.toFixed(1)} kg removed from stock list`,
        });
      } else {
        await recordInventoryHistory({
          type: 'inventory_delete',
          direction: 'out',
          species: item.species,
          quantityKg: 0,
          inventoryId: item.id,
          note: 'Admin deleted empty inventory batch record',
        });
      }
      await deleteDoc(doc(db, "inventory", item.id));
    } catch (error) {
      alert("Database Error: " + error.message);
    }
  };

  const inStockItems = useMemo(
    () => consolidateInventoryBySpecies(inventory).filter(item => parseFloat(item.weight || 0) > 0),
    [inventory]
  );

  const removalMaxKg = useMemo(() => {
    const item = inStockItems.find(
      inv => normalizeSpeciesName(inv.species) === normalizeSpeciesName(removalForm.species)
    );
    return item ? parseFloat(item.weight || 0) : 0;
  }, [inStockItems, removalForm.species]);

  const handleStockRemoval = async (e) => {
    e.preventDefault();
    const quantity = parseFloat(removalForm.quantityKg) || 0;
    if (!removalForm.species) {
      alert('Select a species.');
      return;
    }
    if (quantity <= 0) {
      alert('Enter weight removed (kg).');
      return;
    }
    if (quantity > removalMaxKg) {
      alert(`Cannot remove more than on hand (${removalMaxKg.toFixed(1)} kg).`);
      return;
    }
    const item = inStockItems.find(
      inv => normalizeSpeciesName(inv.species) === normalizeSpeciesName(removalForm.species)
    );
    setIsRemoving(true);
    try {
      await deductInventoryStock(inventory, removalForm.species, quantity);
      const price = parseFloat(item?.price || 0);
      await recordInventoryHistory({
        type: removalForm.reason,
        direction: 'out',
        species: removalForm.species,
        quantityKg: quantity,
        pricePerKg: price,
        totalAmountRm: Number((quantity * price).toFixed(2)),
        note: removalForm.note || movementTypeLabel(removalForm.reason),
      });
      setIsRemovalOpen(false);
      setRemovalForm({ species: '', quantityKg: '', reason: 'spoiled', note: '' });
    } catch (error) {
      alert('Database Error: ' + error.message);
    } finally {
      setIsRemoving(false);
    }
  };

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6 flex flex-col h-full relative">
      <AlertBanner variant="info" title="How stock works in this system">
        New catch is logged in <strong>kilograms (kg)</strong> with a <strong>daily price (RM/kg)</strong>.
        Sales and spoilage reduce kg automatically; every change (including admin deletions) is listed under Stock ledger.
      </AlertBanner>
      <div className="flex flex-wrap justify-between items-start gap-4 mb-6">
        <div className="flex flex-wrap gap-2 text-xs">
          <span className="bg-slate-100 text-slate-700 px-3 py-1 rounded-full font-bold">
            {inventory.length} batch{inventory.length === 1 ? '' : 'es'}
          </span>
          <span className="bg-emerald-50 text-emerald-800 px-3 py-1 rounded-full font-bold">
            {inStockItems.length} species in stock
          </span>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setIsRemovalOpen(true)}
            className="bg-orange-500 text-white px-4 py-2.5 rounded-xl font-bold shadow hover:bg-orange-600 transition-colors"
          >
            Record spoilage / loss
          </button>
          <button onClick={() => setIsModalOpen(true)} className="bg-blue-600 text-white px-5 py-2.5 rounded-xl font-bold shadow-lg shadow-blue-200 hover:bg-blue-700 transition-colors">
            + Add Catch
          </button>
        </div>
      </div>

      <div className="flex gap-2 mb-6 border-b border-slate-100 pb-2">
        <button
          type="button"
          onClick={() => {
            setActiveTab('stock');
            setSearchParams({});
          }}
          className={`px-4 py-2 rounded-lg text-sm font-bold ${activeTab === 'stock' ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600'}`}
        >
          Current stock
        </button>
        <button
          type="button"
          onClick={() => {
            setActiveTab('history');
            setSearchParams({ tab: 'ledger' });
          }}
          className={`px-4 py-2 rounded-lg text-sm font-bold ${activeTab === 'history' ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600'}`}
        >
          Stock ledger ({history.length})
        </button>
      </div>

      {activeTab === 'history' && (
        <div className="overflow-x-auto flex-1">
          {history.length === 0 ? (
            <div className="border-2 border-dashed border-slate-200 rounded-xl p-10 text-center text-slate-500">
              No movements yet. Sales, restocks, spoilage, and admin deletions will appear here like a bank statement.
            </div>
          ) : (
            <table className="bh-table w-full text-left border-collapse text-sm">
              <thead>
                <tr className="bg-[#F5F6FA] text-slate-500 text-xs uppercase">
                  <th className="p-3">Date / time</th>
                  <th className="p-3">Transaction</th>
                  <th className="p-3">Reference</th>
                  <th className="p-3">Species</th>
                  <th className="p-3 text-right text-emerald-700">Stock in (+)</th>
                  <th className="p-3 text-right text-red-700">Stock out (−)</th>
                  <th className="p-3 text-right">Value (RM)</th>
                  <th className="p-3">Description</th>
                </tr>
              </thead>
              <tbody>
                {history.map(row => {
                  const { stockIn, stockOut } = movementInOutKg(row);
                  return (
                  <tr key={row.id} className="border-b hover:bg-slate-50/50">
                    <td className="p-3 text-slate-600 whitespace-nowrap">{formatMovementDateTime(row)}</td>
                    <td className="p-3">
                      <span className={`py-1 px-2 rounded-full text-xs font-bold ${movementTypeBadgeClass(row.type)}`}>
                        {movementTypeLabel(row.type)}
                      </span>
                    </td>
                    <td className="p-3 font-mono text-xs text-slate-600">{row.reference || row.orderId?.slice(0, 8) || '—'}</td>
                    <td className="p-3 font-semibold">{row.species}</td>
                    <td className="p-3 text-right font-bold text-emerald-700">
                      {stockIn > 0 ? `+${stockIn.toFixed(1)}` : '—'}
                    </td>
                    <td className="p-3 text-right font-bold text-red-700">
                      {stockOut > 0 ? `−${stockOut.toFixed(1)}` : '—'}
                    </td>
                    <td className="p-3 text-right">
                      {row.totalAmountRm != null ? `RM ${Number(row.totalAmountRm).toFixed(2)}` : '—'}
                    </td>
                    <td className="p-3 text-slate-600 min-w-[180px]">{row.note || '—'}</td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}

      {activeTab === 'stock' && isLoading ? (
        <div className="flex-1 flex flex-col items-center justify-center">
          <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mb-3"></div>
          <p className="text-slate-400 text-sm font-semibold">Loading from Firestore...</p>
        </div>
      ) : activeTab === 'stock' && inventory.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center border-2 border-dashed border-slate-200 rounded-xl bg-slate-50">
          <span className="text-4xl mb-2">📥</span>
          <h3 className="text-lg font-bold text-slate-700">No Inventory Found</h3>
          <p className="text-slate-500 text-sm">Click "Add Catch" to send your first data to Firebase!</p>
        </div>
      ) : activeTab === 'stock' ? (
        <div className="overflow-x-auto">
          <table className="bh-table w-full text-left border-collapse">
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
                    <StatusBadge status={item.status} />
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
      ) : null}

      {isRemovalOpen && (
        <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="bg-white w-full max-w-md rounded-2xl p-8 shadow-2xl">
            <h3 className="text-xl font-bold mb-2 text-slate-800">Record spoilage or loss</h3>
            <p className="text-sm text-slate-500 mb-6">Removes weight from stock (like a sale) and logs it in inventory history.</p>
            <form onSubmit={handleStockRemoval} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Species</label>
                <select
                  required
                  value={removalForm.species}
                  onChange={e => setRemovalForm({ ...removalForm, species: e.target.value, quantityKg: '' })}
                  className="w-full border p-3 rounded-xl bg-white"
                >
                  <option value="">Select in-stock item...</option>
                  {inStockItems.map(item => (
                    <option key={item.id} value={item.species}>
                      {item.species} ({parseFloat(item.weight).toFixed(1)} kg)
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Reason</label>
                <select
                  value={removalForm.reason}
                  onChange={e => setRemovalForm({ ...removalForm, reason: e.target.value })}
                  className="w-full border p-3 rounded-xl bg-white"
                >
                  {STOCK_REMOVAL_REASONS.map(r => (
                    <option key={r.value} value={r.value}>{r.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">
                  Weight removed (kg){removalMaxKg > 0 ? ` — max ${removalMaxKg.toFixed(1)}` : ''}
                </label>
                <input
                  type="number"
                  step="0.1"
                  min="0.1"
                  max={removalMaxKg || undefined}
                  required
                  value={removalForm.quantityKg}
                  onChange={e => setRemovalForm({ ...removalForm, quantityKg: e.target.value })}
                  className="w-full border p-3 rounded-xl"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Note (optional)</label>
                <input
                  type="text"
                  placeholder="e.g. not fresh, ice melt, customer return"
                  value={removalForm.note}
                  onChange={e => setRemovalForm({ ...removalForm, note: e.target.value })}
                  className="w-full border p-3 rounded-xl"
                />
              </div>
              <div className="flex justify-end gap-3 mt-6">
                <button type="button" onClick={() => setIsRemovalOpen(false)} className="px-5 py-2 font-bold text-slate-500 hover:bg-slate-100 rounded-xl">Cancel</button>
                <button type="submit" disabled={isRemoving} className="px-5 py-2 bg-orange-500 text-white font-bold rounded-xl shadow-lg hover:bg-orange-600 disabled:bg-slate-300">
                  {isRemoving ? 'Saving...' : 'Confirm removal'}
                </button>
              </div>
            </form>
          </div>
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
                  <option value="Spoiled">Spoiled (label only)</option>
                  <option value="Wastage">Wastage (label only)</option>
                </select>
                <p className="text-xs text-slate-500 mt-1">
                  Increasing or decreasing kg is logged in <strong>Stock ledger</strong>. For spoilage with a reason, use &quot;Record spoilage / loss&quot;.
                </p>
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
      <AlertBanner variant="info" title="Live sync from mobile app">
        Accounts appear here when customers register on the consumer app. Status changes apply immediately in Firestore.
      </AlertBanner>

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
  const today = formatLocalDate(new Date());
  const [saleForm, setSaleForm] = useState({
    saleDate: today,
    species: '',
    quantityKg: '',
    pricePerKg: '',
  });
  const [quantityMode, setQuantityMode] = useState('weight');
  const [saleAmountRm, setSaleAmountRm] = useState('');
  const [buyerName, setBuyerName] = useState('');
  const [buyerPhone, setBuyerPhone] = useState('');
  const [buyerType, setBuyerType] = useState('walk_in');
  const [saleType, setSaleType] = useState('cash');
  const [dueDate, setDueDate] = useState('');
  const [creditNotes, setCreditNotes] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [editingOrder, setEditingOrder] = useState(null);
  const [editForm, setEditForm] = useState(null);
  const [isUpdating, setIsUpdating] = useState(false);

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

  const resolvedQuantityKg = useMemo(() => {
    const price = parseFloat(saleForm.pricePerKg) || 0;
    if (quantityMode === 'amount') {
      const amount = parseFloat(saleAmountRm) || 0;
      if (price <= 0) return 0;
      return Math.min(Number((amount / price).toFixed(2)), maxQuantityKg);
    }
    return parseFloat(saleForm.quantityKg) || 0;
  }, [quantityMode, saleAmountRm, saleForm.quantityKg, saleForm.pricePerKg, maxQuantityKg]);

  const totalAmount = useMemo(() => {
    if (quantityMode === 'amount') {
      return parseFloat(saleAmountRm) || 0;
    }
    const price = parseFloat(saleForm.pricePerKg) || 0;
    return resolvedQuantityKg * price;
  }, [quantityMode, saleAmountRm, resolvedQuantityKg, saleForm.pricePerKg]);

  useEffect(() => {
    if (!selectedItem) return;
    const nextPrice = String(selectedItem.price);
    setSaleForm(prev => (
      prev.pricePerKg === nextPrice ? prev : { ...prev, pricePerKg: nextPrice }
    ));
  }, [selectedItem?.id, selectedItem?.price]);

  const handleSpeciesChange = (species) => {
    const item = availableInventory.find(inv => normalizeSpeciesName(inv.species) === normalizeSpeciesName(species));
    setSaleForm(prev => ({
      ...prev,
      species,
      quantityKg: '',
      pricePerKg: item ? String(item.price) : '',
    }));
    setSaleAmountRm('');
  };

  const handleQuantityModeChange = (mode) => {
    setQuantityMode(mode);
    setSaleAmountRm('');
    setSaleForm(prev => ({ ...prev, quantityKg: '' }));
  };

  const handleQuantityInputChange = (rawValue) => {
    if (rawValue === '' || /^\d*\.?\d*$/.test(rawValue)) {
      setSaleForm(prev => ({ ...prev, quantityKg: rawValue }));
    }
  };

  const normalizeSaleQuantityInput = (rawValue) => {
    const trimmed = String(rawValue).trim();
    if (trimmed === '' || trimmed === '.') return '';
    const parsed = parseFloat(trimmed);
    if (Number.isNaN(parsed)) return '';
    const clamped = Math.min(Math.max(0, parsed), maxQuantityKg);
    return String(Math.round(clamped * 100) / 100);
  };

  const handleQuantityBlur = () => {
    setSaleForm(prev => {
      const next = normalizeSaleQuantityInput(prev.quantityKg);
      return prev.quantityKg === next ? prev : { ...prev, quantityKg: next };
    });
  };

  const handleQuantitySliderChange = (rawValue) => {
    setSaleForm(prev => ({ ...prev, quantityKg: rawValue }));
  };

  const handleAddSale = async (e) => {
    e.preventDefault();
    if (!selectedItem) {
      alert('Please select a seafood item that is available in inventory and pricing.');
      return;
    }
    const quantity = resolvedQuantityKg;
    if (quantityMode === 'amount') {
      const amount = parseFloat(saleAmountRm) || 0;
      if (amount <= 0) {
        alert('Enter the sale amount in RM.');
        return;
      }
    }
    if (quantity <= 0) {
      alert(quantityMode === 'amount'
        ? 'Sale amount is too small for this price/kg, or price is missing.'
        : 'Quantity sold must be greater than 0 kg.');
      return;
    }
    if (quantity > maxQuantityKg) {
      alert(`Cannot sell more than available stock (${maxQuantityKg.toFixed(1)} kg).`);
      return;
    }
    const buyerLabel = buyerName.trim();
    const phoneLabel = buyerPhone.trim();
    if (saleType !== 'cash' && !buyerLabel) {
      alert('Enter the buyer name (restaurant / customer) for credit or pre-order sales.');
      return;
    }
    if (saleType !== 'cash' && !phoneLabel) {
      alert('Enter the buyer phone number so you can follow up on payment.');
      return;
    }
    const paymentStatus = saleType === 'cash' ? 'paid' : 'unpaid';
    const amountPaid = saleType === 'cash' ? totalAmount : 0;
    setIsSaving(true);
    try {
      await deductInventoryStock(inventory, saleForm.species, quantity);

      const saleRef = generateSaleReference(saleForm.saleDate);
      const orderRef = await addDoc(collection(db, "orders"), {
        saleRef,
        saleDate: saleForm.saleDate,
        species: formatSpeciesLabel(saleForm.species),
        quantityKg: quantity,
        pricePerKg: parseFloat(saleForm.pricePerKg),
        totalAmount,
        inputMode: quantityMode,
        buyerName: buyerLabel || 'Walk-in',
        buyerPhone: phoneLabel || null,
        buyerType: buyerLabel ? buyerType : 'walk_in',
        saleType,
        paymentStatus,
        amountPaid,
        dueDate: saleType !== 'cash' && dueDate ? dueDate : null,
        creditNotes: creditNotes.trim() || null,
        createdAt: serverTimestamp(),
      });

      await recordInventoryHistory({
        type: 'sale',
        direction: 'out',
        species: saleForm.species,
        quantityKg: quantity,
        pricePerKg: parseFloat(saleForm.pricePerKg),
        totalAmountRm: totalAmount,
        inputMode: quantityMode,
        movementDate: saleForm.saleDate,
        orderId: orderRef.id,
        reference: saleRef,
        note: quantityMode === 'amount'
          ? `${saleRef}: RM ${totalAmount.toFixed(2)} (≈ ${quantity.toFixed(1)} kg)`
          : `${saleRef}: ${quantity.toFixed(1)} kg sold`,
      });

      setSaleForm({ saleDate: today, species: '', quantityKg: '', pricePerKg: '' });
      setSaleAmountRm('');
      setQuantityMode('weight');
      setBuyerName('');
      setBuyerPhone('');
      setBuyerType('walk_in');
      setSaleType('cash');
      setDueDate('');
      setCreditNotes('');
    } catch (error) {
      alert("Database Error: " + error.message);
    } finally {
      setIsSaving(false);
    }
  };

  const speciesOptionsForEdit = useMemo(() => {
    const names = new Set(availableInventory.map(i => i.species));
    if (editForm?.species) names.add(editForm.species);
    if (editingOrder?.species) names.add(editingOrder.species);
    return [...names].sort((a, b) => a.localeCompare(b));
  }, [availableInventory, editForm?.species, editingOrder?.species]);

  const openEditSale = (order) => {
    setEditingOrder(order);
    setEditForm({
      saleDate: order.saleDate || getOrderDateKey(order) || today,
      species: order.species || '',
      quantityKg: String(parseFloat(order.quantityKg) || 0),
      pricePerKg: String(parseFloat(order.pricePerKg) || 0),
      buyerName: order.buyerName === 'Walk-in' ? '' : (order.buyerName || ''),
      buyerPhone: order.buyerPhone || '',
      buyerType: order.buyerType || (order.buyerName === 'Walk-in' ? 'walk_in' : 'restaurant'),
      saleType: order.saleType || 'cash',
      dueDate: order.dueDate || '',
      creditNotes: order.creditNotes || '',
    });
  };

  const closeEditSale = () => {
    setEditingOrder(null);
    setEditForm(null);
  };

  const handleSaveEditSale = async (e) => {
    e.preventDefault();
    if (!editingOrder || !editForm) return;

    const newDate = editForm.saleDate;
    const newSpecies = formatSpeciesLabel(editForm.species);
    const newQty = parseFloat(editForm.quantityKg) || 0;
    const newPrice = parseFloat(editForm.pricePerKg) || 0;
    const oldQty = parseFloat(editingOrder.quantityKg) || 0;
    const oldSpecies = editingOrder.species || '';

    if (!newDate) {
      alert('Please set a sale date.');
      return;
    }
    if (!newSpecies.trim()) {
      alert('Please select a species.');
      return;
    }
    if (newQty <= 0) {
      alert('Quantity must be greater than 0 kg.');
      return;
    }
    if (newPrice <= 0) {
      alert('Price per kg must be greater than 0.');
      return;
    }

    const buyerLabel = editForm.buyerName.trim();
    const phoneLabel = editForm.buyerPhone.trim();
    if (editForm.saleType !== 'cash' && !buyerLabel) {
      alert('Enter buyer name for credit or pre-order sales.');
      return;
    }
    if (editForm.saleType !== 'cash' && !phoneLabel) {
      alert('Enter buyer phone for credit or pre-order sales.');
      return;
    }

    const qtyChanged = Math.abs(newQty - oldQty) > 0.0001;
    const speciesChanged =
      normalizeSpeciesName(oldSpecies) !== normalizeSpeciesName(newSpecies);

    if (qtyChanged || speciesChanged) {
      const stockRow = consolidateInventoryBySpecies(inventory).find(
        i => normalizeSpeciesName(i.species) === normalizeSpeciesName(newSpecies),
      );
      const availableKg = stockRow ? parseFloat(stockRow.weight || 0) : 0;
      const sameSpecies = !speciesChanged;
      const extraNeeded = sameSpecies ? Math.max(0, newQty - oldQty) : newQty;
      if (extraNeeded > availableKg + 0.0001) {
        alert(
          `Not enough stock for ${newSpecies}. Available ${availableKg.toFixed(1)} kg, need ${extraNeeded.toFixed(1)} kg more.`,
        );
        return;
      }
    }

    const newTotal = Number((newQty * newPrice).toFixed(2));
    const paymentStatus =
      editForm.saleType === 'cash'
        ? 'paid'
        : getOrderPaymentStatus(editingOrder);
    let amountPaid = getOrderAmountPaid(editingOrder);
    if (editForm.saleType === 'cash') {
      amountPaid = newTotal;
    } else if (paymentStatus === 'paid') {
      amountPaid = newTotal;
    } else if (amountPaid > newTotal) {
      amountPaid = newTotal;
    }

    setIsUpdating(true);
    try {
      if (qtyChanged || speciesChanged) {
        await adjustStockForSaleCorrection(
          inventory,
          oldSpecies,
          oldQty,
          newSpecies,
          newQty,
        );
      }

      await updateDoc(doc(db, 'orders', editingOrder.id), {
        saleDate: newDate,
        species: newSpecies,
        quantityKg: Number(newQty.toFixed(2)),
        pricePerKg: newPrice,
        totalAmount: newTotal,
        buyerName: buyerLabel || (editForm.saleType === 'cash' ? 'Walk-in' : ''),
        buyerPhone: phoneLabel || null,
        buyerType: buyerLabel ? editForm.buyerType : 'walk_in',
        saleType: editForm.saleType,
        paymentStatus: editForm.saleType === 'cash' ? 'paid' : paymentStatus,
        amountPaid,
        dueDate: editForm.saleType !== 'cash' && editForm.dueDate ? editForm.dueDate : null,
        creditNotes: editForm.creditNotes.trim() || null,
        updatedAt: serverTimestamp(),
      });

      const ref = editingOrder.saleRef || editingOrder.id;
      await patchSaleInventoryHistory(editingOrder.id, {
        movementDate: newDate,
        species: newSpecies,
        quantityKg: Number(newQty.toFixed(2)),
        quantityDelta: -Number(newQty.toFixed(2)),
        pricePerKg: newPrice,
        totalAmountRm: newTotal,
        note:
          editingOrder.inputMode === 'amount'
            ? `${ref}: RM ${newTotal.toFixed(2)} (≈ ${newQty.toFixed(1)} kg) — edited`
            : `${ref}: ${newQty.toFixed(1)} kg sold — edited`,
      });

      closeEditSale();
    } catch (error) {
      alert('Database Error: ' + error.message);
    } finally {
      setIsUpdating(false);
    }
  };

  const handleDeleteSale = async (order) => {
    const ref = order.saleRef || order.id;
    const confirmed = window.confirm(
      `Delete sale ${ref} (${order.species})? Stock will be restored and a reversal line will appear in the stock ledger.`,
    );
    if (!confirmed) return;
    try {
      const qty = parseFloat(order.quantityKg) || 0;
      if (qty > 0) {
        await restoreInventoryStock(
          inventory,
          order.species,
          qty,
          parseFloat(order.pricePerKg) || null,
        );
        await recordInventoryHistory({
          type: 'sale_void',
          direction: 'in',
          species: order.species,
          quantityKg: qty,
          pricePerKg: parseFloat(order.pricePerKg) || null,
          totalAmountRm: getOrderTotal(order),
          movementDate: order.saleDate || formatLocalDate(new Date()),
          orderId: order.id,
          reference: ref,
          note: `Admin deleted sale ${ref} — ${qty.toFixed(1)} kg restored to stock`,
        });
      } else {
        await recordInventoryHistory({
          type: 'sale_void',
          direction: 'in',
          species: order.species,
          quantityKg: 0,
          movementDate: order.saleDate || formatLocalDate(new Date()),
          orderId: order.id,
          reference: ref,
          note: `Admin deleted sale ${ref} (no stock quantity on record)`,
        });
      }
      await deleteDoc(doc(db, "orders", order.id));
    } catch (error) {
      alert("Database Error: " + error.message);
    }
  };

  return (
    <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,420px)_minmax(0,1fr)] gap-6 min-w-0 w-full max-w-full">
      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6 h-fit min-w-0">
        <PageHeader
          title="Record a sale"
          subtitle="Match how your counter works: weigh seafood (kg) or enter the total ringgit amount."
        />

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
            <label className="block text-xs font-bold text-slate-500 uppercase mb-2">Quantity sold</label>
            <div className="flex gap-2 mb-3">
              <button
                type="button"
                onClick={() => handleQuantityModeChange('weight')}
                className={`flex-1 py-2 rounded-lg text-sm font-bold ${quantityMode === 'weight' ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600'}`}
              >
                By weight (kg)
              </button>
              <button
                type="button"
                onClick={() => handleQuantityModeChange('amount')}
                className={`flex-1 py-2 rounded-lg text-sm font-bold ${quantityMode === 'amount' ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600'}`}
              >
                By amount (RM)
              </button>
            </div>
            {selectedItem && (
              <span className="text-xs text-slate-500 font-semibold block mb-2">
                In stock: {maxQuantityKg.toFixed(1)} kg @ RM {Number(selectedItem.price).toFixed(2)}/kg
              </span>
            )}
            {quantityMode === 'weight' ? (
              <>
                <input
                  type="range"
                  min="0"
                  max={maxQuantityKg || 0}
                  step="0.1"
                  disabled={!selectedItem}
                  value={Math.min(parseFloat(saleForm.quantityKg) || 0, maxQuantityKg)}
                  onChange={e => handleQuantitySliderChange(e.target.value)}
                  className="w-full accent-blue-600 disabled:opacity-40"
                />
                <input
                  type="text"
                  inputMode="decimal"
                  autoComplete="off"
                  required
                  disabled={!selectedItem}
                  placeholder="e.g. 2.5"
                  value={saleForm.quantityKg}
                  onChange={e => handleQuantityInputChange(e.target.value)}
                  onBlur={handleQuantityBlur}
                  className="w-full border p-3 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 mt-2 disabled:bg-slate-100"
                />
                <p className="text-xs text-slate-500 mt-1">
                  Type kg directly (decimals OK). Max {maxQuantityKg.toFixed(1)} kg in stock — or use the slider above.
                </p>
              </>
            ) : (
              <>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  required
                  disabled={!selectedItem}
                  placeholder="e.g. 150.00"
                  value={saleAmountRm}
                  onChange={e => setSaleAmountRm(e.target.value)}
                  className="w-full border p-3 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-slate-100"
                />
                {selectedItem && parseFloat(saleAmountRm) > 0 && (
                  <p className="text-xs text-blue-700 font-semibold mt-2">
                    ≈ {resolvedQuantityKg.toFixed(1)} kg deducted from stock
                  </p>
                )}
              </>
            )}
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

          <div className="border-t border-slate-100 pt-4 space-y-3">
            <p className="text-xs font-bold text-slate-500 uppercase">Buyer &amp; payment</p>
            <div>
              <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Sale type</label>
              <select
                value={saleType}
                onChange={e => setSaleType(e.target.value)}
                className="w-full border p-3 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 bg-white"
              >
                {SALE_TYPES.map(t => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-500 uppercase mb-1">
                Buyer name {saleType !== 'cash' ? '*' : '(optional)'}
              </label>
              <input
                type="text"
                required={saleType !== 'cash'}
                placeholder="e.g. Restoran Sri Mutiara"
                value={buyerName}
                onChange={e => setBuyerName(e.target.value)}
                className="w-full border p-3 rounded-xl outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Buyer type</label>
              <select
                value={buyerType}
                onChange={e => setBuyerType(e.target.value)}
                className="w-full border p-3 rounded-xl bg-white outline-none focus:ring-2 focus:ring-blue-500"
              >
                {BUYER_TYPES.map(t => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-500 uppercase mb-1">
                Phone / WhatsApp {saleType !== 'cash' ? '*' : '(optional)'}
              </label>
              <input
                type="tel"
                required={saleType !== 'cash'}
                placeholder="e.g. 012-345 6789"
                value={buyerPhone}
                onChange={e => setBuyerPhone(e.target.value)}
                className="w-full border p-3 rounded-xl outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            {saleType !== 'cash' && (
              <>
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Due date</label>
                  <input
                    type="date"
                    value={dueDate}
                    onChange={e => setDueDate(e.target.value)}
                    className="w-full border p-3 rounded-xl"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Notes</label>
                  <textarea
                    rows={2}
                    placeholder="Pre-order pickup, invoice no., etc."
                    value={creditNotes}
                    onChange={e => setCreditNotes(e.target.value)}
                    className="w-full border p-3 rounded-xl resize-none"
                  />
                </div>
                <AlertBanner variant="warning" title="Credit sale recorded">
                  Stock will be deducted now. Track payment under <strong>Collections</strong> until fully paid.
                </AlertBanner>
              </>
            )}
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

      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6 min-w-0 overflow-hidden">
        <div className="flex flex-wrap justify-between items-start gap-3 mb-4">
          <div className="min-w-0">
            <h3 className="text-xl font-bold text-slate-800">Sales ledger</h3>
            <p className="text-slate-500 text-sm">Each sale has a reference number and updates inventory history.</p>
          </div>
          <span className="bg-emerald-50 text-emerald-700 px-3 py-1 rounded-full text-xs font-bold shrink-0">{orders.length} records</span>
        </div>

        {orders.length === 0 ? (
          <div className="h-[300px] border-2 border-dashed border-slate-200 rounded-xl bg-slate-50 flex flex-col items-center justify-center text-center">
            <h4 className="text-slate-700 font-bold">No Sales Records Yet</h4>
            <p className="text-slate-500 text-sm mt-1">Save the first completed sale to start analytics.</p>
          </div>
        ) : (
          <>
            <p className="text-xs text-slate-500 mb-2">
              Scroll sideways inside the table to see <strong>Edit</strong> and <strong>Delete</strong>.
            </p>
            <div className="bh-table-scroll rounded-xl border border-slate-100">
              <table className="bh-table bh-sales-ledger-table w-full text-left border-collapse text-sm">
                <thead>
                  <tr className="bg-[#F5F6FA] text-slate-500 text-xs uppercase">
                    <th className="p-3 rounded-tl-lg whitespace-nowrap">Ref</th>
                    <th className="p-3 whitespace-nowrap">Date</th>
                    <th className="p-3 min-w-[120px]">Buyer</th>
                    <th className="p-3 whitespace-nowrap">Phone</th>
                    <th className="p-3 min-w-[100px]">Species</th>
                    <th className="p-3 whitespace-nowrap">Qty</th>
                    <th className="p-3 whitespace-nowrap">Total</th>
                    <th className="p-3 whitespace-nowrap">Payment</th>
                    <th className="p-3 rounded-tr-lg text-right bh-sticky-actions-header whitespace-nowrap">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {[...orders].sort((a, b) => (b.saleDate || '').localeCompare(a.saleDate || '')).map(order => {
                    const owing = getOrderAmountOwing(order);
                    const paid = getOrderAmountPaid(order);
                    const status = getOrderPaymentStatus(order);
                    return (
                    <tr key={order.id} className="border-b hover:bg-slate-50/50">
                      <td className="p-3 font-mono text-xs font-bold text-slate-600 whitespace-nowrap">{order.saleRef || '—'}</td>
                      <td className="p-3 text-slate-600 whitespace-nowrap">{order.saleDate || '-'}</td>
                      <td className="p-3 text-slate-700 text-sm max-w-[140px]">
                        <span className="font-semibold block truncate" title={order.buyerName || ''}>{order.buyerName || '—'}</span>
                        <span className="block text-[10px] text-slate-500">{getBuyerTypeLabel(order.buyerType)}</span>
                        {order.saleType && order.saleType !== 'cash' && (
                          <span className="block text-[10px] text-amber-700 uppercase font-bold">{order.saleType}</span>
                        )}
                      </td>
                      <td className="p-3 text-slate-600 text-sm whitespace-nowrap">{order.buyerPhone || '—'}</td>
                      <td className="p-3 font-semibold text-slate-800 max-w-[120px] truncate" title={order.species}>{order.species}</td>
                      <td className="p-3 text-slate-600 whitespace-nowrap">
                        {order.quantityKg} kg
                        {order.inputMode === 'amount' && (
                          <span className="block text-[10px] text-slate-400">entered as RM</span>
                        )}
                      </td>
                      <td className="p-3 font-bold text-emerald-600 whitespace-nowrap">RM {getOrderTotal(order).toFixed(2)}</td>
                      <td className="p-3 text-sm whitespace-nowrap">
                        {status === 'paid' ? (
                          <span className="text-emerald-700 font-bold">Paid</span>
                        ) : (
                          <>
                            <span className="text-amber-700 font-bold">Owing RM {owing.toFixed(2)}</span>
                            {paid > 0 && (
                              <span className="block text-[10px] text-slate-500">Paid RM {paid.toFixed(2)}</span>
                            )}
                          </>
                        )}
                      </td>
                      <td className="p-3 text-right bh-sticky-actions align-middle">
                        <div className="flex flex-wrap justify-end gap-1.5 min-w-[200px]">
                          {order.buyerPhone && normalizeWhatsAppDigits(order.buyerPhone) && (
                            <button
                              type="button"
                              onClick={() => openBuyerWhatsApp(order.buyerPhone, buyerCollectionMessage(order))}
                              className="bg-[#25D366]/10 text-[#128C7E] hover:bg-[#25D366]/20 px-2.5 py-1.5 rounded-lg text-xs font-bold"
                            >
                              WhatsApp
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => openEditSale(order)}
                            className="bg-blue-50 text-blue-700 hover:bg-blue-100 px-2.5 py-1.5 rounded-lg text-xs font-bold transition-colors"
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteSale(order)}
                            className="bg-red-50 text-red-600 hover:bg-red-100 px-2.5 py-1.5 rounded-lg text-xs font-bold transition-colors"
                          >
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      {editingOrder && editForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50">
          <div
            className="bg-white rounded-2xl shadow-xl border border-slate-200 w-full max-w-lg max-h-[90vh] overflow-y-auto"
            role="dialog"
            aria-labelledby="edit-sale-title"
          >
            <form onSubmit={handleSaveEditSale} className="p-6 space-y-4">
              <div className="flex justify-between items-start gap-3">
                <div>
                  <h3 id="edit-sale-title" className="text-lg font-bold text-slate-800">
                    Edit sale
                  </h3>
                  <p className="text-xs text-slate-500 mt-1 font-mono">
                    {editingOrder.saleRef || editingOrder.id}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={closeEditSale}
                  className="text-slate-400 hover:text-slate-700 text-xl leading-none"
                  aria-label="Close"
                >
                  ×
                </button>
              </div>

              <AlertBanner variant="info" title="Date and corrections">
                Changing the sale date updates this row, monthly reports, and the stock ledger line for this sale.
                If you change kg or species, stock is adjusted automatically.
              </AlertBanner>

              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Sale date</label>
                <input
                  type="date"
                  required
                  value={editForm.saleDate}
                  onChange={e => setEditForm({ ...editForm, saleDate: e.target.value })}
                  className="w-full border p-3 rounded-xl outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Species</label>
                <select
                  required
                  value={editForm.species}
                  onChange={e => setEditForm({ ...editForm, species: e.target.value })}
                  className="w-full border p-3 rounded-xl bg-white"
                >
                  {speciesOptionsForEdit.map(name => (
                    <option key={name} value={name}>{name}</option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Quantity (kg)</label>
                  <input
                    type="number"
                    step="0.1"
                    min="0.1"
                    required
                    value={editForm.quantityKg}
                    onChange={e => setEditForm({ ...editForm, quantityKg: e.target.value })}
                    className="w-full border p-3 rounded-xl"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Price (RM/kg)</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0.01"
                    required
                    value={editForm.pricePerKg}
                    onChange={e => setEditForm({ ...editForm, pricePerKg: e.target.value })}
                    className="w-full border p-3 rounded-xl"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Sale type</label>
                <select
                  value={editForm.saleType}
                  onChange={e => setEditForm({ ...editForm, saleType: e.target.value })}
                  className="w-full border p-3 rounded-xl bg-white"
                >
                  {SALE_TYPES.map(t => (
                    <option key={t.value} value={t.value}>{t.label}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Buyer name</label>
                <input
                  type="text"
                  value={editForm.buyerName}
                  onChange={e => setEditForm({ ...editForm, buyerName: e.target.value })}
                  className="w-full border p-3 rounded-xl"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Phone</label>
                <input
                  type="tel"
                  value={editForm.buyerPhone}
                  onChange={e => setEditForm({ ...editForm, buyerPhone: e.target.value })}
                  className="w-full border p-3 rounded-xl"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Buyer type</label>
                <select
                  value={editForm.buyerType}
                  onChange={e => setEditForm({ ...editForm, buyerType: e.target.value })}
                  className="w-full border p-3 rounded-xl bg-white"
                >
                  {BUYER_TYPES.map(t => (
                    <option key={t.value} value={t.value}>{t.label}</option>
                  ))}
                </select>
              </div>

              {editForm.saleType !== 'cash' && (
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Due date</label>
                  <input
                    type="date"
                    value={editForm.dueDate}
                    onChange={e => setEditForm({ ...editForm, dueDate: e.target.value })}
                    className="w-full border p-3 rounded-xl"
                  />
                </div>
              )}

              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Notes</label>
                <textarea
                  rows={2}
                  value={editForm.creditNotes}
                  onChange={e => setEditForm({ ...editForm, creditNotes: e.target.value })}
                  className="w-full border p-3 rounded-xl resize-none"
                />
              </div>

              <div className="bg-slate-50 rounded-xl p-3 text-sm text-slate-600">
                New total:{' '}
                <strong className="text-emerald-700">
                  RM {(parseFloat(editForm.quantityKg || 0) * parseFloat(editForm.pricePerKg || 0)).toFixed(2)}
                </strong>
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={closeEditSale}
                  className="flex-1 py-3 rounded-xl border border-slate-200 font-bold text-slate-600"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isUpdating}
                  className="flex-1 py-3 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 text-white font-bold"
                >
                  {isUpdating ? 'Saving…' : 'Save changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

// ==========================================
// 4b. MONTHLY SALES REPORT (print / PDF)
// ==========================================
const MonthlySalesReportPage = ({ orders, storeInfo }) => {
  const now = new Date();
  const defaultMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const [reportMonth, setReportMonth] = useState(defaultMonth);

  const { from, to, label: monthLabel } = useMemo(() => getMonthBounds(reportMonth), [reportMonth]);

  const monthOrders = useMemo(
    () => orders
      .filter(o => orderInMonthKey(o, reportMonth))
      .sort((a, b) => (getOrderDateKey(a) || '').localeCompare(getOrderDateKey(b) || '')),
    [orders, reportMonth]
  );

  const summary = useMemo(() => {
    let totalSales = 0;
    let collected = 0;
    let owing = 0;
    let paidCount = 0;
    let unpaidCount = 0;
    monthOrders.forEach(order => {
      const total = getOrderTotal(order);
      const paid = getOrderAmountPaid(order);
      const due = getOrderAmountOwing(order);
      totalSales += total;
      collected += paid;
      owing += due;
      if (due > 0.009) unpaidCount += 1;
      else paidCount += 1;
    });
    return { totalSales, collected, owing, paidCount, unpaidCount, count: monthOrders.length };
  }, [monthOrders]);

  const buyerSummary = useMemo(() => {
    const map = new Map();
    monthOrders.forEach(order => {
      const name = (order.buyerName || 'Walk-in / unspecified').trim();
      if (!map.has(name)) {
        map.set(name, {
          name,
          buyerType: order.buyerType,
          bills: 0,
          total: 0,
          paid: 0,
          owing: 0,
        });
      }
      const row = map.get(name);
      row.bills += 1;
      row.total += getOrderTotal(order);
      row.paid += getOrderAmountPaid(order);
      row.owing += getOrderAmountOwing(order);
    });
    return [...map.values()].sort((a, b) => b.owing - a.owing || b.total - a.total);
  }, [monthOrders]);

  const unpaidBuyers = buyerSummary.filter(b => b.owing > 0.009);
  const paidBuyers = buyerSummary.filter(b => b.owing <= 0.009);

  const generatedAt = new Date().toLocaleString('en-MY', { dateStyle: 'medium', timeStyle: 'short' });

  const handlePrintReport = () => {
    document.body.classList.add('bh-print-report');
    window.print();
    window.addEventListener('afterprint', () => {
      document.body.classList.remove('bh-print-report');
    }, { once: true });
  };

  return (
    <div id="monthly-sales-report" className="bh-report-document space-y-6">
      <div className="no-print flex flex-wrap justify-between items-start gap-4">
        <PageHeader
          title="Monthly sales report"
          subtitle="Sales ledger and payment status by buyer — print or save as PDF for your records."
        />
        <button
          type="button"
          onClick={handlePrintReport}
          disabled={monthOrders.length === 0}
          className="bg-slate-800 hover:bg-slate-900 disabled:bg-slate-300 text-white px-5 py-2.5 rounded-xl text-sm font-bold shadow-lg shrink-0"
        >
          Download PDF report
        </button>
      </div>

      <div className="no-print bg-white rounded-2xl shadow-sm border border-slate-100 p-4 flex flex-wrap gap-4 items-end">
        <div>
          <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Report month</label>
          <input
            type="month"
            value={reportMonth}
            onChange={e => setReportMonth(e.target.value)}
            className="bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <p className="text-sm text-slate-500 pb-1">
          Period: <strong>{from}</strong> to <strong>{to}</strong> · {monthOrders.length} sale(s)
        </p>
      </div>

      <div className="hidden print:block bh-report-cover mb-8 pb-6 border-b-2 border-slate-800">
        <h1 className="text-3xl font-black text-slate-900">{storeInfo.storeName || 'Boon Hua Fishery'}</h1>
        <p className="text-lg text-slate-600 mt-1">Monthly Sales &amp; Collection Report</p>
        <p className="text-base font-bold text-slate-800 mt-3">{monthLabel}</p>
        <p className="text-sm text-slate-500 mt-2">Period: {from} — {to}</p>
        {storeInfo.address && <p className="text-sm text-slate-500 mt-1">{storeInfo.address}</p>}
        <p className="text-sm text-slate-500 mt-4">Generated: {generatedAt}</p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 print:grid-cols-5 print:gap-2">
        <StatCard label="Sales (month)" value={`RM ${summary.totalSales.toFixed(2)}`} hint={`${summary.count} transactions`} tone="emerald" />
        <StatCard label="Collected" value={`RM ${summary.collected.toFixed(2)}`} hint="Paid in this month" tone="blue" />
        <StatCard label="Still owing" value={`RM ${summary.owing.toFixed(2)}`} hint={`${summary.unpaidCount} unpaid bill(s)`} tone="orange" />
        <StatCard label="Fully paid" value={String(summary.paidCount)} hint="Bills settled" tone="slate" />
        <StatCard label="Buyers" value={String(buyerSummary.length)} hint="Unique names" tone="purple" />
      </div>

      {monthOrders.length === 0 ? (
        <div className="bg-white rounded-2xl border border-dashed border-slate-200 p-12 text-center no-print">
          <p className="font-bold text-slate-700">No sales recorded for {monthLabel}</p>
          <p className="text-sm text-slate-500 mt-2">Record sales under Sales, then return here to generate the report.</p>
        </div>
      ) : (
        <>
          <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6 print:shadow-none print:border-slate-300 print:break-inside-avoid">
            <h3 className="text-lg font-bold text-slate-800 mb-2">Collection summary by buyer</h3>
            <p className="text-sm text-slate-500 mb-4 print:text-black">
              Who has paid and who still owes for sales dated in {monthLabel}.
            </p>

            {unpaidBuyers.length > 0 && (
              <div className="mb-6">
                <h4 className="text-sm font-bold uppercase text-amber-800 mb-2">Not fully paid ({unpaidBuyers.length})</h4>
                <table className="bh-table w-full text-sm border-collapse">
                  <thead>
                    <tr className="bg-amber-50 text-slate-600 text-xs uppercase">
                      <th className="p-3 text-left">Buyer</th>
                      <th className="p-3 text-left">Phone</th>
                      <th className="p-3 text-left">Type</th>
                      <th className="p-3 text-right">Bills</th>
                      <th className="p-3 text-right">Sales (RM)</th>
                      <th className="p-3 text-right">Paid (RM)</th>
                      <th className="p-3 text-right">Owing (RM)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {unpaidBuyers.map(row => (
                      <tr key={row.name} className="border-b">
                        <td className="p-3 font-semibold">{row.name}</td>
                        <td className="p-3 text-slate-600">{row.phone || '—'}</td>
                        <td className="p-3 text-slate-600">{getBuyerTypeLabel(row.type)}</td>
                        <td className="p-3 text-right">{row.bills}</td>
                        <td className="p-3 text-right">{row.total.toFixed(2)}</td>
                        <td className="p-3 text-right text-emerald-700">{row.paid.toFixed(2)}</td>
                        <td className="p-3 text-right font-bold text-amber-700">{row.owing.toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="bg-amber-50/80 font-bold">
                      <td className="p-3" colSpan={6}>Subtotal owing</td>
                      <td className="p-3 text-right text-amber-800">RM {summary.owing.toFixed(2)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}

            {paidBuyers.length > 0 && (
              <div>
                <h4 className="text-sm font-bold uppercase text-emerald-800 mb-2">Fully paid ({paidBuyers.length})</h4>
                <table className="bh-table w-full text-sm border-collapse">
                  <thead>
                    <tr className="bg-emerald-50 text-slate-600 text-xs uppercase">
                      <th className="p-3 text-left">Buyer</th>
                      <th className="p-3 text-left">Phone</th>
                      <th className="p-3 text-left">Type</th>
                      <th className="p-3 text-right">Bills</th>
                      <th className="p-3 text-right">Total paid (RM)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paidBuyers.map(row => (
                      <tr key={row.name} className="border-b">
                        <td className="p-3 font-semibold">{row.name}</td>
                        <td className="p-3 text-slate-600">{row.phone || '—'}</td>
                        <td className="p-3 text-slate-600">{getBuyerTypeLabel(row.type)}</td>
                        <td className="p-3 text-right">{row.bills}</td>
                        <td className="p-3 text-right font-bold text-emerald-700">{row.total.toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6 print:shadow-none print:border-slate-300">
            <h3 className="text-lg font-bold text-slate-800 mb-4">Sales ledger — {monthLabel}</h3>
            <table className="bh-table w-full text-left text-sm border-collapse print:text-xs">
              <thead>
                <tr className="bg-[#F5F6FA] text-slate-500 text-xs uppercase">
                  <th className="p-2">Ref</th>
                  <th className="p-2">Date</th>
                  <th className="p-2">Buyer</th>
                  <th className="p-2">Phone</th>
                  <th className="p-2">Item</th>
                  <th className="p-2 text-right">Qty</th>
                  <th className="p-2 text-right">Total</th>
                  <th className="p-2 text-right">Paid</th>
                  <th className="p-2 text-right">Owing</th>
                  <th className="p-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {monthOrders.map(order => {
                  const total = getOrderTotal(order);
                  const paid = getOrderAmountPaid(order);
                  const due = getOrderAmountOwing(order);
                  return (
                    <tr key={order.id} className={`border-b ${due > 0.009 ? 'print:bg-amber-50' : ''}`}>
                      <td className="p-2 font-mono text-xs">{order.saleRef || '—'}</td>
                      <td className="p-2">{order.saleDate || getOrderDateKey(order)}</td>
                      <td className="p-2 font-medium">{order.buyerName || '—'}</td>
                      <td className="p-2 text-slate-600">{order.buyerPhone || '—'}</td>
                      <td className="p-2">{order.species}</td>
                      <td className="p-2 text-right">{order.quantityKg} kg</td>
                      <td className="p-2 text-right font-semibold">{total.toFixed(2)}</td>
                      <td className="p-2 text-right text-emerald-700">{paid.toFixed(2)}</td>
                      <td className="p-2 text-right font-bold text-amber-700">{due > 0.009 ? due.toFixed(2) : '—'}</td>
                      <td className="p-2 font-bold text-xs uppercase">{paymentStatusReportLabel(order)}</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-slate-800 font-bold">
                  <td className="p-3" colSpan={6}>Month total</td>
                  <td className="p-3 text-right">RM {summary.totalSales.toFixed(2)}</td>
                  <td className="p-3 text-right text-emerald-700">RM {summary.collected.toFixed(2)}</td>
                  <td className="p-3 text-right text-amber-700">RM {summary.owing.toFixed(2)}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>

          <p className="hidden print:block text-xs text-slate-500 mt-8 pt-4 border-t border-slate-300">
            This report lists sales by sale date in the selected month. Outstanding amounts are bills not yet fully collected — follow up via Collections.
          </p>
        </>
      )}
    </div>
  );
};

// ==========================================
// 4c. CREDIT & COLLECTIONS (outstanding payments)
// ==========================================
const CreditCollectionsPage = ({ orders }) => {
  const [filter, setFilter] = useState('outstanding');
  const [payingId, setPayingId] = useState(null);

  const outstandingOrders = useMemo(
    () => orders.filter(isOrderOutstanding).sort((a, b) => (b.saleDate || '').localeCompare(a.saleDate || '')),
    [orders]
  );

  const filteredList = useMemo(() => {
    if (filter === 'all') return [...orders].sort((a, b) => (b.saleDate || '').localeCompare(a.saleDate || ''));
    if (filter === 'preorder') return outstandingOrders.filter(o => o.saleType === 'preorder');
    if (filter === 'credit') return outstandingOrders.filter(o => o.saleType === 'credit');
    return outstandingOrders;
  }, [orders, outstandingOrders, filter]);

  const totalOwing = useMemo(
    () => outstandingOrders.reduce((sum, o) => sum + getOrderAmountOwing(o), 0),
    [outstandingOrders]
  );

  const byBuyer = useMemo(() => {
    const map = new Map();
    outstandingOrders.forEach(order => {
      const key = (order.buyerName || 'Unknown').trim();
      if (!map.has(key)) {
        map.set(key, { name: key, phone: order.buyerPhone || '', type: order.buyerType, owing: 0, bills: 0 });
      }
      const row = map.get(key);
      if (!row.phone && order.buyerPhone) row.phone = order.buyerPhone;
      row.owing += getOrderAmountOwing(order);
      row.bills += 1;
    });
    return [...map.values()].sort((a, b) => b.owing - a.owing);
  }, [outstandingOrders]);

  const handleMarkPaid = async (order) => {
    const total = getOrderTotal(order);
    const ok = window.confirm(`Mark ${order.saleRef || 'sale'} as fully paid (RM ${total.toFixed(2)})?`);
    if (!ok) return;
    try {
      await updateDoc(doc(db, 'orders', order.id), {
        paymentStatus: 'paid',
        amountPaid: total,
        paidAt: serverTimestamp(),
      });
    } catch (err) {
      alert('Update failed: ' + err.message);
    }
  };

  const handlePartialPayment = async (order) => {
    const owing = getOrderAmountOwing(order);
    const raw = window.prompt(`Record payment received (RM). Still owing: RM ${owing.toFixed(2)}`, owing.toFixed(2));
    if (raw === null) return;
    const paid = parseFloat(raw);
    if (Number.isNaN(paid) || paid <= 0) {
      alert('Enter a valid amount.');
      return;
    }
    const total = getOrderTotal(order);
    const prevPaid = getOrderAmountPaid(order);
    const newPaid = Math.min(total, prevPaid + paid);
    const status = newPaid >= total - 0.009 ? 'paid' : 'partial';
    try {
      await updateDoc(doc(db, 'orders', order.id), {
        paymentStatus: status,
        amountPaid: newPaid,
        ...(status === 'paid' ? { paidAt: serverTimestamp() } : {}),
      });
    } catch (err) {
      alert('Update failed: ' + err.message);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Credit & collections"
        subtitle="Track restaurant and bulk buyers who pay later, pre-orders, and outstanding balances."
        action={(
          <Link to="/reports" className="text-sm font-bold text-[#4379EE] hover:underline no-print">
            Monthly report →
          </Link>
        )}
      />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard label="Total outstanding" value={`RM ${totalOwing.toFixed(2)}`} hint={`${outstandingOrders.length} open bill(s)`} tone="orange" />
        <StatCard label="Buyers with balance" value={String(byBuyer.length)} hint="Restaurants & credit customers" tone="slate" />
        <StatCard label="Largest debtor" value={byBuyer[0] ? `RM ${byBuyer[0].owing.toFixed(2)}` : '—'} hint={byBuyer[0]?.name || 'None'} tone="purple" />
      </div>

      {totalOwing > 0 && (
        <AlertBanner variant="danger" title="Collection risk">
          Unpaid bills are not cash in hand. Follow up before extending more credit — especially large restaurant orders.
        </AlertBanner>
      )}

      {byBuyer.length > 0 && (
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6">
          <h3 className="text-lg font-bold text-slate-800 mb-4">Outstanding by buyer</h3>
          <div className="overflow-x-auto">
            <table className="bh-table w-full text-left">
              <thead>
                <tr className="bg-[#F5F6FA] text-slate-500 text-xs uppercase">
                  <th className="p-3">Buyer</th>
                  <th className="p-3">Phone</th>
                  <th className="p-3">Type</th>
                  <th className="p-3">Open bills</th>
                  <th className="p-3 text-right">Total owing</th>
                </tr>
              </thead>
              <tbody>
                {byBuyer.map(row => (
                  <tr key={row.name} className="border-b">
                    <td className="p-3 font-semibold">{row.name}</td>
                    <td className="p-3 text-slate-600">
                      {row.phone || '—'}
                      {row.phone && normalizeWhatsAppDigits(row.phone) && (
                        <button
                          type="button"
                          onClick={() => openBuyerWhatsApp(
                            row.phone,
                            `Hi ${row.name}, this is Boon Hua Fishery regarding your outstanding balance of RM ${row.owing.toFixed(2)}. Please let us know when payment can be arranged. Thank you.`,
                          )}
                          className="block mt-1 text-[#128C7E] text-xs font-bold hover:underline"
                        >
                          WhatsApp
                        </button>
                      )}
                    </td>
                    <td className="p-3 text-slate-600">{getBuyerTypeLabel(row.type)}</td>
                    <td className="p-3">{row.bills}</td>
                    <td className="p-3 text-right font-bold text-amber-700">RM {row.owing.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6">
        <div className="flex flex-wrap gap-2 mb-6">
          {[
            { id: 'outstanding', label: 'All outstanding' },
            { id: 'credit', label: 'Credit sales' },
            { id: 'preorder', label: 'Pre-orders' },
            { id: 'all', label: 'All sales' },
          ].map(tab => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setFilter(tab.id)}
              className={`px-4 py-2 rounded-xl text-sm font-bold ${filter === tab.id ? 'bg-[#1E2640] text-white' : 'bg-slate-100 text-slate-600'}`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {filteredList.length === 0 ? (
          <p className="text-slate-500 text-sm text-center py-12">
            {filter === 'outstanding' ? 'No outstanding balances — all recorded sales are paid.' : 'No records in this view.'}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="bh-table w-full text-left">
              <thead>
                <tr className="bg-[#F5F6FA] text-xs uppercase text-slate-500">
                  <th className="p-3">Ref / date</th>
                  <th className="p-3">Buyer</th>
                  <th className="p-3">Sale</th>
                  <th className="p-3 text-right">Total</th>
                  <th className="p-3 text-right">Owing</th>
                  <th className="p-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredList.map(order => {
                  const owing = getOrderAmountOwing(order);
                  const outstanding = isOrderOutstanding(order);
                  return (
                    <tr key={order.id} className={`border-b ${outstanding ? 'bg-amber-50/40' : ''}`}>
                      <td className="p-3">
                        <span className="font-mono text-xs font-bold">{order.saleRef || '—'}</span>
                        <span className="block text-slate-500 text-xs">{order.saleDate}</span>
                      </td>
                      <td className="p-3">
                        <span className="font-semibold">{order.buyerName || '—'}</span>
                        {order.buyerPhone && <span className="block text-xs text-slate-500">{order.buyerPhone}</span>}
                        {order.dueDate && <span className="block text-xs text-amber-700">Due {order.dueDate}</span>}
                      </td>
                      <td className="p-3 text-sm">
                        {order.species} · {order.quantityKg} kg
                        <span className="block text-[10px] uppercase text-slate-400">{order.saleType || 'cash'}</span>
                        {order.creditNotes && <span className="block text-xs text-slate-500 mt-1">{order.creditNotes}</span>}
                      </td>
                      <td className="p-3 text-right font-bold">RM {getOrderTotal(order).toFixed(2)}</td>
                      <td className="p-3 text-right font-bold text-amber-700">
                        {outstanding ? `RM ${owing.toFixed(2)}` : <span className="text-emerald-600">Paid</span>}
                      </td>
                      <td className="p-3 text-right space-x-2 whitespace-nowrap">
                        {order.buyerPhone && normalizeWhatsAppDigits(order.buyerPhone) && (
                          <button
                            type="button"
                            onClick={() => openBuyerWhatsApp(order.buyerPhone, buyerCollectionMessage(order))}
                            className="bg-[#25D366]/10 text-[#128C7E] px-3 py-1.5 rounded-lg text-xs font-bold"
                          >
                            WhatsApp
                          </button>
                        )}
                        {outstanding && (
                          <>
                            <button
                              type="button"
                              disabled={payingId === order.id}
                              onClick={async () => { setPayingId(order.id); await handlePartialPayment(order); setPayingId(null); }}
                              className="bg-blue-50 text-blue-700 px-3 py-1.5 rounded-lg text-xs font-bold"
                            >
                              Partial pay
                            </button>
                            <button
                              type="button"
                              disabled={payingId === order.id}
                              onClick={async () => { setPayingId(order.id); await handleMarkPaid(order); setPayingId(null); }}
                              className="bg-emerald-50 text-emerald-700 px-3 py-1.5 rounded-lg text-xs font-bold"
                            >
                              Mark paid
                            </button>
                          </>
                        )}
                      </td>
                    </tr>
                  );
                })}
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
const OverviewPage = ({ inventory, customerCount, orders, inventoryHistory = [] }) => {
  const [apiBaseUrl, setApiBaseUrl] = useState(DEFAULT_FORECAST_API);
  const [salesForecast, setSalesForecast] = useState(() =>
    computeSalesForecastLocal(orders, getOrderDateKey, getOrderTotal, formatLocalDate),
  );
  const [forecastLoading, setForecastLoading] = useState(false);

  useEffect(() => {
    const unsub = onSnapshot(doc(db, 'app_config', 'public'), (snap) => {
      if (snap.exists() && snap.data().recipeApiBaseUrl) {
        setApiBaseUrl(snap.data().recipeApiBaseUrl.trim() || DEFAULT_FORECAST_API);
      }
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    let cancelled = false;
    const daily = buildDailySeriesForForecast(
      orders,
      getOrderDateKey,
      getOrderTotal,
      formatLocalDate,
    );
    const local = computeSalesForecastLocal(
      orders,
      getOrderDateKey,
      getOrderTotal,
      formatLocalDate,
    );

    if (!local.hasEnoughData) {
      setSalesForecast(local);
      setForecastLoading(false);
      return () => { cancelled = true; };
    }

    setForecastLoading(true);
    fetchMlSalesForecast(apiBaseUrl, daily)
      .then((result) => {
        if (!cancelled) setSalesForecast(result);
      })
      .catch(() => {
        if (!cancelled) setSalesForecast(local);
      })
      .finally(() => {
        if (!cancelled) setForecastLoading(false);
      });

    return () => { cancelled = true; };
  }, [orders, apiBaseUrl]);

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
      const key = getOrderDateKey(order);
      if (!key) return false;
      return key >= dateFrom && key <= dateTo;
    })
  ), [orders, dateFrom, dateTo]);

  const ordersOutsideRange = useMemo(() => {
    if (orders.length === 0 || filteredOrders.length > 0) return 0;
    return orders.filter(order => getOrderDateKey(order)).length;
  }, [orders, filteredOrders.length]);

  // Derived stats from real Firestore data
  const totalStock = useMemo(
    () => inventory.reduce((sum, item) => sum + parseFloat(item.weight || 0), 0).toFixed(1),
    [inventory]
  );
  const totalSales = useMemo(
    () => filteredOrders.reduce((sum, order) => sum + getOrderTotal(order), 0),
    [filteredOrders]
  );

  const totalOwingAll = useMemo(
    () => orders.reduce((sum, order) => sum + getOrderAmountOwing(order), 0),
    [orders]
  );

  const collectedInPeriod = useMemo(
    () => filteredOrders.reduce((sum, order) => sum + getOrderAmountPaid(order), 0),
    [filteredOrders]
  );
  const salesData = useMemo(() => {
    const dayKeys = eachDayInRange(dateFrom, dateTo);
    const days = dayKeys.map(key => {
      const date = parseLocalDate(key);
      return {
        key,
        name: date.toLocaleDateString('en-MY', { weekday: 'short', day: 'numeric', month: 'short' }),
        revenue: 0,
      };
    });

    filteredOrders.forEach(order => {
      const key = getOrderDateKey(order);
      if (!key) return;
      const day = days.find(item => item.key === key);
      if (day) day.revenue += getOrderTotal(order);
    });

    return days;
  }, [filteredOrders, dateFrom, dateTo]);

  const chartHasRevenue = salesData.some(day => day.revenue > 0);

  const topSellingItems = useMemo(() => {
    const totals = {};
    filteredOrders.forEach(order => {
      const species = order.species || 'Unknown';
      if (!totals[species]) totals[species] = { species, quantityKg: 0, revenue: 0 };
      totals[species].quantityKg += parseFloat(order.quantityKg || 0);
      totals[species].revenue += getOrderTotal(order);
    });
    return Object.values(totals).sort((a, b) => b.quantityKg - a.quantityKg).slice(0, 5);
  }, [filteredOrders]);

  const lowStockItems = useMemo(
    () => consolidateInventoryBySpecies(inventory).filter(item => {
      const w = parseFloat(item.weight || 0);
      return w > 0 && w < 5;
    }),
    [inventory]
  );

  const avgOrderValue = filteredOrders.length
    ? totalSales / filteredOrders.length
    : 0;

  const stats = [
    { label: 'Total stock on hand', value: `${totalStock} kg`, hint: 'All species combined', tone: 'blue' },
    { label: 'Sales value (period)', value: `RM ${totalSales.toFixed(2)}`, hint: `${filteredOrders.length} sale(s)`, tone: 'emerald' },
    { label: 'Cash collected (period)', value: `RM ${collectedInPeriod.toFixed(2)}`, hint: 'Paid portion in range', tone: 'slate' },
    { label: 'Outstanding balance', value: `RM ${totalOwingAll.toFixed(2)}`, hint: 'All unpaid bills', tone: 'orange' },
    { label: 'Mobile customers', value: String(customerCount), hint: 'Registered accounts', tone: 'purple' },
  ];

  const reportMovements = useMemo(() => (
    inventoryHistory.filter(row => {
      const key = row.movementDate;
      if (!key) return true;
      return key >= dateFrom && key <= dateTo;
    })
  ), [inventoryHistory, dateFrom, dateTo]);

  const lossInPeriodKg = useMemo(() => (
    reportMovements
      .filter(row => ['spoiled', 'wastage', 'damaged', 'expired', 'other'].includes(row.type))
      .reduce((sum, row) => sum + parseFloat(row.quantityKg || 0), 0)
  ), [reportMovements]);

  return (
    <div id="dashboard-overview" className="space-y-6 min-w-0 max-w-full overflow-x-hidden">
      {lowStockItems.length > 0 && (
        <AlertBanner variant="warning" title="Low stock alert">
          {lowStockItems.map(i => i.species).join(', ')} — below 5 kg. Consider restocking or promoting sales.
        </AlertBanner>
      )}

      {lossInPeriodKg > 0 && (
        <AlertBanner variant="danger" title="Stock losses in selected period">
          {lossInPeriodKg.toFixed(1)} kg recorded as spoilage, wastage, or damage.{' '}
          <Link to="/inventory?tab=ledger" className="font-bold underline">
            View Stock ledger →
          </Link>
        </AlertBanner>
      )}

      <div className="bg-white rounded-2xl shadow-sm p-4 border border-slate-100">
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

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-5 gap-4">
        {stats.map(stat => (
          <StatCard key={stat.label} label={stat.label} value={stat.value} hint={stat.hint} tone={stat.tone} />
        ))}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6 min-w-0 items-stretch">
        <div className="xl:col-span-2 bg-white rounded-2xl shadow-sm p-6 border border-slate-100 print:break-inside-avoid min-w-0">
          <h3 className="text-lg font-bold text-slate-800 mb-1 print:mb-3">Revenue Trends</h3>
          <p className="text-xs text-slate-500 mb-4">Daily sales value (RM) for {dateFrom} — {dateTo}</p>
          {ordersOutsideRange > 0 && (
            <AlertBanner variant="info" title="Date range has no sales">
              You have {ordersOutsideRange} sale(s) outside {dateFrom} to {dateTo}. Click <strong>Last 7 Days</strong> or widen the dates to see them on the chart.
            </AlertBanner>
          )}
          {filteredOrders.length === 0 ? (
            <div className="h-[300px] border-2 border-dashed border-slate-200 rounded-xl bg-slate-50 flex flex-col items-center justify-center text-center print:h-auto print:py-8">
              <h4 className="text-slate-700 font-bold">No sales in this period</h4>
              <p className="text-slate-500 text-sm mt-1">
                {orders.length === 0
                  ? 'Record sales under Sales — charts update from Firebase orders.'
                  : 'Adjust the date range above or click Last 7 Days.'}
              </p>
            </div>
          ) : salesData.length === 0 ? (
            <div className="h-[300px] border-2 border-dashed border-slate-200 rounded-xl bg-slate-50 flex flex-col items-center justify-center text-center">
              <h4 className="text-slate-700 font-bold">Invalid date range</h4>
              <p className="text-slate-500 text-sm mt-1">Set From before To (max 31 days shown).</p>
            </div>
          ) : !chartHasRevenue ? (
            <div className="py-8 text-center">
              <p className="text-slate-600 font-semibold">{filteredOrders.length} sale(s) in range but RM 0 total</p>
              <p className="text-slate-500 text-sm mt-1">Check that each sale has a total amount saved.</p>
              <RevenueTrendChart data={salesData} />
            </div>
          ) : (
            <RevenueTrendChart data={salesData} />
          )}
        </div>

        <div className="xl:col-span-1 bg-white rounded-2xl shadow-sm p-6 border border-slate-100 print:break-inside-avoid print:page-break-inside-avoid flex flex-col min-w-0 min-h-[300px] xl:min-h-0">
          <h3 className="text-lg font-bold text-slate-800 mb-1 shrink-0">Top-Selling Seafood</h3>
          <p className="text-xs text-slate-500 mb-4 shrink-0">By kg sold · {dateFrom} — {dateTo}</p>
          {topSellingItems.length === 0 ? (
            <p className="text-slate-500 text-sm flex-1">Top-selling items will appear after sales records are saved.</p>
          ) : (
            <div className="space-y-3 print:space-y-2 flex-1 overflow-y-auto min-h-0 pr-1">
              {topSellingItems.map(item => (
                <div key={item.species} className="flex items-center justify-between border border-slate-100 rounded-xl p-4 print:break-inside-avoid print:p-3">
                  <div className="min-w-0 pr-2">
                    <p className="font-bold text-slate-800 truncate">{item.species}</p>
                    <p className="text-xs text-slate-500">{item.quantityKg.toFixed(1)} kg sold</p>
                  </div>
                  <p className="font-black text-emerald-600 shrink-0">RM {item.revenue.toFixed(2)}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="bg-white rounded-2xl shadow-sm p-6 border border-slate-100 print:break-inside-avoid min-w-0">
        <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
          <div>
            <h3 className="text-lg font-bold text-slate-800">Sales prediction</h3>
            <p className="text-xs text-slate-500 mt-1">
              {forecastSubtitle(salesForecast)}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {forecastLoading && (
              <span className="text-xs font-semibold text-slate-400">Refreshing estimate…</span>
            )}
            <span
              className={`px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wide ${confidenceBadgeClass(salesForecast.confidence)}`}
            >
              {confidenceLabel(salesForecast.confidence)} estimate
            </span>
          </div>
        </div>

        {!salesForecast.hasEnoughData ? (
          <div className="border-2 border-dashed border-slate-200 rounded-xl bg-slate-50 p-8 text-center">
            <p className="font-bold text-slate-700">Not enough sales history yet</p>
            <p className="text-sm text-slate-500 mt-2 max-w-md mx-auto">
              Record sales under <strong>Sales</strong> for a few days — we will estimate the next
              7 days automatically.
            </p>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
              <div className="rounded-xl border border-violet-100 bg-violet-50/60 p-4">
                <p className="text-xs font-bold text-violet-700 uppercase">Next 7 days (predicted)</p>
                <p className="text-2xl font-black text-violet-900 mt-1">
                  RM {salesForecast.next7Total.toFixed(2)}
                </p>
                <p className="text-xs text-violet-600 mt-1">
                  ~RM {salesForecast.perDay.toFixed(2)} / day
                </p>
              </div>
              <div className="rounded-xl border border-slate-100 bg-slate-50 p-4">
                <p className="text-xs font-bold text-slate-500 uppercase">Last 7 days (actual)</p>
                <p className="text-2xl font-black text-slate-800 mt-1">
                  RM {salesForecast.last7Total.toFixed(2)}
                </p>
                <p className="text-xs text-slate-500 mt-1">
                  Avg RM {salesForecast.avg7.toFixed(2)} / day
                </p>
              </div>
              <div className="rounded-xl border border-slate-100 bg-slate-50 p-4">
                <p className="text-xs font-bold text-slate-500 uppercase">28-day average</p>
                <p className="text-2xl font-black text-slate-800 mt-1">
                  RM {salesForecast.avg28.toFixed(2)}
                </p>
                <p className="text-xs text-slate-500 mt-1">
                  {salesForecast.daysWithSales} day(s) with sales recorded
                  {salesForecast.trendPct != null && (
                    <>
                      {' '}
                      · recent week{' '}
                      {salesForecast.trendPct >= 0 ? '↑' : '↓'}
                      {Math.abs(salesForecast.trendPct).toFixed(0)}% vs 28-day avg
                    </>
                  )}
                </p>
              </div>
            </div>
            <p className="text-xs text-slate-500 mb-3">{forecastNote(salesForecast)}</p>
            <RevenueTrendChart
              data={salesForecast.chartSeries}
              showForecastLegend
            />
          </>
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
  const [inventoryHistory, setInventoryHistory] = useState([]);
  const [storeInfo, setStoreInfo] = useState({
    storeName: 'Boon Hua Fishery',
    address: '',
    openingTime: '',
    closingTime: '',
    phone: '',
    email: '',
    contactNote: '',
  });

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
    const u4 = onSnapshot(collection(db, "inventoryHistory"), snap => {
      setInventoryHistory(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });
    const u5 = onSnapshot(doc(db, 'storeSettings', 'main'), snap => {
      if (snap.exists()) {
        const data = snap.data();
        setStoreInfo({
          storeName: data.storeName || 'Boon Hua Fishery',
          address: data.address || '',
          openingTime: data.openingTime || '',
          closingTime: data.closingTime || '',
          phone: data.phone || '',
          email: data.email || '',
          contactNote: data.contactNote || '',
        });
      }
    });
    return () => { u1(); u2(); u3(); u4(); u5(); };
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
      <div className="min-h-screen bg-[#F0F2F8] flex flex-col items-center justify-center gap-4">
        <div className="w-11 h-11 border-4 border-[#4379EE] border-t-transparent rounded-full animate-spin" />
        <p className="text-sm font-semibold text-slate-500">Loading Boon Hua Admin…</p>
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
            <img
              src="/app-icon.png"
              alt="Boon Hua Fishery"
              className="w-14 h-14 rounded-2xl mb-3 shadow-lg shadow-blue-900/30 object-cover"
            />
            <h1 className="text-xl font-black tracking-tight uppercase">Boon Hua Fishery</h1>
            <p className="text-[10px] font-bold tracking-widest text-slate-400 mt-1 uppercase">Admin Only</p>
          </div>
          <p className="text-xs text-slate-500 text-center mb-6 leading-relaxed">
            One connected platform.
          </p>

          <h2 className="text-lg font-bold mb-6 text-center">
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
      <AdminDashboardShell storeInfo={storeInfo} currentUser={currentUser} onLogout={handleLogout}>
        <Routes>
          <Route path="/" element={<OverviewPage inventory={inventory} customerCount={customers.length} orders={orders} inventoryHistory={inventoryHistory} />} />
          <Route path="/inventory" element={<InventoryPage />} />
          <Route path="/sales" element={<SalesRecordsPage orders={orders} inventory={inventory} />} />
          <Route path="/credit" element={<CreditCollectionsPage orders={orders} />} />
          <Route path="/reports" element={<MonthlySalesReportPage orders={orders} storeInfo={storeInfo} />} />
          <Route path="/users" element={<UserManagementPage />} />
          <Route path="/settings" element={<SettingsPage currentUser={currentUser} />} />
        </Routes>
      </AdminDashboardShell>
    </BrowserRouter>
  );
}
