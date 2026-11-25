import { useState, useEffect, useMemo, useRef } from 'react';
import { BrowserRouter, Routes, Route, Link, useSearchParams } from 'react-router-dom';
import {
  AdminDashboardShell,
  PageHeader,
  StatCard,
  AlertBanner,
  StatusBadge,
  generateSaleReference,
} from './components/adminUi';
import {
  AdminNotificationProvider,
  AdminNotificationBell,
  NotificationAlert,
} from './components/AdminNotificationContext';
import { RevenueTrendChart } from './components/RevenueTrendChart';
import {
  buildDailySeriesForForecast,
  computeSalesForecastLocal,
  confidenceBadgeClass,
  confidenceLabel,
  forecastNote,
  forecastSubtitle,
  forecastModelLabel,
  DEFAULT_FORECAST_API,
  fetchMlSalesForecast,
} from './utils/salesForecast';
import {
  formatLocalDate,
  parseLocalDate,
  eachDayInRange,
  getLast7DaysRange,
  saveStoredDateRange,
  getCurrentMonthRange,
  saveStoredReportDateRange,
} from './utils/dateUtils';
import {
  exportSalesReport,
  buildSalesReportPayload,
} from './utils/reportExport';
import {
  getOrderDateKey,
  getOrderTotal,
  getOrderPaymentStatus,
  getOrderAmountPaid,
  getOrderAmountOwing,
  isOrderOutstanding,
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
  LOW_STOCK_THRESHOLD_KG,
  isLowStockWeight,
  STOCK_STATUS_OPTIONS,
  stockStatusFilterLabel,
  landingPriceOf,
} from './domain/InventorySpecies';
import { stockLossesNotificationId } from './utils/adminNotifications';
import {
  SEAFOOD_CATALOG,
  catalogSpeciesNames,
  findCatalogEntry,
} from './domain/SeafoodCatalog';
import {
  SEAFOOD_CATEGORY_OPTIONS,
  resolveSeafoodCategory,
  categoryFromIconKey,
  categoryBadgeClass,
  categoryEmoji,
} from './domain/SeafoodCategory';
import {
  inventoryService,
  deductInventoryStock,
  deductInventoryStockFromBatch,
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
import { resolveWebAdminSession } from './utils/adminSession';

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
const INVENTORY_STATUS_RANK = {
  'Out of Stock': 0,
  'Low Stock': 1,
  'In Stock': 2,
};

function inventoryTimestamp(value) {
  if (!value) return 0;
  if (typeof value.toDate === 'function') return value.toDate().getTime();
  if (value instanceof Date) return value.getTime();
  return 0;
}

function formatInventoryDate(value) {
  const ms = inventoryTimestamp(value);
  if (!ms) return '—';
  return new Date(ms).toLocaleString('en-MY', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function inventoryDateIso(value) {
  const ms = inventoryTimestamp(value);
  if (!ms) return formatLocalDate(new Date());
  return formatLocalDate(new Date(ms));
}

/**
 * Spoilage/loss batches: only inventory rows that still have stock.
 * Loss value uses landing/farm-gate cost (not daily market selling price).
 */
function buildSpoilagePriceBatches(inventory, species) {
  if (!species) return [];
  const key = normalizeSpeciesName(species);

  return inventory
    .filter(
      (item) =>
        normalizeSpeciesName(item.species) === key &&
        (parseFloat(item.weight) || 0) > 0,
    )
    .map((item) => {
      const landing = landingPriceOf(item);
      const availableKg = parseFloat(item.weight) || 0;
      const batchDate = inventoryDateIso(item.createdAt || item.updatedAt);
      const pricePerKg = landing != null ? landing : 0;
      const priceLabel = landing != null
        ? `landing RM ${landing.toFixed(2)}/kg`
        : 'landing price not set';
      return {
        id: `inv:${item.id}`,
        inventoryId: item.id,
        batchDate,
        pricePerKg,
        landingPrice: landing,
        dailyPrice: parseFloat(item.price) || 0,
        availableKg,
        label: `${batchDate} · ${priceLabel} · ${availableKg.toFixed(1)} kg left`,
      };
    })
    .sort((a, b) => String(b.batchDate).localeCompare(String(a.batchDate)));
}

function inventoryItemStockStatus(item) {
  return stockStatusForWeight(parseFloat(item.weight) || 0);
}

function inventoryStatusRank(item) {
  return INVENTORY_STATUS_RANK[inventoryItemStockStatus(item)] ?? 0;
}

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
  const [newCatch, setNewCatch] = useState({
    species: '',
    weight: '',
    landingPrice: '',
    price: '',
    category: 'Fish',
  });
  // FIX: track local price edits per item to avoid defaultValue/uncontrolled anti-pattern
  const [localPrices, setLocalPrices] = useState({});
  const [activeTab, setActiveTab] = useState(() => (ledgerTabFromUrl() ? 'history' : 'stock'));
  const [history, setHistory] = useState([]);
  const [isRemovalOpen, setIsRemovalOpen] = useState(false);
  const [removalForm, setRemovalForm] = useState({
    species: '',
    batchId: '',
    batchDate: '',
    pricePerKg: '',
    quantityKg: '',
    reason: 'spoiled',
    note: '',
  });
  const [isRemoving, setIsRemoving] = useState(false);
  const [inventorySort, setInventorySort] = useState({ field: 'updatedAt', direction: 'desc' });
  const [inventoryCategoryFilter, setInventoryCategoryFilter] = useState('All');
  const [visibleStockStatuses, setVisibleStockStatuses] = useState(() => (
    Object.fromEntries(STOCK_STATUS_OPTIONS.map((status) => [status, true]))
  ));

  const missingLandingCount = useMemo(
    () => inventory.filter((item) => landingPriceOf(item) == null).length,
    [inventory],
  );

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
    const newLanding = parseFloat(newCatch.landingPrice);
    const newPrice = parseFloat(newCatch.price);
    if (addedWeight <= 0) {
      alert('Weight must be greater than 0 kg.');
      return;
    }
    if (Number.isNaN(newLanding) || newLanding < 0) {
      alert('Please enter a valid landing / farm-gate price (what you paid per kg).');
      return;
    }
    if (Number.isNaN(newPrice) || newPrice < 0) {
      alert('Please enter a valid daily market price (selling RM/kg for the app).');
      return;
    }

    const existingMatches = findInventoryMatches(inventory, species);
    const existing = existingMatches[0];

    const category = resolveSeafoodCategory(species, newCatch.category);

    try {
      if (existing) {
        const combinedWeight = parseFloat(existing.weight || 0) + addedWeight;
        await updateDoc(doc(db, 'inventory', existing.id), {
          species,
          category,
          weight: Number(combinedWeight.toFixed(1)),
          landingPrice: newLanding,
          price: newPrice,
          status: stockStatusForWeight(combinedWeight),
          updatedAt: serverTimestamp(),
        });
        await recordInventoryHistory({
          type: 'restock',
          direction: 'in',
          species,
          quantityKg: addedWeight,
          pricePerKg: newLanding,
          totalAmountRm: Number((addedWeight * newLanding).toFixed(2)),
          note: `Added ${addedWeight.toFixed(1)} kg · landing RM ${newLanding.toFixed(2)}/kg · daily market RM ${newPrice.toFixed(2)}/kg`,
        });
        if (existingMatches.length > 1) {
          alert(
            `Combined ${addedWeight.toFixed(1)} kg with existing "${species}" (${combinedWeight.toFixed(1)} kg total).\nLanding/farm-gate: RM ${newLanding.toFixed(2)}/kg\nDaily market: RM ${newPrice.toFixed(2)}/kg\n\nNote: ${existingMatches.length - 1} older duplicate record(s) still exist — edit or delete them in the table if needed.`
          );
        } else {
          alert(
            `Combined with existing "${species}": ${combinedWeight.toFixed(1)} kg in stock.\nLanding/farm-gate: RM ${newLanding.toFixed(2)}/kg\nDaily market: RM ${newPrice.toFixed(2)}/kg`
          );
        }
      } else {
        await addDoc(collection(db, 'inventory'), {
          species,
          category,
          weight: Number(addedWeight.toFixed(1)),
          landingPrice: newLanding,
          price: newPrice,
          status: stockStatusForWeight(addedWeight),
          createdAt: serverTimestamp(),
        });
        await recordInventoryHistory({
          type: 'restock',
          direction: 'in',
          species,
          quantityKg: addedWeight,
          pricePerKg: newLanding,
          totalAmountRm: Number((addedWeight * newLanding).toFixed(2)),
          note: `New catch · landing RM ${newLanding.toFixed(2)}/kg · daily market RM ${newPrice.toFixed(2)}/kg`,
        });
      }
      setIsModalOpen(false);
      setNewCatch({ species: '', weight: '', landingPrice: '', price: '', category: 'Fish' });
    } catch (error) {
      alert('Database Error: ' + error.message);
    }
  };

  const handlePriceUpdate = async (id) => {
    const raw = localPrices[id];
    if (raw === undefined) return;
    const newPrice = parseFloat(raw);
    if (Number.isNaN(newPrice) || newPrice < 0) {
      alert('Please enter a valid daily market price (RM/kg).');
      return;
    }
    const item = inventory.find((row) => row.id === id);
    if (!item) return;
    const previousPrice = parseFloat(item.price) || 0;
    if (Math.abs(previousPrice - newPrice) < 0.0001) return;
    try {
      await inventoryService.updateItemPrice(id, newPrice, {
        species: item.species,
        previousPrice,
      });
    } catch (error) {
      alert('Database Error: ' + error.message);
    }
  };

  const openEditItem = (item) => {
    const weight = parseFloat(item.weight) || 0;
    const landing = landingPriceOf(item);
    setEditItem({
      ...item,
      weight: item.weight ?? '',
      landingPrice: landing != null ? String(landing) : (item.landingPrice ?? ''),
      price: item.price ?? '',
      category: resolveSeafoodCategory(item.species, item.category),
      _snapshot: {
        species: item.species || '',
        weight,
        landingPrice: landing,
        price: parseFloat(item.price) || 0,
        status: inventoryItemStockStatus(item),
        category: resolveSeafoodCategory(item.species, item.category),
      },
    });
  };

  const handleUpdateItem = async (e) => {
    e.preventDefault();
    const newWeight = parseFloat(editItem.weight);
    const newLanding = parseFloat(editItem.landingPrice);
    const newPrice = parseFloat(editItem.price);
    if (Number.isNaN(newWeight) || newWeight < 0) {
      alert('Stock (kg) must be zero or greater.');
      return;
    }
    if (Number.isNaN(newLanding) || newLanding < 0) {
      alert('Please enter a valid landing / farm-gate price (RM/kg).');
      return;
    }
    if (Number.isNaN(newPrice) || newPrice < 0) {
      alert('Please enter a valid daily market price (RM/kg).');
      return;
    }
    const after = {
      species: editItem.species,
      weight: newWeight,
      landingPrice: newLanding,
      price: newPrice,
      status: stockStatusForWeight(newWeight),
      category: resolveSeafoodCategory(editItem.species, editItem.category),
    };
    const before = editItem._snapshot || after;
    try {
      await updateDoc(doc(db, "inventory", editItem.id), {
        species: formatSpeciesLabel(after.species),
        category: after.category,
        weight: Number(newWeight.toFixed(1)),
        landingPrice: newLanding,
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
      `Delete ${item.species} from inventory?${weight > 0 ? ` This removes ${weight.toFixed(1)} kg from stock and is logged in history at landing/farm-gate cost.` : ''}`,
    );
    if (!confirmed) return;
    try {
      if (weight > 0) {
        const landing = landingPriceOf(item);
        const lossPrice = landing != null ? landing : (parseFloat(item.price) || 0);
        await recordInventoryHistory({
          type: 'inventory_delete',
          direction: 'out',
          species: item.species,
          quantityKg: weight,
          pricePerKg: lossPrice,
          totalAmountRm: weight * lossPrice,
          inventoryId: item.id,
          note: landing != null
            ? `Admin deleted inventory batch — ${weight.toFixed(1)} kg at landing RM ${landing.toFixed(2)}/kg`
            : `Admin deleted inventory batch — ${weight.toFixed(1)} kg (no landing price; used daily price)`,
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

  const sortedInventory = useMemo(() => {
    const items = inventory.filter((item) => {
      const status = inventoryItemStockStatus(item);
      if (!visibleStockStatuses[status]) return false;
      if (inventoryCategoryFilter === 'All') return true;
      const category = resolveSeafoodCategory(item.species, item.category);
      return category === inventoryCategoryFilter;
    });
    const dir = inventorySort.direction === 'asc' ? 1 : -1;
    items.sort((a, b) => {
      let cmp = 0;
      switch (inventorySort.field) {
        case 'species':
          cmp = (a.species || '').localeCompare(b.species || '', undefined, { sensitivity: 'base' });
          break;
        case 'category':
          cmp = resolveSeafoodCategory(a.species, a.category).localeCompare(
            resolveSeafoodCategory(b.species, b.category),
            undefined,
            { sensitivity: 'base' },
          );
          break;
        case 'weight':
          cmp = (parseFloat(a.weight) || 0) - (parseFloat(b.weight) || 0);
          break;
        case 'landingPrice':
          cmp = (landingPriceOf(a) || 0) - (landingPriceOf(b) || 0);
          break;
        case 'price':
          cmp = (parseFloat(a.price) || 0) - (parseFloat(b.price) || 0);
          break;
        case 'status':
          cmp = inventoryStatusRank(a) - inventoryStatusRank(b);
          break;
        case 'createdAt':
          cmp = inventoryTimestamp(a.createdAt) - inventoryTimestamp(b.createdAt);
          break;
        case 'updatedAt':
        default:
          cmp = inventoryTimestamp(a.updatedAt) - inventoryTimestamp(b.updatedAt);
          if (cmp === 0) {
            cmp = inventoryTimestamp(a.createdAt) - inventoryTimestamp(b.createdAt);
          }
          break;
      }
      return cmp * dir;
    });
    return items;
  }, [inventory, inventorySort, inventoryCategoryFilter, visibleStockStatuses]);

  const toggleStockStatusVisibility = (status) => {
    setVisibleStockStatuses((prev) => ({ ...prev, [status]: !prev[status] }));
  };

  const hiddenStockStatusLabels = STOCK_STATUS_OPTIONS.filter((status) => !visibleStockStatuses[status]);

  const handleInventorySort = (field) => {
    setInventorySort((prev) => {
      if (prev.field === field) {
        return { field, direction: prev.direction === 'asc' ? 'desc' : 'asc' };
      }
      const defaultDesc = ['weight', 'landingPrice', 'price', 'updatedAt', 'createdAt', 'status', 'category'].includes(field);
      return { field, direction: defaultDesc ? 'desc' : 'asc' };
    });
  };

  const inventorySortIcon = (field) => {
    if (inventorySort.field !== field) return '↕';
    return inventorySort.direction === 'asc' ? '↑' : '↓';
  };

  const removalPriceBatches = useMemo(
    () => buildSpoilagePriceBatches(inventory, removalForm.species),
    [inventory, removalForm.species],
  );

  const selectedRemovalBatch = useMemo(
    () => removalPriceBatches.find((batch) => batch.id === removalForm.batchId) || null,
    [removalPriceBatches, removalForm.batchId],
  );

  const removalMaxKg = useMemo(() => {
    if (selectedRemovalBatch?.availableKg != null) {
      return selectedRemovalBatch.availableKg;
    }
    const item = inStockItems.find(
      (inv) => normalizeSpeciesName(inv.species) === normalizeSpeciesName(removalForm.species),
    );
    return item ? parseFloat(item.weight || 0) : 0;
  }, [inStockItems, removalForm.species, selectedRemovalBatch]);

  const removalLedgerValue = useMemo(() => {
    const qty = parseFloat(removalForm.quantityKg) || 0;
    const price = parseFloat(removalForm.pricePerKg) || 0;
    return Number((qty * price).toFixed(2));
  }, [removalForm.quantityKg, removalForm.pricePerKg]);

  const applyRemovalBatch = (batchId) => {
    const batch = removalPriceBatches.find((row) => row.id === batchId);
    if (!batch) {
      setRemovalForm((prev) => ({
        ...prev,
        batchId: '',
        batchDate: '',
        pricePerKg: '',
        quantityKg: '',
      }));
      return;
    }
    setRemovalForm((prev) => ({
      ...prev,
      batchId: batch.id,
      batchDate: batch.batchDate,
      pricePerKg: String(batch.pricePerKg),
      quantityKg: '',
    }));
  };

  const handleStockRemoval = async (e) => {
    e.preventDefault();
    const quantity = parseFloat(removalForm.quantityKg) || 0;
    const price = parseFloat(removalForm.pricePerKg);
    if (!removalForm.species) {
      alert('Select a species.');
      return;
    }
    if (!removalForm.batchId) {
      alert('Select the in-stock batch this loss belongs to.');
      return;
    }
    if (selectedRemovalBatch?.landingPrice == null) {
      alert(
        'This batch has no landing / farm-gate price. Open Edit on that inventory row, set landing price, then record the loss.',
      );
      return;
    }
    if (Number.isNaN(price) || price < 0) {
      alert('Landing / farm-gate price is missing for this batch.');
      return;
    }
    if (Math.abs(price - selectedRemovalBatch.landingPrice) > 0.0001) {
      alert('Loss value must use the batch landing / farm-gate price. Re-select the batch.');
      return;
    }
    if (quantity <= 0) {
      alert('Enter weight removed (kg).');
      return;
    }
    if (quantity > removalMaxKg) {
      alert(`Cannot remove more than available (${removalMaxKg.toFixed(1)} kg).`);
      return;
    }
    setIsRemoving(true);
    try {
      const inventoryId = selectedRemovalBatch?.inventoryId || null;
      if (inventoryId) {
        await deductInventoryStockFromBatch(inventoryId, quantity);
      } else {
        await deductInventoryStock(inventory, removalForm.species, quantity);
      }
      const batchDate = removalForm.batchDate || selectedRemovalBatch?.batchDate || '';
      const reasonLabel = movementTypeLabel(removalForm.reason);
      const batchNote = batchDate
        ? `Landing/farm-gate ${batchDate} · RM ${price.toFixed(2)}/kg`
        : `Landing/farm-gate RM ${price.toFixed(2)}/kg`;
      const note = [removalForm.note.trim(), batchNote].filter(Boolean).join(' — ') || reasonLabel;
      await recordInventoryHistory({
        type: removalForm.reason,
        direction: 'out',
        species: removalForm.species,
        quantityKg: quantity,
        pricePerKg: price,
        totalAmountRm: Number((quantity * price).toFixed(2)),
        inventoryId: inventoryId || null,
        note,
      });
      setIsRemovalOpen(false);
      setRemovalForm({
        species: '',
        batchId: '',
        batchDate: '',
        pricePerKg: '',
        quantityKg: '',
        reason: 'spoiled',
        note: '',
      });
    } catch (error) {
      alert('Database Error: ' + error.message);
    } finally {
      setIsRemoving(false);
    }
  };

  const applyCatalogSpecies = (speciesName) => {
    const entry = findCatalogEntry(speciesName);
    if (!entry) return;
    setNewCatch({
      species: entry.name,
      weight: newCatch.weight,
      landingPrice: newCatch.landingPrice,
      price: String(entry.pricePerKg),
      category: categoryFromIconKey(entry.iconKey),
    });
  };

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6 flex flex-col h-full relative">
      <div className="flex flex-wrap justify-between items-start gap-4 mb-6">
        <div className="flex flex-wrap gap-2 text-xs">
          <span className="bg-slate-100 text-slate-700 px-3 py-1 rounded-full font-bold">
            {inventory.length} batch{inventory.length === 1 ? '' : 'es'}
          </span>
          <span className="bg-emerald-50 text-emerald-800 px-3 py-1 rounded-full font-bold">
            {inStockItems.length} species with stock
          </span>
          <span className="bg-amber-50 text-amber-800 px-3 py-1 rounded-full font-bold">
            {inventory.filter((item) => isLowStockWeight(item.weight)).length} low stock
          </span>
          <span className="bg-slate-100 text-slate-600 px-3 py-1 rounded-full font-bold">
            {inventory.filter((item) => (parseFloat(item.weight) || 0) <= 0).length} out of stock
          </span>
          {missingLandingCount > 0 && (
            <span className="bg-amber-100 text-amber-900 px-3 py-1 rounded-full font-bold" title="Open Edit on each row to set landing / farm-gate">
              {missingLandingCount} missing landing — use Edit
            </span>
          )}
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
          {inventory.length > 0 && sortedInventory.length === 0 && (
            <p className="text-sm text-amber-700 font-semibold mb-4">
              {hiddenStockStatusLabels.length > 0 && inventoryCategoryFilter !== 'All'
                ? `No items match the "${inventoryCategoryFilter}" category with the current stock-status filters.`
                : hiddenStockStatusLabels.length > 0
                  ? `All rows are hidden. Turn on: ${hiddenStockStatusLabels.map(stockStatusFilterLabel).join(', ')}.`
                  : `No items in the "${inventoryCategoryFilter}" category. Choose "All categories" or edit items to recategorize.`}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-3 mb-4 no-print">
            <span className="text-xs font-bold text-slate-500 uppercase">Sort by</span>
            <select
              value={inventorySort.field}
              onChange={(e) => {
                const field = e.target.value;
                const defaultDesc = ['weight', 'landingPrice', 'price', 'updatedAt', 'createdAt', 'status', 'category'].includes(field);
                setInventorySort({
                  field,
                  direction: inventorySort.field === field
                    ? inventorySort.direction
                    : (defaultDesc ? 'desc' : 'asc'),
                });
              }}
              className="border border-slate-200 rounded-lg px-3 py-2 text-sm font-semibold text-slate-700 outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="species">Species name</option>
              <option value="category">Category</option>
              <option value="weight">Stock level (kg)</option>
              <option value="landingPrice">Landing / farm-gate (RM/kg)</option>
              <option value="price">Daily market price (RM/kg)</option>
              <option value="status">Stock status</option>
              <option value="updatedAt">Last updated</option>
              <option value="createdAt">Date added</option>
            </select>
            <button
              type="button"
              onClick={() => setInventorySort((prev) => ({
                ...prev,
                direction: prev.direction === 'asc' ? 'desc' : 'asc',
              }))}
              className="border border-slate-200 rounded-lg px-3 py-2 text-sm font-bold text-slate-600 hover:bg-slate-50"
              title="Toggle sort direction"
            >
              {inventorySort.direction === 'asc' ? 'Low → high' : 'High → low'}
            </button>
            <span className="text-xs text-slate-400">or click a column header</span>
            <span className="text-xs font-bold text-slate-500 uppercase ml-2">Filter</span>
            <select
              value={inventoryCategoryFilter}
              onChange={(e) => setInventoryCategoryFilter(e.target.value)}
              className="border border-slate-200 rounded-lg px-3 py-2 text-sm font-semibold text-slate-700 outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="All">All categories</option>
              {SEAFOOD_CATEGORY_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.emoji} {option.label}
                </option>
              ))}
            </select>
            <span className="text-xs font-bold text-slate-500 uppercase ml-2">Show status</span>
            {STOCK_STATUS_OPTIONS.map((status) => (
              <label
                key={status}
                className={`inline-flex items-center gap-1.5 border rounded-lg px-3 py-2 text-xs font-bold cursor-pointer select-none ${
                  visibleStockStatuses[status]
                    ? 'border-blue-200 bg-blue-50 text-blue-800'
                    : 'border-slate-200 bg-slate-50 text-slate-400 line-through'
                }`}
              >
                <input
                  type="checkbox"
                  className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                  checked={visibleStockStatuses[status]}
                  onChange={() => toggleStockStatusVisibility(status)}
                />
                {stockStatusFilterLabel(status)}
              </label>
            ))}
          </div>
          <table className="bh-table w-full text-left border-collapse">
            <thead>
              <tr className="bg-[#F5F6FA] text-slate-500 text-xs uppercase">
                <th className="p-4 rounded-tl-lg">
                  <button
                    type="button"
                    onClick={() => handleInventorySort('species')}
                    className="font-bold uppercase tracking-wide hover:text-blue-600 inline-flex items-center gap-1"
                  >
                    Species <span className="text-slate-400">{inventorySortIcon('species')}</span>
                  </button>
                </th>
                <th className="p-4">
                  <button
                    type="button"
                    onClick={() => handleInventorySort('category')}
                    className="font-bold uppercase tracking-wide hover:text-blue-600 inline-flex items-center gap-1"
                  >
                    Category <span className="text-slate-400">{inventorySortIcon('category')}</span>
                  </button>
                </th>
                <th className="p-4">
                  <button
                    type="button"
                    onClick={() => handleInventorySort('weight')}
                    className="font-bold uppercase tracking-wide hover:text-blue-600 inline-flex items-center gap-1"
                  >
                    Weight (kg) <span className="text-slate-400">{inventorySortIcon('weight')}</span>
                  </button>
                </th>
                <th className="p-4 text-amber-700">
                  <button
                    type="button"
                    onClick={() => handleInventorySort('landingPrice')}
                    className="font-bold uppercase tracking-wide text-amber-700 hover:text-amber-900 inline-flex items-center gap-1"
                  >
                    Landing / farm-gate <span className="text-amber-500">{inventorySortIcon('landingPrice')}</span>
                  </button>
                </th>
                <th className="p-4 text-blue-600">
                  <button
                    type="button"
                    onClick={() => handleInventorySort('price')}
                    className="font-bold uppercase tracking-wide text-blue-600 hover:text-blue-800 inline-flex items-center gap-1"
                  >
                    Daily market (RM/kg) <span className="text-blue-400">{inventorySortIcon('price')}</span>
                  </button>
                </th>
                <th className="p-4">
                  <button
                    type="button"
                    onClick={() => handleInventorySort('status')}
                    className="font-bold uppercase tracking-wide hover:text-blue-600 inline-flex items-center gap-1"
                  >
                    Status <span className="text-slate-400">{inventorySortIcon('status')}</span>
                  </button>
                </th>
                <th className="p-4">
                  <button
                    type="button"
                    onClick={() => handleInventorySort('updatedAt')}
                    className="font-bold uppercase tracking-wide hover:text-blue-600 inline-flex items-center gap-1"
                  >
                    Last updated <span className="text-slate-400">{inventorySortIcon('updatedAt')}</span>
                  </button>
                </th>
                <th className="p-4 rounded-tr-lg text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {sortedInventory.map((item) => {
                const category = resolveSeafoodCategory(item.species, item.category);
                return (
                <tr key={item.id} className="border-b hover:bg-slate-50/50">
                  <td className="p-4 font-semibold text-slate-800">{item.species}</td>
                  <td className="p-4">
                    <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold border ${categoryBadgeClass(category)}`}>
                      <span>{categoryEmoji(category)}</span>
                      {category}
                    </span>
                  </td>
                  <td className="p-4 text-slate-600">{item.weight} kg</td>
                  <td className="p-4 text-amber-900 text-sm whitespace-nowrap">
                    {landingPriceOf(item) != null
                      ? `RM ${landingPriceOf(item).toFixed(2)}`
                      : <span className="text-slate-400">Not set</span>}
                  </td>
                  <td className="p-4">
                    {/* Daily market price — syncs to mobile Market tab */}
                    <div className="flex items-center gap-1 bg-white border border-slate-300 rounded-lg px-2 py-1 w-28 focus-within:ring-2 focus-within:ring-blue-500">
                      <span className="text-slate-400 font-bold text-sm">RM</span>
                      <input
                        type="number"
                        value={localPrices[item.id] ?? item.price}
                        onChange={e => setLocalPrices(prev => ({ ...prev, [item.id]: e.target.value }))}
                        onBlur={() => handlePriceUpdate(item.id)}
                        className="w-full bg-transparent outline-none font-bold text-slate-800 text-sm"
                        title="Daily market / selling price (shown in mobile Market)"
                      />
                    </div>
                  </td>
                  <td className="p-4">
                    <StatusBadge status={inventoryItemStockStatus(item)} />
                  </td>
                  <td className="p-4 text-slate-500 text-sm whitespace-nowrap">
                    {formatInventoryDate(item.updatedAt || item.createdAt)}
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
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}

      {isRemovalOpen && (
        <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="bg-white w-full max-w-lg rounded-2xl p-8 shadow-2xl max-h-[90vh] overflow-y-auto">
            <h3 className="text-xl font-bold mb-2 text-slate-800">Record spoilage or loss</h3>
            <p className="text-sm text-slate-500 mb-6">
              Choose a batch still in stock. Loss value always uses that batch&apos;s <strong>landing / farm-gate</strong> cost
              (set via Edit on inventory). Daily market price is not used.
            </p>
            <form onSubmit={handleStockRemoval} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Species</label>
                <select
                  required
                  value={removalForm.species}
                  onChange={(e) => setRemovalForm({
                    species: e.target.value,
                    batchId: '',
                    batchDate: '',
                    pricePerKg: '',
                    quantityKg: '',
                    reason: removalForm.reason,
                    note: removalForm.note,
                  })}
                  className="w-full border p-3 rounded-xl bg-white"
                >
                  <option value="">Select in-stock item...</option>
                  {inStockItems.map((item) => (
                    <option key={item.id} value={item.species}>
                      {item.species} ({parseFloat(item.weight).toFixed(1)} kg)
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">
                  Stock batch (date · landing RM/kg)
                </label>
                <select
                  required
                  disabled={!removalForm.species}
                  value={removalForm.batchId}
                  onChange={(e) => applyRemovalBatch(e.target.value)}
                  className="w-full border p-3 rounded-xl bg-white disabled:bg-slate-50"
                >
                  <option value="">
                    {removalForm.species
                      ? (removalPriceBatches.length
                        ? 'Select in-stock batch...'
                        : 'No stock left for this species')
                      : 'Select a species first'}
                  </option>
                  {removalPriceBatches.map((batch) => (
                    <option key={batch.id} value={batch.id}>
                      {batch.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Batch date</label>
                  <input
                    type="date"
                    required
                    disabled={!removalForm.batchId}
                    value={removalForm.batchDate}
                    onChange={(e) => setRemovalForm({ ...removalForm, batchDate: e.target.value })}
                    className="w-full border p-3 rounded-xl disabled:bg-slate-50"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-amber-700 uppercase mb-1">Landing / farm-gate (RM/kg)</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    required
                    readOnly
                    disabled={!removalForm.batchId || selectedRemovalBatch?.landingPrice == null}
                    value={removalForm.pricePerKg}
                    className="w-full border border-amber-200 p-3 rounded-xl bg-amber-50/50 disabled:bg-slate-50 text-amber-950 font-semibold"
                    title="Taken from inventory landing price (Edit). Not editable here."
                  />
                </div>
              </div>
              {removalForm.batchId && selectedRemovalBatch && (
                <p className="text-xs text-slate-500 -mt-2">
                  Daily market on this batch: RM {(selectedRemovalBatch.dailyPrice || 0).toFixed(2)}/kg (not used for loss value)
                  {selectedRemovalBatch.landingPrice == null
                    ? ' · Landing price missing — open Edit on this inventory row, save landing / farm-gate, then try again.'
                    : ' · Loss value locked to this landing price.'}
                </p>
              )}
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Reason</label>
                <select
                  value={removalForm.reason}
                  onChange={(e) => setRemovalForm({ ...removalForm, reason: e.target.value })}
                  className="w-full border p-3 rounded-xl bg-white"
                >
                  {STOCK_REMOVAL_REASONS.map((r) => (
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
                  disabled={!removalForm.batchId}
                  value={removalForm.quantityKg}
                  onChange={(e) => setRemovalForm({ ...removalForm, quantityKg: e.target.value })}
                  className="w-full border p-3 rounded-xl disabled:bg-slate-50"
                />
              </div>
              {removalForm.batchId && (
                <div className="rounded-xl border border-orange-100 bg-orange-50 px-4 py-3 text-sm text-orange-900">
                  <p className="font-bold">Loss value (landing / farm-gate)</p>
                  <p className="mt-1">
                    {parseFloat(removalForm.quantityKg) > 0
                      ? `${parseFloat(removalForm.quantityKg).toFixed(1)} kg × RM ${(parseFloat(removalForm.pricePerKg) || 0).toFixed(2)}/kg = RM ${removalLedgerValue.toFixed(2)}`
                      : `Uses landing RM ${(parseFloat(removalForm.pricePerKg) || 0).toFixed(2)}/kg`}
                  </p>
                </div>
              )}
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Note (optional)</label>
                <input
                  type="text"
                  placeholder="e.g. not fresh, ice melt, customer return"
                  value={removalForm.note}
                  onChange={(e) => setRemovalForm({ ...removalForm, note: e.target.value })}
                  className="w-full border p-3 rounded-xl"
                />
              </div>
              <div className="flex justify-end gap-3 mt-6">
                <button
                  type="button"
                  onClick={() => {
                    setIsRemovalOpen(false);
                    setRemovalForm({
                      species: '',
                      batchId: '',
                      batchDate: '',
                      pricePerKg: '',
                      quantityKg: '',
                      reason: 'spoiled',
                      note: '',
                    });
                  }}
                  className="px-5 py-2 font-bold text-slate-500 hover:bg-slate-100 rounded-xl"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isRemoving || !removalForm.batchId}
                  className="px-5 py-2 bg-orange-500 text-white font-bold rounded-xl shadow-lg hover:bg-orange-600 disabled:bg-slate-300"
                >
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
            <h3 className="text-xl font-bold mb-2 text-slate-800">Log New Catch</h3>
            <p className="text-sm text-slate-500 mb-6">
              Landing / farm-gate is what you paid. Daily market is the selling price shown in the mobile Market tab.
            </p>
            <form onSubmit={handleAddCatch} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Species catalog</label>
                <select
                  value=""
                  onChange={(e) => applyCatalogSpecies(e.target.value)}
                  className="w-full border p-3 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                >
                  <option value="">Pick from species catalog...</option>
                  {SEAFOOD_CATALOG.map((entry) => (
                    <option key={entry.name} value={entry.name}>
                      {entry.name} — market RM {entry.pricePerKg.toFixed(2)}/kg
                    </option>
                  ))}
                </select>
              </div>
              <input
                type="text"
                list="species-catalog"
                placeholder="Species Name"
                required
                value={newCatch.species}
                onChange={e => setNewCatch({ ...newCatch, species: e.target.value })}
                className="w-full border p-3 rounded-xl outline-none focus:ring-2 focus:ring-blue-500"
              />
              <datalist id="species-catalog">
                {catalogSpeciesNames().map((name) => (
                  <option key={name} value={name} />
                ))}
              </datalist>
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Category</label>
                <select
                  value={newCatch.category}
                  onChange={(e) => setNewCatch({ ...newCatch, category: e.target.value })}
                  className="w-full border p-3 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                >
                  {SEAFOOD_CATEGORY_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.emoji} {option.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Weight (kg)</label>
                <input
                  type="number"
                  placeholder="Weight (KG)"
                  step="0.1"
                  required
                  value={newCatch.weight}
                  onChange={e => setNewCatch({ ...newCatch, weight: e.target.value })}
                  className="w-full border p-3 rounded-xl outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-amber-700 uppercase mb-1">Landing / farm-gate (RM/kg)</label>
                  <input
                    type="number"
                    placeholder="Cost paid"
                    step="0.01"
                    min="0"
                    required
                    value={newCatch.landingPrice}
                    onChange={e => setNewCatch({ ...newCatch, landingPrice: e.target.value })}
                    className="w-full border border-amber-200 p-3 rounded-xl outline-none focus:ring-2 focus:ring-amber-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-blue-700 uppercase mb-1">Daily market (RM/kg)</label>
                  <input
                    type="number"
                    placeholder="Selling price"
                    step="0.01"
                    min="0"
                    required
                    value={newCatch.price}
                    onChange={e => setNewCatch({ ...newCatch, price: e.target.value })}
                    className="w-full border border-blue-200 p-3 rounded-xl outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
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
                <input
                  type="text"
                  list="species-catalog-edit"
                  required
                  value={editItem.species}
                  onChange={e => setEditItem({ ...editItem, species: e.target.value })}
                  className="w-full border p-3 rounded-xl outline-none focus:ring-2 focus:ring-blue-500"
                />
                <datalist id="species-catalog-edit">
                  {catalogSpeciesNames().map((name) => (
                    <option key={name} value={name} />
                  ))}
                </datalist>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Current Stock (kg)</label>
                <input type="number" step="0.1" required value={editItem.weight} onChange={e => setEditItem({ ...editItem, weight: e.target.value })} className="w-full border p-3 rounded-xl outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-amber-700 uppercase mb-1">Landing / farm-gate (RM/kg)</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    required
                    value={editItem.landingPrice}
                    onChange={e => setEditItem({ ...editItem, landingPrice: e.target.value })}
                    className="w-full border border-amber-200 p-3 rounded-xl outline-none focus:ring-2 focus:ring-amber-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-blue-700 uppercase mb-1">Daily market (RM/kg)</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    required
                    value={editItem.price}
                    onChange={e => setEditItem({ ...editItem, price: e.target.value })}
                    className="w-full border border-blue-200 p-3 rounded-xl outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <p className="text-[11px] text-slate-500 mt-1">Shown in mobile Market</p>
                </div>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Category</label>
                <select
                  value={editItem.category}
                  onChange={(e) => setEditItem({ ...editItem, category: e.target.value })}
                  className="w-full border p-3 rounded-xl outline-none focus:ring-2 focus:ring-blue-500"
                >
                  {SEAFOOD_CATEGORY_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.emoji} {option.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Stock status</label>
                <div className="flex items-center gap-2 border border-slate-200 rounded-xl px-3 py-3 bg-slate-50">
                  <StatusBadge status={stockStatusForWeight(parseFloat(editItem.weight) || 0)} />
                  <span className="text-xs text-slate-500">
                    Auto from kg — in stock &gt;{LOW_STOCK_THRESHOLD_KG} kg, low stock 1–{LOW_STOCK_THRESHOLD_KG} kg, 0 kg = out of stock
                  </span>
                </div>
                <p className="text-xs text-slate-500 mt-1">
                  Stock kg, landing, and daily price changes are logged in <strong>Stock ledger</strong>.
                  Spoilage / loss value uses <strong>landing / farm-gate</strong> (not daily market).
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

  const toggleAccountStatus = async (user) => {
    const nextStatus = user.status === 'Active' ? 'Suspended' : 'Active';
    const action = nextStatus === 'Suspended' ? 'deactivate' : 'activate';
    if (!window.confirm(`${action === 'deactivate' ? 'Deactivate' : 'Activate'} account for ${user.name || user.email}?`)) {
      return;
    }
    try {
      await updateDoc(doc(db, 'customers', user.id), {
        status: nextStatus,
        updatedAt: serverTimestamp(),
      });
    } catch (err) {
      alert(`Could not ${action} account: ${err.message}`);
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
                    <div className="flex flex-wrap items-center justify-center gap-2">
                      <button
                        type="button"
                        onClick={() => toggleAccountStatus(user)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${
                          user.status === 'Active'
                            ? 'bg-red-50 text-red-700 hover:bg-red-100'
                            : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                        }`}
                      >
                        {user.status === 'Active' ? 'Deactivate' : 'Activate'}
                      </button>
                      <button onClick={() => openEditModal(user)} className="bg-slate-100 text-slate-600 hover:bg-blue-100 hover:text-blue-600 px-3 py-1.5 rounded-lg text-xs font-bold transition-colors">
                        Edit
                      </button>
                    </div>
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
  const [amountPaidNow, setAmountPaidNow] = useState('');
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

  const paidNowValue = useMemo(() => {
    if (amountPaidNow === '' || amountPaidNow == null) return null;
    const n = parseFloat(amountPaidNow);
    return Number.isNaN(n) ? null : n;
  }, [amountPaidNow]);

  const balanceDue = useMemo(() => {
    if (paidNowValue == null) return totalAmount;
    return Math.max(0, Number((totalAmount - paidNowValue).toFixed(2)));
  }, [totalAmount, paidNowValue]);

  const isFullyPaid = totalAmount > 0 && paidNowValue != null && paidNowValue >= totalAmount - 0.009;
  const needsBuyerContact = totalAmount > 0 && !isFullyPaid;

  useEffect(() => {
    if (!selectedItem) return;
    const nextPrice = String(selectedItem.price);
    setSaleForm(prev => (
      prev.pricePerKg === nextPrice ? prev : { ...prev, pricePerKg: nextPrice }
    ));
  }, [selectedItem?.id, selectedItem?.price]);

  const prevSaleTotalRef = useRef(0);
  // Default “customer paid” to full total when the bill first appears / was paid in full.
  // Keep 0 or a partial amount the user already typed.
  useEffect(() => {
    if (totalAmount <= 0) {
      setAmountPaidNow('');
      prevSaleTotalRef.current = 0;
      return;
    }
    setAmountPaidNow((prev) => {
      const previousTotal = prevSaleTotalRef.current;
      const current = parseFloat(prev);
      const wasBlank = prev === '' || prev == null;
      const wasFull =
        wasBlank ||
        Number.isNaN(current) ||
        Math.abs(current - previousTotal) < 0.02;
      prevSaleTotalRef.current = totalAmount;
      if (wasFull) return totalAmount.toFixed(2);
      if (!Number.isNaN(current) && current > totalAmount) return totalAmount.toFixed(2);
      return prev;
    });
  }, [totalAmount]);

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
    if (paidNowValue == null || paidNowValue < 0) {
      alert('Enter how much the customer paid (RM). Use 0 if nothing paid yet.');
      return;
    }
    if (paidNowValue > totalAmount + 0.009) {
      alert(`Amount paid cannot exceed the sale total (RM ${totalAmount.toFixed(2)}).`);
      return;
    }

    const buyerLabel = buyerName.trim();
    const phoneLabel = buyerPhone.trim();
    const fullyPaid = paidNowValue >= totalAmount - 0.009;
    if (!fullyPaid) {
      if (!buyerLabel) {
        alert('Customer did not pay in full — enter buyer name to follow up.');
        return;
      }
      if (!phoneLabel) {
        alert('Customer did not pay in full — enter phone / WhatsApp number to follow up.');
        return;
      }
    }

    const amountPaid = Number(paidNowValue.toFixed(2));
    const paymentStatus = fullyPaid ? 'paid' : (amountPaid > 0 ? 'partial' : 'unpaid');
    // Underpaid cash sales are tracked as credit for Collections.
    const savedSaleType = fullyPaid ? saleType : (saleType === 'cash' ? 'credit' : saleType);

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
        saleType: savedSaleType,
        paymentStatus,
        amountPaid,
        dueDate: !fullyPaid && dueDate ? dueDate : null,
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
      setAmountPaidNow('');
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

          <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 flex justify-between items-center">
            <span className="text-sm font-bold text-slate-500">Sale total</span>
            <span className="text-xl font-black text-emerald-600">RM {totalAmount.toFixed(2)}</span>
          </div>

          <div className="border-t border-slate-100 pt-4 space-y-3">
            <p className="text-xs font-bold text-slate-500 uppercase">Buyer &amp; payment</p>
            <div>
              <label className="block text-xs font-bold text-slate-500 uppercase mb-1">
                Customer paid (RM) *
              </label>
              <div className="flex gap-2">
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  max={totalAmount > 0 ? Number(totalAmount.toFixed(2)) : undefined}
                  required
                  placeholder="0.00"
                  value={amountPaidNow}
                  onChange={(e) => setAmountPaidNow(e.target.value)}
                  className="w-full border p-3 rounded-xl outline-none focus:ring-2 focus:ring-blue-500"
                />
                <button
                  type="button"
                  disabled={totalAmount <= 0}
                  onClick={() => setAmountPaidNow(totalAmount.toFixed(2))}
                  className="shrink-0 px-3 py-2 rounded-xl text-xs font-bold bg-emerald-50 text-emerald-800 border border-emerald-200 hover:bg-emerald-100 disabled:opacity-40"
                >
                  Full
                </button>
              </div>
              <p className="text-xs text-slate-500 mt-1">
                How much did the customer pay now? Balance owing: {' '}
                <strong className={balanceDue > 0.009 ? 'text-amber-700' : 'text-emerald-700'}>
                  RM {balanceDue.toFixed(2)}
                </strong>
              </p>
            </div>
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
                Buyer name {needsBuyerContact ? '*' : '(optional)'}
              </label>
              <input
                type="text"
                required={needsBuyerContact}
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
                Phone / WhatsApp {needsBuyerContact ? '*' : '(optional)'}
              </label>
              <input
                type="tel"
                required={needsBuyerContact}
                placeholder="e.g. 012-345 6789"
                value={buyerPhone}
                onChange={e => setBuyerPhone(e.target.value)}
                className="w-full border p-3 rounded-xl outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            {needsBuyerContact && (
              <AlertBanner variant="warning" title="Not paid in full">
                Name and phone are required. Balance RM {balanceDue.toFixed(2)} will show under{' '}
                <strong>Collections</strong> until paid.
              </AlertBanner>
            )}
            {(needsBuyerContact || saleType !== 'cash') && (
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
              </>
            )}
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
  // Always open on the current calendar month (ignore old saved ranges like June).
  const [dateFrom, setDateFrom] = useState(() => getCurrentMonthRange().from);
  const [dateTo, setDateTo] = useState(() => getCurrentMonthRange().to);
  const [exportError, setExportError] = useState('');
  const [exportingFormat, setExportingFormat] = useState('');

  useEffect(() => {
    const { from, to } = getCurrentMonthRange();
    setDateFrom(from);
    setDateTo(to);
    saveStoredReportDateRange(from, to);
  }, []);

  const setDateRange = (from, to) => {
    setDateFrom(from);
    setDateTo(to);
    saveStoredReportDateRange(from, to);
  };

  const handleThisMonth = () => {
    const { from, to } = getCurrentMonthRange();
    setDateRange(from, to);
  };

  const rangeInvalid = useMemo(() => {
    const start = parseLocalDate(dateFrom);
    const end = parseLocalDate(dateTo);
    return Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end;
  }, [dateFrom, dateTo]);

  const periodLabel = useMemo(() => {
    if (rangeInvalid) return 'Invalid range';
    const fromD = parseLocalDate(dateFrom);
    const toD = parseLocalDate(dateTo);
    if (dateFrom === dateTo) {
      return fromD.toLocaleDateString('en-MY', { day: 'numeric', month: 'long', year: 'numeric' });
    }
    return `${fromD.toLocaleDateString('en-MY', { day: 'numeric', month: 'short', year: 'numeric' })} — ${toD.toLocaleDateString('en-MY', { day: 'numeric', month: 'short', year: 'numeric' })}`;
  }, [dateFrom, dateTo, rangeInvalid]);

  const periodOrders = useMemo(
    () => orders
      .filter(o => {
        const key = getOrderDateKey(o);
        if (!key || rangeInvalid) return false;
        return key >= dateFrom && key <= dateTo;
      })
      .sort((a, b) => (getOrderDateKey(a) || '').localeCompare(getOrderDateKey(b) || '')),
    [orders, dateFrom, dateTo, rangeInvalid]
  );

  const summary = useMemo(() => {
    let totalSales = 0;
    let collected = 0;
    let owing = 0;
    let paidCount = 0;
    let unpaidCount = 0;
    periodOrders.forEach(order => {
      const total = getOrderTotal(order);
      const paid = getOrderAmountPaid(order);
      const due = getOrderAmountOwing(order);
      totalSales += total;
      collected += paid;
      owing += due;
      if (due > 0.009) unpaidCount += 1;
      else paidCount += 1;
    });
    return { totalSales, collected, owing, paidCount, unpaidCount, count: periodOrders.length };
  }, [periodOrders]);

  const buyerSummary = useMemo(() => {
    const map = new Map();
    periodOrders.forEach(order => {
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
  }, [periodOrders]);

  const unpaidBuyers = buyerSummary.filter(b => b.owing > 0.009);
  const paidBuyers = buyerSummary.filter(b => b.owing <= 0.009);

  const generatedAt = new Date().toLocaleString('en-MY', { dateStyle: 'medium', timeStyle: 'short' });

  const exportPayload = useMemo(() => buildSalesReportPayload({
    storeInfo,
    dateFrom,
    dateTo,
    periodLabel,
    summary,
    buyerSummary,
    periodOrders,
    getBuyerTypeLabel,
    getOrderDateKey,
    getOrderTotal,
    getOrderAmountPaid,
    getOrderAmountOwing,
    paymentStatusReportLabel,
  }), [storeInfo, dateFrom, dateTo, periodLabel, summary, buyerSummary, periodOrders]);

  const handleExport = async (format) => {
    setExportError('');
    setExportingFormat(format);
    try {
      await exportSalesReport(exportPayload, format);
    } catch (err) {
      setExportError(err.message || 'Export failed.');
    } finally {
      setExportingFormat('');
    }
  };

  return (
    <div id="monthly-sales-report" className="bh-report-document space-y-6">
      <div className="no-print flex flex-wrap justify-between items-start gap-4">
        <PageHeader
          title="Monthly sales report"
          subtitle="Sales ledger and payment status by buyer — download as CSV or Excel, or save as PDF."
        />
        <div className="flex flex-wrap gap-2 shrink-0">
          <button
            type="button"
            onClick={() => handleExport('csv')}
            disabled={periodOrders.length === 0 || rangeInvalid || exportingFormat}
            className="bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 text-white px-4 py-2.5 rounded-xl text-sm font-bold shadow-lg"
          >
            {exportingFormat === 'csv' ? 'Exporting…' : 'Download CSV'}
          </button>
          <button
            type="button"
            onClick={() => handleExport('xlsx')}
            disabled={periodOrders.length === 0 || rangeInvalid || exportingFormat}
            className="bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 text-white px-4 py-2.5 rounded-xl text-sm font-bold shadow-lg"
          >
            {exportingFormat === 'xlsx' ? 'Exporting…' : 'Download Excel'}
          </button>
          <button
            type="button"
            onClick={() => handleExport('pdf')}
            disabled={periodOrders.length === 0 || rangeInvalid || exportingFormat}
            className="bg-slate-800 hover:bg-slate-900 disabled:bg-slate-300 text-white px-4 py-2.5 rounded-xl text-sm font-bold shadow-lg"
          >
            {exportingFormat === 'pdf' ? 'Opening…' : 'Save as PDF'}
          </button>
        </div>
      </div>

      {exportError && (
        <AlertBanner variant="danger" title="Export failed">
          {exportError}
        </AlertBanner>
      )}

      <div className="no-print bg-white rounded-2xl shadow-sm border border-slate-100 p-4">
        <div className="grid grid-cols-1 md:grid-cols-[1fr_1fr_auto] gap-4 items-end">
          <div>
            <label className="block text-xs font-bold text-slate-500 uppercase mb-1">From</label>
            <input
              type="date"
              value={dateFrom}
              onChange={e => setDateRange(e.target.value, dateTo)}
              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-500 uppercase mb-1">To</label>
            <input
              type="date"
              value={dateTo}
              onChange={e => setDateRange(dateFrom, e.target.value)}
              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <button
            type="button"
            onClick={handleThisMonth}
            className="bg-slate-100 text-slate-600 hover:bg-slate-200 px-5 py-2.5 rounded-xl text-sm font-bold"
          >
            This month
          </button>
        </div>
        <p className="text-sm text-slate-500 mt-3">
          Period: <strong>{periodLabel}</strong> · {periodOrders.length} sale(s)
        </p>
        {rangeInvalid && (
          <p className="text-sm text-amber-700 font-semibold mt-2">Set From before To to load the report.</p>
        )}
      </div>

      <div className="hidden print:block bh-report-cover mb-8 pb-6 border-b-2 border-slate-800">
        <h1 className="text-3xl font-black text-slate-900">{storeInfo.storeName || 'Boon Hua Fishery'}</h1>
        <p className="text-lg text-slate-600 mt-1">Monthly Sales &amp; Collection Report</p>
        <p className="text-base font-bold text-slate-800 mt-3">{periodLabel}</p>
        <p className="text-sm text-slate-500 mt-2">Period: {dateFrom} — {dateTo}</p>
        {storeInfo.address && <p className="text-sm text-slate-500 mt-1">{storeInfo.address}</p>}
        <p className="text-sm text-slate-500 mt-4">Generated: {generatedAt}</p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 print:grid-cols-5 print:gap-2">
        <StatCard label="Sales (period)" value={`RM ${summary.totalSales.toFixed(2)}`} hint={`${summary.count} transactions`} tone="emerald" />
        <StatCard label="Collected" value={`RM ${summary.collected.toFixed(2)}`} hint="Paid in this period" tone="blue" />
        <StatCard label="Still owing" value={`RM ${summary.owing.toFixed(2)}`} hint={`${summary.unpaidCount} unpaid bill(s)`} tone="orange" />
        <StatCard label="Fully paid" value={String(summary.paidCount)} hint="Bills settled" tone="slate" />
        <StatCard label="Buyers" value={String(buyerSummary.length)} hint="Unique names" tone="purple" />
      </div>

      {periodOrders.length === 0 ? (
        <div className="bg-white rounded-2xl border border-dashed border-slate-200 p-12 text-center no-print">
          <p className="font-bold text-slate-700">No sales recorded for {periodLabel}</p>
          <p className="text-sm text-slate-500 mt-2">Record sales under Sales, then return here to generate the report.</p>
        </div>
      ) : (
        <>
          <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6 print:shadow-none print:border-slate-300 print:break-inside-avoid">
            <h3 className="text-lg font-bold text-slate-800 mb-2">Collection summary by buyer</h3>
            <p className="text-sm text-slate-500 mb-4 print:text-black">
              Who has paid and who still owes for sales dated in {periodLabel}.
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
            <h3 className="text-lg font-bold text-slate-800 mb-4">Sales ledger — {periodLabel}</h3>
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
                {periodOrders.map(order => {
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
                  <td className="p-3" colSpan={6}>Period total</td>
                  <td className="p-3 text-right">RM {summary.totalSales.toFixed(2)}</td>
                  <td className="p-3 text-right text-emerald-700">RM {summary.collected.toFixed(2)}</td>
                  <td className="p-3 text-right text-amber-700">RM {summary.owing.toFixed(2)}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>

          <p className="hidden print:block text-xs text-slate-500 mt-8 pt-4 border-t border-slate-300">
            This report lists sales by sale date in the selected period. Outstanding amounts are bills not yet fully collected — follow up via Collections.
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
        <NotificationAlert variant="danger" title="Collection risk" id="collections-outstanding">
          Unpaid bills are not cash in hand. Follow up before extending more credit — especially large restaurant orders.
        </NotificationAlert>
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
    const primary = (apiBaseUrl || '').trim().replace(/\/+$/, '') || DEFAULT_FORECAST_API;
    const fallbackApi = DEFAULT_FORECAST_API;

    fetchMlSalesForecast(primary, daily)
      .catch((err) => {
        // Retry default Render URL if Settings has a bad/old API base.
        if (primary !== fallbackApi) {
          return fetchMlSalesForecast(fallbackApi, daily);
        }
        throw err;
      })
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

  // Always open on the rolling last 7 days (ignore old saved ranges like June).
  const [dateFrom, setDateFrom] = useState(() => getLast7DaysRange().from);
  const [dateTo, setDateTo] = useState(() => getLast7DaysRange().to);

  useEffect(() => {
    const { from, to } = getLast7DaysRange();
    setDateFrom(from);
    setDateTo(to);
    saveStoredDateRange(from, to);
  }, []);

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
    () => consolidateInventoryBySpecies(inventory).filter(item => isLowStockWeight(item.weight)),
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
        <NotificationAlert variant="warning" title="Low stock alert" id="low-stock">
          {lowStockItems.map(i => i.species).join(', ')} — at or below {LOW_STOCK_THRESHOLD_KG} kg. Consider restocking or promoting sales.
        </NotificationAlert>
      )}

      {lossInPeriodKg > 0 && (
        <NotificationAlert
          variant="danger"
          title="Stock losses in selected period"
          id={stockLossesNotificationId(dateFrom, dateTo)}
        >
          {lossInPeriodKg.toFixed(1)} kg recorded as spoilage, wastage, or damage.{' '}
          <Link to="/inventory?tab=ledger" className="font-bold underline">
            View Stock ledger →
          </Link>
        </NotificationAlert>
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
          <button type="button" onClick={handleLast7Days} className="no-print bg-slate-100 text-slate-600 hover:bg-slate-200 px-5 py-2.5 rounded-xl text-sm font-bold">
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
              {topSellingItems.map((item) => (
                <div
                  key={item.species}
                  className="flex items-center justify-between border border-slate-100 rounded-xl p-4 print:break-inside-avoid print:p-3"
                >
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
            <p className="text-xs text-slate-400 mt-4 pt-3 border-t border-slate-100">
              {forecastModelLabel(salesForecast)}
            </p>
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
  const [adminSessionReady, setAdminSessionReady] = useState(false);

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

  // Verify web admin access (bootstrap adminProfiles on first login; block consumer-only).
  useEffect(() => {
    if (!currentUser) {
      setAdminSessionReady(false);
      return undefined;
    }

    let cancelled = false;
    setAdminSessionReady(false);

    (async () => {
      try {
        const result = await resolveWebAdminSession(currentUser);
        if (cancelled) return;
        if (!result.allowed) {
          await signOut(auth);
          setError(result.message || 'Access denied.');
          return;
        }
        setAdminSessionReady(true);
      } catch (err) {
        if (!cancelled) {
          await signOut(auth);
          setError(`Could not verify administrator access: ${err.message}`);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [currentUser]);

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
    setError('');
    setSuccessMsg('');
    try {
      if (authView === 'login') {
        setAdminSessionReady(false);
        const credential = await signInWithEmailAndPassword(auth, formData.email, formData.password);
        const result = await resolveWebAdminSession(credential.user);
        if (!result.allowed) {
          await signOut(auth);
          setError(result.message || 'Access denied.');
          return;
        }
        setAdminSessionReady(true);
      } else if (authView === 'forgot') {
        await sendPasswordResetEmail(auth, formData.email);
        setSuccessMsg(`✓ Reset link sent to ${formData.email}.`);
      }
    } catch (err) {
      setAdminSessionReady(false);
      setError("✕ " + err.message.replace("Firebase: ", ""));
    }
  };

  const handleLogout = async () => {
    try {
      setAdminSessionReady(false);
      await signOut(auth);
      setAuthView('login');
      setFormData({ email: '', password: '' });
    } catch (err) {
      alert("Logout Error: " + err.message);
    }
  };

  // Wait for Firebase session and admin verification before showing dashboard.
  if (authLoading || (currentUser && !adminSessionReady)) {
    return (
      <div className="min-h-screen bg-[#F0F2F8] flex flex-col items-center justify-center gap-4">
        <div className="w-11 h-11 border-4 border-[#4379EE] border-t-transparent rounded-full animate-spin" />
        <p className="text-sm font-semibold text-slate-500">
          {currentUser ? 'Verifying administrator access…' : 'Loading Boon Hua Admin…'}
        </p>
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
    <AdminNotificationProvider
      userEmail={currentUser?.email}
      inventory={inventory}
      orders={orders}
      inventoryHistory={inventoryHistory}
    >
      <BrowserRouter>
        <AdminDashboardShell
          storeInfo={storeInfo}
          currentUser={currentUser}
          onLogout={handleLogout}
          headerExtra={<AdminNotificationBell />}
        >
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
    </AdminNotificationProvider>
  );
}
