import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getAuth } from "firebase/auth";

// Your real Boon Hua Fishery configuration
const firebaseConfig = {
  apiKey: "AIzaSyCzo-nOlK_oL7Ef0OuNbCFO23bp07LSn5Q",
  authDomain: "boon-hua-fishery.firebaseapp.com",
  projectId: "boon-hua-fishery",
  storageBucket: "boon-hua-fishery.firebasestorage.app",
  messagingSenderId: "613591875384",
  appId: "1:613591875384:web:7d2afbfa2adb9231bfcbcd"
  // Note: measurementId and getAnalytics are removed to prevent AdBlocker crashes
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Initialize Database and Authentication
export const db = getFirestore(app);
export const auth = getAuth(app);