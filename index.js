import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import {
    getAuth, signInWithEmailAndPassword,
    sendPasswordResetEmail, onAuthStateChanged, signOut
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import {
    getFirestore, collection, getDocs, addDoc, doc, setDoc, getDoc,
    serverTimestamp, query, orderBy, limit, onSnapshot, deleteDoc, updateDoc, where
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// ─── Firebase Config ───
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
const adminEmailDisplay = document.getElementById('admin-email-display');
const btnSignOut = document.getElementById('btn-signout');

const navItems = document.querySelectorAll('.nav-item');
const panels = document.querySelectorAll('.panel');

let cachedUsers = [];
let overviewRefreshTimer = null;

// ─── TOAST SYSTEM ───
function toast(message, type = 'success') {
    const container = document.getElementById('toast-container');
    if (!container) return;
    const t = document.createElement('div');
    t.className = `toast toast-${type}`;
    const iconMap = {
        success: 'bx-check-circle',
        error: 'bx-error-circle',
        info: 'bx-info-circle',
        warning: 'bx-error-alt'
    };
    t.innerHTML = `<i class='bx ${iconMap[type] || iconMap.info}'></i><span>${escapeHtml(message)}</span>`;
    container.appendChild(t);
    setTimeout(() => {
        t.classList.add('toast-exit');
        setTimeout(() => t.remove(), 250);
    }, 3000);
}
window.toast = toast;

// ─── ACTIVITY LOG ───
async function logAction(action, details = '') {
    try {
        const adminEmail = auth.currentUser?.email || 'unknown';
        await addDoc(collection(db, "admin_actions"), {
            action: action,
            details: details,
            adminEmail: adminEmail,
            createdAt: serverTimestamp()
        });
    } catch (e) {
        console.warn('[Activity log] Failed:', e);
    }
}

const ACTION_META = {
    send_announcement: { icon: 'broadcast', iconClass: 'bx-broadcast', label: 'إرسال إعلان للجميع' },
    send_user_message: { icon: 'send', iconClass: 'bx-envelope', label: 'إرسال رسالة لمستخدم' },
    toggle_announcement: { icon: 'config', iconClass: 'bx-power-off', label: 'تغيير حالة إعلان' },
    delete_announcement: { icon: 'delete', iconClass: 'bx-trash', label: 'حذف إعلان' },
    delete_crash: { icon: 'delete', iconClass: 'bx-trash', label: 'حذف تقرير عطل' },
    save_config: { icon: 'config', iconClass: 'bx-cog', label: 'حفظ إعدادات التطبيق' },
    save_links: { icon: 'config', iconClass: 'bx-link', label: 'حفظ الروابط العامة' },
    sign_in: { icon: 'auth', iconClass: 'bx-log-in', label: 'تسجيل دخول' },
    sign_out: { icon: 'auth', iconClass: 'bx-log-out', label: 'تسجيل خروج' },
};

// ─── SIDEBAR NAVIGATION & TAB SWITCHING ───
export function switchTab(targetId) {
    if (!targetId) targetId = 'panel-overview';
    targetId = targetId.replace(/^#/, '');

    const targetPanel = document.getElementById(targetId);
    if (!targetPanel) return;

    navItems.forEach(n => {
        const isMatch = n.dataset.target === targetId || n.getAttribute('href') === `#${targetId}`;
        n.classList.toggle('active', isMatch);
    });

    panels.forEach(p => {
        const isMatch = (p.id === targetId);
        p.classList.toggle('hidden', !isMatch);
        p.classList.toggle('active', isMatch);
    });

    if (window.location.hash !== `#${targetId}`) {
        history.replaceState(null, '', `#${targetId}`);
    }

    switch (targetId) {
        case 'panel-overview':
            loadOverviewStats();
            startOverviewAutoRefresh();
            break;
        case 'panel-users':
            loadUsers();
            break;
        case 'panel-notifications':
            populateUserDropdown();
            loadNotificationHistory();
            break;
        case 'panel-announcements':
            loadAnnouncements();
            break;
        case 'panel-chats':
            loadChats();
            break;
        case 'panel-crashes':
            loadCrashes();
            break;
        case 'panel-activity':
            loadActivityLog();
            break;
        case 'panel-config':
            loadAppConfig();
            break;
    }

    // Stop auto-refresh when leaving overview
    if (targetId !== 'panel-overview') {
        stopOverviewAutoRefresh();
    }
}

window.switchTab = switchTab;

navItems.forEach(item => {
    item.addEventListener('click', (e) => {
        e.preventDefault();
        const targetId = item.dataset.target || (item.getAttribute('href') ? item.getAttribute('href').replace('#', '') : '');
        switchTab(targetId);
    });
});

// Clickable stat cards → jump to panel
document.querySelectorAll('.stat-card.clickable').forEach(card => {
    card.addEventListener('click', () => {
        const target = card.dataset.jump;
        if (target) switchTab(target);
    });
});

window.addEventListener('hashchange', () => {
    const hash = window.location.hash.replace('#', '');
    if (hash) switchTab(hash);
});

function navigateToHash() {
    const hash = window.location.hash.replace('#', '');
    switchTab(hash || 'panel-overview');
}

// ─── AUTO REFRESH OVERVIEW ───
function startOverviewAutoRefresh() {
    stopOverviewAutoRefresh();
    const dot = document.getElementById('overview-refresh-status');
    if (dot) dot.classList.add('active');
    overviewRefreshTimer = setInterval(() => {
        if (document.getElementById('panel-overview')?.classList.contains('hidden')) {
            stopOverviewAutoRefresh();
            return;
        }
        loadOverviewStats(true);
        loadRecentActivityWidget();
    }, 30000);
}

function stopOverviewAutoRefresh() {
    if (overviewRefreshTimer) {
        clearInterval(overviewRefreshTimer);
        overviewRefreshTimer = null;
    }
    const dot = document.getElementById('overview-refresh-status');
    if (dot) dot.classList.remove('active');
}

// ─── MODAL HELPERS ───
function openModal(id) { document.getElementById(id)?.classList.remove('hidden'); }
function closeModal(id) { document.getElementById(id)?.classList.add('hidden'); }

document.querySelectorAll('[data-close]').forEach(btn => {
    btn.addEventListener('click', () => closeModal(btn.dataset.close));
});

document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) overlay.classList.add('hidden');
    });
});

// Confirm modal helper
let pendingConfirmAction = null;
function showConfirm(title, message, onConfirm) {
    document.getElementById('confirm-title').textContent = title;
    document.getElementById('confirm-message').textContent = message;
    pendingConfirmAction = onConfirm;
    openModal('modal-confirm');
}
document.getElementById('btn-confirm-yes').addEventListener('click', () => {
    closeModal('modal-confirm');
    if (pendingConfirmAction) {
        const fn = pendingConfirmAction;
        pendingConfirmAction = null;
        fn();
    }
});
document.getElementById('btn-confirm-no').addEventListener('click', () => {
    closeModal('modal-confirm');
    pendingConfirmAction = null;
});

// ─── AUTH ───
function resolveEmail(input) {
    const clean = input.trim().toLowerCase();
    if (clean.includes('@')) return clean;
    return clean + VIRTUAL_DOMAIN;
}

onAuthStateChanged(auth, (user) => {
    if (user) {
        authView.classList.add('hidden');
        dashboardView.classList.remove('hidden');
        const displayName = user.email ? user.email.replace(VIRTUAL_DOMAIN, '') : (user.displayName || 'admin');
        adminEmailDisplay.textContent = displayName;
        navigateToHash();
        loadOverviewStats();
        loadRecentActivityWidget();
        logAction('sign_in', displayName);
    } else {
        authView.classList.add('hidden');
        dashboardView.classList.add('hidden');
        stopOverviewAutoRefresh();
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
    btnSignIn.disabled = true;
    const origBtnText = btnSubmitText.textContent;
    btnSubmitText.innerHTML = '<span class="spinner"></span> جارِ التحقق...';

    try {
        await signInWithEmailAndPassword(auth, email, password);
    } catch (err) {
        authError.textContent = getAuthErrorMsg(err, email);
    } finally {
        btnSignIn.disabled = false;
        btnSubmitText.textContent = origBtnText;
    }
});

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
        if (email.endsWith(VIRTUAL_DOMAIN)) {
            authError.textContent = 'حساب (@ledodown.local) ليس له بريد إلكتروني خارجي. تواصل مع مسؤول النظام لإعادة تعيين كلمة المرور.';
            return;
        }
        try {
            await sendPasswordResetEmail(auth, email);
            authSuccess.textContent = `تم إرسال رابط إعادة تعيين كلمة المرور إلى: ${email}`;
            authSuccess.style.display = 'block';
            toast('تم إرسال الرابط', 'success');
        } catch (err) {
            authError.textContent = getAuthErrorMsg(err, email);
            toast(authError.textContent, 'error');
        }
    });
}

btnSignOut.addEventListener('click', async () => {
    await logAction('sign_out', '');
    signOut(auth);
});

function getAuthErrorMsg(err, attemptedEmail) {
    const code = err.code || '';
    if (code.includes('user-not-found')) return 'المستخدم غير موجود. تواصل مع مسؤول النظام لإنشاء حساب.';
    if (code.includes('wrong-password') || code.includes('invalid-credential')) return 'بيانات الدخول غير صحيحة (تأكد من اسم المستخدم وكلمة المرور).';
    if (code.includes('too-many-requests')) return 'تم حظر المحاولات مؤقتاً لكثرة المحاولات الخاطئة. انتظر دقيقة وحاول لاحقاً.';
    if (code.includes('invalid-email')) return 'صيغة البريد الإلكتروني غير صالحة.';
    return err.message || 'حدث خطأ أثناء المصادقة.';
}

// ─── OVERVIEW STATS ───
async function loadOverviewStats(isAutoRefresh = false) {
    const fetchCount = async (collName, elId) => {
        try {
            const snap = await getDocs(collection(db, collName));
            const el = document.getElementById(elId);
            if (el) el.textContent = snap.size;
            return snap.size;
        } catch (e) {
            console.warn(`[Stats] Could not count ${collName}:`, e);
            const el = document.getElementById(elId);
            if (el) el.textContent = '0';
            return 0;
        }
    };

    // Count errors that happened today (last 24h)
    const fetchErrorsToday = async () => {
        try {
            const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
            const q = query(collection(db, "crash_reports"), where("createdAt", ">=", since));
            const snap = await getDocs(q);
            const el = document.getElementById('stat-errors-today');
            if (el) el.textContent = snap.size;
            return snap.size;
        } catch (e) {
            const el = document.getElementById('stat-errors-today');
            if (el) el.textContent = '0';
            return 0;
        }
    };

    await Promise.allSettled([
        fetchCount("users", "stat-users"),
        fetchCount("crash_reports", "stat-crashes"),
        fetchCount("chats", "stat-chats"),
        fetchCount("heartbeats", "stat-heartbeats"),
        fetchErrorsToday(),
    ]);

    if (!isAutoRefresh) {
        loadGrowthChart();
        loadRecentActivityWidget();
    }
}

document.getElementById('btn-refresh-overview')?.addEventListener('click', () => {
    loadOverviewStats();
    loadRecentActivityWidget();
    toast('تم تحديث النظرة العامة', 'info');
});

// ─── GROWTH CHART (last 7 days of user registrations) ───
async function loadGrowthChart() {
    const svg = document.getElementById('growth-svg');
    const emptyEl = document.getElementById('chart-empty');
    if (!svg) return;

    try {
        const snap = await getDocs(collection(db, "users"));
        const days = {};
        const today = new Date();
        for (let i = 6; i >= 0; i--) {
            const d = new Date(today);
            d.setDate(d.getDate() - i);
            const key = d.toISOString().slice(0, 10);
            days[key] = 0;
        }

        snap.forEach(docSnap => {
            const data = docSnap.data();
            let date = null;
            if (data.createdAt?.toDate) date = data.createdAt.toDate();
            else if (data.createdAt?.seconds) date = new Date(data.createdAt.seconds * 1000);
            else if (data.createdAt) date = new Date(data.createdAt);
            if (!date || isNaN(date.getTime())) return;
            const key = date.toISOString().slice(0, 10);
            if (key in days) days[key]++;
        });

        const labels = Object.keys(days).map(k => {
            const d = new Date(k);
            return `${d.getDate()}/${d.getMonth() + 1}`;
        });
        const values = Object.values(days);
        const total = values.reduce((a, b) => a + b, 0);

        if (total === 0) {
            emptyEl?.classList.remove('hidden');
            document.getElementById('chart-line').setAttribute('d', '');
            document.getElementById('chart-area').setAttribute('d', '');
            document.getElementById('chart-points').innerHTML = '';
            return;
        }
        emptyEl?.classList.add('hidden');

        const W = 600, H = 200, P = 20;
        const max = Math.max(...values, 1);
        const stepX = (W - P * 2) / (values.length - 1 || 1);
        const points = values.map((v, i) => {
            const x = P + i * stepX;
            const y = H - P - ((v / max) * (H - P * 2));
            return [x, y];
        });

        // smooth line
        const linePath = points.map((p, i) => (i === 0 ? `M ${p[0]} ${p[1]}` : `L ${p[0]} ${p[1]}`)).join(' ');
        document.getElementById('chart-line').setAttribute('d', linePath);

        const areaPath = linePath + ` L ${points[points.length - 1][0]} ${H - P} L ${points[0][0]} ${H - P} Z`;
        document.getElementById('chart-area').setAttribute('d', areaPath);

        // grid lines
        const grid = document.getElementById('chart-grid');
        grid.innerHTML = '';
        for (let i = 0; i <= 4; i++) {
            const y = P + ((H - P * 2) / 4) * i;
            grid.innerHTML += `<line x1="${P}" y1="${y}" x2="${W - P}" y2="${y}" />`;
        }

        // points
        const pts = document.getElementById('chart-points');
        pts.innerHTML = points.map((p, i) => {
            const title = `${labels[i]}: ${values[i]} مستخدم`;
            return `<circle class="chart-point" cx="${p[0]}" cy="${p[1]}" r="4"><title>${title}</title></circle>`;
        }).join('');

        // labels
        const labelsEl = document.getElementById('chart-labels');
        labelsEl.innerHTML = labels.map((lbl, i) => {
            const x = P + i * stepX;
            return `<text class="chart-label" x="${x}" y="${H - 2}" text-anchor="middle">${lbl}</text>`;
        }).join('');
    } catch (e) {
        console.warn('Chart error:', e);
        emptyEl?.classList.remove('hidden');
        emptyEl.textContent = 'تعذر تحميل الرسم البياني';
    }
}

// ─── RECENT ACTIVITY WIDGET (overview) ───
async function loadRecentActivityWidget() {
    const list = document.getElementById('recent-activity-list');
    if (!list) return;
    try {
        const q = query(collection(db, "admin_actions"), orderBy("createdAt", "desc"), limit(5));
        const snap = await getDocs(q);
        list.innerHTML = '';
        if (snap.empty) {
            list.innerHTML = '<p class="empty-state">لا يوجد نشاط حديث</p>';
            return;
        }
        snap.forEach(docSnap => {
            const data = docSnap.data();
            const meta = ACTION_META[data.action] || { iconClass: 'bx-circle', label: data.action };
            const item = document.createElement('div');
            item.className = 'recent-item';
            item.innerHTML = `
                <i class='bx ${meta.iconClass}'></i>
                <span class="recent-text">${escapeHtml(meta.label)}${data.details ? ' — ' + escapeHtml(data.details) : ''}</span>
                <span class="recent-time">${formatDate(data.createdAt)}</span>
            `;
            list.appendChild(item);
        });
    } catch (e) {
        list.innerHTML = '<p class="empty-state">تعذر التحميل</p>';
    }
}

// ─── USERS ───
async function loadUsers() {
    const tbody = document.getElementById('users-table-body');
    const search = document.getElementById('users-search');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="4" class="empty-state"><span class="spinner"></span> جارِ التحميل...</td></tr>';
    try {
        const snap = await getDocs(collection(db, "users"));
        cachedUsers = [];
        tbody.innerHTML = '';
        if (snap.empty) {
            tbody.innerHTML = '<tr><td colspan="4" class="empty-state">لا يوجد مستخدمين</td></tr>';
            updateUsersCount(0);
            return;
        }
        snap.forEach(docSnap => {
            const data = docSnap.data();
            const uid = docSnap.id;
            const username = data.username || data.email || uid.slice(0, 8);
            cachedUsers.push({ uid, username, data });

            const tr = document.createElement('tr');
            tr.dataset.uid = uid;
            tr.dataset.username = username.toLowerCase();
            const avatarHtml = data.photoURL
                ? `<img src="${escapeHtml(data.photoURL)}" class="user-avatar" alt="avatar">`
                : `<div class="avatar-placeholder"><i class='bx bx-user'></i></div>`;
            tr.innerHTML = `
                <td><strong>${escapeHtml(username)}</strong></td>
                <td>${avatarHtml}</td>
                <td>${formatDate(data.createdAt)}</td>
                <td>
                    <button class="btn outline btn-sm btn-msg-user" data-uid="${uid}" data-name="${escapeHtml(username)}">
                        <i class='bx bx-envelope'></i> رسالة
                    </button>
                </td>
            `;
            tbody.appendChild(tr);
        });

        updateUsersCount(snap.size);

        document.querySelectorAll('.btn-msg-user').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                openSendUserMsgModal(btn.dataset.uid, btn.dataset.name);
            });
        });

        // Row click → user detail modal
        tbody.querySelectorAll('tr').forEach(row => {
            if (!row.dataset.uid) return;
            row.addEventListener('click', () => openUserDetail(row.dataset.uid));
        });
    } catch (e) {
        tbody.innerHTML = '<tr><td colspan="4" class="error-text">خطأ في تحميل المستخدمين — تأكد من صلاحيات الأدمن</td></tr>';
        console.error(e);
    }
}

function updateUsersCount(n) {
    const el = document.getElementById('users-count');
    if (el) el.textContent = `${n} مستخدم`;
}

// Users search
document.getElementById('users-search')?.addEventListener('input', (e) => {
    const term = e.target.value.trim().toLowerCase();
    const rows = document.querySelectorAll('#users-table-body tr');
    let visible = 0;
    rows.forEach(r => {
        const match = !term || (r.dataset.username || '').includes(term) || (r.dataset.uid || '').toLowerCase().includes(term);
        r.style.display = match ? '' : 'none';
        if (match) visible++;
    });
    const countEl = document.getElementById('users-count');
    if (countEl) countEl.textContent = `${visible} من ${cachedUsers.length} مستخدم`;
});

document.getElementById('btn-refresh-users')?.addEventListener('click', () => {
    loadUsers();
    toast('تم تحديث قائمة المستخدمين', 'info');
});

// ─── USER DETAIL MODAL ───
async function openUserDetail(uid) {
    const content = document.getElementById('user-detail-content');
    content.innerHTML = '<p class="empty-state"><span class="spinner"></span> جارِ التحميل...</p>';
    openModal('modal-user-detail');

    try {
        const userDoc = await getDoc(doc(db, "users", uid));
        if (!userDoc.exists()) {
            content.innerHTML = '<p class="error-text">المستخدم غير موجود</p>';
            return;
        }
        const data = userDoc.data();
        const username = data.username || data.email || uid.slice(0, 8);
        const avatar = data.photoURL
            ? `<img src="${escapeHtml(data.photoURL)}" class="avatar-lg" alt="avatar">`
            : `<div class="avatar-placeholder-lg"><i class='bx bx-user'></i></div>`;

        // Try to fetch messages count + last heartbeat
        let msgCount = 0;
        try {
            const msgs = await getDocs(collection(db, "users", uid, "messages"));
            msgCount = msgs.size;
        } catch (e) {}

        content.innerHTML = `
            <div class="user-detail-header">
                ${avatar}
                <div>
                    <h3>${escapeHtml(username)}</h3>
                    <span class="text-muted">${escapeHtml(data.email || '—')}</span>
                </div>
            </div>
            <div class="user-detail-info">
                <div class="info-item">
                    <div class="info-label">المعرّف</div>
                    <div class="info-value">${escapeHtml(uid)}</div>
                </div>
                <div class="info-item">
                    <div class="info-label">تاريخ التسجيل</div>
                    <div class="info-value">${formatDate(data.createdAt)}</div>
                </div>
                <div class="info-item">
                    <div class="info-label">إشعارات مرسلة</div>
                    <div class="info-value">${msgCount}</div>
                </div>
                <div class="info-item">
                    <div class="info-label">آخر ظهور</div>
                    <div class="info-value">${data.lastSeen ? formatDate(data.lastSeen) : '—'}</div>
                </div>
            </div>
            <div class="button-group">
                <button class="btn primary" id="btn-detail-send-msg" data-uid="${uid}" data-name="${escapeHtml(username)}">
                    <i class='bx bx-envelope'></i> إرسال رسالة
                </button>
                <button class="btn outline" data-close="modal-user-detail">
                    إغلاق
                </button>
            </div>
        `;

        document.getElementById('btn-detail-send-msg')?.addEventListener('click', (e) => {
            const uidVal = e.currentTarget.dataset.uid;
            const name = e.currentTarget.dataset.name;
            closeModal('modal-user-detail');
            openSendUserMsgModal(uidVal, name);
        });
        content.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => closeModal('modal-user-detail')));
    } catch (e) {
        content.innerHTML = `<p class="error-text">خطأ: ${escapeHtml(e.message)}</p>`;
    }
}

// ─── SEND NOTIFICATION TO ALL USERS (announcement) ───
const btnSendAll = document.getElementById('btn-send-all-notification');
const formSendAll = document.getElementById('form-send-all');
const btnCancelAll = document.getElementById('btn-cancel-all-notif');
const btnPublishAll = document.getElementById('btn-publish-all-notif');

btnSendAll?.addEventListener('click', () => formSendAll?.classList.toggle('hidden'));
btnCancelAll?.addEventListener('click', () => {
    formSendAll?.classList.add('hidden');
    document.getElementById('all-notif-title').value = '';
    document.getElementById('all-notif-body').value = '';
    document.getElementById('all-notif-url').value = '';
    document.getElementById('all-notif-status').textContent = '';
});

btnPublishAll?.addEventListener('click', async () => {
    const title = document.getElementById('all-notif-title').value.trim();
    const body = document.getElementById('all-notif-body').value.trim();
    const type = document.getElementById('all-notif-type').value;
    const priority = document.getElementById('all-notif-priority').value;
    const actionUrl = document.getElementById('all-notif-url').value.trim();
    const statusEl = document.getElementById('all-notif-status');

    if (!title || !body) {
        statusEl.textContent = 'يرجى ملء العنوان والرسالة';
        statusEl.style.color = 'var(--error)';
        toast('يرجى ملء العنوان والرسالة', 'warning');
        return;
    }

    btnPublishAll.disabled = true;
    statusEl.innerHTML = '<span class="spinner"></span> جارِ الإرسال...';
    statusEl.style.color = 'var(--text-muted)';

    try {
        await addDoc(collection(db, "announcements"), {
            title, body, type, priority,
            active: true,
            action_url: actionUrl || null,
            action_label: actionUrl ? 'عرض التفاصيل' : null,
            created_at: new Date().toISOString(),
            createdAt: serverTimestamp()
        });

        await logAction('send_announcement', `${type}: ${title}`);

        statusEl.textContent = '✅ تم إرسال الإشعار لكل المستخدمين بنجاح!';
        statusEl.style.color = 'var(--success)';
        toast('تم إرسال الإعلان لكل المستخدمين', 'success');
        document.getElementById('all-notif-title').value = '';
        document.getElementById('all-notif-body').value = '';
        document.getElementById('all-notif-url').value = '';
        setTimeout(() => {
            statusEl.textContent = '';
            formSendAll.classList.add('hidden');
        }, 2500);
    } catch (e) {
        statusEl.textContent = 'خطأ: ' + e.message;
        statusEl.style.color = 'var(--error)';
        toast('فشل الإرسال: ' + e.message, 'error');
    } finally {
        btnPublishAll.disabled = false;
    }
});

// ─── PER-USER MESSAGE (via users/{uid}/messages) ───
function openSendUserMsgModal(uid, name) {
    document.getElementById('modal-msg-uid').value = uid;
    document.getElementById('modal-user-name').textContent = `إرسال رسالة لـ: ${name}`;
    document.getElementById('modal-msg-title').value = '';
    document.getElementById('modal-msg-body').value = '';
    document.getElementById('modal-msg-status').textContent = '';
    openModal('modal-send-user-msg');
    setTimeout(() => document.getElementById('modal-msg-title')?.focus(), 100);
}

document.getElementById('btn-modal-cancel')?.addEventListener('click', () => closeModal('modal-send-user-msg'));

document.getElementById('btn-modal-send')?.addEventListener('click', async () => {
    const uid = document.getElementById('modal-msg-uid').value;
    const title = document.getElementById('modal-msg-title').value.trim();
    const body = document.getElementById('modal-msg-body').value.trim();
    const statusEl = document.getElementById('modal-msg-status');

    if (!title || !body) {
        statusEl.textContent = 'يرجى ملء العنوان والرسالة';
        statusEl.style.color = 'var(--error)';
        toast('املأ العنوان والرسالة', 'warning');
        return;
    }

    try {
        await addDoc(collection(db, "users", uid, "messages"), {
            title, body,
            createdAt: serverTimestamp(),
            read: false,
            from: 'admin'
        });
        await logAction('send_user_message', `→ ${uid}: ${title}`);
        statusEl.textContent = '✅ تم الإرسال بنجاح!';
        statusEl.style.color = 'var(--success)';
        toast('تم إرسال الرسالة', 'success');
        setTimeout(() => closeModal('modal-send-user-msg'), 1200);
    } catch (e) {
        statusEl.textContent = 'خطأ: ' + e.message;
        statusEl.style.color = 'var(--error)';
        toast('فشل الإرسال: ' + e.message, 'error');
    }
});

// ─── NOTIFICATIONS PANEL ───
function populateUserDropdown() {
    const select = document.getElementById('notif-user-select');
    if (!select) return;
    select.innerHTML = '<option value="">-- اختر مستخدم --</option>';
    cachedUsers.forEach(u => {
        const opt = document.createElement('option');
        opt.value = u.uid;
        opt.textContent = u.username;
        select.appendChild(opt);
    });
    if (cachedUsers.length === 0) {
        loadUsers().then(() => populateUserDropdown());
    }
}

document.getElementById('btn-send-notif')?.addEventListener('click', async () => {
    const uid = document.getElementById('notif-user-select').value;
    const title = document.getElementById('notif-title').value.trim();
    const body = document.getElementById('notif-body').value.trim();
    const statusEl = document.getElementById('notif-status');

    if (!uid) { statusEl.textContent = 'اختر مستخدم'; statusEl.style.color = 'var(--error)'; toast('اختر مستخدم', 'warning'); return; }
    if (!title || !body) { statusEl.textContent = 'املأ العنوان والرسالة'; statusEl.style.color = 'var(--error)'; toast('املأ العنوان والرسالة', 'warning'); return; }

    try {
        await addDoc(collection(db, "users", uid, "messages"), {
            title, body,
            createdAt: serverTimestamp(),
            read: false,
            from: 'admin'
        });
        await logAction('send_user_message', `→ ${uid}: ${title}`);
        statusEl.textContent = '✅ تم إرسال الإشعار!';
        statusEl.style.color = 'var(--success)';
        toast('تم إرسال الإشعار', 'success');
        document.getElementById('notif-title').value = '';
        document.getElementById('notif-body').value = '';
        loadNotificationHistory();
        setTimeout(() => statusEl.textContent = '', 3000);
    } catch (e) {
        statusEl.textContent = 'خطأ: ' + e.message;
        statusEl.style.color = 'var(--error)';
        toast('فشل الإرسال: ' + e.message, 'error');
    }
});

// Notification history (last 30 sent messages across all users)
async function loadNotificationHistory() {
    const list = document.getElementById('notif-history-list');
    if (!list) return;
    list.innerHTML = '<p class="empty-state"><span class="spinner"></span> جارِ التحميل...</p>';
    try {
        // gather recent messages from each cached user
        const allMsgs = [];
        const usersToQuery = cachedUsers.length > 0 ? cachedUsers : await loadUsersFirst();

        await Promise.allSettled(usersToQuery.map(async (u) => {
            try {
                const q = query(collection(db, "users", u.uid, "messages"), orderBy("createdAt", "desc"), limit(5));
                const snap = await getDocs(q);
                snap.forEach(d => {
                    const data = d.data();
                    allMsgs.push({
                        uid: u.uid,
                        username: u.username,
                        title: data.title,
                        body: data.body,
                        createdAt: data.createdAt,
                        read: data.read
                    });
                });
            } catch (e) {}
        }));

        allMsgs.sort((a, b) => {
            const ta = a.createdAt?.seconds || 0;
            const tb = b.createdAt?.seconds || 0;
            return tb - ta;
        });

        const top = allMsgs.slice(0, 30);
        list.innerHTML = '';
        if (top.length === 0) {
            list.innerHTML = '<p class="empty-state">لا يوجد إشعارات سابقة</p>';
            return;
        }
        top.forEach(m => {
            const item = document.createElement('div');
            item.className = 'notif-history-item';
            item.innerHTML = `
                <h4>${escapeHtml(m.title)}</h4>
                <p>${escapeHtml((m.body || '').slice(0, 120))}</p>
                <div class="notif-meta">
                    <span>→ ${escapeHtml(m.username)}</span>
                    <span>${formatDate(m.createdAt)}</span>
                </div>
            `;
            list.appendChild(item);
        });
    } catch (e) {
        list.innerHTML = '<p class="error-text">تعذر تحميل السجل</p>';
    }
}

async function loadUsersFirst() {
    const snap = await getDocs(collection(db, "users"));
    cachedUsers = [];
    snap.forEach(d => {
        const data = d.data();
        const username = data.username || data.email || d.id.slice(0, 8);
        cachedUsers.push({ uid: d.id, username, data });
    });
    return cachedUsers;
}

document.getElementById('btn-refresh-notif-history')?.addEventListener('click', () => {
    loadNotificationHistory();
    toast('تم تحديث السجل', 'info');
});

// ─── ANNOUNCEMENTS MANAGER ───
async function loadAnnouncements() {
    const list = document.getElementById('announcements-list');
    if (!list) return;
    list.innerHTML = '<p class="empty-state"><span class="spinner"></span> جارِ التحميل...</p>';
    try {
        const q = query(collection(db, "announcements"), orderBy("createdAt", "desc"), limit(100));
        const snap = await getDocs(q);
        list.innerHTML = '';
        if (snap.empty) {
            list.innerHTML = '<p class="empty-state">لا توجد إعلانات</p>';
            return;
        }
        snap.forEach(docSnap => {
            const data = docSnap.data();
            const id = docSnap.id;
            const isActive = data.active !== false;
            const div = document.createElement('div');
            div.className = `announcement-item ${isActive ? '' : 'inactive'}`;
            div.innerHTML = `
                <div class="announcement-head">
                    <h4>
                        <span class="badge-type ${escapeHtml(data.type || 'info')}">${escapeHtml(data.type || 'info')}</span>
                        ${escapeHtml(data.title || '')}
                        ${data.priority === 'high' ? '<i class="bx bx-bolt" style="color:var(--warning)" title="أولوية عالية"></i>' : ''}
                    </h4>
                    <div class="announcement-actions">
                        <span class="status-pill ${isActive ? 'active' : 'inactive'}">${isActive ? 'نشط' : 'معطل'}</span>
                        <button class="btn-icon btn-toggle-ann" data-id="${id}" data-active="${!isActive}" title="${isActive ? 'تعطيل' : 'تفعيل'}">
                            <i class='bx ${isActive ? 'bx-pause' : 'bx-play'}'></i>
                        </button>
                        <button class="btn-icon btn-delete-ann" data-id="${id}" title="حذف" style="color:var(--error)">
                            <i class='bx bx-trash'></i>
                        </button>
                    </div>
                </div>
                <p class="announcement-body">${escapeHtml(data.body || '')}</p>
                <div class="announcement-meta">
                    <span><i class='bx bx-calendar'></i>${formatDate(data.createdAt)}</span>
                    ${data.action_url ? `<span><i class='bx bx-link'></i><a href="${escapeHtml(data.action_url)}" target="_blank" style="color:var(--accent);">رابط</a></span>` : ''}
                </div>
            `;
            list.appendChild(div);
        });

        list.querySelectorAll('.btn-toggle-ann').forEach(btn => {
            btn.addEventListener('click', async () => {
                const id = btn.dataset.id;
                const newActive = btn.dataset.active === 'true';
                showConfirm(
                    newActive ? 'تفعيل الإعلان' : 'تعطيل الإعلان',
                    newActive ? 'هل تريد تفعيل هذا الإعلان؟ سيظهر للمستخدمين.' : 'هل تريد تعطيل هذا الإعلان؟ سيختفي من المستخدمين.',
                    async () => {
                        try {
                            await updateDoc(doc(db, "announcements", id), { active: newActive });
                            await logAction('toggle_announcement', `${id} → ${newActive ? 'active' : 'inactive'}`);
                            toast(newActive ? 'تم التفعيل' : 'تم التعطيل', 'success');
                            loadAnnouncements();
                        } catch (e) {
                            toast('فشل: ' + e.message, 'error');
                        }
                    }
                );
            });
        });

        list.querySelectorAll('.btn-delete-ann').forEach(btn => {
            btn.addEventListener('click', () => {
                const id = btn.dataset.id;
                showConfirm(
                    'حذف الإعلان',
                    'هل تريد حذف هذا الإعلان نهائياً؟ لن يمكن التراجع.',
                    async () => {
                        try {
                            await deleteDoc(doc(db, "announcements", id));
                            await logAction('delete_announcement', id);
                            toast('تم الحذف', 'success');
                            loadAnnouncements();
                        } catch (e) {
                            toast('فشل: ' + e.message, 'error');
                        }
                    }
                );
            });
        });
    } catch (e) {
        list.innerHTML = '<p class="error-text">خطأ في تحميل الإعلانات</p>';
    }
}

document.getElementById('btn-refresh-announcements')?.addEventListener('click', () => {
    loadAnnouncements();
    toast('تم التحديث', 'info');
});

// ─── SUPPORT CHATS ───
let activeChatUid = null;
let chatMessagesUnsubscribe = null;
let chatsListUnsubscribe = null;

async function loadChats() {
    const chatList = document.getElementById('chat-list');
    chatList.innerHTML = '<p class="empty-state"><span class="spinner"></span> جارِ التحميل...</p>';
    try {
        // Use real-time listener for live updates
        if (chatsListUnsubscribe) chatsListUnsubscribe();
        const q = query(collection(db, "chats"), orderBy("lastUpdated", "desc"));
        chatsListUnsubscribe = onSnapshot(q, (snap) => {
            chatList.innerHTML = '';
            if (snap.empty) {
                chatList.innerHTML = '<p class="empty-state">لا توجد محادثات</p>';
                return;
            }
            snap.forEach(docSnap => {
                const data = docSnap.data();
                const uid = docSnap.id;
                const email = data.email || uid.slice(0, 8);
                const displayName = email.replace(VIRTUAL_DOMAIN, '');
                const unread = data.unreadAdmin ? '<span class="chat-unread-dot"></span>' : '';
                const div = document.createElement('div');
                div.className = 'chat-list-item' + (uid === activeChatUid ? ' active' : '');
                div.dataset.uid = uid;
                div.innerHTML = `
                    <h4>${escapeHtml(displayName)} ${unread}</h4>
                    <p>${escapeHtml((data.lastMessage || '...').slice(0, 50))}</p>
                `;
                div.addEventListener('click', () => openChat(uid, displayName));
                chatList.appendChild(div);
            });
        }, (err) => {
            chatList.innerHTML = '<p class="error-text">خطأ في تحميل المحادثات</p>';
        });
    } catch (e) {
        chatList.innerHTML = '<p class="error-text">خطأ في تحميل المحادثات</p>';
        console.error(e);
    }
}

document.getElementById('btn-refresh-chats')?.addEventListener('click', () => {
    loadChats();
    toast('تم تحديث المحادثات', 'info');
});

async function openChat(uid, displayName) {
    activeChatUid = uid;

    document.querySelectorAll('.chat-list-item').forEach(item => {
        item.classList.toggle('active', item.dataset.uid === uid);
    });

    const messagesEl = document.getElementById('chat-messages');
    const inputArea = document.getElementById('chat-input-area');
    const headerEl = document.getElementById('chat-window-header');
    const headerName = document.getElementById('chat-window-name');
    const headerEmail = document.getElementById('chat-window-email');

    messagesEl.innerHTML = '<p class="empty-state"><span class="spinner"></span> جارِ التحميل...</p>';
    inputArea.classList.remove('hidden');
    if (headerEl) headerEl.classList.remove('hidden');
    if (headerName) headerName.textContent = displayName;

    // try to fetch email
    try {
        const userDoc = await getDoc(doc(db, "users", uid));
        if (userDoc.exists()) {
            const u = userDoc.data();
            if (headerEmail) headerEmail.textContent = u.email || '';
        }
    } catch (e) {}

    if (chatMessagesUnsubscribe) chatMessagesUnsubscribe();

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

    setDoc(doc(db, "chats", uid), { unreadAdmin: false }, { merge: true }).catch(() => {});
}

document.getElementById('btn-send-reply')?.addEventListener('click', sendChatReply);
document.getElementById('chat-reply-input')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') sendChatReply();
});

async function sendChatReply() {
    if (!activeChatUid) return;
    const input = document.getElementById('chat-reply-input');
    const text = input.value.trim();
    if (!text) return;

    try {
        await addDoc(collection(db, "chats", activeChatUid, "messages"), {
            text, sender: 'admin', isAdmin: true,
            createdAt: serverTimestamp()
        });
        await setDoc(doc(db, "chats", activeChatUid), {
            lastMessage: text,
            lastSender: 'admin',
            lastUpdated: serverTimestamp(),
            unreadUser: true,
            unreadAdmin: false
        }, { merge: true });
        input.value = '';
        toast('تم إرسال الرد', 'success');
    } catch (e) {
        toast('فشل إرسال الرد: ' + e.message, 'error');
    }
}

// ─── CRASH REPORTS ───
let cachedCrashes = [];
let crashUserMap = {}; // uid → user info cache

// Rule-based AI error analyzer — categorizes errors and produces prompt-style explanation
function analyzeError(message = '', stack = '', category = '') {
    const text = ((message || '') + ' ' + (stack || '') + ' ' + (category || '')).toLowerCase();
    const result = {
        category: 'unknown',
        categoryLabel: 'غير مصنف',
        severity: 'medium',
        severityLabel: 'متوسطة',
        severityIcon: 'bx-error',
        patterns: [],
        cause: '',
        fixes: [],
        summary: ''
    };

    // Network
    if (/network|fetch|econnrefused|econnreset|enotfound|net::err|dns|failed to fetch|xmlhttprequest/i.test(text)) {
        result.category = 'network';
        result.categoryLabel = 'خطأ في الشبكة';
        result.severity = 'medium';
        result.patterns.push('network-failure');
        result.cause = 'فشل في الاتصال بالخادم البعيد — إما الإنترنت مقطوع، أو الخادم مش متاح، أو DNS مش شغال.';
        result.fixes.push('تأكد من اتصال الإنترنت عند المستخدم', 'تأكد إن الخادم شغال (Firebase / API)', 'أعد المحاولة بعد ثوان قليلة', 'فعّل retry mechanism في الكود');
    }
    // Timeout
    else if (/timeout|timed out|deadline exceeded|etimedout/i.test(text)) {
        result.category = 'timeout';
        result.categoryLabel = 'انتهاء المهلة';
        result.severity = 'medium';
        result.patterns.push('timeout');
        result.cause = 'العملية أخذت وقت أطول من المسموح (default timeout). غالباً في طلبات الشبكة أو عمليات ثقيلة.';
        result.fixes.push('زيادة الـ timeout', 'تقليل حجم البيانات', 'استخدام pagination', 'فحص أداء الخادم');
    }
    // Auth
    else if (/auth|permission|denied|forbidden|401|403|unauthor|invalid.token|jwt|credential/i.test(text)) {
        result.category = 'auth';
        result.categoryLabel = 'صلاحيات / تسجيل دخول';
        result.severity = 'high';
        result.severityIcon = 'bx-lock-alt';
        result.patterns.push('auth-issue');
        result.cause = 'المستخدم لا يملك صلاحية أو انتهت صلاحية الجلسة/التوكن.';
        result.fixes.push('أعد تسجيل دخول المستخدم', 'حدّث الـ token', 'راجع Security Rules في Firestore', 'فحص صلاحية المستخدم في القاعدة');
    }
    // Null / undefined
    else if (/cannot read|null|undefined|is not a function|of undefined|of null|typeerror/i.test(text)) {
        result.category = 'null_reference';
        result.categoryLabel = 'مرجع فارغ';
        result.severity = 'high';
        result.patterns.push('null-reference');
        result.cause = 'محاولة الوصول لقيمة غير موجودة (null/undefined). غالباً الكود بيفترض إن البيانات موجودة بدون فحص.';
        result.fixes.push('استخدم optional chaining: data?.field', 'ضع قيم افتراضية', 'فحص هل البيانات وصلت قبل الـ render', 'أضف guard checks في الكود');
    }
    // Not found
    else if (/404|not found|does not exist|missing/i.test(text)) {
        result.category = 'not_found';
        result.categoryLabel = 'مورد غير موجود';
        result.severity = 'low';
        result.patterns.push('resource-missing');
        result.cause = 'المورد المطلوب (ملف، API endpoint، document) غير موجود.';
        result.fixes.push('فحص الرابط / الـ ID', 'تأكد من بيانات الـ deployment', 'راجع آخر migration', 'تحقق من الـ collection name');
    }
    // Server
    else if (/500|internal server|server error|bad gateway|502|503/i.test(text)) {
        result.category = 'server';
        result.categoryLabel = 'خطأ في الخادم';
        result.severity = 'critical';
        result.severityIcon = 'bx-server';
        result.patterns.push('server-error');
        result.cause = 'خطأ في الكود من جانب الخادم. التطبيق عند العميل سليم، لكن السيرفر وقع.';
        result.fixes.push('راجع logs الخادم فوراً', 'راجع آخر deployment', 'أبلغ فريق التطوير', 'فحص قاعدة البيانات');
    }
    // CORS
    else if (/cors|cross-origin|access-control/i.test(text)) {
        result.category = 'cors';
        result.categoryLabel = 'مشكلة CORS';
        result.severity = 'medium';
        result.patterns.push('cors');
        result.cause = 'الخادم لا يسمح بطلبات من هذا الـ origin (Cross-Origin).';
        result.fixes.push('أضف الـ domain في CORS settings', 'استخدم proxy', 'راجع الـ headers في الخادم');
    }
    // Syntax / parse
    else if (/syntax|parse|unexpected token|invalid json/i.test(text)) {
        result.category = 'syntax';
        result.categoryLabel = 'خطأ في الكود';
        result.severity = 'high';
        result.patterns.push('syntax-error');
        result.cause = 'كود غير صالح أو JSON تالف. غالباً build خاطئ أو بيانات فاسدة.';
        result.fixes.push('فحص الـ build process', 'تحقق من صحة البيانات المدخلة', 'راجع آخر commit');
    }
    // Disk / storage
    else if (/disk|storage|quota|enospc|no space/i.test(text)) {
        result.category = 'storage';
        result.categoryLabel = 'تخزين ممتلئ';
        result.severity = 'medium';
        result.patterns.push('storage-full');
        result.cause = 'مساحة التخزين نفدت عند المستخدم أو على الخادم.';
        result.fixes.push('تنظيف الملفات القديمة', 'راجع حدود Firebase Storage', 'تنبيه المستخدم');
    }
    // Unknown
    else {
        result.cause = 'خطأ غير مصنف. يحتاج مراجعة يدوية للـ Stack trace.';
        result.fixes.push('راجع Stack trace', 'ابحث عن الرسالة في الكود', 'أضف logging أعمق');
    }

    // Build a one-line prompt summary
    result.summary = `[${result.categoryLabel}] ${result.cause.split('—')[0].trim()}`;

    return result;
}

// Build a "prompt-like" explanation string for an error
function buildErrorPrompt(analysis, crashData) {
    const lines = [];
    lines.push(`# تحليل خطأ تلقائي — Ledo Admin`);
    lines.push('');
    lines.push(`## المدخلات`);
    lines.push(`- الرسالة: ${crashData.message || '—'}`);
    lines.push(`- الفئة المُسجّلة: ${crashData.error_category || crashData.category || '—'}`);
    if (crashData.stack_trace) {
        lines.push(`- Stack: ${crashData.stack_trace.split('\n')[0]}`);
    }
    lines.push('');
    lines.push(`## التشخيص`);
    lines.push(`- النوع: ${analysis.categoryLabel}`);
    lines.push(`- الخطورة: ${analysis.severityLabel}`);
    lines.push(`- أنماط مكتشفة: ${analysis.patterns.join(', ') || 'لا يوجد'}`);
    lines.push('');
    lines.push(`## السبب المحتمل`);
    lines.push(analysis.cause);
    lines.push('');
    lines.push(`## اقتراحات الإصلاح`);
    analysis.fixes.forEach((f, i) => lines.push(`${i + 1}. ${f}`));
    return lines.join('\n');
}

// Resolve crash.user_uid → user info (from cache or fetch)
async function getCrashUserInfo(uid) {
    if (!uid) return { uid: null, name: 'مستخدم مجهول', isAnon: true, avatar: null, email: '' };
    if (crashUserMap[uid]) return crashUserMap[uid];
    let user = cachedUsers.find(u => u.uid === uid);
    if (!user) {
        try {
            const d = await getDoc(doc(db, "users", uid));
            if (d.exists()) {
                const ud = d.data();
                user = { uid, username: ud.username || ud.email || uid, data: ud };
                cachedUsers.push(user);
            }
        } catch (e) { /* ignore */ }
    }
    if (user) {
        const info = {
            uid,
            name: user.username,
            isAnon: false,
            avatar: user.data?.photoURL || null,
            email: user.data?.email || ''
        };
        crashUserMap[uid] = info;
        return info;
    }
    return { uid, name: uid.slice(0, 10) + '…', isAnon: false, avatar: null, email: '' };
}

function userChipHtml(uid) {
    if (!uid) return '<span class="chip-anon text-muted"><i class="bx bx-user-x"></i> مجهول</span>';
    const info = crashUserMap[uid];
    if (!info) return `<span class="chip-anon text-muted">${escapeHtml(uid.slice(0, 10))}…</span>`;
    const avatar = info.avatar
        ? `<img src="${escapeHtml(info.avatar)}" class="chip-avatar" alt="">`
        : `<span class="chip-avatar"><i class='bx bx-user'></i></span>`;
    return `<span class="user-chip" data-uid="${escapeHtml(uid)}">${avatar}<span class="chip-name">${escapeHtml(info.name)}</span></span>`;
}

async function loadCrashes() {
    const tbody = document.getElementById('crashes-table-body');
    tbody.innerHTML = '<tr><td colspan="5" class="empty-state"><span class="spinner"></span> جارِ التحميل...</td></tr>';

    // Make sure we have users cached for attribution
    if (cachedUsers.length === 0) {
        try { await loadUsersFirst(); } catch (e) {}
    }

    try {
        const q = query(collection(db, "crash_reports"), orderBy("createdAt", "desc"), limit(100));
        const snap = await getDocs(q);
        tbody.innerHTML = '';
        cachedCrashes = [];

        if (snap.empty) {
            tbody.innerHTML = '<tr><td colspan="5" class="empty-state">لا توجد تقارير</td></tr>';
            updateCrashesCount(0, 0);
            return;
        }

        // Pre-resolve unique user uids
        const uids = new Set();
        snap.forEach(d => { if (d.data().user_uid) uids.add(d.data().user_uid); });
        await Promise.allSettled([...uids].map(uid => getCrashUserInfo(uid)));

        // Populate user filter dropdown
        const filter = document.getElementById('crashes-user-filter');
        if (filter) {
            const currentVal = filter.value;
            filter.innerHTML = '<option value="">— كل المستخدمين —</option>';
            const userOptions = [...uids].map(uid => {
                const info = crashUserMap[uid];
                const name = info ? info.name : uid.slice(0, 10);
                return `<option value="${escapeHtml(uid)}">${escapeHtml(name)}</option>`;
            }).join('');
            filter.innerHTML += userOptions;
            // Also add "مجهول" option
            const hasAnon = [...uids].length < snap.size;
            if (hasAnon) filter.innerHTML += '<option value="__anon__">— مستخدم مجهول —</option>';
            filter.value = currentVal;
        }

        let visibleCount = 0;
        snap.forEach(docSnap => {
            const data = docSnap.data();
            cachedCrashes.push({ id: docSnap.id, data });
            const tr = document.createElement('tr');
            tr.dataset.id = docSnap.id;
            tr.dataset.uid = data.user_uid || '';
            tr.innerHTML = `
                <td>${formatDate(data.createdAt)}</td>
                <td>${userChipHtml(data.user_uid)}</td>
                <td title="${escapeHtml(data.message || '')}">${escapeHtml((data.message || '').slice(0, 80))}</td>
                <td>${escapeHtml(data.error_category || data.category || '—')}</td>
                <td>
                    <button class="btn danger btn-sm btn-delete-crash" data-id="${docSnap.id}">
                        <i class='bx bx-trash'></i>
                    </button>
                </td>
            `;
            tbody.appendChild(tr);
            visibleCount++;
        });

        updateCrashesCount(visibleCount, snap.size);

        tbody.querySelectorAll('tr').forEach(row => {
            row.addEventListener('click', (e) => {
                if (e.target.closest('.btn-delete-crash')) return;
                if (e.target.closest('.user-chip')) {
                    // Click on user chip → open user detail modal
                    e.stopPropagation();
                    const uid = e.target.closest('.user-chip').dataset.uid;
                    if (uid) openUserDetail(uid);
                    return;
                }
                const id = row.dataset.id;
                const crash = cachedCrashes.find(c => c.id === id);
                if (crash) openCrashDetail(crash);
            });
        });

        tbody.querySelectorAll('.btn-delete-crash').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const id = btn.dataset.id;
                showConfirm(
                    'حذف تقرير العطل',
                    'هل تريد حذف هذا التقرير نهائياً؟',
                    async () => {
                        try {
                            await deleteDoc(doc(db, "crash_reports", id));
                            await logAction('delete_crash', id);
                            toast('تم الحذف', 'success');
                            loadCrashes();
                        } catch (e) {
                            toast('فشل: ' + e.message, 'error');
                        }
                    }
                );
            });
        });

        // Re-apply filters if any
        applyCrashFilters();
    } catch (e) {
        tbody.innerHTML = '<tr><td colspan="5" class="error-text">خطأ في تحميل التقارير</td></tr>';
        console.error(e);
    }
}

function updateCrashesCount(visible, total) {
    const el = document.getElementById('crashes-count');
    if (!el) return;
    if (visible === total) el.textContent = `${total} تقرير`;
    else el.textContent = `${visible} من ${total} تقرير`;
}

function applyCrashFilters() {
    const term = (document.getElementById('crashes-search')?.value || '').trim().toLowerCase();
    const userFilter = document.getElementById('crashes-user-filter')?.value || '';
    const rows = document.querySelectorAll('#crashes-table-body tr');
    let visible = 0;
    rows.forEach(r => {
        const text = (r.textContent || '').toLowerCase();
        const uid = r.dataset.uid || '';
        let matchText = !term || text.includes(term);
        let matchUser = true;
        if (userFilter === '__anon__') matchUser = !uid;
        else if (userFilter) matchUser = uid === userFilter;
        const match = matchText && matchUser;
        r.style.display = match ? '' : 'none';
        if (match) visible++;
    });
    updateCrashesCount(visible, cachedCrashes.length);
}

// Crash detail modal — with user chip + AI-like explanation
async function openCrashDetail(crash) {
    const d = crash.data;
    const content = document.getElementById('crash-detail-content');
    content.innerHTML = '<p class="empty-state"><span class="spinner"></span> جارِ التحميل...</p>';
    openModal('modal-crash-detail');

    // Ensure user info resolved
    if (d.user_uid) await getCrashUserInfo(d.user_uid);

    // Run analyzer
    const analysis = analyzeError(d.message || '', d.stack_trace || '', d.error_category || d.category || '');
    const promptStr = buildErrorPrompt(analysis, d);

    const severityIcons = {
        low: 'bx-info-circle',
        medium: 'bx-error',
        high: 'bx-error-alt',
        critical: 'bx-error-circle'
    };
    const severityLabelAr = {
        low: 'منخفضة',
        medium: 'متوسطة',
        high: 'عالية',
        critical: 'حرجة'
    };

    content.innerHTML = `
        <!-- USER + SEVERITY ROW -->
        <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap; margin-bottom: 1rem;">
            ${d.user_uid ? userChipHtml(d.user_uid) : '<span class="chip-anon text-muted"><i class="bx bx-user-x"></i> مستخدم مجهول</span>'}
            <span class="severity-badge severity-${analysis.severity}">
                <i class='bx ${severityIcons[analysis.severity]}'></i>
                خطورة: ${severityLabelAr[analysis.severity]}
            </span>
            <span class="text-muted" style="margin-right:auto;">${formatDate(d.createdAt)}</span>
        </div>

        <div class="crash-detail-section">
            <div class="crash-detail-label">رسالة الخطأ</div>
            <div class="crash-detail-value">${escapeHtml(d.message || '—')}</div>
            ${analysis.patterns.length ? `<div class="pattern-tags">${analysis.patterns.map(p => `<span class="pattern-tag">${escapeHtml(p)}</span>`).join('')}</div>` : ''}
        </div>

        ${d.stack_trace ? `
        <div class="crash-detail-section">
            <div class="crash-detail-label">Stack Trace</div>
            <div class="crash-detail-value crash-stack">${escapeHtml(d.stack_trace)}</div>
        </div>` : ''}

        <div class="crash-detail-section">
            <div class="crash-detail-label">الفئة المُسجّلة</div>
            <div class="crash-detail-value">${escapeHtml(d.error_category || d.category || '—')}</div>
        </div>

        ${d.app_version ? `
        <div class="crash-detail-section">
            <div class="crash-detail-label">إصدار التطبيق</div>
            <div class="crash-detail-value">${escapeHtml(d.app_version)}</div>
        </div>` : ''}

        ${d.platform || d.os ? `
        <div class="crash-detail-section">
            <div class="crash-detail-label">المنصة / نظام التشغيل</div>
            <div class="crash-detail-value">${escapeHtml((d.platform || '') + (d.os ? ' — ' + d.os : ''))}</div>
        </div>` : ''}

        <!-- AI EXPLANATION -->
        <div class="explanation-box">
            <div class="explanation-head">
                <i class='bx bx-analyse'></i>
                تحليل الخطأ (Prompt)
            </div>

            <div class="explanation-section">
                <div class="explanation-label"><i class='bx bx-category'></i> النوع</div>
                <div class="explanation-text">${escapeHtml(analysis.categoryLabel)}</div>
            </div>

            <div class="explanation-section">
                <div class="explanation-label"><i class='bx bx-bullseye'></i> السبب المحتمل</div>
                <div class="explanation-text">${escapeHtml(analysis.cause)}</div>
            </div>

            <div class="explanation-section">
                <div class="explanation-label"><i class='bx bx-wrench'></i> اقتراحات الإصلاح</div>
                <ul class="explanation-list">
                    ${analysis.fixes.map(f => `<li>${escapeHtml(f)}</li>`).join('')}
                </ul>
            </div>

            <div class="explanation-section">
                <div class="explanation-label"><i class='bx bx-code-alt'></i> Prompt مقترح للمطور</div>
                <div class="explanation-prompt">${escapeHtml(promptStr)}</div>
            </div>
        </div>

        <div class="button-group">
            <button class="btn primary" data-close="modal-crash-detail">
                <i class='bx bx-check'></i> فهمت
            </button>
            ${d.user_uid ? `<button class="btn outline" id="btn-crash-open-user" data-uid="${escapeHtml(d.user_uid)}">
                <i class='bx bx-user'></i> عرض ملف المستخدم
            </button>` : ''}
        </div>
    `;

    // Bind actions
    content.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => closeModal('modal-crash-detail')));
    document.getElementById('btn-crash-open-user')?.addEventListener('click', (e) => {
        const uid = e.currentTarget.dataset.uid;
        closeModal('modal-crash-detail');
        openUserDetail(uid);
    });
}

// Crash search + user filter
document.getElementById('crashes-search')?.addEventListener('input', applyCrashFilters);
document.getElementById('crashes-user-filter')?.addEventListener('change', applyCrashFilters);

document.getElementById('btn-refresh-crashes')?.addEventListener('click', () => {
    loadCrashes();
    toast('تم تحديث التقارير', 'info');
});

// ─── ACTIVITY LOG PANEL ───
async function loadActivityLog() {
    const list = document.getElementById('activity-list');
    if (!list) return;
    list.innerHTML = '<p class="empty-state"><span class="spinner"></span> جارِ التحميل...</p>';
    try {
        const q = query(collection(db, "admin_actions"), orderBy("createdAt", "desc"), limit(100));
        const snap = await getDocs(q);
        list.innerHTML = '';
        if (snap.empty) {
            list.innerHTML = '<p class="empty-state">لا توجد نشاطات مسجلة</p>';
            return;
        }
        snap.forEach(docSnap => {
            const data = docSnap.data();
            const meta = ACTION_META[data.action] || { iconClass: 'bx-circle', label: data.action };
            const item = document.createElement('div');
            item.className = 'activity-item';
            const adminName = (data.adminEmail || 'unknown').replace(VIRTUAL_DOMAIN, '');
            item.innerHTML = `
                <div class="activity-icon ${meta.icon || ''}"><i class='bx ${meta.iconClass}'></i></div>
                <div class="activity-content">
                    <h4>${escapeHtml(meta.label)}</h4>
                    <p>${escapeHtml(data.details || '—')} • بواسطة: ${escapeHtml(adminName)}</p>
                </div>
                <div class="activity-time">${formatDate(data.createdAt)}</div>
            `;
            list.appendChild(item);
        });
    } catch (e) {
        list.innerHTML = '<p class="error-text">تعذر تحميل السجل — قد لا يكون مجموعة admin_actions موجودة بعد</p>';
        console.warn('Activity log error:', e);
    }
}

document.getElementById('btn-refresh-activity')?.addEventListener('click', () => {
    loadActivityLog();
    toast('تم تحديث السجل', 'info');
});

// ─── APP CONFIG ───
async function loadAppConfig() {
    try {
        const updateDoc = await getDoc(doc(db, "app_config", "latest_update"));
        if (updateDoc.exists()) {
            const d = updateDoc.data();
            document.getElementById('config-version').value = d.version || '';
            document.getElementById('config-download-url').value = d.download_url || '';
            document.getElementById('config-changelog').value = d.changelog || '';
            document.getElementById('config-required').checked = !!d.required;
        }
        const linksDoc = await getDoc(doc(db, "app_config", "public_links"));
        if (linksDoc.exists()) {
            const l = linksDoc.data();
            document.getElementById('config-website-url').value = l.website_url || '';
            document.getElementById('config-privacy-url').value = l.privacy_url || '';
            document.getElementById('config-terms-url').value = l.terms_url || '';
            document.getElementById('config-support-url').value = l.support_url || '';
        }
    } catch (e) {
        console.error("Config load error:", e);
    }
}

document.getElementById('btn-save-config')?.addEventListener('click', async () => {
    const statusEl = document.getElementById('config-status');
    try {
        const version = document.getElementById('config-version').value.trim();
        await setDoc(doc(db, "app_config", "latest_update"), {
            version,
            download_url: document.getElementById('config-download-url').value.trim(),
            changelog: document.getElementById('config-changelog').value.trim(),
            required: document.getElementById('config-required').checked,
            updatedAt: serverTimestamp()
        }, { merge: true });
        await logAction('save_config', `version: ${version}`);
        statusEl.textContent = '✅ تم حفظ إعدادات التحديث';
        statusEl.style.color = 'var(--success)';
        toast('تم حفظ إعدادات التحديث', 'success');
        setTimeout(() => statusEl.textContent = '', 3000);
    } catch (e) {
        statusEl.textContent = 'خطأ: ' + e.message;
        statusEl.style.color = 'var(--error)';
        toast('فشل: ' + e.message, 'error');
    }
});

document.getElementById('btn-save-links')?.addEventListener('click', async () => {
    const statusEl = document.getElementById('links-status');
    try {
        await setDoc(doc(db, "app_config", "public_links"), {
            website_url: document.getElementById('config-website-url').value.trim(),
            privacy_url: document.getElementById('config-privacy-url').value.trim(),
            terms_url: document.getElementById('config-terms-url').value.trim(),
            support_url: document.getElementById('config-support-url').value.trim(),
            updatedAt: serverTimestamp()
        }, { merge: true });
        await logAction('save_links', '');
        statusEl.textContent = '✅ تم حفظ الروابط';
        statusEl.style.color = 'var(--success)';
        toast('تم حفظ الروابط', 'success');
        setTimeout(() => statusEl.textContent = '', 3000);
    } catch (e) {
        statusEl.textContent = 'خطأ: ' + e.message;
        statusEl.style.color = 'var(--error)';
        toast('فشل: ' + e.message, 'error');
    }
});

// ─── ESC closes modals ───
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        document.querySelectorAll('.modal-overlay:not(.hidden)').forEach(m => m.classList.add('hidden'));
    }
});

// ─── HELPERS ───
function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    const div = document.createElement('div');
    div.textContent = String(str);
    return div.innerHTML;
}

function formatDate(val) {
    if (!val) return '—';
    if (typeof val.toDate === 'function') return val.toDate().toLocaleString('ar-EG');
    if (val.seconds) return new Date(val.seconds * 1000).toLocaleString('ar-EG');
    const d = new Date(val);
    return isNaN(d.getTime()) ? '—' : d.toLocaleString('ar-EG');
}
