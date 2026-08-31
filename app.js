// =============================================================
// LEDO · COMMAND CENTER
// Premium admin dashboard application
// =============================================================

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth,
  signInWithEmailAndPassword,
  onAuthStateChanged,
  signOut,
  setPersistence,
  browserLocalPersistence,
  inMemoryPersistence,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore,
  collection,
  query,
  orderBy,
  limit,
  onSnapshot,
  doc,
  updateDoc,
  addDoc,
  serverTimestamp,
  getDocs,
  getDoc,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// ============== CONFIG ==============
const firebaseConfig = {
  apiKey: "AIzaSyBWZx5WdJ8dJoI8nZlU1eA-OnOk91gj8Xk",
  authDomain: "group-a0ee4.firebaseapp.com",
  projectId: "group-a0ee4",
  storageBucket: "group-a0ee4.firebasestorage.app",
  messagingSenderId: "519444570577",
  appId: "1:519444570577:web:3a55d7010192e2ac2740f0",
  measurementId: "G-9TXCQ06MJM",
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// ============== STATE ==============
const state = {
  tickets: [],
  crashes: [],
  currentUser: null,
  currentRoute: "overview",
  statusFilter: "all",
  searchQuery: "",
  userSort: "tickets",
  userSearch: "",
  ticketsRange: 14,
  selectedTicket: null,
  charts: {},
  unsubscribers: [],
  firstTicketsLoad: true,
  firstCrashesLoad: true,
};

// ============== DOM HELPERS ==============
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const fmt = {
  date(ts) {
    if (!ts) return "—";
    const d = ts.toDate ? ts.toDate() : new Date(ts);
    return d.toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  },
  timeAgo(ts) {
    if (!ts) return "—";
    const d = ts.toDate ? ts.toDate() : new Date(ts);
    const diff = (Date.now() - d.getTime()) / 1000;
    if (diff < 60) return "just now";
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
    return d.toLocaleDateString();
  },
  initials(str) {
    if (!str) return "?";
    const parts = str.split(/[\s@.]+/).filter(Boolean);
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    return str.slice(0, 2).toUpperCase();
  },
  emailLocal(email) {
    if (!email) return "—";
    return email.split("@")[0] || email;
  },
  escape(str) {
    if (str == null) return "";
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  },
};

// ============== TOAST ==============
const TOAST_ICONS = {
  success: "check",
  error: "alert-circle",
  warning: "alert-triangle",
  info: "info",
};

function toast({ title = "", message = "", type = "info", duration = 3500 }) {
  const root = $("#toast-root");
  const el = document.createElement("div");
  el.className = `toast ${type}`;
  el.innerHTML = `
    <div class="toast-icon"><i data-lucide="${TOAST_ICONS[type] || "info"}"></i></div>
    <div class="toast-body">
      ${title ? `<div class="toast-title">${fmt.escape(title)}</div>` : ""}
      ${message ? `<div class="toast-msg">${fmt.escape(message)}</div>` : ""}
    </div>
    <button class="toast-close" aria-label="Dismiss"><i data-lucide="x"></i></button>
  `;
  root.appendChild(el);
  refreshIcons();
  const remove = () => {
    el.classList.add("leaving");
    setTimeout(() => el.remove(), 300);
  };
  $(".toast-close", el).addEventListener("click", remove);
  setTimeout(remove, duration);
}

function refreshIcons() {
  if (window.lucide && typeof window.lucide.createIcons === "function") {
    window.lucide.createIcons();
  }
}

// ============== ICONS ==============
function initIcons() {
  refreshIcons();
}

// ============== THEME ==============
function initTheme() {
  const saved = localStorage.getItem("ledo-theme") || "dark";
  document.documentElement.setAttribute("data-theme", saved);
  updateThemeUI(saved);
}

function setTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  localStorage.setItem("ledo-theme", theme);
  updateThemeUI(theme);
  // Re-render charts with new colors
  renderAllCharts();
}

function updateThemeUI(theme) {
  $$("#theme-seg .seg-btn").forEach((b) => {
    b.classList.toggle("active", b.dataset.theme === theme);
  });
  const icon = $("#theme-toggle i");
  if (icon) {
    icon.setAttribute("data-lucide", theme === "dark" ? "sun" : "moon");
    refreshIcons();
  }
}

// ============== COMPACT / ANIM ==============
function initPrefs() {
  const compact = localStorage.getItem("ledo-compact") === "1";
  const anim = localStorage.getItem("ledo-anim") !== "0";
  if (compact) {
    document.body.classList.add("compact");
    $("#compact-mode").checked = true;
  }
  if (!anim) {
    document.body.classList.add("no-anim");
    $("#anim-toggle").checked = false;
  }
}

// ============== AUTH ==============
async function initAuth() {
  // Use in-memory persistence if "remember me" is unchecked
  onAuthStateChanged(auth, async (user) => {
    if (user) {
      state.currentUser = user;
      showDashboard();
      updateAdminInfo();
      await loadAllData();
    } else {
      state.currentUser = null;
      showLogin();
      cleanupListeners();
    }
  });
}

function showLogin() {
  $("#login-view").hidden = false;
  $("#dashboard-view").hidden = true;
  setTimeout(() => $("#admin-email")?.focus(), 100);
}

function showDashboard() {
  $("#login-view").hidden = true;
  $("#dashboard-view").hidden = false;
  refreshIcons();
  navigateTo(state.currentRoute);
}

function updateAdminInfo() {
  if (!state.currentUser) return;
  const name = state.currentUser.displayName || fmt.emailLocal(state.currentUser.email) || "Admin";
  const initial = name.charAt(0).toUpperCase();
  $("#admin-avatar").textContent = initial;
  $("#admin-name").textContent = name;
  $("#admin-role").textContent = state.currentUser.email || "Administrator";
  $("#settings-avatar").textContent = initial;
  $("#settings-name").textContent = name;
  $("#settings-email").textContent = state.currentUser.email || "—";
}

async function login(email, password, remember) {
  try {
    await setPersistence(auth, remember ? browserLocalPersistence : inMemoryPersistence);
    await signInWithEmailAndPassword(auth, email, password);
    toast({ type: "success", title: "Welcome back", message: "Signed in successfully" });
  } catch (e) {
    let msg = "Invalid email or password.";
    if (e.code === "auth/invalid-email") msg = "Please enter a valid email.";
    if (e.code === "auth/too-many-requests") msg = "Too many attempts. Try again later.";
    if (e.code === "auth/network-request-failed") msg = "Network error. Check your connection.";
    toast({ type: "error", title: "Sign in failed", message: msg });
    throw e;
  }
}

async function logout() {
  try {
    cleanupListeners();
    await signOut(auth);
    toast({ type: "info", title: "Signed out", message: "See you soon!" });
  } catch (e) {
    console.error(e);
    toast({ type: "error", title: "Sign out failed", message: e.message });
  }
}

// ============== ROUTER ==============
function navigateTo(route) {
  state.currentRoute = route;
  $$(".route").forEach((el) => {
    el.hidden = el.dataset.route !== route;
  });
  $$(".nav-item").forEach((el) => {
    el.classList.toggle("active", el.dataset.route === route);
  });
  const titles = {
    overview: ["Overview", "Welcome back — here's what's happening today"],
    tickets: ["Tickets", "Manage and respond to user support tickets"],
    users: ["Users", "All users who have contacted support"],
    crashes: ["Crash Reports", "Application crash telemetry"],
    analytics: ["Analytics", "Insights and platform performance"],
    settings: ["Settings", "Customize your admin experience"],
  };
  const [t, s] = titles[route] || ["Ledo", ""];
  $("#page-title").textContent = t;
  $("#page-sub").textContent = s;
  if (location.hash !== `#${route}`) {
    history.replaceState(null, "", `#${route}`);
  }
  // Close mobile sidebar
  $("#sidebar")?.classList.remove("open");
}

function initRouter() {
  $$(".nav-item, [data-route]").forEach((el) => {
    el.addEventListener("click", (e) => {
      const route = el.dataset.route;
      if (!route) return;
      e.preventDefault();
      navigateTo(route);
    });
  });
  window.addEventListener("hashchange", () => {
    const route = location.hash.replace("#", "") || "overview";
    navigateTo(route);
  });
  const initial = location.hash.replace("#", "") || "overview";
  navigateTo(initial);
}

// ============== DATA ==============
function cleanupListeners() {
  state.unsubscribers.forEach((u) => u && u());
  state.unsubscribers = [];
  state.tickets = [];
  state.crashes = [];
  state.firstTicketsLoad = true;
  state.firstCrashesLoad = true;
}

async function loadAllData() {
  subscribeTickets();
  subscribeCrashes();
}

function subscribeTickets() {
  if (!state.currentUser) return;
  const q = query(collection(db, "support_tickets"), orderBy("createdAt", "desc"), limit(500));
  const unsub = onSnapshot(
    q,
    (snapshot) => {
      state.tickets = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
      state.firstTicketsLoad = false;
      onTicketsUpdate();
    },
    (err) => {
      console.error("Tickets error:", err);
      if (err.code === "permission-denied") {
        toast({
          type: "error",
          title: "Permission denied",
          message: "Your account doesn't have admin access. Update Firestore rules or sign in as admin.",
          duration: 7000,
        });
      } else {
        toast({ type: "error", title: "Failed to load tickets", message: err.message });
      }
      state.firstTicketsLoad = false;
      onTicketsUpdate();
    }
  );
  state.unsubscribers.push(unsub);
}

function subscribeCrashes() {
  if (!state.currentUser) return;
  const q = query(collection(db, "crash_reports"), orderBy("createdAt", "desc"), limit(200));
  const unsub = onSnapshot(
    q,
    (snapshot) => {
      state.crashes = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
      state.firstCrashesLoad = false;
      onCrashesUpdate();
    },
    (err) => {
      console.error("Crashes error:", err);
      state.firstCrashesLoad = false;
      onCrashesUpdate();
    }
  );
  state.unsubscribers.push(unsub);
}

function onTicketsUpdate() {
  renderKpis();
  renderRecentActivity();
  renderTickets();
  renderUsers();
  renderAnalytics();
  renderTopSubjects();
  renderNotifications();
  if (state.charts.timeline) updateTimelineChart();
  if (state.charts.status) updateStatusChart();
  if (state.charts.daily) updateDailyChart();
}

function onCrashesUpdate() {
  renderCrashes();
}

// ============== KPIs ==============
function renderKpis() {
  const stats = {
    total: state.tickets.length,
    open: state.tickets.filter((t) => (t.status || "open") === "open").length,
    progress: state.tickets.filter((t) => t.status === "in_progress").length,
    resolved: state.tickets.filter((t) => t.status === "resolved").length,
  };
  $$("[data-kpi]").forEach((el) => {
    const key = el.dataset.kpi;
    animateNumber(el, stats[key] || 0);
  });
  // Update chip counts
  $$("[data-count]").forEach((el) => {
    const key = el.dataset.count;
    el.textContent = stats[key] || 0;
  });
  $("#tickets-count").textContent = stats.open;
}

function animateNumber(el, target) {
  const current = parseInt(el.textContent.replace(/\D/g, "")) || 0;
  if (current === target) return;
  const duration = 600;
  const start = performance.now();
  const step = (now) => {
    const t = Math.min(1, (now - start) / duration);
    const eased = 1 - Math.pow(1 - t, 3);
    el.textContent = Math.round(current + (target - current) * eased);
    if (t < 1) requestAnimationFrame(step);
    else el.textContent = target;
  };
  requestAnimationFrame(step);
}

// ============== RECENT ACTIVITY ==============
function renderRecentActivity() {
  const root = $("#recent-activity");
  if (state.firstTicketsLoad) return;
  const recent = state.tickets.slice(0, 5);
  if (recent.length === 0) {
    root.innerHTML = `<div class="muted center pad">No tickets yet. They'll appear here when users reach out.</div>`;
    return;
  }
  root.innerHTML = recent
    .map(
      (t) => `
      <div class="activity-row" data-ticket="${t.id}">
        <div class="activity-avatar">${fmt.escape(fmt.initials(t.email || "U"))}</div>
        <div class="activity-body">
          <div class="activity-title">${fmt.escape(t.subject || "Untitled")}</div>
          <div class="activity-meta">
            <span>${fmt.escape(t.email || "Anonymous")}</span>
            <span class="dot"></span>
            <span>${fmt.timeAgo(t.createdAt)}</span>
            <span class="dot"></span>
            <span class="status-badge ${fmt.escape(t.status || "open")}">${fmt.escape(
        (t.status || "open").replace("_", " ")
      )}</span>
          </div>
        </div>
        <i data-lucide="chevron-right" style="color:var(--muted)"></i>
      </div>
    `
    )
    .join("");
  refreshIcons();
  $$(".activity-row", root).forEach((row) => {
    row.addEventListener("click", () => {
      const id = row.dataset.ticket;
      const ticket = state.tickets.find((t) => t.id === id);
      if (ticket) openTicketModal(ticket);
    });
  });
}

// ============== TICKETS ==============
function renderTickets() {
  const tbody = $("#tickets-tbody");
  if (state.firstTicketsLoad) {
    tbody.innerHTML = `<tr><td colspan="5" class="empty">Loading tickets…</td></tr>`;
    return;
  }
  const filter = state.statusFilter;
  const q = state.searchQuery.toLowerCase();
  let list = state.tickets.filter((t) => {
    if (filter !== "all" && (t.status || "open") !== filter) return false;
    if (!q) return true;
    return (
      (t.subject || "").toLowerCase().includes(q) ||
      (t.email || "").toLowerCase().includes(q) ||
      (t.message || "").toLowerCase().includes(q)
    );
  });
  $("#tickets-summary").textContent = `Showing ${list.length} of ${state.tickets.length} tickets`;

  if (list.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" class="empty">${
      state.tickets.length === 0
        ? "No tickets yet."
        : "No tickets match the current filters."
    }</td></tr>`;
    return;
  }

  tbody.innerHTML = list
    .map(
      (t) => `
      <tr data-ticket="${t.id}">
        <td><span class="status-badge ${fmt.escape(t.status || "open")}">
          <span class="dot dot-${getStatusDot(t.status)}"></span>
          ${fmt.escape((t.status || "open").replace("_", " "))}
        </span></td>
        <td>
          <div class="row-subject">${fmt.escape(t.subject || "Untitled")}</div>
          <div class="row-msg">${fmt.escape(t.message || "")}</div>
        </td>
        <td>
          <div class="row-user">
            <div class="row-avatar">${fmt.escape(fmt.initials(t.email || "U"))}</div>
            <div class="row-email">${fmt.escape(t.email || "—")}</div>
          </div>
        </td>
        <td><div class="row-time">${fmt.timeAgo(t.createdAt)}</div></td>
        <td class="t-right">
          <div class="row-actions">
            <button class="row-btn" data-action="view" title="View">
              <i data-lucide="eye"></i>
            </button>
            <button class="row-btn" data-action="reply" title="Reply">
              <i data-lucide="message-square"></i>
            </button>
          </div>
        </td>
      </tr>
    `
    )
    .join("");
  refreshIcons();

  $$("#tickets-tbody tr[data-ticket]").forEach((row) => {
    const id = row.dataset.ticket;
    const ticket = state.tickets.find((t) => t.id === id);
    if (!ticket) return;
    row.addEventListener("click", (e) => {
      const action = e.target.closest("[data-action]")?.dataset.action;
      if (action === "reply") {
        // focus reply
        openTicketModal(ticket, true);
      } else {
        openTicketModal(ticket);
      }
    });
  });
}

function getStatusDot(status) {
  if (status === "in_progress") return "progress";
  if (status === "resolved") return "resolved";
  return "open";
}

// ============== USERS ==============
function renderUsers() {
  const grid = $("#users-grid");
  if (state.firstTicketsLoad) return;
  const map = new Map();
  state.tickets.forEach((t) => {
    const key = t.userId || t.email || "anonymous";
    if (!map.has(key)) {
      map.set(key, {
        id: key,
        email: t.email || "Anonymous",
        tickets: 0,
        lastActivity: t.createdAt,
      });
    }
    const u = map.get(key);
    u.tickets++;
    if (t.createdAt && (!u.lastActivity || (t.createdAt.seconds || 0) > (u.lastActivity.seconds || 0))) {
      u.lastActivity = t.createdAt;
    }
  });
  let users = Array.from(map.values());
  const q = state.userSearch.toLowerCase();
  if (q) users = users.filter((u) => (u.email || "").toLowerCase().includes(q));
  if (state.userSort === "tickets") users.sort((a, b) => b.tickets - a.tickets);
  else if (state.userSort === "recent")
    users.sort(
      (a, b) => (b.lastActivity?.seconds || 0) - (a.lastActivity?.seconds || 0)
    );
  else if (state.userSort === "alpha")
    users.sort((a, b) => (a.email || "").localeCompare(b.email || ""));

  if (users.length === 0) {
    grid.innerHTML = `<div class="muted center pad" style="grid-column:1/-1">${
      state.tickets.length === 0
        ? "No users yet."
        : "No users match the current search."
    }</div>`;
    return;
  }

  grid.innerHTML = users
    .map(
      (u) => `
      <div class="user-card" data-user="${fmt.escape(u.id)}">
        <div class="row-avatar" style="width:50px;height:50px;font-size:18px;border-radius:14px">${fmt.escape(
          fmt.initials(u.email)
        )}</div>
        <div class="user-card-info">
          <div class="user-card-name">${fmt.escape(fmt.emailLocal(u.email))}</div>
          <div class="user-card-email">${fmt.escape(u.email)}</div>
        </div>
        <div class="user-card-stats">
          <div class="user-stat">
            <div class="user-stat-label">Tickets</div>
            <div class="user-stat-value">${u.tickets}</div>
          </div>
          <div class="user-stat">
            <div class="user-stat-label">Last seen</div>
            <div class="user-stat-value" style="font-size:13px">${fmt.timeAgo(u.lastActivity)}</div>
          </div>
        </div>
      </div>
    `
    )
    .join("");
  $$(".user-card", grid).forEach((card) => {
    card.addEventListener("click", () => {
      navigateTo("tickets");
    });
  });
}

// ============== CRASHES ==============
function renderCrashes() {
  const tbody = $("#crashes-tbody");
  if (state.firstCrashesLoad) {
    tbody.innerHTML = `<tr><td colspan="4" class="empty">Loading crash reports…</td></tr>`;
    return;
  }
  if (state.crashes.length === 0) {
    tbody.innerHTML = `<tr><td colspan="4" class="empty">No crash reports. 🎉</td></tr>`;
    return;
  }
  tbody.innerHTML = state.crashes
    .map(
      (c) => `
      <tr>
        <td><div class="row-time">${fmt.timeAgo(c.createdAt)}</div></td>
        <td><div class="row-email">${fmt.escape(c.email || "—")}</div></td>
        <td><div class="row-subject">${fmt.escape(c.subject || "—")}</div></td>
        <td><div class="row-msg" style="max-width:340px">${fmt.escape(c.message || "—")}</div></td>
      </tr>
    `
    )
    .join("");
}

// ============== ANALYTICS ==============
function renderAnalytics() {
  // resolution rate
  const total = state.tickets.length;
  const resolved = state.tickets.filter((t) => t.status === "resolved").length;
  const rate = total ? Math.round((resolved / total) * 100) : 0;
  $("#perf-resolve").textContent = `${rate}%`;
  // unique users
  const users = new Set(state.tickets.map((t) => t.userId || t.email).filter(Boolean));
  $("#perf-users").textContent = users.size;
  // tickets today
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const today = state.tickets.filter((t) => {
    const d = t.createdAt?.toDate ? t.createdAt.toDate() : new Date(t.createdAt);
    return d >= todayStart;
  }).length;
  $("#perf-today").textContent = today;
  // response time (avg from open to first reply / status change) — placeholder
  $("#perf-response").textContent = "—";
}

function renderTopSubjects() {
  const root = $("#top-subjects");
  if (!root) return;
  if (state.firstTicketsLoad) return;
  const counts = new Map();
  state.tickets.forEach((t) => {
    const sub = (t.subject || "Untitled").trim();
    counts.set(sub, (counts.get(sub) || 0) + 1);
  });
  const top = Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6);
  const max = top[0]?.[1] || 1;
  if (top.length === 0) {
    root.innerHTML = `<div class="muted center pad">No data yet</div>`;
    return;
  }
  root.innerHTML = top
    .map(
      ([sub, count]) => `
      <div class="bar-item">
        <div class="bar-head">
          <div class="bar-name">${fmt.escape(sub)}</div>
          <div class="bar-val">${count}</div>
        </div>
        <div class="bar-track"><div class="bar-fill" style="width: ${(count / max) * 100}%"></div></div>
      </div>
    `
    )
    .join("");
}

// ============== CHARTS ==============
function getChartTheme() {
  const theme = document.documentElement.getAttribute("data-theme");
  if (theme === "light") {
    return {
      text: "#475569",
      grid: "rgba(15,23,42,0.08)",
      bg: "transparent",
    };
  }
  return {
    text: "#8b91a7",
    grid: "rgba(255,255,255,0.06)",
    bg: "transparent",
  };
}

function getGradient(ctx, color1, color2) {
  const gradient = ctx.createLinearGradient(0, 0, 0, 280);
  gradient.addColorStop(0, color1);
  gradient.addColorStop(1, color2);
  return gradient;
}

function buildTimelineData(range) {
  const days = range;
  const buckets = new Array(days).fill(0);
  const labels = [];
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    labels.push(d.toLocaleDateString("en-US", { month: "short", day: "numeric" }));
  }
  state.tickets.forEach((t) => {
    if (!t.createdAt) return;
    const d = t.createdAt.toDate ? t.createdAt.toDate() : new Date(t.createdAt);
    const daysAgo = Math.floor((now - new Date(d.getFullYear(), d.getMonth(), d.getDate())) / 86400000);
    if (daysAgo >= 0 && daysAgo < days) {
      buckets[days - 1 - daysAgo]++;
    }
  });
  return { labels, data: buckets };
}

function renderTimelineChart() {
  const ctx = $("#chart-timeline")?.getContext("2d");
  if (!ctx) return;
  const theme = getChartTheme();
  const { labels, data } = buildTimelineData(state.ticketsRange);
  const gradient = getGradient(ctx, "rgba(99,102,241,0.4)", "rgba(99,102,241,0)");
  const gradient2 = getGradient(ctx, "rgba(236,72,153,0.4)", "rgba(236,72,153,0)");
  if (state.charts.timeline) state.charts.timeline.destroy();
  state.charts.timeline = new Chart(ctx, {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          label: "Open",
          data,
          borderColor: "#6366f1",
          backgroundColor: gradient,
          borderWidth: 2.5,
          fill: true,
          tension: 0.4,
          pointRadius: 0,
          pointHoverRadius: 6,
          pointHoverBackgroundColor: "#6366f1",
          pointHoverBorderColor: "#fff",
          pointHoverBorderWidth: 2,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: "#0b0d1a",
          titleColor: "#f1f3f9",
          bodyColor: "#c6cad8",
          borderColor: "rgba(255,255,255,0.1)",
          borderWidth: 1,
          padding: 10,
          cornerRadius: 8,
          displayColors: false,
        },
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: { color: theme.text, font: { size: 11 } },
          border: { display: false },
        },
        y: {
          grid: { color: theme.grid, drawBorder: false },
          ticks: { color: theme.text, font: { size: 11 }, stepSize: 1 },
          border: { display: false },
          beginAtZero: true,
        },
      },
    },
  });
}

function updateTimelineChart() {
  if (!state.charts.timeline) return;
  const { labels, data } = buildTimelineData(state.ticketsRange);
  state.charts.timeline.data.labels = labels;
  state.charts.timeline.data.datasets[0].data = data;
  state.charts.timeline.update("none");
}

function renderStatusChart() {
  const ctx = $("#chart-status")?.getContext("2d");
  if (!ctx) return;
  const theme = getChartTheme();
  const counts = {
    open: state.tickets.filter((t) => (t.status || "open") === "open").length,
    in_progress: state.tickets.filter((t) => t.status === "in_progress").length,
    resolved: state.tickets.filter((t) => t.status === "resolved").length,
  };
  if (state.charts.status) state.charts.status.destroy();
  state.charts.status = new Chart(ctx, {
    type: "doughnut",
    data: {
      labels: ["Open", "In Progress", "Resolved"],
      datasets: [
        {
          data: [counts.open, counts.in_progress, counts.resolved],
          backgroundColor: ["#f59e0b", "#06b6d4", "#10b981"],
          borderColor: "transparent",
          borderWidth: 0,
          hoverOffset: 8,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: "70%",
      plugins: {
        legend: {
          position: "bottom",
          labels: {
            color: theme.text,
            padding: 14,
            usePointStyle: true,
            pointStyle: "circle",
            font: { size: 12, family: "Outfit" },
          },
        },
        tooltip: {
          backgroundColor: "#0b0d1a",
          titleColor: "#f1f3f9",
          bodyColor: "#c6cad8",
          borderColor: "rgba(255,255,255,0.1)",
          borderWidth: 1,
          padding: 10,
          cornerRadius: 8,
        },
      },
    },
  });
}

function updateStatusChart() {
  if (!state.charts.status) return;
  const counts = {
    open: state.tickets.filter((t) => (t.status || "open") === "open").length,
    in_progress: state.tickets.filter((t) => t.status === "in_progress").length,
    resolved: state.tickets.filter((t) => t.status === "resolved").length,
  };
  state.charts.status.data.datasets[0].data = [counts.open, counts.in_progress, counts.resolved];
  state.charts.status.update("none");
}

function renderDailyChart() {
  const ctx = $("#chart-daily")?.getContext("2d");
  if (!ctx) return;
  const theme = getChartTheme();
  const { labels, data } = buildTimelineData(30);
  if (state.charts.daily) state.charts.daily.destroy();
  state.charts.daily = new Chart(ctx, {
    type: "bar",
    data: {
      labels,
      datasets: [
        {
          label: "Tickets",
          data,
          backgroundColor: (c) => {
            const { ctx } = c.chart;
            const g = ctx.createLinearGradient(0, 0, 0, 280);
            g.addColorStop(0, "#6366f1");
            g.addColorStop(1, "#8b5cf6");
            return g;
          },
          borderRadius: 6,
          borderSkipped: false,
          maxBarThickness: 18,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: "#0b0d1a",
          titleColor: "#f1f3f9",
          bodyColor: "#c6cad8",
          borderColor: "rgba(255,255,255,0.1)",
          borderWidth: 1,
          padding: 10,
          cornerRadius: 8,
        },
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: { color: theme.text, font: { size: 10 }, maxRotation: 0, autoSkip: true, maxTicksLimit: 8 },
          border: { display: false },
        },
        y: {
          grid: { color: theme.grid, drawBorder: false },
          ticks: { color: theme.text, font: { size: 11 }, stepSize: 1 },
          border: { display: false },
          beginAtZero: true,
        },
      },
    },
  });
}

function updateDailyChart() {
  if (!state.charts.daily) return;
  const { labels, data } = buildTimelineData(30);
  state.charts.daily.data.labels = labels;
  state.charts.daily.data.datasets[0].data = data;
  state.charts.daily.update("none");
}

function renderAllCharts() {
  renderTimelineChart();
  renderStatusChart();
  renderDailyChart();
}

// ============== TICKET MODAL ==============
function openTicketModal(ticket, focusReply = false) {
  state.selectedTicket = ticket;
  $("#modal-subject").textContent = ticket.subject || "Untitled";
  $("#modal-email").textContent = ticket.email || "—";
  $("#modal-time").textContent = fmt.date(ticket.createdAt);
  $("#modal-userid").textContent = ticket.userId || "guest";
  $("#modal-message").textContent = ticket.message || "—";
  $("#reply-target").textContent = ticket.email || "user";
  $("#modal-reply").value = "";

  // Status pill
  const status = ticket.status || "open";
  const pill = $("#modal-status-pill");
  pill.className = `status-pill sm status-${status}`;
  pill.innerHTML = `<span class="dot dot-${getStatusDot(status)}"></span><span>${status.replace(
    "_",
    " "
  )}</span>`;

  // Status buttons
  $$(".status-btn").forEach((b) => {
    b.classList.toggle("active", b.dataset.status === status);
  });

  $("#ticket-modal").hidden = false;
  setTimeout(() => {
    if (focusReply) $("#modal-reply").focus();
  }, 100);
}

function closeTicketModal() {
  $("#ticket-modal").hidden = true;
  state.selectedTicket = null;
}

async function updateTicketStatus(status) {
  if (!state.selectedTicket) return;
  try {
    await updateDoc(doc(db, "support_tickets", state.selectedTicket.id), {
      status,
      updatedAt: serverTimestamp(),
    });
    toast({ type: "success", title: "Status updated", message: `Ticket is now ${status.replace("_", " ")}` });
  } catch (e) {
    console.error(e);
    toast({ type: "error", title: "Update failed", message: e.message });
  }
}

async function sendReply() {
  if (!state.selectedTicket) return;
  const text = $("#modal-reply").value.trim();
  if (!text) {
    toast({ type: "warning", title: "Empty reply", message: "Write something to send." });
    return;
  }
  if (!state.selectedTicket.userId) {
    toast({
      type: "warning",
      title: "Cannot reply",
      message: "This ticket has no user ID (guest). Update Firestore rules to allow sending to anonymous users.",
    });
    return;
  }
  const btn = $("#btn-send-reply");
  btn.disabled = true;
  btn.querySelector("span").textContent = "Sending…";
  try {
    await addDoc(collection(db, `users/${state.selectedTicket.userId}/messages`), {
      text,
      fromAdmin: true,
      createdAt: serverTimestamp(),
    });
    // mark ticket as in_progress if open
    if ((state.selectedTicket.status || "open") === "open") {
      await updateDoc(doc(db, "support_tickets", state.selectedTicket.id), {
        status: "in_progress",
        updatedAt: serverTimestamp(),
      });
    }
    toast({ type: "success", title: "Reply sent", message: "User will be notified in their inbox." });
    closeTicketModal();
  } catch (e) {
    console.error(e);
    toast({ type: "error", title: "Send failed", message: e.message });
  } finally {
    btn.disabled = false;
    btn.querySelector("span").textContent = "Send reply";
  }
}

// ============== NOTIFICATIONS ==============
function renderNotifications() {
  const list = $("#notif-list");
  const recent = state.tickets.slice(0, 8);
  if (recent.length === 0) {
    list.innerHTML = `<div class="muted center pad">No new notifications</div>`;
    $("#notif-dot").hidden = true;
    return;
  }
  $("#notif-dot").hidden = false;
  list.innerHTML = recent
    .map(
      (t) => `
      <div class="notif-item" data-ticket="${t.id}">
        <div class="notif-dot"></div>
        <div class="notif-body">
          <div class="notif-title">${fmt.escape(t.subject || "New ticket")}</div>
          <div class="notif-desc">${fmt.escape(t.email || "Anonymous")}</div>
          <div class="notif-time">${fmt.timeAgo(t.createdAt)}</div>
        </div>
      </div>
    `
    )
    .join("");
  $$(".notif-item", list).forEach((el) => {
    el.addEventListener("click", () => {
      const ticket = state.tickets.find((t) => t.id === el.dataset.ticket);
      if (ticket) {
        openTicketModal(ticket);
        closeDrawer();
      }
    });
  });
}

function openDrawer() {
  $("#notif-drawer").hidden = false;
  refreshIcons();
}
function closeDrawer() {
  $("#notif-drawer").hidden = true;
}

// ============== EVENT WIRING ==============
function wireEvents() {
  // Login
  $("#login-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = $("#admin-email").value.trim();
    const pwd = $("#admin-password").value;
    const remember = $("#remember-me").checked;
    if (!email || !pwd) {
      toast({ type: "warning", title: "Missing fields", message: "Enter both email and password." });
      return;
    }
    const btn = $("#btn-login");
    btn.disabled = true;
    btn.querySelector("span").textContent = "Signing in…";
    try {
      await login(email, pwd, remember);
    } catch {
      // already toasted
    } finally {
      btn.disabled = false;
      btn.querySelector("span").textContent = "Sign in";
    }
  });

  // Password reveal
  $$("[data-toggle-pwd]").forEach((b) => {
    b.addEventListener("click", () => {
      const id = b.dataset.togglePwd;
      const input = document.getElementById(id);
      const isPwd = input.type === "password";
      input.type = isPwd ? "text" : "password";
      b.querySelector("i").setAttribute("data-lucide", isPwd ? "eye-off" : "eye");
      refreshIcons();
    });
  });

  // Logout
  $("#btn-logout").addEventListener("click", logout);
  $("#btn-logout-2")?.addEventListener("click", logout);

  // Sidebar collapse
  $("#collapse-sidebar").addEventListener("click", () => {
    $("#dashboard-view").classList.toggle("collapsed");
  });
  // Mobile menu
  $("#mobile-menu").addEventListener("click", () => {
    $("#sidebar").classList.toggle("open");
  });

  // Theme toggle
  $("#theme-toggle").addEventListener("click", () => {
    const current = document.documentElement.getAttribute("data-theme");
    setTheme(current === "dark" ? "light" : "dark");
  });
  $$("#theme-seg .seg-btn").forEach((b) => {
    b.addEventListener("click", () => setTheme(b.dataset.theme));
  });

  // Compact / anim
  $("#compact-mode").addEventListener("change", (e) => {
    document.body.classList.toggle("compact", e.target.checked);
    localStorage.setItem("ledo-compact", e.target.checked ? "1" : "0");
  });
  $("#anim-toggle").addEventListener("change", (e) => {
    document.body.classList.toggle("no-anim", !e.target.checked);
    localStorage.setItem("ledo-anim", e.target.checked ? "1" : "0");
  });

  // Filters
  $$("#status-filters .chip").forEach((c) => {
    c.addEventListener("click", () => {
      $$("#status-filters .chip").forEach((x) => x.classList.remove("active"));
      c.classList.add("active");
      state.statusFilter = c.dataset.filter;
      renderTickets();
    });
  });
  // User sort
  $$("[data-usersort]").forEach((c) => {
    c.addEventListener("click", () => {
      $$("[data-usersort]").forEach((x) => x.classList.remove("active"));
      c.classList.add("active");
      state.userSort = c.dataset.usersort;
      renderUsers();
    });
  });

  // Search
  $("#ticket-search").addEventListener("input", (e) => {
    state.searchQuery = e.target.value;
    renderTickets();
  });
  $("#user-search").addEventListener("input", (e) => {
    state.userSearch = e.target.value;
    renderUsers();
  });
  $("#global-search").addEventListener("input", (e) => {
    const v = e.target.value;
    state.searchQuery = v;
    state.userSearch = v;
    if (state.currentRoute !== "tickets" && state.currentRoute !== "users") {
      navigateTo("tickets");
    }
    renderTickets();
    renderUsers();
  });

  // Range
  $$("#range-seg .seg-btn").forEach((b) => {
    b.addEventListener("click", () => {
      $$("#range-seg .seg-btn").forEach((x) => x.classList.remove("active"));
      b.classList.add("active");
      state.ticketsRange = parseInt(b.dataset.range) || 14;
      renderTimelineChart();
    });
  });

  // Modal close
  $$("#ticket-modal [data-close]").forEach((el) =>
    el.addEventListener("click", closeTicketModal)
  );
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      if (!$("#ticket-modal").hidden) closeTicketModal();
      if (!$("#notif-drawer").hidden) closeDrawer();
    }
  });

  // Status update
  $$(".status-btn").forEach((b) => {
    b.addEventListener("click", () => updateTicketStatus(b.dataset.status));
  });

  // Reply
  $("#btn-send-reply").addEventListener("click", sendReply);
  $("#btn-reply-template").addEventListener("click", () => {
    const t = state.selectedTicket;
    if (!t) return;
    $("#modal-reply").value = `Hi,\n\nThanks for reaching out about "${t.subject || "your issue"}". We're looking into it and will get back to you shortly.\n\nBest,\nLedo Support`;
    $("#modal-reply").focus();
  });

  // Notifications drawer
  $("#notif-btn").addEventListener("click", openDrawer);
  $$("[data-close-drawer]").forEach((el) => el.addEventListener("click", closeDrawer));

  // Keyboard: Cmd/Ctrl+K to focus search
  document.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
      e.preventDefault();
      $("#global-search").focus();
    }
  });
}

// ============== INIT ==============
function init() {
  initTheme();
  initPrefs();
  initIcons();
  initRouter();
  wireEvents();
  initAuth();
}

document.addEventListener("DOMContentLoaded", init);

// Expose for debugging
window.__ledo = { state, db, auth };
