const savedUserData = JSON.parse(localStorage.getItem('careerVibeUser'));
const isLoggedIn = localStorage.getItem('careerVibeSession') === 'true';

let state = {
    currentScreen: (isLoggedIn && savedUserData) ? 'profile' : 'login',
    theme: 'default',
    user: savedUserData || {
        name: 'Alex Johnson',
        degree: 'BCA',
        interests: ['Frontend', 'AI'],
        email: '',
        phone: '',
        headline: 'Aspiring professional',
        location: '',
        bio: '',
        profilePic: null,
        resumeName: null,
        languages: [],
        achievements: [],
        accomplishments: [],
        projects: '',
        internships: '',
        education: {
            class10: { school: '', board: '', year: '', score: '' },
            class12: { school: '', board: '', year: '', score: '' }
        }
    },
    selectedDegree: null,
    isMenuOpen: false,
    isProfileModalOpen: false,
    naukriJobs: {
        software: [],
        commerce: [],
        business: []
    },
    savedItems: JSON.parse(localStorage.getItem('careerVibeSaved')) || [],
    adminData: null,
    adminDataLoading: false
};

function saveToLocalStorage() {
    localStorage.setItem('careerVibeSaved', JSON.stringify(state.savedItems));
}

function saveUserToLocalStorage() {
    localStorage.setItem('careerVibeUser', JSON.stringify(state.user));
}

// ─── Analytics ──────────────────────────────────────────────────────────────
function getAnalytics() {
    return JSON.parse(localStorage.getItem('careerVibeAnalytics')) || {
        totalSessions: 0,
        pageViews: {},
        registeredUsers: [],
        loginHistory: []
    };
}
function saveAnalytics(data) {
    localStorage.setItem('careerVibeAnalytics', JSON.stringify(data));
}
function trackPageView(screen) {
    const a = getAnalytics();
    a.pageViews[screen] = (a.pageViews[screen] || 0) + 1;
    saveAnalytics(a);
}
async function trackLoginEvent(email, action) {
    const a = getAnalytics();
    const entry = { email, action, timestamp: new Date().toISOString() };
    a.loginHistory.unshift(entry);
    if (a.loginHistory.length > 100) a.loginHistory = a.loginHistory.slice(0, 100);
    saveAnalytics(a);
    addLoginEventToFirestore(entry).catch(() => {});
    updateUserLoginStats(email, action).catch(() => {});
    // Sync to shared cloud storage
    const shared = await fetchSharedData();
    if (shared) {
        shared.loginHistory = [entry, ...(shared.loginHistory || [])].slice(0, 100);
        await updateSharedData(shared);
    }
}
async function trackRegistration(user) {
    const a = getAnalytics();
    const entry = {
        name: user.name,
        email: user.email,
        degree: user.degree,
        phone: user.phone || '',
        location: user.location || '',
        bio: user.bio || '',
        headline: user.headline || '',
        interests: user.interests || [],
        languages: user.languages || [],
        joinedAt: new Date().toISOString()
    };
    const idx = a.registeredUsers.findIndex(u => u.email === user.email);
    if (idx >= 0) a.registeredUsers[idx] = entry;
    else a.registeredUsers.unshift(entry);
    saveAnalytics(a);
    saveUserToFirestore(user).catch(() => {});
    // Sync to shared cloud storage
    const shared = await fetchSharedData();
    if (shared) {
        const sidx = (shared.registeredUsers || []).findIndex(u => u.email === user.email);
        if (sidx >= 0) shared.registeredUsers[sidx] = entry;
        else shared.registeredUsers = [entry, ...(shared.registeredUsers || [])];
        shared.loginHistory = [
            { email: user.email, action: 'signup', timestamp: entry.joinedAt },
            ...(shared.loginHistory || [])
        ].slice(0, 100);
        await updateSharedData(shared);
    }
}
// Increment session count on every app open
(function () {
    const a = getAnalytics();
    a.totalSessions = (a.totalSessions || 0) + 1;
    saveAnalytics(a);
})();

// Admin credentials
const ADMIN_EMAIL = 'admin@careervibe.com';
const ADMIN_PASSWORD = 'Admin@123';

// ─── JSONBin (shared cloud storage so admin sees ALL users) ──────────────────
// Setup: https://jsonbin.io → Sign up → Create Bin → paste keys below
const JSONBIN_CONFIG = {
    apiKey: 'YOUR_JSONBIN_API_KEY',  // ← Replace: your Master Key from jsonbin.io
    binId:  'YOUR_JSONBIN_BIN_ID'    // ← Replace: your Bin ID from jsonbin.io
};

const FIREBASE_CONFIG = {
    apiKey: 'AIzaSyCCOw8tG4_vg92RgTU7Jjmwc_zNNVuOogw',
    authDomain: 'career-trend-analyzer.firebaseapp.com',
    projectId: 'career-trend-analyzer',
    storageBucket: 'career-trend-analyzer.firebasestorage.app',
    messagingSenderId: '540729624200',
    appId: '1:540729624200:web:d007a431b8be44b9f2813d'
};

let firestoreDB = null;
function canUseFirestore() {
    return FIREBASE_CONFIG.apiKey && !FIREBASE_CONFIG.apiKey.startsWith('YOUR_') && FIREBASE_CONFIG.projectId && !FIREBASE_CONFIG.projectId.startsWith('YOUR_');
}

async function initFirestore() {
    if (firestoreDB || !canUseFirestore()) return firestoreDB;
    try {
        if (!firebase.apps.length) {
            firebase.initializeApp(FIREBASE_CONFIG);
        }
        firestoreDB = firebase.firestore();
        return firestoreDB;
    } catch (e) {
        console.warn('Firestore initialization failed:', e);
        return null;
    }
}

function emailToDocId(email) {
    return (email || '').replace(/[.#$\[\]\/]/g, '_');
}

async function saveUserToFirestore(user) {
    const db = await initFirestore();
    if (!db || !user?.email) return;
    const docId = emailToDocId(user.email);
    await db.collection('users').doc(docId).set({
        ...user,
        joinedAt: user.joinedAt || new Date().toISOString(),
        updatedAt: new Date().toISOString()
    }, { merge: true });
}

async function addLoginEventToFirestore(entry) {
    const db = await initFirestore();
    if (!db) return;
    await db.collection('loginEvents').add(entry);
}

async function updateUserLoginStats(email, action) {
    const db = await initFirestore();
    if (!db || !email) return;
    const docId = emailToDocId(email);
    await db.collection('users').doc(docId).set({
        lastAction: action,
        lastActivityAt: new Date().toISOString(),
        loginCount: firebase.firestore.FieldValue.increment(1)
    }, { merge: true });
}

async function fetchUsersFromFirestore() {
    const db = await initFirestore();
    if (!db) return [];
    const snapshot = await db.collection('users').orderBy('joinedAt', 'desc').get();
    return snapshot.docs.map(doc => doc.data());
}

async function fetchLoginHistoryFromFirestore() {
    const db = await initFirestore();
    if (!db) return [];
    const snapshot = await db.collection('loginEvents').orderBy('timestamp', 'desc').limit(100).get();
    return snapshot.docs.map(doc => doc.data());
}

async function fetchSharedData() {
    if (!JSONBIN_CONFIG.apiKey || JSONBIN_CONFIG.apiKey.startsWith('YOUR_')) return null;
    try {
        const res = await fetch(
            `https://api.jsonbin.io/v3/b/${JSONBIN_CONFIG.binId}/latest`,
            { headers: { 'X-Master-Key': JSONBIN_CONFIG.apiKey } }
        );
        if (!res.ok) return null;
        const json = await res.json();
        return json.record;
    } catch (e) { return null; }
}

async function updateSharedData(data) {
    if (!JSONBIN_CONFIG.apiKey || JSONBIN_CONFIG.apiKey.startsWith('YOUR_')) return;
    try {
        await fetch(`https://api.jsonbin.io/v3/b/${JSONBIN_CONFIG.binId}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'X-Master-Key': JSONBIN_CONFIG.apiKey
            },
            body: JSON.stringify(data)
        });
    } catch (e) { /* silent */ }
}


const softwareJobs = [
    "Frontend Developer", "Backend Engineer", "Full Stack Developer", "Mobile App Developer",
    "DevOps Engineer", "Cloud Architect", "Data Scientist", "AI Engineer",
    "Software Tester", "UI/UX Designer", "Cybersecurity Analyst", "Database Administrator",
    "Blockchain Developer", "Embedded Systems Engineer", "Game Developer"
];

const commerceJobs = [
    "Chartered Accountant", "Investment Banker", "Financial Analyst", "Tax Consultant",
    "Auditor", "Stock Broker", "Bank Manager", "Economic Researcher",
    "Insurance Underwriter", "Cost Accountant", "Treasury Manager", "Portfolio Manager",
    "Credit Risk Analyst", "Venture Capital Analyst", "Compliance Officer"
];

const businessJobs = [
    "Business Development Manager", "Marketing Manager", "Product Manager", "Operations Manager",
    "HR Specialist", "Management Consultant", "Sales Director", "Supply Chain Analyst",
    "Public Relations Officer", "Digital Marketing Specialist", "Brand Manager", "Strategic Planner",
    "Entrepreneurship Consultant", "E-commerce Manager", "Customer Relationship Manager"
];

const generateNaukriJobs = (category, titles) => {
    const searchTerms = {
        "Software": "software-developer",
        "Commerce": "commerce",
        "Business": "business-development"
    };
    const term = searchTerms[category] || category.toLowerCase();
    return titles.map((title, i) => ({
        id: `${category}-${i}`,
        title: title,
        company: ["Google", "Amazon", "Microsoft", "TATA", "Reliance", "Zomato", "Infosys", "Wipro"][i % 8] + " " + (i % 2 === 0 ? "Solutions" : "Global"),
        location: ["Bangalore", "Mumbai", "Hyderabad", "Delhi", "Pune", "Remote"][i % 6],
        platform: "Naukri",
        link: `https://www.naukri.com/${term}-jobs`
    }));
};

state.naukriJobs.software = generateNaukriJobs("Software", softwareJobs);
state.naukriJobs.commerce = generateNaukriJobs("Commerce", commerceJobs);
state.naukriJobs.business = generateNaukriJobs("Business", businessJobs);

const jobTitlesPool = [
    ...softwareJobs, ...commerceJobs, ...businessJobs,
    "Cloud Engineer", "Cyber Security Specialist", "HR Manager", "Sales Executive",
    "Content Writer", "Graphic Designer", "SEO Analyst", "Legal Consultant",
    "Civil Engineer", "Mechanical Engineer", "Biotech Researcher", "Hospital Administrator"
];

const generateAllJobOpenings = (count) => {
    const jobs = [];
    for (let i = 0; i < count; i++) {
        const platform = i % 2 === 0 ? "LinkedIn" : "Naukri";
        const title = jobTitlesPool[i % jobTitlesPool.length];
        jobs.push({
            id: `job-opening-${i}`,
            title: title,
            company: ["Meta", "Apple", "Netflix", "Google", "Microsoft", "TCS", "HCL", "Infosys", "Deloitte", "KPMG"][i % 10],
            location: ["Chennai", "Bangalore", "Hyderabad", "Noida", "Mumbai", "Remote", "USA", "London"][i % 8],
            platform: platform,
            link: platform === "LinkedIn" ? `https://www.linkedin.com/jobs/search/?keywords=${encodeURIComponent(title)}` : `https://www.naukri.com/${title.toLowerCase().replace(/ /g, '-')}-jobs`
        });
    }
    return jobs;
};

state.allJobOpenings = generateAllJobOpenings(55);

const internshipTitles = [
    "Web Development Intern", "Data Analyst Intern", "Marketing Intern", "HR Recruitment Intern",
    "Social Media Intern", "Content Writing Intern", "Graphic Design Intern", "Finance Intern",
    "Cybersecurity Trainee", "AI/ML Research Intern", "APP Development Intern", "UI/UX Design Intern"
];

const generateInternships = (count) => {
    const internships = [];
    for (let i = 0; i < count; i++) {
        const platform = ["Internshala", "LinkedIn", "Naukri"][i % 3];
        const title = internshipTitles[i % internshipTitles.length];
        const stipend = ["₹5,000 - ₹10,000", "Unpaid (Certificate Only)", "₹15,000 /Month", "Performance Based", "₹12,000 /Month"][i % 5];

        internships.push({
            id: `internship-${i}`,
            title: title,
            company: ["StartupX", "TechGiant", "FinLease", "InnoWorks", "GlobalCorp", "EduTech Inc"][i % 6],
            location: ["Remote", "Work from Home", "Bangalore", "Delhi", "Pune", "Hyderabad"][i % 6],
            platform: platform,
            stipend: stipend,
            link: platform === "Internshala" ? `https://internshala.com/internships/keywords-${encodeURIComponent(title)}` :
                (platform === "LinkedIn" ? `https://www.linkedin.com/jobs/search/?keywords=${encodeURIComponent(title)}` : `https://www.naukri.com/${title.toLowerCase().replace(/ /g, '-')}-jobs`)
        });
    }
    return internships;
};

state.allInternships = generateInternships(40);


const scholarshipData = [
    {
        title: "Sitaram Jindal Foundation Scholarship",
        amount: "Up to ₹3,200/Month",
        eligibility: "Students pursuing ITI, Diploma, Graduation, or Post-Graduation with high merit.",
        deadline: "Always Open",
        link: "https://www.sitaramjindalfoundation.org/scholarships-for-students-in-bangalore-india.php",
        tag: "🔥 HIGHLY RECOMMENDED",
        color: "#f59e0b"
    },
    {
        title: "HDFC Bank Parivartan's ECS Scholarship 2026",
        amount: "Up to ₹75,000",
        eligibility: "Meritorious students from Class 1 to PG level facing financial hardship.",
        deadline: "Active",
        link: "https://www.buddy4study.com/page/hdfc-bank-parivartans-ecs-scholarship",
        tag: "⭐ MOST POPULAR",
        color: "#6366f1"
    },
    {
        title: "Reliance Foundation Scholarships 2026-27",
        amount: "Up to INR 6 Lakh",
        eligibility: "First-year UG/PG students in specified streams (Engineering, Medicine, etc.).",
        deadline: "Active",
        link: "https://www.reliancefoundation.org/scholarships",
        tag: "🚀 PREMIUM",
        color: "#2dd4bf"
    },
    {
        title: "Cigma Pedia Career Excellence Grant",
        amount: "₹25,000",
        eligibility: "Students pursuing professional courses with a focus on career development.",
        deadline: "July 2026",
        link: "https://www.cigmapedia.com/",
        tag: "🆕 NEW OPPORTUNITY",
        color: "#ec4899"
    },
    {
        title: "Tata Capital Pankh Scholarship 2026",
        amount: "Up to ₹15,000",
        eligibility: "Students in Class 11, 12, or Undergraduate professional courses.",
        deadline: "Active",
        link: "https://www.buddy4study.com/page/tata-capital-pankh-scholarship-program"
    },
    {
        title: "Global Study Abroad Scholarship",
        amount: "$5,000 USD",
        eligibility: "Students planning to pursue higher education in international universities.",
        deadline: "Sep 2026",
        link: "https://www.globalscholarships.com/",
        tag: "🌍 GLOBAL",
        color: "#8b5cf6"
    },
    {
        title: "LIC Golden Jubilee Scholarship 2026",
        amount: "₹20,000/Year",
        eligibility: "Students who passed Class 12 with 60% and are pursuing UG degrees.",
        deadline: "Dec 2026",
        link: "https://www.licindia.in/Bottom-Links/Golden-Jubilee-Foundation"
    },
    {
        title: "Adobe Women in Technology 2026",
        amount: "Tuition + Internship",
        eligibility: "Female students enrolled in Computer Science or related programs.",
        deadline: "Ongoing",
        link: "https://www.adobe.com/careers/university/scholarships.html"
    },
    {
        title: "Keep India Smiling Mission 2026",
        amount: "INR 30,000/Year",
        eligibility: "Colgate scholarship for 1st year BDS/Engineering/UG students.",
        deadline: "Open",
        link: "https://www.buddy4study.com/page/keep-india-smiling-foundational-scholarship-program"
    },
    {
        title: "Google Generation Scholarship (APAC)",
        amount: "$2,500 USD",
        eligibility: "Women in Computer Science showing leadership and passion for tech.",
        deadline: "Mar 2027",
        link: "https://buildyourfuture.withgoogle.com/scholarships/generation-google-scholarship-apac"
    },
    {
        title: "Prime Minister's Scholarship Scheme (PMSS)",
        amount: "₹3,000/Month",
        eligibility: "Wards/widows of deceased/ex-service personnel of Armed Forces.",
        deadline: "Nov 2026",
        link: "https://www.desw.gov.in/scholarship"
    },
    {
        title: "Kotak Kanya Scholarship 2026",
        amount: "₹1.5 Lakh/Year",
        eligibility: "Meritorious girl students for professional graduation courses.",
        deadline: "Oct 2026",
        link: "https://www.buddy4study.com/page/kotak-kanya-scholarship"
    }
].map((s, i) => s.id ? s : { ...s, id: `scholarship-${i}` });

const certificationsData = {
    software: [
        { id: "course-sw-0", title: "Meta Front-End Developer", platform: "Coursera", demand: "Top Rated", link: "https://www.coursera.org/professional-certificates/meta-front-end-developer", rating: "4.8" },
        { id: "course-sw-1", title: "AWS Solutions Architect", platform: "Udemy", demand: "High Demand", link: "https://www.udemy.com/course/aws-certified-solutions-architect-associate-saa-c03/", rating: "4.7" },
        { id: "course-sw-2", title: "Google Data Analytics", platform: "Coursera", demand: "Trending", link: "https://www.coursera.org/professional-certificates/google-data-analytics", rating: "4.8" },
        { id: "course-sw-3", title: "IBM Full Stack Software Developer", platform: "Coursera", demand: "High Salary", link: "https://www.coursera.org/professional-certificates/ibm-full-stack-cloud-developer", rating: "4.6" }
    ],
    commerce: [
        { id: "course-cm-0", title: "Financial Markets (Yale)", platform: "Coursera", demand: "Essential", link: "https://www.coursera.org/learn/financial-markets-global", rating: "4.9" },
        { id: "course-cm-1", title: "TallyPrime with GST", platform: "Udemy", demand: "Industry Standard", link: "https://www.udemy.com/course/tally-prime-with-gst-training/", rating: "4.5" },
        { id: "course-cm-2", title: "Excel Skills for Business", platform: "Coursera", demand: "Vital Skill", link: "https://www.coursera.org/specializations/excel", rating: "4.7" },
        { id: "course-cm-3", title: "Investment Banking Specialization", platform: "Coursera", demand: "High Value", link: "https://www.coursera.org/specializations/investment-banking-principles-and-analysis", rating: "4.8" }
    ],
    business: [
        { id: "course-bz-0", title: "Google Project Management", platform: "Coursera", demand: "Professional", link: "https://www.coursera.org/professional-certificates/google-project-management", rating: "4.8" },
        { id: "course-bz-1", title: "Digital Marketing Strategy", platform: "Udemy", demand: "Trending", link: "https://www.udemy.com/course/digital-marketing-strategy-course-plan-steps/", rating: "4.6" },
        { id: "course-bz-2", title: "Six Sigma Green Belt", platform: "Coursera", demand: "High Demand", link: "https://www.coursera.org/specializations/six-sigma-green-belt", rating: "4.7" },
        { id: "course-bz-3", title: "Business Foundations (Wharton)", platform: "Coursera", demand: "Elite", link: "https://www.coursera.org/specializations/wharton-business-foundations", rating: "4.8" }
    ]
};

function toggleSave(event, item, type) {
    if (event) event.stopPropagation();

    const index = state.savedItems.findIndex(i => i.id === item.id);
    if (index === -1) {
        state.savedItems.push({ ...item, type });
    } else {
        state.savedItems.splice(index, 1);
    }

    saveToLocalStorage();
    render();
}

function toggleMenu() {
    state.isMenuOpen = !state.isMenuOpen;
    const drawer = document.querySelector('.menu-drawer');
    const overlay = document.querySelector('.menu-overlay');
    if (drawer && overlay) {
        if (state.isMenuOpen) {
            drawer.classList.add('active');
            overlay.classList.add('active');
        } else {
            drawer.classList.remove('active');
            overlay.classList.remove('active');
        }
    }
}

function toggleProfileModal() {
    state.isProfileModalOpen = !state.isProfileModalOpen;
    render();
}

function handleResumeUpload(event) {
    const file = event.target.files[0];
    if (file) {
        state.user.resumeName = file.name;
        saveUserToLocalStorage();
        alert('Resume uploaded successfully: ' + file.name);
        render();
    }
}

function handleImageUpload(event) {
    const file = event.target.files[0];
    if (file) {
        const reader = new FileReader();
        reader.onload = (e) => {
            state.user.profilePic = e.target.result;
            saveUserToLocalStorage();
            render();
        };
        reader.readAsDataURL(file);
    }
}

function handleProfileSave(event) {
    if (event) event.preventDefault();

    const name = document.getElementById('profileName').value;
    const email = document.getElementById('profileEmail').value;
    const phone = document.getElementById('profilePhone').value;
    const headline = document.getElementById('profileHeadline').value;
    const location = document.getElementById('profileLocation').value;
    const degree = document.getElementById('profileDegree').value;
    const bio = document.getElementById('profileBio').value;
    const skills = document.getElementById('profileSkills').value.split(',').map(s => s.trim()).filter(s => s);
    const languages = document.getElementById('profileLanguages').value.split(',').map(s => s.trim()).filter(s => s);
    const achievements = document.getElementById('profileAchievements').value.split(',').map(s => s.trim()).filter(s => s);
    const accomplishments = document.getElementById('profileAccomplishments').value.split(',').map(s => s.trim()).filter(s => s);
    const projects = document.getElementById('profileProjects').value;
    const internships = document.getElementById('profileInternships').value;

    // Education Data
    const edu10School = document.getElementById('edu10School').value;
    const edu10Board = document.getElementById('edu10Board').value;
    const edu10Year = document.getElementById('edu10Year').value;
    const edu10Score = document.getElementById('edu10Score').value;

    const edu12School = document.getElementById('edu12School').value;
    const edu12Board = document.getElementById('edu12Board').value;
    const edu12Year = document.getElementById('edu12Year').value;
    const edu12Score = document.getElementById('edu12Score').value;

    state.user = {
        ...state.user,
        name,
        email,
        phone,
        headline,
        location,
        degree,
        bio,
        interests: skills.length > 0 ? skills : state.user.interests,
        languages,
        achievements,
        accomplishments,
        projects,
        internships,
        education: {
            class10: { school: edu10School, board: edu10Board, year: edu10Year, score: edu10Score },
            class12: { school: edu12School, board: edu12Board, year: edu12Year, score: edu12Score }
        }
    };

    saveUserToLocalStorage();
    saveUserToFirestore(state.user).catch(() => {});
    alert('Profile saved successfully!');
    toggleProfileModal();
}

const themes = ['default', 'midnight', 'ocean', 'forest'];

function cycleTheme() {
    let currentIndex = themes.indexOf(state.theme);
    let nextIndex = (currentIndex + 1) % themes.length;
    state.theme = themes[nextIndex];
    document.documentElement.setAttribute('data-theme', state.theme);
}

function renderHeader() {
    const menuBtn = (state.currentScreen === 'login' || state.currentScreen === 'signup') ? '' : `
        <div class="menu-btn" onclick="toggleMenu()">
            <span></span>
            <span></span>
            <span></span>
        </div>
    `;

    return `
        ${menuBtn}
        <!-- Theme Toggle -->
        <div class="theme-btn" onclick="cycleTheme()" style="position: fixed; top: 24px; right: ${state.currentScreen === 'login' || state.currentScreen === 'signup' ? '24px' : '90px'}; z-index: 1000; width: 48px; height: 48px; border-radius: 50%; background: var(--card-bg); border: 1px solid var(--card-border); backdrop-filter: blur(12px); display: flex; justify-content: center; align-items: center; cursor: pointer; transition: all 0.3s; box-shadow: 0 8px 20px rgba(0,0,0,0.3);">
            <i data-lucide="palette" style="width: 20px; height: 20px; color: var(--primary);"></i>
        </div>
        ${(state.currentScreen === 'login' || state.currentScreen === 'signup') ? '' : `
            <div class="profile-btn" onclick="navigate('myProfile')">
                <i data-lucide="user"></i>
            </div>
        `}
        ${(state.currentScreen === 'login' || state.currentScreen === 'signup') ? '' : `
            <div class="menu-overlay ${state.isMenuOpen ? 'active' : ''}" onclick="toggleMenu()"></div>
            <nav class="menu-drawer ${state.isMenuOpen ? 'active' : ''}">
                <div style="margin-bottom: 30px; padding: 0 20px;">
                    <h2 style="font-size: 1.5rem; color: var(--primary);">CareerVibe</h2>
                    <p style="font-size: 0.8rem;">Future Analysis Pro</p>
                </div>

                <!-- Horizontal Scroll Slider -->
                <div class="menu-slider">
                    <div class="slider-item" onclick="navigate('saved'); toggleMenu();">
                        <i data-lucide="bookmark"></i>
                        <span>Saved</span>
                    </div>
                    <div class="slider-item" onclick="navigate('jobs'); toggleMenu();">
                        <i data-lucide="zap"></i>
                        <span>AI Roles</span>
                    </div>
                    <div class="slider-item" onclick="navigate('jobs'); toggleMenu();">
                        <i data-lucide="code-2"></i>
                        <span>Frontend</span>
                    </div>
                    <div class="slider-item" onclick="navigate('jobs'); toggleMenu();">
                        <i data-lucide="database"></i>
                        <span>Data Sci</span>
                    </div>
                    <div class="slider-item" onclick="navigate('jobs'); toggleMenu();">
                        <i data-lucide="layout"></i>
                        <span>UI/UX</span>
                    </div>
                    <div class="slider-item" onclick="navigate('scholarships'); toggleMenu();">
                        <i data-lucide="award"></i>
                        <span>Grants</span>
                    </div>
                    <div class="slider-item" onclick="alert('DevOps section coming soon!'); toggleMenu();">
                        <i data-lucide="terminal"></i>
                        <span>DevOps</span>
                    </div>
                </div>

                <a href="javascript:void(0)" class="menu-item" onclick="navigate('myProfile'); toggleMenu();">
                    <i data-lucide="user"></i> My Profile
                </a>
                <a href="javascript:void(0)" class="menu-item" onclick="navigate('profile'); toggleMenu();">
                    <i data-lucide="home"></i> Home
                </a>
                <a href="javascript:void(0)" class="menu-item" onclick="navigate('saved'); toggleMenu();">
                    <i data-lucide="bookmark"></i> Saved Items
                </a>
                <a href="javascript:void(0)" class="menu-item" onclick="navigate('jobs'); toggleMenu();">
                    <i data-lucide="briefcase"></i> Jobs
                </a>
                <a href="javascript:void(0)" class="menu-item" onclick="navigate('scholarships'); toggleMenu();">
                    <i data-lucide="graduation-cap"></i> Scholarships
                </a>
                <a href="javascript:void(0)" class="menu-item" onclick="navigate('internships'); toggleMenu();">
                    <i data-lucide="user-check"></i> Internships
                </a>
                <a href="javascript:void(0)" class="menu-item" onclick="navigate('about'); toggleMenu();">
                    <i data-lucide="info"></i> About Us
                </a>
                <a href="javascript:void(0)" class="menu-item" onclick="navigate('feedback'); toggleMenu();">
                    <i data-lucide="message-square"></i> Feedback
                </a>
                
                <div style="margin-top: auto; padding: 20px;">
                    <button class="btn" style="padding: 12px; font-size: 0.9rem; background: rgba(239, 68, 68, 0.1); color: #ef4444;" onclick="handleLogout(); toggleMenu();">
                        <i data-lucide="log-out"></i> Logout
                    </button>
                </div>
            </nav>
        `}
    `;
}

function renderProfileModal() {
    return `
        <div class="modal-overlay ${state.isProfileModalOpen ? 'active' : ''}" id="profileModal">
            <div class="modal-content fade-in">
                <div class="modal-header">
                    <h2 style="margin: 0;">User Profile</h2>
                    <div class="close-modal" onclick="toggleProfileModal()">
                        <i data-lucide="x"></i>
                    </div>
                </div>

                <div class="profile-avatar-edit" onclick="document.getElementById('profilePicInput').click()" style="cursor: pointer;">
                    ${state.user.profilePic ? `<img src="${state.user.profilePic}" style="width: 100%; height: 100%; object-fit: cover; border-radius: 35px;">` : state.user.name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}
                    <div class="edit-overlay">
                        <i data-lucide="camera"></i>
                    </div>
                </div>
                <input type="file" id="profilePicInput" style="display: none;" accept="image/*" onchange="handleImageUpload(event)">

                <form onsubmit="handleProfileSave(event)">
                    <div class="form-grid">
                        <div class="input-group form-full">
                            <label>Full Name</label>
                            <input type="text" id="profileName" value="${state.user.name}" placeholder="Your Full Name">
                        </div>
                        <div class="input-group form-full">
                            <label>Email Address</label>
                            <input type="email" id="profileEmail" value="${state.user.email || ''}" placeholder="email@example.com">
                        </div>
                        <div class="input-group form-full">
                            <label>Professional Headline</label>
                            <input type="text" id="profileHeadline" value="${state.user.headline || ''}" placeholder="e.g. Aspiring Web Developer | MCA Student">
                        </div>
                        <div class="input-group form-full">
                            <label>Location</label>
                            <input type="text" id="profileLocation" value="${state.user.location || ''}" placeholder="e.g. Mumbai, India">
                        </div>
                        <div class="input-group">
                            <label>Phone Number</label>
                            <input type="tel" id="profilePhone" value="${state.user.phone || ''}" placeholder="+91 00000 00000">
                        </div>
                        <div class="input-group">
                            <label>Degree</label>
                            <select id="profileDegree">
                                <option value="BCA" ${state.user.degree === 'BCA' ? 'selected' : ''}>BCA</option>
                                <option value="BCOM" ${state.user.degree === 'BCOM' ? 'selected' : ''}>BCOM</option>
                                <option value="BBA" ${state.user.degree === 'BBA' ? 'selected' : ''}>BBA</option>
                                <option value="MCA" ${state.user.degree === 'MCA' ? 'selected' : ''}>MCA</option>
                                <option value="MCOM" ${state.user.degree === 'MCOM' ? 'selected' : ''}>MCOM</option>
                                <option value="MTECH" ${state.user.degree === 'MTECH' ? 'selected' : ''}>MTECH</option>
                                <option value="MBA" ${state.user.degree === 'MBA' ? 'selected' : ''}>MBA</option>
                                <option value="OTHERS" ${state.user.degree === 'OTHERS' ? 'selected' : ''}>OTHERS</option>
                            </select>
                        </div>
                        <div class="input-group form-full">
                            <label>Skills (Comma separated)</label>
                            <input type="text" id="profileSkills" value="${state.user.interests.join(', ')}" placeholder="UI Design, JavaScript, React">
                        </div>

                        <!-- Education Section -->
                        <div class="form-full" style="margin: 20px 0 10px;">
                            <h3 style="font-size: 1.1rem; border-bottom: 1px solid var(--card-border); padding-bottom: 8px;">Education History</h3>
                        </div>

                        <div class="form-full">
                            <p style="font-size: 0.9rem; font-weight: 700; color: var(--secondary); margin-bottom: 15px;">Class 10th Details</p>
                            <div class="form-grid">
                                <div class="input-group form-full">
                                    <label>School Name</label>
                                    <input type="text" id="edu10School" value="${state.user.education?.class10?.school || ''}" placeholder="Enter school name">
                                </div>
                                <div class="input-group">
                                    <label>Board</label>
                                    <input type="text" id="edu10Board" value="${state.user.education?.class10?.board || ''}" placeholder="CBSE/ICSE/State">
                                </div>
                                <div class="input-group">
                                    <label>Year</label>
                                    <input type="number" id="edu10Year" value="${state.user.education?.class10?.year || ''}" placeholder="YYYY">
                                </div>
                                <div class="input-group form-full">
                                    <label>Percentage / CGPA</label>
                                    <input type="text" id="edu10Score" value="${state.user.education?.class10?.score || ''}" placeholder="e.g. 95% or 9.8 CGPA">
                                </div>
                            </div>
                        </div>

                        <div class="form-full" style="margin-top: 20px;">
                            <p style="font-size: 0.9rem; font-weight: 700; color: var(--secondary); margin-bottom: 15px;">Class 12th Details</p>
                            <div class="form-grid">
                                <div class="input-group form-full">
                                    <label>College/School Name</label>
                                    <input type="text" id="edu12School" value="${state.user.education?.class12?.school || ''}" placeholder="Enter college name">
                                </div>
                                <div class="input-group">
                                    <label>Board</label>
                                    <input type="text" id="edu12Board" value="${state.user.education?.class12?.board || ''}" placeholder="CBSE/ISC/State">
                                </div>
                                <div class="input-group">
                                    <label>Year</label>
                                    <input type="number" id="edu12Year" value="${state.user.education?.class12?.year || ''}" placeholder="YYYY">
                                </div>
                                <div class="input-group form-full">
                                    <label>Percentage (%)</label>
                                    <input type="text" id="edu12Score" value="${state.user.education?.class12?.score || ''}" placeholder="e.g. 92%">
                                </div>
                            </div>
                        </div>

                        <div class="input-group form-full">
                            <label>Professional Bio</label>
                            <textarea style="height: 120px; resize: none;" id="profileBio" placeholder="Tell us about yourself...">${state.user.bio || ''}</textarea>
                        </div>

                        <!-- Professional Info -->
                        <div class="form-full" style="margin: 20px 0 10px;">
                            <h3 style="font-size: 1.1rem; border-bottom: 1px solid var(--card-border); padding-bottom: 8px;">Experience & Projects</h3>
                        </div>

                        <div class="input-group form-full">
                            <label>Internships (Experience)</label>
                            <textarea style="height: 100px; resize: none;" id="profileInternships" placeholder="e.g. Web Dev Intern at Tech Corp (3 Months)...">${state.user.internships || ''}</textarea>
                        </div>

                        <div class="input-group form-full">
                            <label>Projects</label>
                            <textarea style="height: 100px; resize: none;" id="profileProjects" placeholder="e.g. E-commerce App using React...">${state.user.projects || ''}</textarea>
                        </div>

                        <!-- Highlights Section -->
                        <div class="form-full" style="margin: 20px 0 10px;">
                            <h3 style="font-size: 1.1rem; border-bottom: 1px solid var(--card-border); padding-bottom: 8px;">Highlights & Skills</h3>
                        </div>

                        <div class="input-group form-full">
                            <label>Languages (Comma separated)</label>
                            <input type="text" id="profileLanguages" value="${(state.user.languages || []).join(', ')}" placeholder="English, Hindi, German">
                        </div>

                        <div class="input-group form-full">
                            <label>Academic Achievements</label>
                            <input type="text" id="profileAchievements" value="${(state.user.achievements || []).join(', ')}" placeholder="Gold Medalist, 1st Rank in Math Olympiad">
                        </div>

                        <div class="input-group form-full">
                            <label>Accomplishments</label>
                            <input type="text" id="profileAccomplishments" value="${(state.user.accomplishments || []).join(', ')}" placeholder="Published Research Paper, 500+ LeetCode problems">
                        </div>

                        <!-- Resume Section -->
                        <div class="form-full" style="margin-top: 20px;">
                            <label style="display: block; margin-bottom: 12px; font-size: 0.95rem; font-weight: 600; color: var(--text-muted);">Resume / CV</label>
                            <div style="background: rgba(255,255,255,0.03); border: 2px dashed var(--card-border); border-radius: 20px; padding: 24px; text-align: center; cursor: pointer;" onclick="document.getElementById('resumeInput').click()">
                                <i data-lucide="file-text" style="width: 32px; height: 32px; color: var(--primary); margin-bottom: 10px;"></i>
                                <p style="font-size: 0.9rem; color: #fff; margin-bottom: 5px;">${state.user.resumeName || 'Click to upload your resume'}</p>
                                <p style="font-size: 0.75rem; color: var(--text-muted);">PDF, DOCX (Max 5MB)</p>
                            </div>
                            <input type="file" id="resumeInput" style="display: none;" accept=".pdf,.doc,.docx" onchange="handleResumeUpload(event)">
                        </div>
                    </div>
                    <button type="submit" class="btn btn-primary" style="margin-top: 20px;">
                        Save Profile <i data-lucide="check"></i>
                    </button>
                </form>
            </div>
        </div>
    `;
}

// Function to export users data to CSV
function exportUsersToCSV() {
    const analytics = state.adminData || getAnalytics();
    const users = analytics.registeredUsers;

    if (!users.length) {
        alert('No users to export');
        return;
    }

    // Create CSV content
    const headers = ['Name', 'Email', 'Degree', 'Phone', 'Location', 'Bio', 'Headline', 'Interests', 'Languages', 'Joined Date'];
    const csvContent = [
        headers.join(','),
        ...users.map(user => [
            `"${user.name || ''}"`,
            `"${user.email || ''}"`,
            `"${user.degree || ''}"`,
            `"${user.phone || ''}"`,
            `"${user.location || ''}"`,
            `"${user.bio || ''}"`,
            `"${user.headline || ''}"`,
            `"${(user.interests || []).join('; ')}"`,
            `"${(user.languages || []).join('; ')}"`,
            `"${user.joinedAt ? new Date(user.joinedAt).toLocaleDateString() : ''}"`
        ].join(','))
    ].join('\n');

    // Create and download the file
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `careervibe_users_${new Date().toISOString().split('T')[0]}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

const screens = {
    login: () => `
        <div class="login-screen fade-in" style="display: flex; flex-direction: column; justify-content: center; align-items: center; min-height: 80vh; text-align: center;">
            <div style="margin-bottom: 40px;">
                <div class="avatar" style="width: 100px; height: 100px; margin: 0 auto 24px; border-radius: 30px; background: linear-gradient(135deg, var(--primary), var(--accent));">
                    <i data-lucide="briefcase" style="width: 45px; height: 45px;"></i>
                </div>
                <h1 style="font-size: 3.5rem;">CareerVibe</h1>
                <p style="font-size: 1.2rem; max-width: 300px; margin: 0 auto;">Plan your path. Track your growth. Master your future.</p>
            </div>
            
            <div class="glass-card" style="width: 100%; text-align: left;">
                <div class="input-group">
                    <label>Email Address</label>
                    <input type="email" id="loginEmail" placeholder="student@example.com">
                </div>
                <div class="input-group">
                    <label>Password</label>
                    <input type="password" id="loginPassword" placeholder="••••••••">
                </div>
                <button class="btn btn-primary" onclick="handleLogin()">
                    Login <i data-lucide="log-in"></i>
                </button>
                <p style="margin-top: 24px; font-size: 0.9rem; text-align: center;">
                    Don't have an account? <a href="javascript:void(0)" onclick="navigate('signup')" style="color: var(--secondary); font-weight: 600; text-decoration: none;">Sign Up</a>
                </p>
                <p style="margin-top: 12px; text-align: center;">
                    <a href="javascript:void(0)" onclick="navigate('adminLogin')" style="font-size: 0.78rem; opacity: 0.45; color: var(--text); text-decoration: none; letter-spacing: 0.03em;">Admin Access</a>
                </p>
            </div>
        </div>
    `,

    about: () => `
        <div class="fade-in">
            <div class="back-btn" onclick="navigate('profile')">
                <i data-lucide="chevron-left"></i>
            </div>
            <div style="margin-bottom: 30px;">
                <h1>About Us</h1>
                <p>Learn about our mission and the student behind the project.</p>
            </div>
            
            <div class="glass-card">
                <div style="display: flex; align-items: center; gap: 20px; margin-bottom: 24px;">
                    <div class="avatar" style="width: 60px; height: 60px; font-size: 1.2rem;">TM</div>
                    <div>
                        <h3 style="margin: 0;">Student Team Collaboration</h3>
                        <p style="font-size: 0.85rem; color: var(--secondary);">Three Members • Future-Proofing Careers</p>
                    </div>
                </div>
                
                <p style="margin-bottom: 20px;">
                    Hello! We are a <strong>team of three dedicated students</strong> who created <strong>CareerVibe (Career Trend Analyzer Pro)</strong> as part of our mission to help fellow students navigate the complex job market.
                </p>
                
                <p style="margin-bottom: 20px;">
                    As students ourselves, we understand the struggle of finding job opportunities that perfectly align with a specific field of study. Our combined efforts focus on providing better job-finding functionalities that empower students to discover roles tailored precisely to their degree and course specialization.
                </p>
                
                <p>
                    By analyzing industry trends and curating specific career paths, our team aims to bridge the gap between education and employment, ensuring every student has the tools to succeed in their chosen career path.
                </p>
            </div>

            <div class="glass-card" style="padding: 24px; border-style: dashed;">
                <h4 style="margin-bottom: 12px; color: #fff;">Our Vision</h4>
                <p style="font-size: 0.9rem;">To become the go-to platform for every student looking to translate their academic success into a thriving professional career.</p>
            </div>
        </div>
    `,

    scholarships: () => `
        <div class="fade-in">
            <div class="back-btn" onclick="navigate('profile')">
                <i data-lucide="chevron-left"></i>
            </div>
            <div style="margin-bottom: 30px;">
                <h1>Scholarships</h1>
            </div>

            <div class="scholarship-list">
                ${scholarshipData.map(s => {
        const isSaved = state.savedItems.some(i => i.id === s.id);
        return `
                    <div class="glass-card" style="padding: 20px; margin-bottom: 16px; ${s.color ? `border-left: 4px solid ${s.color};` : ''}">
                        <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 15px;">
                            <div>
                                ${s.tag ? `<div class="tag" style="background: ${s.color}33; color: ${s.color}; font-size: 0.6rem; margin-bottom: 8px; width: fit-content;">${s.tag}</div>` : ''}
                                <h3 style="font-size: 1.1rem; margin-bottom: 5px; color: #fff;">${s.title}</h3>
                                <p style="font-size: 0.85rem; color: var(--secondary); font-weight: 600;">Amount: ${s.amount}</p>
                            </div>
                            <div style="display: flex; gap: 10px;">
                                <div class="save-btn ${isSaved ? 'active' : ''}" onclick="toggleSave(event, ${JSON.stringify(s).replace(/"/g, '&quot;')}, 'Scholarship')">
                                    <i data-lucide="bookmark"></i>
                                </div>
                                <i data-lucide="${s.tag ? (s.tag.includes('TRENDING') ? 'trending-up' : 'star') : 'award'}" style="color: ${s.color || 'gold'}; margin-top: 8px;"></i>
                            </div>
                        </div>
                        <div style="background: rgba(255,255,255,0.03); padding: 12px; border-radius: 12px; margin-bottom: 15px;">
                            <p style="font-size: 0.8rem; color: var(--text-muted); margin-bottom: 8px;"><strong>Eligibility:</strong> ${s.eligibility}</p>
                            <p style="font-size: 0.8rem; color: var(--text-muted);"><strong>Deadline:</strong> ${s.deadline}</p>
                        </div>
                        <button class="btn btn-primary" style="padding: 12px; font-size: 0.9rem;" onclick="window.open('${s.link}', '_blank')">
                            Apply Now <i data-lucide="external-link"></i>
                        </button>
                    </div>
                `}).join('')}
            </div>
        </div>
    `,

    signup: () => `
        <div class="fade-in">
            <div class="back-btn" onclick="navigate('login')">
                <i data-lucide="chevron-left"></i>
            </div>
            <div style="margin-bottom: 30px;">
                <h1>Create Account</h1>
                <p>Join CareerVibe to start your journey.</p>
            </div>
            
            <div class="glass-card">
                <div class="input-group">
                    <label>Full Name</label>
                    <input type="text" id="signupName" placeholder="John Doe">
                </div>
                <div class="input-group">
                    <label>Email Address</label>
                    <input type="email" id="signupEmail" placeholder="john@example.com">
                </div>
                <div class="input-group">
                    <label>Password</label>
                    <input type="password" id="signupPassword" placeholder="Minimum 6 characters">
                </div>
                <div class="input-group">
                    <label>Degree</label>
                    <select id="signupDegree">
                        <option value="" disabled selected>Select your degree</option>
                        <option value="BCA">BCA</option>
                        <option value="BCOM">BCOM</option>
                        <option value="BBA">BBA</option>
                        <option value="MCA">MCA</option>
                        <option value="MCOM">MCOM</option>
                        <option value="MTECH">MTECH</option>
                        <option value="MBA">MBA</option>
                        <option value="OTHERS">OTHERS</option>
                    </select>
                </div>
                <button class="btn btn-primary" onclick="handleSignup()">
                    Create Account <i data-lucide="user-plus"></i>
                </button>
            </div>
        </div>
    `,

    profile: () => `
        <div class="fade-in">
            <div class="back-btn" onclick="navigate('login')">
                <i data-lucide="chevron-left"></i>
            </div>
            
            <!-- Moved Analyze Job Trends to Top and removed header -->
            <button class="btn btn-primary" style="margin-bottom: 40px; height: 80px; font-size: 1.4rem;" onclick="navigate('degree')">
                Analyze Job Trends <i data-lucide="trending-up"></i>
            </button>

            <!-- Interactive Trending Jobs Title -->
            <div style="margin-bottom: 40px; position: relative;">
                <div class="live-indicator">
                    <span class="pulse-dot"></span>
                    <span>LIVE UPDATES</span>
                </div>
                <h2 class="interactive-title">Trending Jobs</h2>
                <p style="font-size: 0.95rem; opacity: 0.8; margin-top: 8px;">Discover top opportunities across industries</p>
                
                <!-- Category: Software -->
                <h4 style="margin: 30px 0 15px; color: var(--secondary); font-size: 1.1rem; display: flex; align-items: center; gap: 8px;">
                    <i data-lucide="code" style="width: 18px;"></i> Software Roles (15)
                </h4>
                <div class="job-container">
                    ${state.naukriJobs.software.map(job => {
        const isSaved = state.savedItems.some(i => i.id === job.id);
        return `
                        <div class="job-card fade-in" onclick="window.open('${job.link}', '_blank')">
                            <div style="display: flex; justify-content: space-between; align-items: center;">
                                <span class="job-platform platform-naukri">Naukri</span>
                                <div style="display: flex; align-items: center; gap: 10px;">
                                    <div class="save-btn ${isSaved ? 'active' : ''}" style="width: 28px; height: 28px; border-radius: 8px;" onclick="toggleSave(event, ${JSON.stringify(job).replace(/"/g, '&quot;')}, 'Job')">
                                        <i data-lucide="bookmark" style="width: 14px;"></i>
                                    </div>
                                    <i data-lucide="external-link" style="width: 14px; opacity: 0.5;"></i>
                                </div>
                            </div>
                            <div>
                                <h4 style="margin-bottom: 4px; font-size: 1.1rem;">${job.title}</h4>
                                <p style="font-size: 0.85rem; color: var(--text-muted);">${job.company} • ${job.location}</p>
                            </div>
                        </div>
                    `}).join('')}
                </div>

                <!-- Category: Commerce -->
                <h4 style="margin: 40px 0 15px; color: var(--accent); font-size: 1.1rem; display: flex; align-items: center; gap: 8px;">
                    <i data-lucide="briefcase" style="width: 18px;"></i> Commerce Roles (15)
                </h4>
                <div class="job-container">
                    ${state.naukriJobs.commerce.map(job => {
            const isSaved = state.savedItems.some(i => i.id === job.id);
            return `
                        <div class="job-card fade-in" onclick="window.open('${job.link}', '_blank')">
                            <div style="display: flex; justify-content: space-between; align-items: center;">
                                <span class="job-platform platform-naukri">Naukri</span>
                                <div style="display: flex; align-items: center; gap: 10px;">
                                    <div class="save-btn ${isSaved ? 'active' : ''}" style="width: 28px; height: 28px; border-radius: 8px;" onclick="toggleSave(event, ${JSON.stringify(job).replace(/"/g, '&quot;')}, 'Job')">
                                        <i data-lucide="bookmark" style="width: 14px;"></i>
                                    </div>
                                    <i data-lucide="external-link" style="width: 14px; opacity: 0.5;"></i>
                                </div>
                            </div>
                            <div>
                                <h4 style="margin-bottom: 4px; font-size: 1.1rem;">${job.title}</h4>
                                <p style="font-size: 0.85rem; color: var(--text-muted);">${job.company} • ${job.location}</p>
                            </div>
                        </div>
                    `}).join('')}
                </div>

                <!-- Category: Business -->
                <h4 style="margin: 40px 0 15px; color: var(--primary-light); font-size: 1.1rem; display: flex; align-items: center; gap: 8px;">
                    <i data-lucide="bar-chart-3" style="width: 18px;"></i> Business Roles (15)
                </h4>
                <div class="job-container">
                    ${state.naukriJobs.business.map(job => {
                const isSaved = state.savedItems.some(i => i.id === job.id);
                return `
                        <div class="job-card fade-in" onclick="window.open('${job.link}', '_blank')">
                            <div style="display: flex; justify-content: space-between; align-items: center;">
                                <span class="job-platform platform-naukri">Naukri</span>
                                <div style="display: flex; align-items: center; gap: 10px;">
                                    <div class="save-btn ${isSaved ? 'active' : ''}" style="width: 28px; height: 28px; border-radius: 8px;" onclick="toggleSave(event, ${JSON.stringify(job).replace(/"/g, '&quot;')}, 'Job')">
                                        <i data-lucide="bookmark" style="width: 14px;"></i>
                                    </div>
                                    <i data-lucide="external-link" style="width: 14px; opacity: 0.5;"></i>
                                </div>
                            </div>
                            <div>
                                <h4 style="margin-bottom: 4px; font-size: 1.1rem;">${job.title}</h4>
                                <p style="font-size: 0.85rem; color: var(--text-muted);">${job.company} • ${job.location}</p>
                            </div>
                        </div>
                    `}).join('')}
                </div>
            </div>


            ${state.user.resumeName ? `
                <div class="glass-card" style="border: 2px solid var(--primary-glow); background: rgba(99, 102, 241, 0.05);">
                    <div style="display: flex; align-items: center; justify-content: space-between;">
                        <div style="display: flex; align-items: center; gap: 12px;">
                            <i data-lucide="file-check" style="color: var(--primary);"></i>
                            <div>
                                <h4 style="margin: 0;">Resume Uploaded</h4>
                                <p style="font-size: 0.75rem; margin: 0; opacity: 0.7;">${state.user.resumeName}</p>
                            </div>
                        </div>
                        <i data-lucide="download" style="width: 18px; cursor: pointer;"></i>
                    </div>
                </div>
            ` : ''}

        </div>
    `,

    degree: () => `
        <div class="fade-in">
            <div class="back-btn" onclick="navigate('profile')">
                <i data-lucide="chevron-left"></i>
            </div>
            <div style="margin-bottom: 30px;">
                <h1>Select Degree</h1>
                <p>Choose your field to see tailored industry insights and course recommendations.</p>
            </div>
            
            <div class="glass-card">
                <div class="input-group">
                    <label>Pick Your Degree</label>
                    <select id="degreeSpinner" onchange="state.selectedDegree = this.value">
                        <option value="" disabled selected>Select your degree...</option>
                        <option value="BCA">BCA</option>
                        <option value="BCOM">BCOM</option>
                        <option value="BBA">BBA</option>
                        <option value="MCA">MCA</option>
                        <option value="MCOM">MCOM</option>
                        <option value="MTECH">MTECH</option>
                        <option value="MBA">MBA</option>
                        <option value="OTHERS">OTHERS</option>
                    </select>
                </div>

                <div style="margin-top: 30px;">
                    <button class="btn btn-primary" onclick="handleSpinnerSubmit()">
                        Visualize Trends <i data-lucide="line-chart"></i>
                    </button>
                </div>
            </div>
        </div>
    `,

    recommendations: () => {
        const jobs = getJobsForDegree(state.selectedDegree);
        const degreeName = state.selectedDegree || 'your degree';

        return `
        <div class="fade-in">
            <div class="back-btn" onclick="navigate('degree')">
                <i data-lucide="chevron-left"></i>
            </div>
            <div style="margin-bottom: 30px;">
                <h1 style="font-size: 2.2rem;">Industry Trends</h1>
                <p>Tailored insights for <span style="color: var(--secondary); font-weight: 700;">${degreeName}</span></p>
            </div>

            <!-- Course Recommendations -->
            <div style="margin-bottom: 40px;">
                <h3 style="display: flex; align-items: center; gap: 10px; font-size: 1.25rem; margin-bottom: 20px;">
                    <i data-lucide="award" style="color: var(--primary);"></i> Trending Certifications
                </h3>
                <div class="glass-card" style="padding: 24px;">
                    ${getCoursesForDegree(state.selectedDegree).map(course => {
            const isSaved = state.savedItems.some(i => i.id === course.id);
            return `
                        <div class="list-item" style="cursor: pointer; position: relative;" onclick="window.open('${course.link}', '_blank')">
                            <div style="flex: 1;">
                                <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 6px;">
                                    <h4 style="margin: 0; font-size: 1.05rem;">${course.title}</h4>
                                    <span style="font-size: 0.65rem; background: var(--secondary-glow); color: var(--secondary); padding: 2px 6px; border-radius: 6px; font-weight: 700;">${course.platform}</span>
                                </div>
                                <div style="display: flex; align-items: center; gap: 12px;">
                                    <p style="font-size: 0.8rem; margin: 0;">Market Status: <span class="trend-up" style="font-weight: 600;">${course.demand}</span></p>
                                    <div style="display: flex; align-items: center; gap: 4px; font-size: 0.8rem; color: #facc15;">
                                        <i data-lucide="star" style="width: 12px; height: 12px; fill: currentColor;"></i>
                                        <span>${course.rating}</span>
                                    </div>
                                </div>
                            </div>
                            <div style="display: flex; align-items: center; gap: 12px;">
                                <div class="save-btn ${isSaved ? 'active' : ''}" style="width: 32px; height: 32px;" onclick="toggleSave(event, ${JSON.stringify(course).replace(/"/g, '&quot;')}, 'Course')">
                                    <i data-lucide="bookmark" style="width: 16px;"></i>
                                </div>
                                <i data-lucide="external-link" style="width:18px; color: var(--text-muted); opacity: 0.5;"></i>
                            </div>
                        </div>
                    `}).join('')}
                </div>
            </div>

            <!-- Job Recommendations Section -->
            <div style="margin-bottom: 40px;">
                <h3 style="display: flex; align-items: center; gap: 10px; font-size: 1.2rem; margin-bottom: 20px;">
                    <i data-lucide="briefcase" style="color: var(--secondary);"></i> Related Job Opportunities
                </h3>
                <div class="job-container">
                    ${jobs.map(job => {
                const isSaved = state.savedItems.some(i => i.id === job.id);
                return `
                        <div class="job-card fade-in" onclick="window.open('${job.link}', '_blank')" style="background: rgba(255,255,255,0.05);">
                            <div style="display: flex; justify-content: space-between; align-items: center;">
                                <div style="display: flex; align-items: center; gap: 8px;">
                                    <span class="job-platform ${job.platform === 'LinkedIn' ? 'platform-linkedin' : 'platform-naukri'}">${job.platform}</span>
                                    <span style="font-size: 0.65rem; color: var(--text-muted);">Match: 95%</span>
                                </div>
                                <div style="display: flex; align-items: center; gap: 10px;">
                                    <div class="save-btn ${isSaved ? 'active' : ''}" style="width: 28px; height: 28px; border-radius: 8px;" onclick="toggleSave(event, ${JSON.stringify(job).replace(/"/g, '&quot;')}, 'Job')">
                                        <i data-lucide="bookmark" style="width: 14px;"></i>
                                    </div>
                                    <i data-lucide="external-link" style="width: 14px; opacity: 0.5;"></i>
                                </div>
                            </div>
                            <div>
                                <h4 style="margin-bottom: 4px; font-size: 1.1rem; color: #fff;">${job.title}</h4>
                                <p style="font-size: 0.85rem; color: var(--text-muted);">${job.company} • ${job.location}</p>
                            </div>
                        </div>
                    `}).join('')}
                </div>
            </div>

            <button class="btn btn-primary" onclick="navigate('jobs')">
                View All Job Openings <i data-lucide="arrow-right"></i>
            </button>
        </div>
        `;
    },

    jobs: () => `
        <div class="fade-in profile-screen-content">
            <div class="back-btn" onclick="navigate('profile')">
                <i data-lucide="chevron-left"></i>
            </div>
            <div style="margin-bottom: 30px;">
                <h1 style="font-size: 2.2rem;">Job Openings</h1>
            </div>

            <div class="list-container" style="display: flex; flex-direction: column; gap: 16px; padding-bottom: 40px;">
                ${state.allJobOpenings.map(job => {
        const isSaved = state.savedItems.some(i => i.id === job.id);
        return `
                    <div class="glass-card" style="margin-bottom: 0; cursor: pointer; padding: 20px;" onclick="window.open('${job.link}', '_blank')">
                        <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 12px;">
                            <div style="flex: 1;">
                                <h4 style="margin-bottom: 4px; font-size: 1.1rem; color: #fff;">${job.title}</h4>
                                <p style="font-size: 0.9rem; opacity: 0.7;">${job.company} • ${job.location}</p>
                            </div>
                            <div style="display: flex; flex-direction: column; align-items: flex-end; gap: 10px;">
                                <span class="job-platform ${job.platform === 'LinkedIn' ? 'platform-linkedin' : 'platform-naukri'}" style="margin: 0;">${job.platform}</span>
                                <div class="save-btn ${isSaved ? 'active' : ''}" style="width: 32px; height: 32px;" onclick="toggleSave(event, ${JSON.stringify(job).replace(/"/g, '&quot;')}, 'Job')">
                                    <i data-lucide="bookmark" style="width: 16px;"></i>
                                </div>
                            </div>
                        </div>
                        <div style="display: flex; justify-content: flex-end;">
                            <i data-lucide="external-link" style="width: 16px; color: var(--secondary);"></i>
                        </div>
                    </div>
                `}).join('')}
            </div>

        </div>
    `,

    internships: () => `
        <div class="fade-in profile-screen-content">
            <div class="back-btn" onclick="navigate('profile')">
                <i data-lucide="chevron-left"></i>
            </div>
            <div style="margin-bottom: 30px;">
                <h1 style="font-size: 2.2rem;">Internships</h1>
                <p>Curated <span style="color: var(--accent); font-weight: 700;">40 active roles</span> for students</p>
            </div>

            <div class="list-container" style="display: flex; flex-direction: column; gap: 16px; padding-bottom: 40px;">
                ${state.allInternships.map(intern => {
        const isSaved = state.savedItems.some(i => i.id === intern.id);
        return `
                    <div class="glass-card" style="margin-bottom: 0; cursor: pointer; padding: 22px;" onclick="window.open('${intern.link}', '_blank')">
                        <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 12px;">
                            <div style="flex: 1;">
                                <h4 style="margin-bottom: 4px; font-size: 1.15rem; color: #fff; line-height: 1.3;">${intern.title}</h4>
                                <p style="font-size: 0.9rem; opacity: 0.7; margin-bottom: 8px;">${intern.company} • ${intern.location}</p>
                                <div style="display: flex; align-items: center; gap: 6px; font-size: 0.8rem; color: var(--secondary); font-weight: 600;">
                                    <i data-lucide="wallet" style="width: 12px; height: 12px;"></i>
                                    ${intern.stipend}
                                </div>
                            </div>
                            <div style="display: flex; flex-direction: column; align-items: flex-end; gap: 10px;">
                                <span class="job-platform" style="background: ${intern.platform === 'Internshala' ? 'rgba(0, 172, 240, 0.15)' : (intern.platform === 'LinkedIn' ? 'rgba(0, 119, 181, 0.15)' : 'rgba(47, 50, 145, 0.15)')}; color: ${intern.platform === 'Internshala' ? '#00acf0' : (intern.platform === 'LinkedIn' ? '#0077b5' : '#4a90e2')}; border: 1px solid currentColor;">${intern.platform}</span>
                                <div class="save-btn ${isSaved ? 'active' : ''}" style="width: 32px; height: 32px;" onclick="toggleSave(event, ${JSON.stringify(intern).replace(/"/g, '&quot;')}, 'Internship')">
                                    <i data-lucide="bookmark" style="width: 16px;"></i>
                                </div>
                            </div>
                        </div>
                        <div style="display: flex; justify-content: flex-end; margin-top: 5px;">
                            <button class="btn btn-primary" style="padding: 8px 16px; font-size: 0.75rem; width: fit-content; border-radius: 10px;">
                                Apply <i data-lucide="arrow-right" style="width: 12px; height: 12px;"></i>
                            </button>
                        </div>
                    </div>
                `}).join('')}
            </div>

        </div>
    `,

    feedback: () => `
        <div class="fade-in">
            <div class="back-btn" onclick="navigate('profile')">
                <i data-lucide="chevron-left"></i>
            </div>
            <div style="margin-bottom: 30px;">
                <h1>Feedback</h1>
                <p>We value your thoughts. Help us improve your experience.</p>
            </div>

            <div class="glass-card">
                <form onsubmit="handleFeedbackSubmit(event)">
                    <div class="input-group">
                        <label>How would you rate your experience?</label>
                        <div style="display: flex; gap: 15px; margin-top: 10px;">
                            <label class="rating-option">
                                <input type="radio" name="rating" value="1" style="display: none;">
                                <div class="rating-btn">1</div>
                            </label>
                            <label class="rating-option">
                                <input type="radio" name="rating" value="2" style="display: none;">
                                <div class="rating-btn">2</div>
                            </label>
                            <label class="rating-option">
                                <input type="radio" name="rating" value="3" style="display: none;">
                                <div class="rating-btn">3</div>
                            </label>
                            <label class="rating-option">
                                <input type="radio" name="rating" value="4" style="display: none;">
                                <div class="rating-btn">4</div>
                            </label>
                            <label class="rating-option">
                                <input type="radio" name="rating" value="5" style="display: none;" checked>
                                <div class="rating-btn">5</div>
                            </label>
                        </div>
                    </div>

                    <div class="input-group">
                        <label>Category</label>
                        <select id="feedbackCategory">
                            <option value="General">General Feedback</option>
                            <option value="Bug">Report a Bug</option>
                            <option value="Feature">Feature Request</option>
                            <option value="Content">Job/Course Content</option>
                        </select>
                    </div>

                    <div class="input-group">
                        <label>Your Comments</label>
                        <textarea id="feedbackText" style="height: 150px; resize: none;" placeholder="Tell us what you like or what we can improve..."></textarea>
                    </div>

                    <button type="submit" class="btn btn-primary">
                        Submit Feedback <i data-lucide="send"></i>
                    </button>
                </form>
            </div>

            <div id="feedbackSuccess" style="display: none; text-align: center;" class="fade-in">
                <div class="glass-card" style="border-color: var(--secondary);">
                    <i data-lucide="check-circle" style="width: 48px; height: 48px; color: var(--secondary); margin-bottom: 15px;"></i>
                    <h3>Thank You!</h3>
                    <p>Your feedback has been received and helps us grow.</p>
                    <button class="btn btn-primary" style="margin-top: 20px;" onclick="navigate('profile')">Back to Home</button>
                </div>
            </div>
        </div>
    `,

    saved: () => `
        <div class="fade-in profile-screen-content">
            <div class="back-btn" onclick="navigate('profile')">
                <i data-lucide="chevron-left"></i>
            </div>
            <div style="margin-bottom: 30px;">
                <h1 style="font-size: 2.2rem;">Saved Items</h1>
                <p>You have <span style="color: var(--primary-light); font-weight: 700;">${state.savedItems.length} items</span> bookmarked</p>
            </div>

            <div class="list-container" style="display: flex; flex-direction: column; gap: 16px; padding-bottom: 60px;">
                ${state.savedItems.length === 0 ? `
                    <div class="empty-state">
                        <i data-lucide="bookmark-x"></i>
                        <h3>No Saved Items</h3>
                        <p>Explore jobs and scholarships and click the bookmark icon to save them here.</p>
                        <button class="btn btn-primary" style="margin-top: 30px; width: auto; padding: 12px 30px;" onclick="navigate('profile')">Explore Jobs</button>
                    </div>
                ` : state.savedItems.map(item => `
                    <div class="glass-card" style="margin-bottom: 0; cursor: pointer; padding: 22px;" onclick="window.open('${item.link}', '_blank')">
                        <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 12px;">
                            <div style="flex: 1;">
                                <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 8px;">
                                    <span class="tag" style="padding: 4px 8px; font-size: 0.6rem; background: var(--primary-glow); color: var(--primary-light);">${item.type}</span>
                                    ${item.platform ? `<span class="job-platform" style="background: rgba(255,255,255,0.05); color: var(--text-muted); border: 1px solid var(--card-border);">${item.platform}</span>` : ''}
                                </div>
                                <h4 style="margin-bottom: 4px; font-size: 1.15rem; color: #fff; line-height: 1.3;">${item.title}</h4>
                                <p style="font-size: 0.9rem; opacity: 0.7;">${item.company || (item.amount ? 'Amount: ' + item.amount : '')} ${item.location ? '• ' + item.location : ''}</p>
                            </div>
                            <div class="save-btn active" style="width: 32px; height: 32px;" onclick="toggleSave(event, ${JSON.stringify(item).replace(/"/g, '&quot;')}, '${item.type}')">
                                <i data-lucide="bookmark" style="width: 16px;"></i>
                            </div>
                        </div>
                        <div style="display: flex; justify-content: flex-end; margin-top: 10px;">
                            <div style="display: flex; align-items: center; gap: 6px; color: var(--secondary); font-size: 0.85rem; font-weight: 600;">
                                View Details <i data-lucide="arrow-right" style="width: 14px;"></i>
                            </div>
                        </div>
                    </div>
                `).join('')}
            </div>
        </div>
    `,

    myProfile: () => `
        <div class="fade-in">
            <div class="back-btn" onclick="navigate('profile')">
                <i data-lucide="chevron-left"></i>
            </div>
            
            <div style="margin-bottom: 30px; display: flex; justify-content: space-between; align-items: center;">
                <h1>My Profile</h1>
                <button class="btn btn-primary" style="width: auto; padding: 10px 20px;" onclick="toggleProfileModal()">
                    <i data-lucide="edit-3"></i> Edit
                </button>
            </div>

            <div class="glass-card" style="padding: 30px; text-align: center; margin-bottom: 30px;">
                <div class="profile-avatar" style="width: 120px; height: 120px; border-radius: 40px; background: var(--primary-glow); margin: 0 auto 20px; display: flex; justify-content: center; align-items: center; font-size: 3rem; color: white;">
                    ${state.user.profilePic ? `<img src="${state.user.profilePic}" style="width: 100%; height: 100%; object-fit: cover; border-radius: 40px;">` : state.user.name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}
                </div>
                <h2 style="font-size: 2.2rem; margin-bottom: 5px;">${state.user.name}</h2>
                <p style="color: var(--secondary); font-weight: 600; font-size: 1.1rem; margin-bottom: 20px;">${state.user.headline || 'Career Path Explorer'}</p>
                
                <div style="display: flex; justify-content: center; gap: 20px; flex-wrap: wrap;">
                    <div class="stat-item" style="background: rgba(255,255,255,0.03); padding: 15px 25px; border-radius: 15px; border: 1px solid var(--card-border);">
                        <p style="font-size: 0.75rem; color: var(--text-muted); margin-bottom: 5px; text-transform: uppercase;">Degree</p>
                        <p style="font-weight: 700; color: #fff;">${state.user.degree}</p>
                    </div>
                    <div class="stat-item" style="background: rgba(255,255,255,0.03); padding: 15px 25px; border-radius: 15px; border: 1px solid var(--card-border);">
                        <p style="font-size: 0.75rem; color: var(--text-muted); margin-bottom: 5px; text-transform: uppercase;">Location</p>
                        <p style="font-weight: 700; color: #fff;">${state.user.location || 'Not set'}</p>
                    </div>
                </div>
            </div>

            <div class="form-grid">
                <div class="glass-card" style="padding: 24px;">
                    <h3 style="margin-bottom: 15px; border-bottom: 1px solid var(--card-border); padding-bottom: 10px;">Contact Info</h3>
                    <p style="margin-bottom: 12px; display: flex; align-items: center; gap: 10px;">
                        <i data-lucide="mail" style="width: 18px; color: var(--primary);"></i> 
                        <span>${state.user.email || 'No email provided'}</span>
                    </p>
                    <p style="margin-bottom: 12px; display: flex; align-items: center; gap: 10px;">
                        <i data-lucide="phone" style="width: 18px; color: var(--primary);"></i> 
                        <span>${state.user.phone || 'No phone provided'}</span>
                    </p>
                </div>

                <div class="glass-card" style="padding: 24px;">
                    <h3 style="margin-bottom: 15px; border-bottom: 1px solid var(--card-border); padding-bottom: 10px;">Skills</h3>
                    <div style="display: flex; gap: 10px; flex-wrap: wrap;">
                        ${(state.user.interests || []).map(skill => `<span class="tag" style="background: var(--secondary-glow); color: var(--secondary);">${skill}</span>`).join('')}
                    </div>
                </div>

                <div class="glass-card form-full" style="padding: 24px;">
                    <h3 style="margin-bottom: 15px; border-bottom: 1px solid var(--card-border); padding-bottom: 10px;">Professional Bio</h3>
                    <p style="line-height: 1.6; opacity: 0.9;">${state.user.bio || 'Please update your bio...'}</p>
                </div>

                <div class="glass-card form-full" style="padding: 24px;">
                    <h3 style="margin-bottom: 15px; border-bottom: 1px solid var(--card-border); padding-bottom: 10px;">Education</h3>
                    <div class="form-grid">
                        <div style="background: rgba(255,255,255,0.02); padding: 15px; border-radius: 12px;">
                            <h4 style="color: var(--secondary); margin-bottom: 8px;">Class 10th</h4>
                            <p style="font-size: 0.9rem;"><strong>${state.user.education?.class10?.school || 'N/A'}</strong></p>
                            <p style="font-size: 0.8rem; opacity: 0.7;">${state.user.education?.class10?.board || ''} | ${state.user.education?.class10?.year || ''}</p>
                            <p style="margin-top: 5px; color: var(--primary-light);">Score: ${state.user.education?.class10?.score || '--'}</p>
                        </div>
                        <div style="background: rgba(255,255,255,0.02); padding: 15px; border-radius: 12px;">
                            <h4 style="color: var(--secondary); margin-bottom: 8px;">Class 12th</h4>
                            <p style="font-size: 0.9rem;"><strong>${state.user.education?.class12?.school || 'N/A'}</strong></p>
                            <p style="font-size: 0.8rem; opacity: 0.7;">${state.user.education?.class12?.board || ''} | ${state.user.education?.class12?.year || ''}</p>
                            <p style="margin-top: 5px; color: var(--primary-light);">Score: ${state.user.education?.class12?.score || '--'}</p>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `,

    adminLogin: () => `
        <div class="admin-login-screen fade-in">
            <div class="admin-login-box glass-card">
                <div style="text-align: center; margin-bottom: 32px;">
                    <div class="avatar" style="width: 72px; height: 72px; margin: 0 auto 16px; border-radius: 20px; background: linear-gradient(135deg, #ef4444, #b91c1c);">
                        <i data-lucide="shield" style="width: 34px; height: 34px;"></i>
                    </div>
                    <h2 style="font-size: 1.8rem; margin: 0 0 6px;">Admin Panel</h2>
                    <p style="font-size: 0.9rem; opacity: 0.55;">CareerVibe Administration</p>
                </div>
                <div class="input-group">
                    <label>Admin Email</label>
                    <input type="email" id="adminEmail" placeholder="admin@careervibe.com">
                </div>
                <div class="input-group">
                    <label>Password</label>
                    <input type="password" id="adminPassword" placeholder="••••••••">
                </div>
                <button class="btn btn-primary" onclick="handleAdminLogin()" style="width: 100%; background: linear-gradient(135deg, #ef4444, #b91c1c); border: none;">
                    Sign In <i data-lucide="shield-check"></i>
                </button>
                <p style="margin-top: 20px; font-size: 0.85rem; text-align: center;">
                    <a href="javascript:void(0)" onclick="navigate('login')" style="color: var(--secondary); text-decoration: none;">← Back to User Login</a>
                </p>
            </div>
        </div>
    `,

    adminDashboard: () => {
        if (state.adminDataLoading) {
            return `<div class="admin-loading"><i data-lucide="loader-2" class="admin-spinner"></i><p>Loading dashboard data...</p></div>`;
        }
        const analytics = state.adminData || getAnalytics();
        const users = analytics.registeredUsers || [];
        const pageViews = analytics.pageViews || {};
        const loginHistory = analytics.loginHistory || [];
        const totalPageViews = Object.values(pageViews).reduce((a, b) => a + b, 0);
        const maxViews = Math.max(...Object.values(pageViews), 1);
        const uniqueActiveUsers = new Set(loginHistory.map(l => l.email).filter(Boolean)).size;
        const activeUsersLast7Days = new Set(loginHistory
            .filter(l => new Date(l.timestamp) >= new Date(Date.now() - 7 * 24 * 60 * 60 * 1000))
            .map(l => l.email).filter(Boolean)).size;

        const pageViewBars = Object.entries(pageViews)
            .sort((a, b) => b[1] - a[1])
            .map(([screen, count]) => `
                <div class="admin-bar-row">
                    <span class="admin-bar-label">${screen.charAt(0).toUpperCase() + screen.slice(1)}</span>
                    <div class="admin-bar-track">
                        <div class="admin-bar-fill" style="width:${Math.round(count / maxViews * 100)}%"></div>
                    </div>
                    <span class="admin-bar-count">${count}</span>
                </div>`).join('');

        const behaviorMap = loginHistory.reduce((map, event) => {
            if (!event.email) return map;
            if (!map[event.email]) {
                map[event.email] = { count: 0, lastTimestamp: event.timestamp };
            }
            map[event.email].count += 1;
            if (new Date(event.timestamp) > new Date(map[event.email].lastTimestamp)) {
                map[event.email].lastTimestamp = event.timestamp;
            }
            return map;
        }, {});

        const userRows = users.length
            ? users.map(u => {
                const stats = behaviorMap[u.email] || { count: 0, lastTimestamp: null };
                return `
                <tr>
                    <td>${u.name}</td>
                    <td style="font-size:0.8rem;opacity:0.75">${u.email}</td>
                    <td><span class="admin-badge">${u.degree || 'N/A'}</span></td>
                    <td style="font-size:0.8rem;opacity:0.65">${u.joinedAt ? new Date(u.joinedAt).toLocaleDateString() : 'N/A'}</td>
                    <td style="font-size:0.8rem;opacity:0.65">${stats.lastTimestamp ? new Date(stats.lastTimestamp).toLocaleString() : 'No activity'}</td>
                    <td style="font-size:0.8rem;opacity:0.65">${stats.count}</td>
                </tr>`;
            }).join('')
            : `<tr><td colspan="6" style="text-align:center;opacity:0.45;padding:20px">No users registered yet</td></tr>`;

        const loginRows = loginHistory.slice(0, 12).length
            ? loginHistory.slice(0, 12).map(l => `
                <tr>
                    <td style="font-size:0.8rem;opacity:0.75">${l.email}</td>
                    <td><span class="admin-badge admin-badge-${l.action === 'logout' ? 'red' : 'green'}">${l.action}</span></td>
                    <td style="font-size:0.78rem;opacity:0.6">${new Date(l.timestamp).toLocaleString()}</td>
                </tr>`).join('')
            : `<tr><td colspan="3" style="text-align:center;opacity:0.45;padding:20px">No activity yet</td></tr>`;

        return `
        <div class="admin-dashboard fade-in">
            <div class="admin-header">
                <div>
                    <h1 style="font-size:1.8rem;margin:0;">Admin Dashboard</h1>
                    <p style="opacity:0.55;margin:4px 0 0;font-size:0.88rem;">CareerVibe Analytics &amp; Management</p>
                    ${!canUseFirestore() ?
                        '<p style="opacity:0.7;margin:4px 0 0;font-size:0.75rem;color:#f59e0b;">⚠️ Firestore not configured. Enable Firebase in app.js to show backend user data.</p>' :
                        '<p style="opacity:0.7;margin:4px 0 0;font-size:0.75rem;color:#10b981;">✅ Connected to Firebase Firestore</p>'}
                </div>
                <button class="btn" onclick="navigate('login')" style="background:rgba(239,68,68,0.1);color:#ef4444;padding:10px 16px;display:flex;align-items:center;gap:8px;">
                    <i data-lucide="log-out" style="width:16px;height:16px;"></i> Exit Admin
                </button>
                <button class="btn" onclick="loadAdminData()" style="background:rgba(59,130,246,0.1);color:#3b82f6;padding:10px 16px;display:flex;align-items:center;gap:8px;margin-right:10px;">
                    <i data-lucide="refresh-ccw" style="width:16px;height:16px;"></i> Refresh Data
                </button>
            </div>

            <div class="admin-stats-grid">
                <div class="glass-card admin-stat-card">
                    <div class="admin-stat-icon" style="background:linear-gradient(135deg,#6366f1,#8b5cf6);">
                        <i data-lucide="users" style="width:22px;height:22px;"></i>
                    </div>
                    <div class="admin-stat-value">${users.length}</div>
                    <div class="admin-stat-label">Registered Users</div>
                </div>
                <div class="glass-card admin-stat-card">
                    <div class="admin-stat-icon" style="background:linear-gradient(135deg,#0ea5e9,#06b6d4);">
                        <i data-lucide="activity" style="width:22px;height:22px;"></i>
                    </div>
                    <div class="admin-stat-value">${analytics.totalSessions}</div>
                    <div class="admin-stat-label">App Sessions</div>
                </div>
                <div class="glass-card admin-stat-card">
                    <div class="admin-stat-icon" style="background:linear-gradient(135deg,#f59e0b,#f97316);">
                        <i data-lucide="eye" style="width:22px;height:22px;"></i>
                    </div>
                    <div class="admin-stat-value">${totalPageViews}</div>
                    <div class="admin-stat-label">Total Page Views</div>
                </div>
                <div class="glass-card admin-stat-card">
                    <div class="admin-stat-icon" style="background:linear-gradient(135deg,#8b5cf6,#6366f1);">
                        <i data-lucide="users" style="width:22px;height:22px;"></i>
                    </div>
                    <div class="admin-stat-value">${uniqueActiveUsers}</div>
                    <div class="admin-stat-label">Unique Active Users</div>
                </div>
                <div class="glass-card admin-stat-card">
                    <div class="admin-stat-icon" style="background:linear-gradient(135deg,#14b8a6,#0d9488);">
                        <i data-lucide="clock" style="width:22px;height:22px;"></i>
                    </div>
                    <div class="admin-stat-value">${activeUsersLast7Days}</div>
                    <div class="admin-stat-label">Active Last 7 Days</div>
                </div>
                <div class="glass-card admin-stat-card">
                    <div class="admin-stat-icon" style="background:linear-gradient(135deg,#10b981,#059669);">
                        <i data-lucide="log-in" style="width:22px;height:22px;"></i>
                    </div>
                    <div class="admin-stat-value">${loginHistory.filter(l => l.action === 'login' || l.action === 'signup').length}</div>
                    <div class="admin-stat-label">Total Logins</div>
                </div>
            </div>

            <div class="glass-card" style="margin-bottom:20px;">
                <h3 style="margin:0 0 20px;font-size:1.05rem;display:flex;align-items:center;gap:8px;">
                    <i data-lucide="bar-chart-2" style="width:18px;height:18px;color:var(--primary);"></i>
                    Feature Usage
                </h3>
                ${pageViewBars || '<p style="opacity:0.45;text-align:center;padding:20px 0">No page views yet — users need to navigate the app first.</p>'}
            </div>

            <div class="admin-tables-grid">
                <div class="glass-card">
                    <h3 style="margin:0 0 16px;font-size:1.05rem;display:flex;align-items:center;gap:8px;justify-content:space-between;">
                        <span style="display:flex;align-items:center;gap:8px;">
                            <i data-lucide="user-check" style="width:18px;height:18px;color:var(--primary);"></i>
                            Registered Users
                        </span>
                        <button class="btn" onclick="exportUsersToCSV()" style="background:linear-gradient(135deg,#10b981,#059669);color:white;padding:8px 12px;font-size:0.8rem;display:flex;align-items:center;gap:6px;border:none;border-radius:6px;">
                            <i data-lucide="download" style="width:14px;height:14px;"></i> Export CSV
                        </button>
                    </h3>
                    <div style="overflow-x:auto;">
                        <table class="admin-table">
                            <thead><tr><th>Name</th><th>Email</th><th>Degree</th><th>Joined</th><th>Last Active</th><th>Logins</th></tr></thead>
                            <tbody>${userRows}</tbody>
                        </table>
                        <p style="font-size:0.75rem;opacity:0.6;margin-top:8px;text-align:center;">💡 Export CSV for complete user profiles including contact details, bio, and interests</p>
                    </div>
                </div>
                <div class="glass-card">
                    <h3 style="margin:0 0 16px;font-size:1.05rem;display:flex;align-items:center;gap:8px;">
                        <i data-lucide="clock" style="width:18px;height:18px;color:var(--primary);"></i>
                        Recent Activity
                    </h3>
                    <div style="overflow-x:auto;">
                        <table class="admin-table">
                            <thead><tr><th>Email</th><th>Action</th><th>Time</th></tr></thead>
                            <tbody>${loginRows}</tbody>
                        </table>
                    </div>
                </div>
            </div>
        </div>
        `;
    }
};

function handleFeedbackSubmit(event) {
    event.preventDefault();

    // Simulate API call
    document.querySelector('form').style.display = 'none';
    document.getElementById('feedbackSuccess').style.display = 'block';

    // Refresh icons for success card
    if (typeof lucide !== 'undefined') {
        lucide.createIcons();
    }
}

async function loadAdminData() {
    state.adminDataLoading = true;
    render();
    const localAnalytics = getAnalytics();
    const db = await initFirestore();
    if (db) {
        const users = await fetchUsersFromFirestore();
        const loginHistory = await fetchLoginHistoryFromFirestore();
        state.adminData = {
            ...localAnalytics,
            registeredUsers: users,
            loginHistory: loginHistory.length ? loginHistory : localAnalytics.loginHistory
        };
    } else {
        const shared = await fetchSharedData();
        state.adminData = shared || localAnalytics;
    }
    state.adminDataLoading = false;
    render();
}

function navigate(screenName) {
    state.currentScreen = screenName;
    const skipTracking = ['login', 'signup', 'adminLogin', 'adminDashboard'];
    if (!skipTracking.includes(screenName)) trackPageView(screenName);
    if (screenName === 'adminDashboard') {
        loadAdminData();
        return;
    }
    render();
}

function handleLogout() {
    trackLoginEvent(state.user.email || '', 'logout');
    localStorage.removeItem('careerVibeSession');
    navigate('login');
}

function handleLogin() {
    const email = document.getElementById('loginEmail').value;
    const password = document.getElementById('loginPassword').value;

    if (!email || !password) {
        alert('Please enter both email and password.');
        return;
    }

    const saved = JSON.parse(localStorage.getItem('careerVibeUser'));
    if (!saved) {
        alert('No account found. Please sign up first.');
        navigate('signup');
        return;
    }
    if (saved.email !== email) {
        alert('Email not found. Please check your email or sign up.');
        return;
    }
    if (saved.password !== password) {
        alert('Incorrect password. Please try again.');
        return;
    }

    state.user = {
        ...saved,
        lastLoginAt: new Date().toISOString()
    };
    saveUserToLocalStorage();
    saveUserToFirestore(state.user).catch(() => {});
    localStorage.setItem('careerVibeSession', 'true');
    trackLoginEvent(email, 'login');
    navigate('profile');
}

function handleSignup() {
    const name = document.getElementById('signupName').value;
    const email = document.getElementById('signupEmail').value;
    const password = document.getElementById('signupPassword').value;
    const degree = document.getElementById('signupDegree').value;

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    if (!name || name.length < 3) {
        alert('Please enter a valid full name (min 3 characters).');
        return;
    }
    if (!email || !emailRegex.test(email)) {
        alert('Please enter a valid email address.');
        return;
    }
    if (!password || password.length < 6) {
        alert('Password must be at least 6 characters long.');
        return;
    }
    if (!degree) {
        alert('Please select your degree.');
        return;
    }

    const joinedAt = new Date().toISOString();

    // Update state
    state.user = {
        ...state.user,
        name: name,
        degree: degree,
        interests: ['Career Planning', 'Job Trends'], // Default interests
        email: email,
        password: password,
        joinedAt: joinedAt,
        lastLoginAt: joinedAt
    };

    saveUserToLocalStorage();
    localStorage.setItem('careerVibeSession', 'true');
    trackRegistration(state.user);
    trackLoginEvent(email, 'signup');

    // Simulate success and navigate
    navigate('profile');
}

function handleAdminLogin() {
    const email = document.getElementById('adminEmail').value.trim();
    const password = document.getElementById('adminPassword').value;
    if (!email || !password) { alert('Please enter admin credentials.'); return; }
    if (email !== ADMIN_EMAIL || password !== ADMIN_PASSWORD) { alert('Invalid admin credentials.'); return; }
    navigate('adminDashboard');
}

function getCoursesForDegree(degree) {
    const mapping = {
        'BCA': 'software',
        'MCA': 'software',
        'MTECH': 'software',
        'BCOM': 'commerce',
        'MCOM': 'commerce',
        'BBA': 'business',
        'MBA': 'business'
    };
    const category = mapping[degree] || 'software';
    return certificationsData[category] || certificationsData.software;
}

function getJobsForDegree(degree) {
    const mapping = {
        'BCA': 'software',
        'MCA': 'software',
        'MTECH': 'software',
        'BCOM': 'commerce',
        'MCOM': 'commerce',
        'BBA': 'business',
        'MBA': 'business'
    };

    const category = mapping[degree] || 'software';
    const homeJobs = state.naukriJobs[category] || [];

    // Also search in allJobOpenings for keywords
    const keywords = {
        'software': ['Developer', 'Engineer', 'Cloud', 'Data', 'AI', 'Full Stack', 'Backend', 'Frontend'],
        'commerce': ['Accountant', 'Banker', 'Financial', 'Auditor', 'Broker', 'Tax'],
        'business': ['Manager', 'HR', 'Marketing', 'Product', 'Sales', 'Business']
    };

    const relevantKeywords = keywords[category] || [];
    const otherJobs = state.allJobOpenings.filter(job =>
        relevantKeywords.some(kw => job.title.includes(kw))
    );

    // Combine and remove duplicates by title
    const combined = [...homeJobs, ...otherJobs];
    const unique = [];
    const titles = new Set();

    combined.forEach(job => {
        if (!titles.has(job.title)) {
            titles.add(job.title);
            unique.push(job);
        }
    });

    return unique.slice(0, 10); // Return top 10 relevant jobs
}

function handleSpinnerSubmit() {
    if (state.selectedDegree) {
        // Show a loading state or just navigate
        navigate('recommendations');
    } else {
        alert('Please select a degree first!');
    }
}

function render() {
    const app = document.getElementById('app');
    if (!app) return;

    const adminScreens = ['adminLogin', 'adminDashboard'];
    if (adminScreens.includes(state.currentScreen)) {
        const screenFn = screens[state.currentScreen];
        app.innerHTML = typeof screenFn === 'function' ? screenFn() : screenFn;
    } else {
        app.innerHTML = renderHeader() + screens[state.currentScreen]() + renderProfileModal();
    }

    // Initialize Lucide icons after rendering content
    if (typeof lucide !== 'undefined') {
        lucide.createIcons();
    }

    // Scroll to top
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

// Initial render
document.addEventListener('DOMContentLoaded', render);
