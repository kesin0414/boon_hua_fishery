import { doc, onSnapshot, setDoc } from 'firebase/firestore';
import { db } from '../firebase';

export function notificationPrefsDocId(userEmail) {
  return (userEmail || 'admin').toLowerCase().replace(/[^a-z0-9._@-]+/g, '_');
}

export function subscribeNotificationPrefs(userEmail, onPrefs) {
  const ref = doc(db, 'adminNotificationPrefs', notificationPrefsDocId(userEmail));
  return onSnapshot(
    ref,
    (snap) => {
      if (!snap.exists()) {
        onPrefs(null);
        return;
      }
      const data = snap.data() || {};
      onPrefs({
        read: Array.isArray(data.read) ? data.read : [],
        dismissed: Array.isArray(data.dismissed) ? data.dismissed : [],
      });
    },
    () => onPrefs(null),
  );
}

export function pushNotificationPrefs(userEmail, prefs) {
  const ref = doc(db, 'adminNotificationPrefs', notificationPrefsDocId(userEmail));
  return setDoc(
    ref,
    {
      read: prefs.read || [],
      dismissed: prefs.dismissed || [],
      email: userEmail || 'admin',
      updatedAt: new Date().toISOString(),
    },
    { merge: true },
  );
}
