import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import {
    getAuth, signInWithEmailAndPassword,
    sendPasswordResetEmail, onAuthStateChanged, signOut
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import {
    getFirestore, collection, collectionGroup, getDocs, addDoc, doc, setDoc, getDoc,
    serverTimestamp, query, orderBy, limit, onSnapshot, deleteDoc, where
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// ─── Firebase Config (from your project) ───
const firebaseConfig = {
    apiKey: "AIzaSyBWZx5WdJ8dJoI8nZlU1eA-OnOk91gj8Xk",
    authDomain: "group-a0ee4.firebaseapp.com",
    projectId: "group-a0ee4",
    storageBucket: "group-a0ee4.firebasestorage.app",
    messagingSenderId: "519444570577",
    appId: "1:519444570577:web:3a55d7010192e2ac2740f0",
    measurementId: "G-9TXCQ06MJM"
};

const VIRTUAL_DOMAIN = "@ledodown.local";
const ADMIN_EMAIL = "waleed@ledodown.local";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// ─── DOM REFERENCES ───
const authView = document.getElementById('auth-view');
const dashboardView = document.getElementById('dashboard-view');
const authForm = document.getElementById('auth-form');
const loginUsername = document.getElementById('login-username');
const loginPassword = document.getElementById('login-password');
const authError = document.getElementById('auth-error');
const authSuccess = document.getElementById('auth-success');
const btnSubmitText = document.getElementById('btn-submit-text');
const btnSignIn = document.getElementById('btn-signin');
const btnForgotPassword = document.getElementById('btn-forgot-password');
const authSubtitle = document.getElementById('auth-subtitle');
const adminEmailDisplay = document.getElementById('admin-email-display');
const btnSignOut = document.getElementById('btn-signout');

const navItems = document.querySelectorAll('.nav-item');
const panels = document.querySelectorAll('.panel');

let cachedUsers = [];
let telegramActivity = [];

// ─── SIDEBAR NAVIGATION & TAB SWITCHING ───
export function switchTab(targetId) {
    if (!targetId) targetId = 'panel-overview';
    targetId = targetId.replace(/^#/, '');

    const targetPanel = document.getElementById(targetId);
    if (!targetPanel) return;

    // Update active nav item
    navItems.forEach(n => {
        const isMatch = n.dataset.target === targetId || n.getAttribute('href') === `#${targetId}`;
        n.classList.toggle('active', isMatch);
    });

    // Show target panel, hide others
    panels.forEach(p => {
        const isMatch = (p.id === targetId);
        p.classList.toggle('hidden', !isMatch);
        p.classList.toggle('active', isMatch);
    });

    // Update URL hash safely without scrolling
    if (window.location.hash !== `#${targetId}`) {
        history.replaceState(null, '', `#${targetId}`);
    }

    // Load data for the target panel
    switch (targetId) {
        case 'panel-overview':
            loadOverviewStats();
            break;
        case 'panel-users':
            loadUsers();
            break;
        case 'panel-notifications':
            populateUserDropdown();
            break;
        case 'panel-chats':
            loadChats();
            break;
        case 'panel-crashes':
            loadCrashes();
            break;
        case 'panel-announcements':
            loadLiveBanner();
            break;
        case 'panel-active-users':
            loadActiveUsers();
            break;
        case 'panel-config':
            loadAppConfig();
            break;
        case 'panel-telegram':
            loadTelegramActivity();
            break;
    }
}

// Expose globally for inline onclick fallback
window.switchTab = switchTab;

// Attach click listeners to nav items
navItems.forEach(item => {
    item.addEventListener('click', (e) => {
        e.preventDefault();
        const targetId = item.dataset.target || (item.getAttribute('href') ? item.getAttribute('href').replace('#', '') : '');
        switchTab(targetId);
    });
});

// React to browser back/forward or hash changes
window.addEventListener('hashchange', () => {
    const hash = window.location.hash.replace('#', '');
    if (hash) {
        switchTab(hash);
    }
});

// Handle URL hash on initial page load
function navigateToHash() {
    const hash = window.location.hash.replace('#', '');
    switchTab(hash || 'panel-overview');
}

// Registration removed — admin accounts are created only from the database

function resolveEmail(input) {
    const clean = input.trim().toLowerCase();
    if (clean.includes('@')) {
        return clean;
    }
    return clean + VIRTUAL_DOMAIN;
}

// ─── AUTH ───
onAuthStateChanged(auth, async (user) => {
    if (user) {
        const authorized = String(user.email || '').toLowerCase() === ADMIN_EMAIL;
        if (!authorized) {
            authError.textContent = `دخول لوحة الأدمن مسموح فقط للحساب ${ADMIN_EMAIL}`;
            await signOut(auth).catch(() => {});
            authView.classList.remove('hidden');
            dashboardView.classList.add('hidden');
            return;
        }
        authView.classList.add('hidden');
        dashboardView.classList.remove('hidden');
        const displayName = user.email ? user.email.replace(VIRTUAL_DOMAIN, '') : (user.displayName || 'admin');
        adminEmailDisplay.textContent = displayName;
        loadOverviewStats();
        // Navigate to hash if present
        navigateToHash();
    } else {
        authView.classList.remove('hidden');
        dashboardView.classList.add('hidden');
    }
});

authForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    authError.textContent = '';
    authSuccess.style.display = 'none';

    const inputVal = loginUsername.value.trim();
    const password = loginPassword.value;

    if (!inputVal || !password) {
        authError.textContent = 'يرجى إدخال اسم المستخدم/البريد وكلمة المرور';
        return;
    }

    const email = resolveEmail(inputVal);
    if (email !== ADMIN_EMAIL) {
        authError.textContent = `استخدم حساب الأدمن الوحيد: ${ADMIN_EMAIL}`;
        return;
    }

    btnSignIn.disabled = true;
    const origBtnText = btnSubmitText.textContent;
    btnSubmitText.textContent = 'جارِ التحقق...';

    try {
        await signInWithEmailAndPassword(auth, email, password);
    } catch (err) {
        authError.textContent = getAuthErrorMsg(err, email);
    } finally {
        btnSignIn.disabled = false;
        btnSubmitText.textContent = origBtnText;
    }
});

// Forgot Password
if (btnForgotPassword) {
    btnForgotPassword.addEventListener('click', async (e) => {
        e.preventDefault();
        authError.textContent = '';
        authSuccess.style.display = 'none';

        const inputVal = loginUsername.value.trim();
        if (!inputVal) {
            authError.textContent = 'اكتب اسم المستخدم أو البريد الإلكتروني أولاً في الحقل أعلاه';
            return;
        }

        const email = resolveEmail(inputVal);
        if (email !== ADMIN_EMAIL) {
            authError.textContent = `إعادة التعيين متاحة لحساب الأدمن فقط: ${ADMIN_EMAIL}`;
            return;
        }

        if (email.endsWith(VIRTUAL_DOMAIN)) {
            authError.textContent = 'حساب (@ledodown.local) ليس له بريد إلكتروني خارجي. تواصل مع مسؤول النظام لإعادة تعيين كلمة المرور.';
            return;
        }

        try {
            await sendPasswordResetEmail(auth, email);
            authSuccess.textContent = `تم إرسال رابط إعادة تعيين كلمة المرور إلى: ${email}`;
            authSuccess.style.display = 'block';
        } catch (err) {
            authError.textContent = getAuthErrorMsg(err, email);
        }
    });
}

btnSignOut.addEventListener('click', () => signOut(auth));

function getAuthErrorMsg(err, attemptedEmail) {
    const code = err.code || '';
    if (code.includes('user-not-found')) {
        return 'المستخدم غير موجود. تواصل مع مسؤول النظام لإنشاء حساب.';
    }
    if (code.includes('wrong-password') || code.includes('invalid-credential')) {
        return 'بيانات الدخول غير صحيحة (تأكد من اسم المستخدم وكلمة المرور).';
    }
    if (code.includes('too-many-requests')) {
        return 'تم حظر المحاولات مؤقتاً لكثرة المحاولات الخاطئة. انتظر دقيقة وحاول لاحقاً.';
    }
    if (code.includes('invalid-email')) {
        return 'صيغة البريد الإلكتروني غير صالحة.';
    }
    return err.message || 'حدث خطأ أثناء المصادقة.';
}

// ─── OVERVIEW STATS ───
async function loadOverviewStats() {
    const fetchCount = async (collName, elId) => {
        try {
            const snap = await getDocs(collection(db, collName));
            const el = document.getElementById(elId);
            if (el) el.textContent = snap.size;
        } catch (e) {
            console.warn(`[Stats] Could not count ${collName}:`, e);
            const el = document.getElementById(elId);
            if (el) el.textContent = '0';
        }
    };

    await Promise.allSettled([
        fetchCount("users", "stat-users"),
        fetchCount("crash_reports", "stat-crashes"),
        fetchCount("chats", "stat-chats"),
        fetchCount("heartbeats", "stat-heartbeats"),
    ]);
}

// ─── USERS ───
async function loadUsers() {
    const tbody = document.getElementById('users-table-body');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="5" class="empty-state">جارِ التحميل...</td></tr>';
    try {
        const snap = await getDocs(collection(db, "users"));
        cachedUsers = [];
        tbody.innerHTML = '';
        if (snap.empty) {
            tbody.innerHTML = '<tr><td colspan="5" class="empty-state">لا يوجد مستخدمين</td></tr>';
            return;
        }
        snap.forEach(docSnap => {
            const data = docSnap.data();
            const uid = docSnap.id;
            const username = data.username || data.email || uid.slice(0, 8);
            cachedUsers.push({ uid, username, data });

            const isBanned = data.status === 'banned';
            const statusBadge = isBanned 
                ? '<span class="badge" style="background:var(--error);color:#fff;">محظور</span>' 
                : '<span class="badge" style="background:var(--success);color:#fff;">حساب فعّال</span>';

            const tr = document.createElement('tr');
            const avatarHtml = data.photoURL
                ? `<img src="${data.photoURL}" class="user-avatar" alt="avatar">`
                : `<div class="avatar-placeholder"><i class='bx bx-user'></i></div>`;
            tr.innerHTML = `
                <td>${escapeHtml(username)}</td>
                <td>${avatarHtml}</td>
                <td>${statusBadge}</td>
                <td>${formatDate(data.createdAt)}</td>
                <td>
                    <button class="btn outline btn-sm btn-msg-user" data-uid="${uid}" data-name="${escapeHtml(username)}" title="إرسال رسالة">
                        <i class='bx bx-envelope'></i>
                    </button>
                    <button class="btn ${isBanned ? 'primary' : 'danger'} btn-sm btn-toggle-ban" data-uid="${uid}" data-banned="${isBanned}" title="${isBanned ? 'فك الحظر' : 'حظر'}">
                        <i class='bx ${isBanned ? 'bx-check-shield' : 'bx-block'}'></i>
                    </button>
                </td>
            `;
            tbody.appendChild(tr);
        });

        // Attach per-user message button handlers
        document.querySelectorAll('.btn-msg-user').forEach(btn => {
            btn.addEventListener('click', () => {
                openSendUserMsgModal(btn.dataset.uid, btn.dataset.name);
            });
        });

        // Attach ban toggle handlers
        document.querySelectorAll('.btn-toggle-ban').forEach(btn => {
            btn.addEventListener('click', async () => {
                const uid = btn.dataset.uid;
                const currentlyBanned = btn.dataset.banned === 'true';
                const actionText = currentlyBanned ? 'فك الحظر عن' : 'حظر';
                
                if (confirm(`هل أنت متأكد من ${actionText} هذا المستخدم؟`)) {
                    try {
                        await setDoc(doc(db, "users", uid), {
                            status: currentlyBanned ? 'active' : 'banned',
                            updatedAt: serverTimestamp()
                        }, { merge: true });
                        loadUsers(); // refresh
                    } catch (e) {
                        alert('خطأ: ' + e.message);
                    }
                }
            });
        });
    } catch (e) {
        tbody.innerHTML = '<tr><td colspan="5" class="error-text">خطأ في تحميل المستخدمين — تأكد من صلاحيات الأدمن</td></tr>';
        console.error(e);
    }
}

document.getElementById('btn-refresh-users').addEventListener('click', loadUsers);

// ─── SEND NOTIFICATION TO ALL USERS (as announcement) ───
const btnSendAll = document.getElementById('btn-send-all-notification');
const formSendAll = document.getElementById('form-send-all');
const btnCancelAll = document.getElementById('btn-cancel-all-notif');
const btnPublishAll = document.getElementById('btn-publish-all-notif');

btnSendAll.addEventListener('click', () => formSendAll.classList.toggle('hidden'));
btnCancelAll.addEventListener('click', () => formSendAll.classList.add('hidden'));

btnPublishAll.addEventListener('click', async () => {
    const title = document.getElementById('all-notif-title').value.trim();
    const body = document.getElementById('all-notif-body').value.trim();
    const type = document.getElementById('all-notif-type').value;
    const priority = document.getElementById('all-notif-priority').value;
    const actionUrl = document.getElementById('all-notif-url').value.trim();
    const statusEl = document.getElementById('all-notif-status');

    if (!title || !body) {
        statusEl.textContent = 'يرجى ملء العنوان والرسالة';
        statusEl.style.color = 'var(--error)';
        return;
    }

    btnPublishAll.disabled = true;
    statusEl.textContent = 'جارِ الإرسال...';
    statusEl.style.color = 'var(--text-muted)';

    try {
        // This creates an announcement that ALL users will see when they open the app
        // The app's announcements.js fetches from "announcements" collection with active=true
        await addDoc(collection(db, "announcements"), {
            title: title,
            body: body,
            type: type,
            priority: priority,
            active: true,
            action_url: actionUrl || null,
            action_label: actionUrl ? 'عرض التفاصيل' : null,
            created_at: new Date().toISOString(),
            createdAt: serverTimestamp()
        });

        statusEl.textContent = '✅ تم إرسال الإشعار لكل المستخدمين بنجاح!';
        statusEl.style.color = 'var(--success)';
        document.getElementById('all-notif-title').value = '';
        document.getElementById('all-notif-body').value = '';
        document.getElementById('all-notif-url').value = '';
        setTimeout(() => {
            statusEl.textContent = '';
            formSendAll.classList.add('hidden');
        }, 3000);
    } catch (e) {
        statusEl.textContent = 'خطأ: ' + e.message;
        statusEl.style.color = 'var(--error)';
    } finally {
        btnPublishAll.disabled = false;
    }
});

// ─── PER-USER MESSAGE (via users/{uid}/messages) ───
function openSendUserMsgModal(uid, name) {
    document.getElementById('modal-send-user-msg').classList.remove('hidden');
    document.getElementById('modal-user-name').textContent = `إرسال رسالة لـ: ${name}`;
    document.getElementById('modal-msg-uid').value = uid;
    document.getElementById('modal-msg-title').value = '';
    document.getElementById('modal-msg-body').value = '';
    document.getElementById('modal-msg-status').textContent = '';
}

document.getElementById('btn-modal-cancel').addEventListener('click', () => {
    document.getElementById('modal-send-user-msg').classList.add('hidden');
});

document.getElementById('btn-modal-send').addEventListener('click', async () => {
    const uid = document.getElementById('modal-msg-uid').value;
    const title = document.getElementById('modal-msg-title').value.trim();
    const body = document.getElementById('modal-msg-body').value.trim();
    const statusEl = document.getElementById('modal-msg-status');

    if (!title || !body) {
        statusEl.textContent = 'يرجى ملء العنوان والرسالة';
        statusEl.style.color = 'var(--error)';
        return;
    }

    try {
        // Write to users/{uid}/messages — this is the inbox that the app reads
        await addDoc(collection(db, "users", uid, "messages"), {
            title: title,
            body: body,
            createdAt: serverTimestamp(),
            read: false,
            from: 'admin'
        });

        statusEl.textContent = '✅ تم الإرسال بنجاح!';
        statusEl.style.color = 'var(--success)';
        setTimeout(() => {
            document.getElementById('modal-send-user-msg').classList.add('hidden');
        }, 1500);
    } catch (e) {
        statusEl.textContent = 'خطأ: ' + e.message;
        statusEl.style.color = 'var(--error)';
    }
});

// ─── NOTIFICATIONS PANEL (per-user dropdown) ───
function populateUserDropdown() {
    const select = document.getElementById('notif-user-select');
    select.innerHTML = '<option value="">-- اختر مستخدم --</option>';
    cachedUsers.forEach(u => {
        const opt = document.createElement('option');
        opt.value = u.uid;
        opt.textContent = u.username;
        select.appendChild(opt);
    });
    // If users not loaded yet, load them first
    if (cachedUsers.length === 0) {
        loadUsers().then(() => populateUserDropdown());
    }
}

document.getElementById('btn-send-notif').addEventListener('click', async () => {
    const uid = document.getElementById('notif-user-select').value;
    const title = document.getElementById('notif-title').value.trim();
    const body = document.getElementById('notif-body').value.trim();
    const statusEl = document.getElementById('notif-status');

    if (!uid) { statusEl.textContent = 'اختر مستخدم'; statusEl.style.color = 'var(--error)'; return; }
    if (!title || !body) { statusEl.textContent = 'املأ العنوان والرسالة'; statusEl.style.color = 'var(--error)'; return; }

    try {
        await addDoc(collection(db, "users", uid, "messages"), {
            title, body,
            createdAt: serverTimestamp(),
            read: false,
            from: 'admin'
        });
        statusEl.textContent = '✅ تم إرسال الإشعار!';
        statusEl.style.color = 'var(--success)';
        document.getElementById('notif-title').value = '';
        document.getElementById('notif-body').value = '';
        setTimeout(() => statusEl.textContent = '', 3000);
    } catch (e) {
        statusEl.textContent = 'خطأ: ' + e.message;
        statusEl.style.color = 'var(--error)';
    }
});

// ─── SUPPORT CHATS ───
let activeChatUid = null;
let chatMessagesUnsubscribe = null;

async function loadChats() {
    const chatList = document.getElementById('chat-list');
    chatList.innerHTML = '<p class="empty-state">جارِ التحميل...</p>';
    try {
        const q = query(collection(db, "chats"), orderBy("lastUpdated", "desc"));
        const snap = await getDocs(q);
        chatList.innerHTML = '';
        if (snap.empty) {
            chatList.innerHTML = '<p class="empty-state">لا توجد محادثات</p>';
            return;
        }
        snap.forEach(docSnap => {
            const data = docSnap.data();
            const uid = docSnap.id;
            const div = document.createElement('div');
            div.className = 'chat-list-item';
            div.dataset.uid = uid;
            const email = data.email || uid.slice(0, 8);
            const displayName = email.replace(VIRTUAL_DOMAIN, '');
            const unread = data.unreadAdmin ? '<span class="chat-unread-dot"></span>' : '';
            div.innerHTML = `
                <h4>${escapeHtml(displayName)} ${unread}</h4>
                <p>${escapeHtml(data.lastMessage || '...')}</p>
            `;
            div.addEventListener('click', () => openChat(uid, displayName));
            chatList.appendChild(div);
        });
    } catch (e) {
        chatList.innerHTML = '<p class="error-text">خطأ في تحميل المحادثات</p>';
        console.error(e);
    }
}

document.getElementById('btn-refresh-chats').addEventListener('click', loadChats);

function openChat(uid, displayName) {
    activeChatUid = uid;

    // Highlight active
    document.querySelectorAll('.chat-list-item').forEach(item => {
        item.classList.toggle('active', item.dataset.uid === uid);
    });

    const messagesEl = document.getElementById('chat-messages');
    const inputArea = document.getElementById('chat-input-area');
    messagesEl.innerHTML = '<p class="empty-state">جارِ التحميل...</p>';
    inputArea.classList.remove('hidden');

    // Unsubscribe from previous listener
    if (chatMessagesUnsubscribe) chatMessagesUnsubscribe();

    // Real-time listener on messages subcollection
    const q = query(collection(db, "chats", uid, "messages"), orderBy("createdAt", "asc"));
    chatMessagesUnsubscribe = onSnapshot(q, (snapshot) => {
        messagesEl.innerHTML = '';
        if (snapshot.empty) {
            messagesEl.innerHTML = '<p class="empty-state">لا توجد رسائل</p>';
            return;
        }
        snapshot.forEach(docSnap => {
            const msg = docSnap.data();
            const isAdmin = msg.isAdmin === true;
            const bubble = document.createElement('div');
            bubble.className = `chat-bubble ${isAdmin ? 'admin' : 'user'}`;
            const time = msg.createdAt ? formatDate(msg.createdAt) : '';
            bubble.innerHTML = `
                <div>${escapeHtml(msg.text || '')}</div>
                <div class="bubble-time">${time}</div>
            `;
            messagesEl.appendChild(bubble);
        });
        messagesEl.scrollTop = messagesEl.scrollHeight;
    });

    // Mark as read by admin
    setDoc(doc(db, "chats", uid), { unreadAdmin: false }, { merge: true }).catch(() => { });
}

document.getElementById('btn-send-reply').addEventListener('click', sendChatReply);
document.getElementById('chat-reply-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') sendChatReply();
});

async function sendChatReply() {
    if (!activeChatUid) return;
    const input = document.getElementById('chat-reply-input');
    const text = input.value.trim();
    if (!text) return;

    try {
        await addDoc(collection(db, "chats", activeChatUid, "messages"), {
            text: text,
            sender: 'admin',
            isAdmin: true,
            createdAt: serverTimestamp()
        });

        // Update chat metadata
        await setDoc(doc(db, "chats", activeChatUid), {
            lastMessage: text,
            lastSender: 'admin',
            lastUpdated: serverTimestamp(),
            unreadUser: true,
            unreadAdmin: false
        }, { merge: true });

        input.value = '';
    } catch (e) {
        console.error("Reply error:", e);
    }
}

// ─── CRASH REPORTS ───
// Store crash data for modal
let crashesData = {};

async function loadCrashes() {
    const tbody = document.getElementById('crashes-table-body');
    tbody.innerHTML = '<tr><td colspan="5" class="empty-state">جارِ التحميل...</td></tr>';
    try {
        const q = query(collection(db, "crash_reports"), orderBy("createdAt", "desc"), limit(100));
        const snap = await getDocs(q);
        tbody.innerHTML = '';
        if (snap.empty) {
            tbody.innerHTML = '<tr><td colspan="5" class="empty-state">لا توجد تقارير</td></tr>';
            return;
        }
        
        crashesData = {}; // clear old data
        snap.forEach(docSnap => {
            const data = docSnap.data();
            const id = docSnap.id;
            crashesData[id] = data;
            
            const sender = data.email || data.userId || data.device_id || 'مجهول';
            
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${formatDate(data.createdAt)}</td>
                <td title="${escapeHtml(sender)}">${escapeHtml(sender)}</td>
                <td title="${escapeHtml(data.message || '')}">${escapeHtml((data.message || '').slice(0, 50))}...</td>
                <td>${escapeHtml(data.error_category || data.category || '—')}</td>
                <td>
                    <button class="btn outline btn-sm btn-view-crash" data-id="${id}" title="عرض التفاصيل">
                        <i class='bx bx-show'></i>
                    </button>
                    <button class="btn danger btn-sm btn-delete-crash" data-id="${id}" title="حذف">
                        <i class='bx bx-trash'></i>
                    </button>
                </td>
            `;
            tbody.appendChild(tr);
        });

        document.querySelectorAll('.btn-view-crash').forEach(btn => {
            btn.addEventListener('click', () => {
                const id = btn.dataset.id;
                const data = crashesData[id];
                if (!data) return;
                
                document.getElementById('modal-crash-subtitle').textContent = `تاريخ التقرير: ${formatDate(data.createdAt)}`;
                document.getElementById('modal-crash-sender').value = data.email || data.userId || data.device_id || 'مجهول';
                document.getElementById('modal-crash-msg').value = data.raw_message || data.message || 'لا توجد رسالة';
                
                const stackTrace = data.stack_trace || data.stack || 'No stack trace available.';
                document.getElementById('modal-crash-stack').value = stackTrace;
                
                document.getElementById('modal-crash-details').classList.remove('hidden');
            });
        });

        document.querySelectorAll('.btn-delete-crash').forEach(btn => {
            btn.addEventListener('click', async () => {
                if (confirm('حذف هذا التقرير؟')) {
                    try {
                        await deleteDoc(doc(db, "crash_reports", btn.dataset.id));
                        loadCrashes();
                    } catch (e) { alert('خطأ: ' + e.message); }
                }
            });
        });
    } catch (e) {
        tbody.innerHTML = '<tr><td colspan="5" class="error-text">خطأ في تحميل التقارير</td></tr>';
        console.error(e);
    }
}

document.getElementById('btn-close-crash-modal')?.addEventListener('click', () => {
    document.getElementById('modal-crash-details').classList.add('hidden');
});

document.getElementById('btn-refresh-crashes').addEventListener('click', loadCrashes);

// ─── APP CONFIG ───
async function loadAppConfig() {
    try {
        // latest_update config
        const updateDoc = await getDoc(doc(db, "app_config", "latest_update"));
        if (updateDoc.exists()) {
            const d = updateDoc.data();
            document.getElementById('config-version').value = d.version || '';
            document.getElementById('config-download-url').value = d.download_url || '';
            document.getElementById('config-changelog').value = d.changelog || '';
            document.getElementById('config-required').checked = !!d.required;
        }

        // public_links config
        const linksDoc = await getDoc(doc(db, "app_config", "public_links"));
        if (linksDoc.exists()) {
            const l = linksDoc.data();
            document.getElementById('config-website-url').value = l.website_url || '';
            document.getElementById('config-privacy-url').value = l.privacy_url || '';
            document.getElementById('config-terms-url').value = l.terms_url || '';
            document.getElementById('config-support-url').value = l.support_url || '';
        }

        // status config (Maintenance)
        const statusDoc = await getDoc(doc(db, "app_config", "status"));
        if (statusDoc.exists()) {
            const s = statusDoc.data();
            document.getElementById('config-maintenance').checked = !!s.maintenance_mode;
            document.getElementById('config-maintenance-msg').value = s.maintenance_message || '';
        }

        // features config
        const featuresDoc = await getDoc(doc(db, "app_config", "features"));
        if (featuresDoc.exists()) {
            const f = featuresDoc.data();
            // Default to true if undefined
            document.getElementById('config-feature-yt').checked = f.youtube_enabled !== false;
            document.getElementById('config-feature-insta').checked = f.instagram_enabled !== false;
            document.getElementById('config-feature-tiktok').checked = f.tiktok_enabled !== false;
        }
    } catch (e) {
        console.error("Config load error:", e);
    }
}

document.getElementById('btn-save-config').addEventListener('click', async () => {
    const statusEl = document.getElementById('config-status');
    try {
        await setDoc(doc(db, "app_config", "latest_update"), {
            version: document.getElementById('config-version').value.trim(),
            download_url: document.getElementById('config-download-url').value.trim(),
            changelog: document.getElementById('config-changelog').value.trim(),
            required: document.getElementById('config-required').checked,
            updatedAt: serverTimestamp()
        }, { merge: true });
        statusEl.textContent = '✅ تم حفظ إعدادات التحديث';
        statusEl.style.color = 'var(--success)';
        setTimeout(() => statusEl.textContent = '', 3000);
    } catch (e) {
        statusEl.textContent = 'خطأ: ' + e.message;
        statusEl.style.color = 'var(--error)';
    }
});

document.getElementById('btn-save-links').addEventListener('click', async () => {
    const statusEl = document.getElementById('links-status');
    try {
        await setDoc(doc(db, "app_config", "public_links"), {
            website_url: document.getElementById('config-website-url').value.trim(),
            privacy_url: document.getElementById('config-privacy-url').value.trim(),
            terms_url: document.getElementById('config-terms-url').value.trim(),
            support_url: document.getElementById('config-support-url').value.trim(),
            updatedAt: serverTimestamp()
        }, { merge: true });
        statusEl.textContent = '✅ تم حفظ الروابط';
        statusEl.style.color = 'var(--success)';
        setTimeout(() => statusEl.textContent = '', 3000);
    } catch (e) {
        statusEl.textContent = 'خطأ: ' + e.message;
        statusEl.style.color = 'var(--error)';
    }
});

document.getElementById('btn-save-features').addEventListener('click', async () => {
    const statusEl = document.getElementById('features-status');
    try {
        // Save Maintenance Mode
        await setDoc(doc(db, "app_config", "status"), {
            maintenance_mode: document.getElementById('config-maintenance').checked,
            maintenance_message: document.getElementById('config-maintenance-msg').value.trim(),
            updatedAt: serverTimestamp()
        }, { merge: true });

        // Save Features
        await setDoc(doc(db, "app_config", "features"), {
            youtube_enabled: document.getElementById('config-feature-yt').checked,
            instagram_enabled: document.getElementById('config-feature-insta').checked,
            tiktok_enabled: document.getElementById('config-feature-tiktok').checked,
            updatedAt: serverTimestamp()
        }, { merge: true });

        statusEl.textContent = '✅ تم حفظ الإعدادات والصيانة بنجاح';
        statusEl.style.color = 'var(--success)';
        setTimeout(() => statusEl.textContent = '', 3000);
    } catch (e) {
        statusEl.textContent = 'خطأ: ' + e.message;
        statusEl.style.color = 'var(--error)';
    }
});

// ─── LIVE ANNOUNCEMENTS ───
async function loadLiveBanner() {
    try {
        const docRef = doc(db, "announcements", "live_banner");
        const docSnap = await getDoc(docRef);
        if (docSnap.exists() && docSnap.data().active) {
            const data = docSnap.data();
            document.getElementById('live-banner-title').value = data.title || '';
            document.getElementById('live-banner-text').value = data.body || '';
            document.getElementById('live-banner-color').value = data.type || 'info';
        } else {
            document.getElementById('live-banner-title').value = '';
            document.getElementById('live-banner-text').value = '';
        }
    } catch (e) {
        console.error("Live banner load error:", e);
    }
}

document.getElementById('btn-activate-banner')?.addEventListener('click', async () => {
    const statusEl = document.getElementById('banner-status');
    const title = document.getElementById('live-banner-title').value.trim();
    const body = document.getElementById('live-banner-text').value.trim();
    const type = document.getElementById('live-banner-color').value;
    
    if (!body) {
        statusEl.textContent = 'الرجاء إدخال نص الإعلان';
        statusEl.style.color = 'var(--error)';
        return;
    }

    try {
        await setDoc(doc(db, "announcements", "live_banner"), {
            active: true,
            title: title || 'رسالة من إدارة البرنامج',
            body: body,
            type: type,
            created_at: new Date().toISOString(),
            updatedAt: serverTimestamp()
        });
        statusEl.textContent = '✅ تم تفعيل الإعلان وسيظهر في التطبيق فوراً';
        statusEl.style.color = 'var(--success)';
        setTimeout(() => statusEl.textContent = '', 3000);
    } catch (e) {
        statusEl.textContent = 'خطأ: ' + e.message;
        statusEl.style.color = 'var(--error)';
    }
});

document.getElementById('btn-deactivate-banner')?.addEventListener('click', async () => {
    const statusEl = document.getElementById('banner-status');
    try {
        await setDoc(doc(db, "announcements", "live_banner"), {
            active: false,
            updatedAt: serverTimestamp()
        }, { merge: true });
        
        document.getElementById('live-banner-title').value = '';
        document.getElementById('live-banner-text').value = '';
        statusEl.textContent = '✅ تم إيقاف الإعلان وإخفاؤه من التطبيق';
        statusEl.style.color = 'var(--success)';
        setTimeout(() => statusEl.textContent = '', 3000);
    } catch (e) {
        statusEl.textContent = 'خطأ: ' + e.message;
        statusEl.style.color = 'var(--error)';
    }
});

// ─── ACTIVE USERS (HEARTBEATS) ───
async function loadActiveUsers() {
    const tbody = document.getElementById('active-users-body');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="4" class="empty-state">جارِ التحميل...</td></tr>';
    try {
        // Query heartbeats from the last 5 minutes (300,000 ms)
        const fiveMinutesAgoMs = Date.now() - 300000;
        // The ISO string can be compared alphabetically if createdAt is string
        const fiveMinutesAgoStr = new Date(fiveMinutesAgoMs).toISOString();
        
        const q = query(
            collection(db, "heartbeats"),
            orderBy("createdAt", "desc"),
            limit(100)
        );
        const snap = await getDocs(q);
        tbody.innerHTML = '';
        
        let activeCount = 0;
        snap.forEach(docSnap => {
            const data = docSnap.data();
            // Filter locally to ensure they are actually recent
            let isRecent = false;
            if (data.createdAt) {
                if (data.createdAt.seconds) {
                    isRecent = (data.createdAt.seconds * 1000) > fiveMinutesAgoMs;
                } else if (typeof data.createdAt === 'string') {
                    isRecent = new Date(data.createdAt).getTime() > fiveMinutesAgoMs;
                }
            }
            
            // Try to get a meaningful name
            let sender = data.username || data.email || docSnap.id || data.device_id || 'مجهول';
            
            // If sender looks like a long ID, try to find it in cachedUsers
            if (sender.length > 15 && cachedUsers.length > 0) {
                const foundUser = cachedUsers.find(u => u.uid === sender || (u.data && u.data.device_id === sender));
                if (foundUser) {
                    sender = foundUser.username || foundUser.data.email || sender;
                }
            }
            
            const os = data.system_info?.system || data.os || '—';
            const version = data.system_info?.app_version || data.app_version || '—';
            
            const tr = document.createElement('tr');
            if (!isRecent) tr.style.opacity = '0.5';
            else activeCount++;

            tr.innerHTML = `
                <td>${escapeHtml(sender)}</td>
                <td>${escapeHtml(os)}</td>
                <td>${escapeHtml(version)}</td>
                <td>${formatDate(data.createdAt)} ${isRecent ? '<span style="color:var(--success); font-size: 0.8rem;">(متصل)</span>' : ''}</td>
            `;
            tbody.appendChild(tr);
        });

        if (snap.empty) {
            tbody.innerHTML = '<tr><td colspan="4" class="empty-state">لا يوجد نشاط حالياً</td></tr>';
        }
        
        // Update overview stats if we are here
        const statEl = document.getElementById('stat-heartbeats');
        if (statEl) statEl.textContent = activeCount.toString();

    } catch (e) {
        tbody.innerHTML = '<tr><td colspan="4" class="error-text">خطأ في تحميل النشاط</td></tr>';
        console.error(e);
    }
}

document.getElementById('btn-refresh-active-users')?.addEventListener('click', loadActiveUsers);

// ─── TELEGRAM BOT ACTIVITY ───
function activityTimestamp(item) {
    const value = item?.updatedAt || item?.createdAtMs || item?.createdAt;
    if (typeof value?.toMillis === 'function') return value.toMillis();
    if (typeof value?.toDate === 'function') return value.toDate().getTime();
    if (Number.isFinite(Number(value))) return Number(value);
    if (value?.seconds) return value.seconds * 1000;
    const parsed = Date.parse(value || '');
    return Number.isNaN(parsed) ? 0 : parsed;
}

const DEFAULT_TELEGRAM_SETTINGS = {
    enabled: true, allowVideo: true, allowAudio: true, allowDirectFiles: true,
    allowMultipleLinks: true, maxLinks: 5, maxFileSizeMB: 50, pollIntervalSeconds: 3,
    videoQualities: ['best', '1080p', '720p', '480p', '360p'],
    audioFormats: ['audio-mp3', 'audio-m4a'], welcomeMessage: '', helpMessage: ''
};

async function populateTelegramAdminUsers() {
    const select = document.getElementById('telegram-admin-user');
    if (!select) return;
    const previous = select.value;
    select.innerHTML = '<option value="">جارٍ تحميل المستخدمين…</option>';
    try {
        const [snapshot, botSettingsSnapshot] = await Promise.all([
            getDocs(collection(db, 'users')),
            getDocs(query(collectionGroup(db, 'account'), where('enabled', 'in', [true, false]), limit(200)))
        ]);
        const usersByUid = new Map(snapshot.docs.map(userDoc => [userDoc.id, { uid: userDoc.id, data: userDoc.data() }]));
        for (const settingsDoc of botSettingsSnapshot.docs) {
            if (settingsDoc.id !== 'telegram_bot_settings') continue;
            const uid = settingsDoc.ref.parent.parent?.id;
            if (uid && !usersByUid.has(uid)) usersByUid.set(uid, { uid, data: {}, hasTelegramSettings: true });
        }
        cachedUsers = Array.from(usersByUid.values())
            .map(user => ({ ...user, username: user.data.username || user.data.email || user.uid.slice(0, 12) }))
            .sort((a, b) => a.username.localeCompare(b.username, 'ar'));
        select.replaceChildren();
        const placeholder = document.createElement('option');
        placeholder.value = '';
        placeholder.textContent = snapshot.empty ? 'لا يوجد مستخدمون' : 'اختر مستخدمًا';
        select.appendChild(placeholder);
        for (const user of cachedUsers) {
            const option = document.createElement('option');
            option.value = user.uid;
            option.textContent = `${user.username} · ${user.uid.slice(0, 8)}`;
            select.appendChild(option);
        }
        if (previous && cachedUsers.some(user => user.uid === previous)) select.value = previous;
        if (select.value) await loadTelegramUserSettings();
    } catch (error) {
        select.innerHTML = '<option value="">تعذر تحميل المستخدمين</option>';
        document.getElementById('telegram-admin-user-status').textContent = `تعذر قراءة المستخدمين: ${error.message}`;
    }
}

function applyTelegramUserSettings(settings = DEFAULT_TELEGRAM_SETTINGS) {
    const data = { ...DEFAULT_TELEGRAM_SETTINGS, ...(settings || {}) };
    const checks = {
        'telegram-control-enabled': data.enabled,
        'telegram-control-video': data.allowVideo,
        'telegram-control-audio': data.allowAudio,
        'telegram-control-direct': data.allowDirectFiles,
        'telegram-control-multiple': data.allowMultipleLinks
    };
    for (const [id, value] of Object.entries(checks)) document.getElementById(id).checked = value !== false;
    document.getElementById('telegram-control-max-links').value = String(data.maxLinks || 5);
    document.getElementById('telegram-control-max-size').value = String(data.maxFileSizeMB || 50);
    document.getElementById('telegram-control-poll').value = String(data.pollIntervalSeconds || 3);
    document.querySelectorAll('[data-admin-video-quality]').forEach(input => { input.checked = (data.videoQualities || []).includes(input.dataset.adminVideoQuality); });
    document.querySelectorAll('[data-admin-audio-format]').forEach(input => { input.checked = (data.audioFormats || []).includes(input.dataset.adminAudioFormat); });
    document.getElementById('telegram-control-welcome').value = data.welcomeMessage || '';
    document.getElementById('telegram-control-help').value = data.helpMessage || '';
}

async function loadTelegramUserSettings() {
    const uid = document.getElementById('telegram-admin-user')?.value;
    const controls = document.getElementById('telegram-admin-user-controls');
    const status = document.getElementById('telegram-admin-user-status');
    const saveStatus = document.getElementById('telegram-admin-save-status');
    if (saveStatus) saveStatus.textContent = '';
    if (!uid) {
        controls?.classList.add('hidden');
        if (status) status.textContent = 'اختر مستخدمًا لقراءة إعدادات بوت تيليجرام الخاصة به.';
        return;
    }
    if (status) status.textContent = 'جارٍ تحميل إعدادات البوت…';
    try {
        const snapshot = await getDoc(doc(db, 'users', uid, 'account', 'telegram_bot_settings'));
        if (document.getElementById('telegram-admin-user')?.value !== uid) return;
        applyTelegramUserSettings(snapshot.exists() ? snapshot.data() : DEFAULT_TELEGRAM_SETTINGS);
        controls?.classList.remove('hidden');
        if (status) status.textContent = snapshot.exists()
            ? `تم تحميل إعدادات ${cachedUsers.find(user => user.uid === uid)?.username || uid}. التوكن غير متاح للوحة.`
            : 'لا توجد إعدادات بوت محفوظة لهذا المستخدم؛ يمكنك ضبطها مسبقًا لتتزامن عند تشغيل التطبيق.';
    } catch (error) {
        controls?.classList.add('hidden');
        if (status) status.textContent = `تعذر تحميل إعدادات المستخدم: ${error.message}`;
    }
}

function collectTelegramUserSettings() {
    const checked = id => document.getElementById(id).checked;
    return {
        enabled: checked('telegram-control-enabled'),
        allowVideo: checked('telegram-control-video'),
        allowAudio: checked('telegram-control-audio'),
        allowDirectFiles: checked('telegram-control-direct'),
        allowMultipleLinks: checked('telegram-control-multiple'),
        maxLinks: Number(document.getElementById('telegram-control-max-links').value || 5),
        maxFileSizeMB: Number(document.getElementById('telegram-control-max-size').value || 50),
        pollIntervalSeconds: Number(document.getElementById('telegram-control-poll').value || 3),
        videoQualities: Array.from(document.querySelectorAll('[data-admin-video-quality]:checked'), input => input.dataset.adminVideoQuality),
        audioFormats: Array.from(document.querySelectorAll('[data-admin-audio-format]:checked'), input => input.dataset.adminAudioFormat),
        welcomeMessage: document.getElementById('telegram-control-welcome').value.trim(),
        helpMessage: document.getElementById('telegram-control-help').value.trim()
    };
}

document.getElementById('telegram-admin-user')?.addEventListener('change', loadTelegramUserSettings);
document.getElementById('btn-save-telegram-user-settings')?.addEventListener('click', async event => {
    const uid = document.getElementById('telegram-admin-user')?.value;
    const button = event.currentTarget;
    const status = document.getElementById('telegram-admin-save-status');
    if (!uid) return;
    button.disabled = true;
    if (status) status.textContent = 'جارٍ حفظ الإعدادات وإرسالها للمستخدم…';
    try {
        await setDoc(doc(db, 'users', uid, 'account', 'telegram_bot_settings'), {
            ...collectTelegramUserSettings(),
            updatedAt: serverTimestamp(),
            updatedBy: auth.currentUser?.uid || ''
        }, { merge: true });
        if (status) status.textContent = 'تم الحفظ؛ ستصل الإعدادات إلى التطبيق عند اتصاله بـ Firebase.';
    } catch (error) {
        if (status) status.textContent = `تعذر الحفظ: ${error.message}`;
    } finally { button.disabled = false; }
});

function telegramActivityState(status) {
    if (status === 'completed') return { key: 'completed', label: 'اكتمل', icon: 'bx-check-circle' };
    if (status === 'error') return { key: 'error', label: 'فشل', icon: 'bx-error-circle' };
    return { key: 'running', label: status === 'starting' ? 'جارٍ التجهيز' : 'قيد التنفيذ', icon: 'bx-loader-circle' };
}

function getFilteredTelegramActivity() {
    const term = String(document.getElementById('telegram-activity-search')?.value || '').trim().toLowerCase();
    const filter = document.getElementById('telegram-activity-filter')?.value || 'all';
    return telegramActivity.filter(item => {
        const state = telegramActivityState(item.status);
        const user = cachedUsers.find(entry => entry.uid === item.userId);
        const searchable = [item.title, item.userId, item.downloadId, user?.username, user?.data?.email].join(' ').toLowerCase();
        return (filter === 'all' || state.key === filter) && (!term || searchable.includes(term));
    });
}

function renderTelegramActivity() {
    const tbody = document.getElementById('telegram-activity-body');
    if (!tbody) return;
    const rows = getFilteredTelegramActivity();
    tbody.replaceChildren();
    if (!rows.length) {
        const tr = document.createElement('tr');
        const td = document.createElement('td');
        td.colSpan = 6;
        td.className = 'empty-state';
        td.textContent = telegramActivity.length ? 'لا توجد نتائج مطابقة للبحث أو الفلتر.' : 'لا توجد تنزيلات بوت في أحدث السجلات.';
        tr.appendChild(td);
        tbody.appendChild(tr);
        return;
    }

    for (const item of rows) {
        const tr = document.createElement('tr');
        const titleCell = document.createElement('td');
        titleCell.className = 'telegram-title-cell';
        const title = document.createElement('strong');
        title.textContent = item.title || 'تنزيل من بوت تيليجرام';
        const source = document.createElement('span');
        source.textContent = item.source || 'Telegram';
        titleCell.append(title, source);

        const userCell = document.createElement('td');
        userCell.className = 'telegram-user-cell';
        const user = cachedUsers.find(entry => entry.uid === item.userId);
        const userName = user?.username || user?.data?.email || item.userId || 'غير معروف';
        userCell.textContent = userName.length > 20 ? `${userName.slice(0, 17)}…` : userName;
        userCell.title = userName;

        const stateCell = document.createElement('td');
        const state = telegramActivityState(item.status);
        const stateBadge = document.createElement('span');
        stateBadge.className = `telegram-state ${state.key}`;
        const stateIcon = document.createElement('i');
        stateIcon.className = `bx ${state.icon}`;
        stateBadge.append(stateIcon, document.createTextNode(state.label));
        stateCell.appendChild(stateBadge);

        const progressCell = document.createElement('td');
        progressCell.className = 'telegram-progress';
        const progress = Math.max(0, Math.min(100, Number(item.progress) || 0));
        const track = document.createElement('div');
        track.className = 'telegram-progress-track';
        const fill = document.createElement('span');
        fill.style.width = `${progress}%`;
        track.appendChild(fill);
        const progressText = document.createElement('small');
        progressText.textContent = `${Math.round(progress)}٪`;
        progressCell.append(track, progressText);

        const updatedCell = document.createElement('td');
        updatedCell.textContent = formatDate(item.updatedAt || item.createdAtMs);

        const idCell = document.createElement('td');
        const idButton = document.createElement('button');
        idButton.type = 'button';
        idButton.className = 'telegram-id-button';
        idButton.textContent = String(item.downloadId || item.id || '—').slice(0, 12);
        idButton.title = 'اضغط لنسخ المعرّف';
        idButton.addEventListener('click', async () => {
            try {
                await navigator.clipboard.writeText(String(item.downloadId || item.id || ''));
                idButton.textContent = 'تم النسخ';
                setTimeout(() => idButton.textContent = String(item.downloadId || item.id || '—').slice(0, 12), 1200);
            } catch (_) { idButton.title = String(item.downloadId || item.id || ''); }
        });
        idCell.appendChild(idButton);
        tr.append(titleCell, userCell, stateCell, progressCell, updatedCell, idCell);
        tbody.appendChild(tr);
    }
}

async function loadTelegramActivity() {
    const tbody = document.getElementById('telegram-activity-body');
    const refreshButton = document.getElementById('btn-refresh-telegram-activity');
    const note = document.getElementById('telegram-activity-note');
    if (tbody) tbody.innerHTML = '<tr><td colspan="6" class="empty-state">جارٍ تحميل سجل البوتات…</td></tr>';
    if (refreshButton) refreshButton.disabled = true;
    await populateTelegramAdminUsers();
    try {
        const activityQuery = query(collectionGroup(db, 'activity_log'), where('type', '==', 'telegram_download'), limit(200));
        const snapshot = await getDocs(activityQuery);
        telegramActivity = snapshot.docs
            .map(entry => {
                const data = entry.data();
                return { ...data, id: entry.id, userId: entry.ref.parent.parent?.id || '' };
            })
            .filter(item => item.type === 'telegram_download' || item.source === 'telegram')
            .sort((a, b) => activityTimestamp(b) - activityTimestamp(a));

        const uniqueUsers = new Set(telegramActivity.map(item => item.userId).filter(Boolean));
        const completed = telegramActivity.filter(item => item.status === 'completed').length;
        const running = telegramActivity.filter(item => !['completed', 'error'].includes(item.status)).length;
        document.getElementById('telegram-stat-downloads').textContent = String(telegramActivity.length);
        document.getElementById('telegram-stat-users').textContent = String(uniqueUsers.size);
        document.getElementById('telegram-stat-completed').textContent = String(completed);
        document.getElementById('telegram-stat-running').textContent = String(running);
        document.getElementById('telegram-activity-updated').textContent = `آخر تحديث: ${new Date().toLocaleTimeString('ar-EG')}`;
        if (note) {
            note.classList.remove('error-text');
            note.textContent = 'يعرض القسم أحدث 200 سجل نشاط كحد أقصى. بيانات التوكن لا تغادر جهاز المستخدم.';
        }
        renderTelegramActivity();
    } catch (error) {
        console.error('Telegram activity load failed:', error);
        telegramActivity = [];
        if (tbody) tbody.innerHTML = `<tr><td colspan="6" class="error-text">تعذر تحميل نشاط البوت: ${escapeHtml(error.message || 'تحقق من صلاحيات Firebase واتصال الإنترنت')}</td></tr>`;
        if (note) {
            note.classList.add('error-text');
            note.textContent = 'تأكد أن قواعد Firestore تسمح للأدمن بقراءة users/{uid}/activity_log.';
        }
    } finally {
        if (refreshButton) refreshButton.disabled = false;
    }
}

document.getElementById('btn-refresh-telegram-activity')?.addEventListener('click', loadTelegramActivity);
document.getElementById('telegram-activity-search')?.addEventListener('input', renderTelegramActivity);
document.getElementById('telegram-activity-filter')?.addEventListener('change', renderTelegramActivity);
document.getElementById('btn-export-telegram-activity')?.addEventListener('click', () => {
    const rows = getFilteredTelegramActivity();
    const csvCell = value => `"${String(value ?? '').replace(/"/g, '""')}"`;
    const lines = [
        ['العنوان', 'UID المستخدم', 'الحالة', 'التقدم', 'آخر تحديث', 'معرّف التنزيل'],
        ...rows.map(item => [item.title, item.userId, telegramActivityState(item.status).label, `${Math.round(Number(item.progress) || 0)}%`, formatDate(item.updatedAt || item.createdAtMs), item.downloadId || item.id])
    ];
    const blob = new Blob(['\ufeff' + lines.map(row => row.map(csvCell).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `ledo-telegram-activity-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
});

// ─── HELPERS ───
function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
}

function formatDate(val) {
    if (!val) return '—';
    if (typeof val.toDate === 'function') return val.toDate().toLocaleString('ar-EG');
    if (val.seconds) return new Date(val.seconds * 1000).toLocaleString('ar-EG');
    const d = new Date(val);
    return isNaN(d.getTime()) ? '—' : d.toLocaleString('ar-EG');
}
