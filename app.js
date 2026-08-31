import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore, collection, query, orderBy, limit, onSnapshot } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyBWZx5WdJ8dJoI8nZlU1eA-OnOk91gj8Xk",
  authDomain: "group-a0ee4.firebaseapp.com",
  projectId: "group-a0ee4",
  storageBucket: "group-a0ee4.firebasestorage.app",
  messagingSenderId: "519444570577",
  appId: "1:519444570577:web:3a55d7010192e2ac2740f0",
  measurementId: "G-9TXCQ06MJM"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// DOM Elements
const loginView = document.getElementById('login-view');
const dashboardView = document.getElementById('dashboard-view');
const btnLogin = document.getElementById('btn-login');
const btnLogout = document.getElementById('btn-logout');
const adminEmailInput = document.getElementById('admin-email');
const adminPasswordInput = document.getElementById('admin-password');
const loginError = document.getElementById('login-error');
const crashTbody = document.getElementById('crash-tbody');

let unsubscribeReports = null;

onAuthStateChanged(auth, (user) => {
    if (user) {
        loginView.style.display = 'none';
        dashboardView.style.display = 'block';
        loadReports();
    } else {
        loginView.style.display = 'block';
        dashboardView.style.display = 'none';
        if (unsubscribeReports) unsubscribeReports();
    }
});

const loginForm = document.getElementById('login-form');

loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = adminEmailInput.value;
    const pwd = adminPasswordInput.value;
    if (!email || !pwd) {
        loginError.innerText = "Please enter both email and password.";
        return;
    }
    
    loginError.innerText = "Logging in...";
    try {
        await signInWithEmailAndPassword(auth, email, pwd);
        loginError.innerText = "";
        adminEmailInput.value = "";
        adminPasswordInput.value = "";
    } catch (e) {
        loginError.innerText = "Invalid admin credentials.";
        console.error(e);
    }
});

btnLogout.addEventListener('click', async () => {
    await signOut(auth);
});

function loadReports() {
    crashTbody.innerHTML = '<tr><td colspan="6" style="text-align: center;">Loading...</td></tr>';
    
    const q = query(collection(db, "support_tickets"), orderBy("createdAt", "desc"), limit(50));
    
    unsubscribeReports = onSnapshot(q, (snapshot) => {
        crashTbody.innerHTML = '';
        
        if (snapshot.empty) {
            crashTbody.innerHTML = '<tr><td colspan="6" style="text-align: center;">No tickets found.</td></tr>';
            return;
        }
        
        snapshot.forEach((doc) => {
            const data = doc.data();
            
            const tr = document.createElement('tr');
            
            const tdTime = document.createElement('td');
            tdTime.innerText = new Date(data.createdAt).toLocaleString();
            
            const tdEmail = document.createElement('td');
            tdEmail.innerHTML = `<span class="badge">${data.email || 'Unknown'}</span>`;
            
            const tdSub = document.createElement('td');
            tdSub.innerText = data.subject || 'N/A';
            
            const tdMsg = document.createElement('td');
            tdMsg.innerText = data.message || 'N/A';
            tdMsg.style.maxWidth = "250px";
            tdMsg.style.overflow = "hidden";
            tdMsg.style.textOverflow = "ellipsis";
            tdMsg.style.whiteSpace = "nowrap";
            tdMsg.title = data.message;
            
            const tdStatus = document.createElement('td');
            tdStatus.innerText = data.status || 'open';
            
            const tdAction = document.createElement('td');
            const replyBtn = document.createElement('button');
            replyBtn.className = 'btn btn-sm';
            replyBtn.innerText = 'Reply';
            replyBtn.onclick = () => openMessageModal(data.userId, data.subject);
            tdAction.appendChild(replyBtn);

            tr.appendChild(tdTime);
            tr.appendChild(tdEmail);
            tr.appendChild(tdSub);
            tr.appendChild(tdMsg);
            tr.appendChild(tdStatus);
            tr.appendChild(tdAction);
            
            crashTbody.appendChild(tr);
        });
    }, (error) => {
        console.error(error);
        crashTbody.innerHTML = '<tr><td colspan="6" style="text-align: center; color: red;">Error loading tickets (Check permissions)</td></tr>';
    });
}

// Modal Logic
let currentReplyUserId = null;
const modal = document.getElementById('message-modal');
const modalSubject = document.getElementById('modal-ticket-subject');
const modalMsgText = document.getElementById('modal-message-text');

function openMessageModal(userId, subject) {
    if (!userId) {
        alert("Cannot reply: User ID is missing (Guest user?).");
        return;
    }
    currentReplyUserId = userId;
    modalSubject.innerText = subject;
    modalMsgText.value = "";
    modal.style.display = "flex";
}

document.getElementById('btn-modal-cancel').addEventListener('click', () => {
    modal.style.display = "none";
});

document.getElementById('btn-modal-send').addEventListener('click', async () => {
    const text = modalMsgText.value.trim();
    if (!text || !currentReplyUserId) return;
    
    document.getElementById('btn-modal-send').innerText = "Sending...";
    document.getElementById('btn-modal-send').disabled = true;
    
    try {
        const { addDoc } = await import("https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js");
        await addDoc(collection(db, `users/${currentReplyUserId}/messages`), {
            text: text,
            createdAt: new Date().toISOString()
        });
        modal.style.display = "none";
    } catch (e) {
        console.error("Error sending message", e);
        alert("Failed to send message.");
    }
    
    document.getElementById('btn-modal-send').innerText = "Send Message";
    document.getElementById('btn-modal-send').disabled = false;
});
