import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  buildAdminNotifications,
  loadNotificationPrefs,
  saveNotificationPrefs,
  unreadCount,
  visibleNotifications,
  isNotificationDismissed,
} from '../utils/adminNotifications';
import {
  pushNotificationPrefs,
  subscribeNotificationPrefs,
} from '../utils/adminNotificationSync';

import { AlertBanner } from './adminUi';

const AdminNotificationContext = createContext(null);

export function AdminNotificationProvider({
  userEmail,
  inventory,
  orders,
  inventoryHistory,
  children,
}) {
  const [prefs, setPrefs] = useState(() => loadNotificationPrefs(userEmail));
  const knownAlertIds = useRef(null);

  useEffect(() => {
    setPrefs(loadNotificationPrefs(userEmail));
    knownAlertIds.current = null;
    const unsubscribe = subscribeNotificationPrefs(userEmail, (remote) => {
      if (!remote) return;
      setPrefs(remote);
      saveNotificationPrefs(userEmail, remote);
    });
    return unsubscribe;
  }, [userEmail]);

  const notifications = useMemo(
    () => buildAdminNotifications({ inventory, orders, inventoryHistory }),
    [inventory, orders, inventoryHistory],
  );

  const visible = useMemo(
    () => visibleNotifications(notifications, prefs),
    [notifications, prefs],
  );

  const unread = useMemo(
    () => unreadCount(notifications, prefs),
    [notifications, prefs],
  );

  const markRead = useCallback((id) => {
    setPrefs((prev) => {
      if (prev.read.includes(id)) return prev;
      const next = { ...prev, read: [...prev.read, id] };
      saveNotificationPrefs(userEmail, next);
      pushNotificationPrefs(userEmail, next).catch(() => {});
      return next;
    });
  }, [userEmail]);

  const markAllRead = useCallback(() => {
    const ids = visible.map((item) => item.id);
    setPrefs((prev) => {
      const read = [...new Set([...prev.read, ...ids])];
      const next = { ...prev, read };
      saveNotificationPrefs(userEmail, next);
      pushNotificationPrefs(userEmail, next).catch(() => {});
      return next;
    });
  }, [userEmail, visible]);

  const dismiss = useCallback((id) => {
    setPrefs((prev) => {
      if (prev.dismissed.includes(id)) return prev;
      const next = {
        read: prev.read.includes(id) ? prev.read : [...prev.read, id],
        dismissed: [...prev.dismissed, id],
      };
      saveNotificationPrefs(userEmail, next);
      pushNotificationPrefs(userEmail, next).catch(() => {});
      return next;
    });
  }, [userEmail]);

  const isDismissed = useCallback(
    (id) => isNotificationDismissed(id, prefs),
    [prefs],
  );

  useEffect(() => {
    if (typeof Notification === 'undefined') return;
    const currentIds = notifications.map((item) => item.id);
    const previous = knownAlertIds.current;
    if (previous && Notification.permission === 'granted') {
      notifications
        .filter((item) => !previous.has(item.id) && !(prefs.read || []).includes(item.id))
        .forEach((item) => {
          try {
            // eslint-disable-next-line no-new
            new Notification(item.title, { body: item.message });
          } catch {
            /* browser blocked the alert */
          }
        });
    }
    knownAlertIds.current = new Set(currentIds);
  }, [notifications, prefs.read]);

  const value = useMemo(() => ({
    notifications: visible,
    allNotifications: notifications,
    unreadCount: unread,
    prefs,
    markRead,
    markAllRead,
    dismiss,
    isDismissed,
  }), [visible, notifications, unread, prefs, markRead, markAllRead, dismiss, isDismissed]);

  return (
    <AdminNotificationContext.Provider value={value}>
      {children}
    </AdminNotificationContext.Provider>
  );
}

export function useAdminNotifications() {
  const ctx = useContext(AdminNotificationContext);
  if (!ctx) {
    throw new Error('useAdminNotifications must be used within AdminNotificationProvider');
  }
  return ctx;
}

export function NotificationAlert({ id, variant, title, children }) {
  const { isDismissed, dismiss, markRead } = useAdminNotifications();
  if (isDismissed(id)) return null;

  return (
    <AlertBanner
      variant={variant}
      title={title}
      onDismiss={() => dismiss(id)}
      onMarkRead={() => markRead(id)}
    >
      {children}
    </AlertBanner>
  );
}

export function AdminNotificationBell() {
  const navigate = useNavigate();
  const {
    notifications,
    unreadCount: unread,
    markRead,
    markAllRead,
    dismiss,
  } = useAdminNotifications();
  const [open, setOpen] = useState(false);

  const handleOpen = (item) => {
    markRead(item.id);
    setOpen(false);
    if (item.link) navigate(item.link);
  };

  return (
    <div className="relative no-print">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="relative w-10 h-10 rounded-xl border border-slate-200 bg-slate-50 hover:bg-slate-100 flex items-center justify-center text-lg"
        aria-label="Notifications"
      >
        🔔
        {unread > 0 && (
          <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <>
          <button
            type="button"
            className="fixed inset-0 z-40 cursor-default"
            aria-label="Close notifications"
            onClick={() => setOpen(false)}
          />
          <div className="absolute right-0 top-full mt-2 w-[min(360px,calc(100vw-2rem))] z-50 bg-white rounded-2xl shadow-xl border border-slate-200 overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 bg-slate-50">
              <p className="text-sm font-bold text-slate-800">Notifications</p>
              <div className="flex items-center gap-3">
                {typeof Notification !== 'undefined' && Notification.permission === 'default' && (
                  <button
                    type="button"
                    onClick={() => Notification.requestPermission()}
                    className="text-xs font-bold text-slate-600 hover:underline"
                  >
                    Alert this device
                  </button>
                )}
                {notifications.length > 0 && (
                  <button
                    type="button"
                    onClick={markAllRead}
                    className="text-xs font-bold text-[#4379EE] hover:underline"
                  >
                    Mark all read
                  </button>
                )}
              </div>
            </div>
            <div className="max-h-80 overflow-y-auto">
              {notifications.length === 0 ? (
                <p className="px-4 py-8 text-sm text-slate-500 text-center">No active notifications</p>
              ) : (
                notifications.map((item) => (
                  <div
                    key={item.id}
                    className="flex items-start gap-2 px-4 py-3 border-b border-slate-50 hover:bg-slate-50/80"
                  >
                    <button
                      type="button"
                      onClick={() => handleOpen(item)}
                      className="flex-1 text-left min-w-0"
                    >
                      <p className="text-sm font-bold text-slate-800">{item.title}</p>
                      <p className="text-xs text-slate-600 mt-0.5 leading-relaxed">{item.message}</p>
                    </button>
                    <button
                      type="button"
                      onClick={() => dismiss(item.id)}
                      className="shrink-0 w-7 h-7 rounded-lg hover:bg-slate-200 text-slate-500 text-lg leading-none"
                      aria-label="Dismiss"
                      title="Dismiss"
                    >
                      ×
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
