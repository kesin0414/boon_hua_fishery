import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase';

/**
 * Decide whether a Firebase Auth user may use the web admin dashboard.
 * - Consumer-only accounts (customers doc, no adminProfiles) are denied.
 * - Other users without adminProfiles get one auto-created on first web login.
 */
export async function resolveWebAdminSession(user) {
  if (!user?.uid) {
    return { allowed: false, message: 'No signed-in user.' };
  }

  const adminRef = doc(db, 'adminProfiles', user.uid);
  const customerRef = doc(db, 'customers', user.uid);

  const [adminSnap, customerSnap] = await Promise.all([
    getDoc(adminRef),
    getDoc(customerRef),
  ]);

  const hasAdminProfile = adminSnap.exists();
  const hasCustomerProfile = customerSnap.exists();

  if (hasCustomerProfile && !hasAdminProfile) {
    return {
      allowed: false,
      message:
        'This account is registered for the consumer mobile app. Please sign in using the Boon Hua mobile app.',
    };
  }

  if (!hasAdminProfile) {
    await setDoc(
      adminRef,
      {
        fullName: user.displayName?.trim() || '',
        phone: '',
        email: user.email || '',
        role: 'admin',
        bootstrappedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    );
  }

  return { allowed: true };
}
