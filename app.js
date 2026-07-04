const STORAGE_KEY = "dayflow-planner-v1";
const THEME_KEY = "dayflow-theme";
const CLOUD_COLLECTION = "users";
const CLOUD_SUBCOLLECTION = "planner";
const CLOUD_DOC_ID = "main";

let firebaseReady = false;
let auth = null;
let db = null;
let currentUser = null;
let cloudSaveTimer = null;
let isLoadingCloud = false;


const defaultCategories = [
  { id: "cat-study", name: "Study", color: "#7c3aed" },
  { id: "cat-submission", name: "Submission", color: "#ef4444" },
  { id: "cat-grocery", name: "Groceries", color: "#10b981" },
  { id: "cat-personal", name: "Personal", color: "#f59e0b" }
];

const sampleActivities = [
  {
    id: uid(),
    title: "Submit rainfall bias-correction report",
    categoryId: "cat-submission",
    priority: "high",
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 6).toISOString(),
    startAt: new Date(Date.now() - 1000 * 60 * 60 * 6).toISOString(),
    deadline: new Date(Date.now() + 1000 * 60 * 60 * 10).toISOString(),
    notes: "Attach final CSV outputs, plots, and discussion points before submission.",
    tags: ["university", "urgent"],
    repeat: "none",
    done: false,
    subtasks: [
      { id: uid(), title: "Check station metadata", done: true },
      { id: uid(), title: "Export PNG plots", done: false },
      { id: uid(), title: "Write result discussion", done: false }
    ]
  },
  {
    id: uid(),
    title: "Buy weekly groceries",
    categoryId: "cat-grocery",
    priority: "medium",
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 2).toISOString(),
    startAt: new Date(Date.now() - 1000 * 60 * 60 * 2).toISOString(),
    deadline: new Date(Date.now() + 1000 * 60 * 60 * 30).toISOString(),
    notes: "Try to keep the list short and avoid duplicate items.",
    tags: ["home"],
    repeat: "weekly",
    done: false,
    subtasks: [
      { id: uid(), title: "Rice", done: false },
      { id: uid(), title: "Eggs", done: false },
      { id: uid(), title: "Vegetables", done: true }
    ]
  }
];

let state = loadState();
let currentView = "today";
let todayFilter = "all";
let activityFilter = "all";
let activeTimer = null;
let timerSeconds = 25 * 60;
let timerRunning = false;

const $ = (selector) => document.querySelector(selector);

function uid() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `id-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

const $$ = (selector) => Array.from(document.querySelectorAll(selector));

function emptyState() {
  return {
    categories: defaultCategories,
    activities: [],
    quickNotes: "",
    lastUpdated: new Date().toISOString()
  };
}

function demoState() {
  return {
    categories: defaultCategories,
    activities: sampleActivities,
    quickNotes: "Welcome to DayFlow. Use this space for quick thoughts, class notes, shopping ideas, or anything temporary. Everything saves automatically in your browser. Sign in to sync across devices.",
    lastUpdated: new Date().toISOString()
  };
}

function normalizeState(value, fallback = emptyState()) {
  const parsed = value && typeof value === "object" ? value : fallback;
  return {
    categories: parsed.categories?.length ? parsed.categories : defaultCategories,
    activities: Array.isArray(parsed.activities) ? parsed.activities : [],
    quickNotes: parsed.quickNotes || "",
    lastUpdated: parsed.lastUpdated || new Date().toISOString()
  };
}

function loadState() {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (!saved) return demoState();
  try {
    return normalizeState(JSON.parse(saved), demoState());
  } catch (error) {
    console.warn("Could not parse saved data", error);
    return demoState();
  }
}

function saveLocalState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function saveState() {
  state.lastUpdated = new Date().toISOString();
  saveLocalState();
  scheduleCloudSave();
}

function init() {
  applyTheme();
  bindEvents();
  initFirebase();
  populateCategorySelects();
  updateDateLine();
  render();
  setInterval(() => {
    renderListsOnly();
    updateDateLine();
  }, 60_000);
}

function bindEvents() {
  $("#quickAddBtn").addEventListener("click", () => openActivityDialog());
  $("#quickCreate").addEventListener("click", quickCreateActivity);
  $("#quickTitle").addEventListener("keydown", (event) => {
    if (event.key === "Enter") quickCreateActivity();
  });

  $$(".tab").forEach((tab) => {
    tab.addEventListener("click", () => switchView(tab.dataset.view));
  });

  $("#searchInput").addEventListener("input", renderListsOnly);
  $("#sortSelect").addEventListener("change", renderListsOnly);
  $("#themeToggle").addEventListener("click", toggleTheme);
  $("#exportBtn").addEventListener("click", exportData);
  $("#importFile").addEventListener("change", importData);

  $("#googleLogin")?.addEventListener("click", signInWithGoogle);
  $("#emailLogin")?.addEventListener("click", signInWithEmail);
  $("#emailSignup")?.addEventListener("click", signUpWithEmail);
  $("#logoutBtn")?.addEventListener("click", signOutUser);

  $("#activityForm").addEventListener("submit", saveActivityFromDialog);
  $("#closeDialog").addEventListener("click", closeActivityDialog);
  $("#cancelActivity").addEventListener("click", closeActivityDialog);
  $("#deleteActivity").addEventListener("click", deleteCurrentActivity);
  $("#addSubtaskLine").addEventListener("click", () => addSubtaskEditorLine(""));

  $("#addCategoryBtn").addEventListener("click", () => $("#categoryDialog").showModal());
  $("#closeCategoryDialog").addEventListener("click", () => $("#categoryDialog").close());
  $("#categoryForm").addEventListener("submit", createCategory);

  $("#quickNotes").addEventListener("input", () => {
    state.quickNotes = $("#quickNotes").value;
    $("#notesStatus").textContent = "Saving...";
    saveState();
    setTimeout(() => ($("#notesStatus").textContent = "Saved"), 350);
  });

  $("#todayFilters").addEventListener("click", (event) => {
    if (!event.target.matches(".pill")) return;
    todayFilter = event.target.dataset.filter;
    setActivePill("#todayFilters", todayFilter);
    renderListsOnly();
  });

  $("#activityFilters").addEventListener("click", (event) => {
    if (!event.target.matches(".pill")) return;
    activityFilter = event.target.dataset.filter;
    setActivePill("#activityFilters", activityFilter);
    renderListsOnly();
  });

  $("#timerStart").addEventListener("click", toggleTimer);
  $("#timerReset").addEventListener("click", resetTimer);

  document.addEventListener("keydown", (event) => {
    const isTyping = ["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement.tagName);
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
      event.preventDefault();
      $("#quickTitle").focus();
    }
    if (event.key === "n" && !isTyping) {
      openActivityDialog();
    }
  });
}

function initFirebase() {
  updateAuthUI();

  if (!hasFirebaseConfig()) {
    setSyncStatus("Local-only mode. Add Firebase config to enable cloud sync.", "offline");
    disableAuthControls(true);
    return;
  }

  try {
    firebase.initializeApp(window.DAYFLOW_FIREBASE_CONFIG);
    auth = firebase.auth();
    db = firebase.firestore();
    firebaseReady = true;
    disableAuthControls(false);
    setSyncStatus("Cloud sync ready. Log in to continue.", "ready");

    auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL).catch(() => {});
    auth.onAuthStateChanged(async (user) => {
      currentUser = user;
      updateAuthUI();
      if (user) {
        await loadCloudState(user);
      } else {
        setSyncStatus(firebaseReady ? "Logged out. Data is local on this browser only." : "Local-only mode.", "offline");
      }
    });
  } catch (error) {
    console.error("Firebase could not start", error);
    firebaseReady = false;
    disableAuthControls(true);
    setSyncStatus("Firebase setup error. Check firebase-config.js.", "error");
  }
}

function hasFirebaseConfig() {
  const config = window.DAYFLOW_FIREBASE_CONFIG;
  if (!window.firebase || !config) return false;
  const required = ["apiKey", "authDomain", "projectId", "appId"];
  return required.every((key) => {
    const value = String(config[key] || "");
    return value && !value.includes("PASTE_") && !value.includes("YOUR_");
  });
}

function cloudDocRef(uid = currentUser?.uid) {
  if (!db || !uid) return null;
  return db.collection(CLOUD_COLLECTION).doc(uid).collection(CLOUD_SUBCOLLECTION).doc(CLOUD_DOC_ID);
}

async function loadCloudState(user) {
  const ref = cloudDocRef(user.uid);
  if (!ref) return;
  isLoadingCloud = true;
  setSyncStatus("Loading your cloud planner...", "syncing");

  try {
    const snapshot = await ref.get();
    const localBackupExists = Boolean(localStorage.getItem(STORAGE_KEY));

    if (snapshot.exists && snapshot.data()?.state) {
      state = normalizeState(snapshot.data().state, emptyState());
      saveLocalState();
      render();
      setSyncStatus("Cloud planner loaded.", "ready");
    } else if (localBackupExists) {
      const shouldImport = confirm("This account has no cloud planner yet. Import the planner saved in this browser to your account?");
      if (shouldImport) {
        await saveCloudNow();
        setSyncStatus("Imported this browser's planner to cloud.", "ready");
      } else {
        state = emptyState();
        saveLocalState();
        render();
        await saveCloudNow();
        setSyncStatus("Started a new cloud planner.", "ready");
      }
    } else {
      state = emptyState();
      saveLocalState();
      render();
      await saveCloudNow();
      setSyncStatus("Started a new cloud planner.", "ready");
    }
  } catch (error) {
    console.error("Could not load cloud planner", error);
    setSyncStatus("Could not load cloud data. Check Firebase rules/domain.", "error");
  } finally {
    isLoadingCloud = false;
  }
}

function scheduleCloudSave() {
  if (!firebaseReady || !currentUser || isLoadingCloud) return;
  clearTimeout(cloudSaveTimer);
  setSyncStatus("Saving...", "syncing");
  cloudSaveTimer = setTimeout(saveCloudNow, 1200);
}

async function saveCloudNow() {
  const ref = cloudDocRef();
  if (!ref) return;
  try {
    await ref.set({
      state: normalizeState(state),
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
    setSyncStatus("Saved to cloud.", "ready");
  } catch (error) {
    console.error("Could not save cloud planner", error);
    setSyncStatus("Cloud save failed. Local backup still saved.", "error");
  }
}

async function signInWithGoogle() {
  if (!auth) return showToast("Firebase is not configured yet");
  try {
    const provider = new firebase.auth.GoogleAuthProvider();
    await auth.signInWithPopup(provider);
  } catch (error) {
    console.error(error);
    showToast(authErrorMessage(error));
  }
}

async function signInWithEmail() {
  if (!auth) return showToast("Firebase is not configured yet");
  const { email, password } = getEmailCredentials();
  if (!email || !password) return showToast("Enter email and password");
  try {
    await auth.signInWithEmailAndPassword(email, password);
  } catch (error) {
    console.error(error);
    showToast(authErrorMessage(error));
  }
}

async function signUpWithEmail() {
  if (!auth) return showToast("Firebase is not configured yet");
  const { email, password } = getEmailCredentials();
  if (!email || password.length < 6) return showToast("Password must be at least 6 characters");
  try {
    await auth.createUserWithEmailAndPassword(email, password);
  } catch (error) {
    console.error(error);
    showToast(authErrorMessage(error));
  }
}

async function signOutUser() {
  if (!auth) return;
  await auth.signOut();
  currentUser = null;
  updateAuthUI();
  showToast("Logged out");
}

function getEmailCredentials() {
  return {
    email: $("#authEmail")?.value.trim() || "",
    password: $("#authPassword")?.value || ""
  };
}

function updateAuthUI() {
  const signedOut = $("#authSignedOut");
  const signedIn = $("#authSignedIn");
  if (!signedOut || !signedIn) return;

  signedOut.hidden = Boolean(currentUser);
  signedIn.hidden = !currentUser;
  if (currentUser) {
    $("#userName").textContent = currentUser.displayName || currentUser.email || "Signed-in user";
  }
}

function setSyncStatus(message, mode = "ready") {
  const status = $("#syncStatus");
  const help = $("#authHelp");
  const dot = $("#syncDot");
  if (status) status.textContent = message;
  if (help && !currentUser) help.textContent = message;
  if (dot) {
    dot.dataset.mode = mode;
    dot.title = message;
  }
}

function disableAuthControls(disabled) {
  ["#googleLogin", "#emailLogin", "#emailSignup", "#authEmail", "#authPassword"].forEach((selector) => {
    const element = $(selector);
    if (element) element.disabled = disabled;
  });
}

function authErrorMessage(error) {
  const code = error?.code || "";
  if (code.includes("popup")) return "Popup blocked. Allow popups or use email login.";
  if (code.includes("unauthorized-domain")) return "Add this GitHub Pages domain in Firebase Authentication settings.";
  if (code.includes("wrong-password") || code.includes("invalid-credential")) return "Email or password is incorrect.";
  if (code.includes("user-not-found")) return "No account found. Use Sign up first.";
  if (code.includes("email-already-in-use")) return "This email already has an account. Use Log in.";
  return "Login failed. Check Firebase setup and try again.";
}

function updateDateLine() {
  const formatter = new Intl.DateTimeFormat(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric"
  });
  $("#dateLine").textContent = formatter.format(new Date());
}

function switchView(view) {
  currentView = view;
  $$(".tab").forEach((tab) => tab.classList.toggle("active", tab.dataset.view === view));
  $$(".view").forEach((panel) => panel.classList.remove("active-view"));
  $(`#view${capitalize(view)}`).classList.add("active-view");
  $("#viewTitle").textContent = view === "today" ? "Today" : capitalize(view);
  renderListsOnly();
}

function setActivePill(container, filter) {
  $$(`${container} .pill`).forEach((pill) => pill.classList.toggle("active", pill.dataset.filter === filter));
}

function render() {
  populateCategorySelects();
  renderSidebarCategories();
  renderStats();
  renderListsOnly();
  $("#quickNotes").value = state.quickNotes;
}

function renderListsOnly() {
  renderStats();
  renderSidebarCategories();
  renderTodayList();
  renderActivityList();
  renderPlannerBoard();
  renderInsights();
}

function renderStats() {
  const open = state.activities.filter((item) => !item.done).length;
  const done = state.activities.filter((item) => item.done).length;
  const dueToday = state.activities.filter((item) => isToday(item.deadline)).length;
  const overdue = state.activities.filter((item) => isOverdue(item) && !item.done).length;
  $("#statOpen").textContent = open;
  $("#statDone").textContent = done;
  $("#statToday").textContent = dueToday;
  $("#statOverdue").textContent = overdue;
}

function renderSidebarCategories() {
  const list = $("#categoryList");
  list.innerHTML = "";
  state.categories.forEach((category) => {
    const count = state.activities.filter((item) => item.categoryId === category.id).length;
    const chip = document.createElement("div");
    chip.className = "category-chip";
    chip.innerHTML = `
      <span><span class="color-dot" style="background:${category.color}"></span>${escapeHTML(category.name)}</span>
      <span class="category-count">${count}</span>
    `;
    list.appendChild(chip);
  });
}

function populateCategorySelects() {
  const selects = [$("#quickCategory"), $("#categoryInput")];
  selects.forEach((select) => {
    const current = select.value;
    select.innerHTML = state.categories
      .map((category) => `<option value="${category.id}">${escapeHTML(category.name)}</option>`)
      .join("");
    if (current) select.value = current;
  });
}

function getVisibleActivities() {
  const query = $("#searchInput")?.value?.trim().toLowerCase() || "";
  let items = [...state.activities];

  if (query) {
    items = items.filter((item) => {
      const category = getCategory(item.categoryId)?.name || "";
      const haystack = [
        item.title,
        item.notes,
        category,
        item.priority,
        ...(item.tags || []),
        ...(item.subtasks || []).map((subtask) => subtask.title)
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(query);
    });
  }

  const sort = $("#sortSelect")?.value || "deadline";
  items.sort((a, b) => {
    if (sort === "priority") return priorityScore(b.priority) - priorityScore(a.priority);
    if (sort === "created") return new Date(b.createdAt) - new Date(a.createdAt);
    if (sort === "progress") return deadlineProgress(b).percent - deadlineProgress(a).percent;
    return new Date(a.deadline) - new Date(b.deadline);
  });
  return items;
}

function renderTodayList() {
  let items = getVisibleActivities().filter((item) => isToday(item.deadline) || !item.done || isOverdue(item));
  if (todayFilter === "open") items = items.filter((item) => !item.done);
  if (todayFilter === "done") items = items.filter((item) => item.done);
  if (todayFilter === "overdue") items = items.filter((item) => isOverdue(item) && !item.done);
  renderActivityCards($("#todayList"), items, "grid");
}

function renderActivityList() {
  let items = getVisibleActivities();
  if (activityFilter === "high") items = items.filter((item) => item.priority === "high");
  if (activityFilter === "uncategorized") items = items.filter((item) => !getCategory(item.categoryId));
  renderActivityCards($("#activityList"), items, "list");
}

function renderActivityCards(container, items) {
  container.innerHTML = "";
  if (!items.length) {
    container.innerHTML = `
      <div class="empty-state">
        <strong>Nothing here yet.</strong>
        Add an activity, adjust the filter, or press Ctrl/⌘ + K for quick capture.
      </div>`;
    return;
  }
  items.forEach((item) => container.appendChild(activityCard(item)));
}

function activityCard(item) {
  const category = getCategory(item.categoryId) || { name: "Uncategorized", color: "#94a3b8" };
  const progress = deadlineProgress(item);
  const subtaskTotal = item.subtasks?.length || 0;
  const subtaskDone = item.subtasks?.filter((subtask) => subtask.done).length || 0;
  const card = document.createElement("article");
  card.className = `activity-card ${item.done ? "done" : ""}`;
  card.style.setProperty("--category-color", category.color);
  card.innerHTML = `
    <div class="card-head">
      <div>
        <h4 class="activity-title">${escapeHTML(item.title)}</h4>
        <div class="meta-row">
          <span class="badge"><span class="color-dot" style="background:${category.color}"></span>${escapeHTML(category.name)}</span>
          <span class="badge priority-${item.priority}">${capitalize(item.priority)}</span>
          ${item.repeat !== "none" ? `<span class="badge">↻ ${capitalize(item.repeat)}</span>` : ""}
          ${item.tags?.map((tag) => `<span class="badge">#${escapeHTML(tag)}</span>`).join("") || ""}
        </div>
      </div>
      <div class="card-actions">
        <button class="icon-btn" title="Mark done">${item.done ? "↺" : "✓"}</button>
        <button class="icon-btn" title="Edit">✎</button>
      </div>
    </div>
    <div class="progress-shell" title="${progress.label}">
      <div class="progress-bar" style="width:${progress.percent}%"></div>
    </div>
    <div class="progress-info">
      <span>${progress.label}</span>
      <span>${Math.round(progress.percent)}% elapsed</span>
    </div>
    ${subtaskTotal ? `<div class="subtasks">${item.subtasks.map((subtask) => subtaskLine(item.id, subtask)).join("")}</div>` : ""}
    ${subtaskTotal ? `<div class="progress-info"><span>Subtasks</span><span>${subtaskDone}/${subtaskTotal} complete</span></div>` : ""}
    ${item.notes ? `<p class="note-preview">${escapeHTML(truncate(item.notes, 150))}</p>` : ""}
  `;

  const [doneBtn, editBtn] = card.querySelectorAll(".icon-btn");
  doneBtn.addEventListener("click", () => toggleDone(item.id));
  editBtn.addEventListener("click", () => openActivityDialog(item.id));
  card.querySelectorAll(".subtask input").forEach((checkbox) => {
    checkbox.addEventListener("change", () => toggleSubtask(item.id, checkbox.dataset.subtaskId));
  });
  return card;
}

function subtaskLine(activityId, subtask) {
  return `
    <label class="subtask">
      <input type="checkbox" data-activity-id="${activityId}" data-subtask-id="${subtask.id}" ${subtask.done ? "checked" : ""} />
      <span class="subtask-text">${escapeHTML(subtask.title)}</span>
    </label>
  `;
}

function renderPlannerBoard() {
  const board = $("#plannerBoard");
  board.innerHTML = "";
  state.categories.forEach((category) => {
    const items = getVisibleActivities().filter((item) => item.categoryId === category.id);
    const column = document.createElement("section");
    column.className = "planner-column";
    column.innerHTML = `
      <h4><span class="color-dot" style="background:${category.color}"></span>${escapeHTML(category.name)} <span class="category-count">${items.length}</span></h4>
      <div class="column-list"></div>
    `;
    const list = column.querySelector(".column-list");
    if (!items.length) {
      list.innerHTML = `<div class="empty-state"><strong>Empty bundle</strong>Add tasks in this category.</div>`;
    } else {
      items.forEach((item) => {
        const card = document.createElement("button");
        card.className = `compact-card ${item.done ? "done" : ""}`;
        card.innerHTML = `<strong>${escapeHTML(item.title)}</strong><span class="compact-meta">${timeLeft(item.deadline)} · ${capitalize(item.priority)}</span>`;
        card.addEventListener("click", () => openActivityDialog(item.id));
        list.appendChild(card);
      });
    }
    board.appendChild(column);
  });
}

function renderInsights() {
  const total = state.activities.length;
  const done = state.activities.filter((item) => item.done).length;
  const rate = total ? Math.round((done / total) * 100) : 0;
  $("#completionRing").style.setProperty("--angle", `${rate * 3.6}deg`);
  $("#completionRing span").textContent = `${rate}%`;

  const workload = $("#workloadBars");
  workload.innerHTML = "";
  const max = Math.max(1, ...state.categories.map((category) => state.activities.filter((item) => item.categoryId === category.id && !item.done).length));
  state.categories.forEach((category) => {
    const openCount = state.activities.filter((item) => item.categoryId === category.id && !item.done).length;
    const row = document.createElement("div");
    row.className = "workload-row";
    row.innerHTML = `
      <div class="workload-label"><span>${escapeHTML(category.name)}</span><span>${openCount} open</span></div>
      <div class="progress-shell"><div class="progress-bar" style="width:${(openCount / max) * 100}%; background:${category.color}"></div></div>
    `;
    workload.appendChild(row);
  });

  const upcoming = getVisibleActivities().filter((item) => !item.done).slice(0, 6);
  $("#upcomingList").innerHTML = upcoming.length
    ? upcoming.map((item) => `<div class="compact-item"><strong>${escapeHTML(item.title)}</strong><span>${timeLeft(item.deadline)}</span></div>`).join("")
    : `<div class="empty-state"><strong>No upcoming tasks.</strong>Enjoy the quiet.</div>`;
}

function openActivityDialog(id = null) {
  const dialog = $("#activityDialog");
  const item = id ? state.activities.find((activity) => activity.id === id) : null;
  $("#modalTitle").textContent = item ? "Edit Activity" : "New Activity";
  $("#activityId").value = item?.id || "";
  $("#titleInput").value = item?.title || "";
  $("#categoryInput").value = item?.categoryId || state.categories[0]?.id || "";
  $("#priorityInput").value = item?.priority || "medium";
  $("#startInput").value = toLocalInputValue(item?.startAt || new Date().toISOString());
  $("#deadlineInput").value = toLocalInputValue(item?.deadline || new Date(Date.now() + 1000 * 60 * 60 * 24).toISOString());
  $("#tagsInput").value = item?.tags?.join(", ") || "";
  $("#repeatInput").value = item?.repeat || "none";
  $("#notesInput").value = item?.notes || "";
  $("#deleteActivity").style.visibility = item ? "visible" : "hidden";
  $("#subtaskEditor").innerHTML = "";
  (item?.subtasks?.length ? item.subtasks : [{ title: "", done: false }]).forEach((subtask) => addSubtaskEditorLine(subtask.title, subtask.done, subtask.id));
  dialog.showModal();
  $("#titleInput").focus();
}

function closeActivityDialog() {
  $("#activityDialog").close();
}

function addSubtaskEditorLine(value = "", done = false, id = uid()) {
  const line = document.createElement("div");
  line.className = "subtask-line";
  line.dataset.id = id;
  line.innerHTML = `
    <input type="text" value="${escapeAttr(value)}" placeholder="Subtask item" data-done="${done}" />
    <button type="button" class="soft-btn">Remove</button>
  `;
  line.querySelector("button").addEventListener("click", () => line.remove());
  $("#subtaskEditor").appendChild(line);
}

function saveActivityFromDialog(event) {
  event.preventDefault();
  const id = $("#activityId").value || uid();
  const existing = state.activities.find((item) => item.id === id);
  const subtasks = $$("#subtaskEditor .subtask-line")
    .map((line) => ({
      id: line.dataset.id || uid(),
      title: line.querySelector("input").value.trim(),
      done: existing?.subtasks?.find((subtask) => subtask.id === line.dataset.id)?.done || false
    }))
    .filter((subtask) => subtask.title);

  const activity = {
    id,
    title: $("#titleInput").value.trim(),
    categoryId: $("#categoryInput").value,
    priority: $("#priorityInput").value,
    createdAt: existing?.createdAt || new Date().toISOString(),
    startAt: fromLocalInputValue($("#startInput").value),
    deadline: fromLocalInputValue($("#deadlineInput").value),
    notes: $("#notesInput").value.trim(),
    tags: $("#tagsInput").value.split(",").map((tag) => tag.trim()).filter(Boolean),
    repeat: $("#repeatInput").value,
    done: existing?.done || false,
    subtasks
  };

  if (existing) {
    state.activities = state.activities.map((item) => (item.id === id ? activity : item));
    showToast("Activity updated");
  } else {
    state.activities.unshift(activity);
    showToast("Activity created");
  }
  saveState();
  closeActivityDialog();
  render();
}

function deleteCurrentActivity() {
  const id = $("#activityId").value;
  if (!id) return;
  state.activities = state.activities.filter((item) => item.id !== id);
  saveState();
  closeActivityDialog();
  render();
  showToast("Activity deleted");
}

function quickCreateActivity() {
  const title = $("#quickTitle").value.trim();
  if (!title) {
    showToast("Add a title first");
    return;
  }
  const deadline = $("#quickDue").value ? fromLocalInputValue($("#quickDue").value) : new Date(Date.now() + 1000 * 60 * 60 * 24).toISOString();
  state.activities.unshift({
    id: uid(),
    title,
    categoryId: $("#quickCategory").value || state.categories[0]?.id,
    priority: "medium",
    createdAt: new Date().toISOString(),
    startAt: new Date().toISOString(),
    deadline,
    notes: "",
    tags: [],
    repeat: "none",
    done: false,
    subtasks: []
  });
  $("#quickTitle").value = "";
  $("#quickDue").value = "";
  saveState();
  render();
  showToast("Quick activity added");
}

function createCategory(event) {
  event.preventDefault();
  const name = $("#categoryNameInput").value.trim();
  if (!name) return;
  state.categories.push({
    id: `cat-${Date.now()}`,
    name,
    color: $("#categoryColorInput").value
  });
  $("#categoryNameInput").value = "";
  saveState();
  $("#categoryDialog").close();
  render();
  showToast("Category created");
}

function toggleDone(id) {
  const item = state.activities.find((activity) => activity.id === id);
  if (!item) return;
  item.done = !item.done;

  if (item.done && item.repeat && item.repeat !== "none") {
    createRecurringCopy(item);
  }

  saveState();
  renderListsOnly();
}

function createRecurringCopy(item) {
  const nextDeadline = new Date(item.deadline);
  if (item.repeat === "daily") nextDeadline.setDate(nextDeadline.getDate() + 1);
  if (item.repeat === "weekly") nextDeadline.setDate(nextDeadline.getDate() + 7);
  if (item.repeat === "monthly") nextDeadline.setMonth(nextDeadline.getMonth() + 1);

  const nextStart = new Date(item.startAt || item.createdAt);
  if (item.repeat === "daily") nextStart.setDate(nextStart.getDate() + 1);
  if (item.repeat === "weekly") nextStart.setDate(nextStart.getDate() + 7);
  if (item.repeat === "monthly") nextStart.setMonth(nextStart.getMonth() + 1);

  const exists = state.activities.some((activity) => activity.title === item.title && activity.deadline === nextDeadline.toISOString() && !activity.done);
  if (!exists) {
    state.activities.push({
      ...item,
      id: uid(),
      createdAt: new Date().toISOString(),
      startAt: nextStart.toISOString(),
      deadline: nextDeadline.toISOString(),
      done: false,
      subtasks: item.subtasks.map((subtask) => ({ ...subtask, id: uid(), done: false }))
    });
  }
}

function toggleSubtask(activityId, subtaskId) {
  const item = state.activities.find((activity) => activity.id === activityId);
  const subtask = item?.subtasks?.find((task) => task.id === subtaskId);
  if (!subtask) return;
  subtask.done = !subtask.done;
  saveState();
  renderListsOnly();
}

function exportData() {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `dayflow-backup-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(url);
  showToast("Backup exported");
}

function importData(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const imported = JSON.parse(reader.result);
      if (!Array.isArray(imported.activities) || !Array.isArray(imported.categories)) throw new Error("Invalid backup");
      state = imported;
      saveState();
      render();
      showToast("Backup imported");
    } catch (error) {
      showToast("Could not import this file");
    }
  };
  reader.readAsText(file);
  event.target.value = "";
}

function toggleTheme() {
  const current = document.documentElement.dataset.theme;
  const next = current === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = next;
  localStorage.setItem(THEME_KEY, next);
}

function applyTheme() {
  const saved = localStorage.getItem(THEME_KEY);
  const prefersDark = window.matchMedia?.("(prefers-color-scheme: dark)").matches;
  document.documentElement.dataset.theme = saved || (prefersDark ? "dark" : "light");
}

function toggleTimer() {
  timerRunning = !timerRunning;
  $("#timerStart").textContent = timerRunning ? "Pause" : "Start";
  if (timerRunning) {
    activeTimer = setInterval(() => {
      timerSeconds -= 1;
      updateTimerDisplay();
      if (timerSeconds <= 0) {
        resetTimer();
        showToast("Focus session complete");
      }
    }, 1000);
  } else {
    clearInterval(activeTimer);
  }
}

function resetTimer() {
  clearInterval(activeTimer);
  timerRunning = false;
  timerSeconds = 25 * 60;
  $("#timerStart").textContent = "Start";
  updateTimerDisplay();
}

function updateTimerDisplay() {
  const minutes = String(Math.floor(timerSeconds / 60)).padStart(2, "0");
  const seconds = String(timerSeconds % 60).padStart(2, "0");
  $("#timerDisplay").textContent = `${minutes}:${seconds}`;
}

function getCategory(id) {
  return state.categories.find((category) => category.id === id);
}

function priorityScore(priority) {
  return { high: 3, medium: 2, low: 1 }[priority] || 0;
}

function deadlineProgress(item) {
  if (item.done) return { percent: 100, label: "Completed" };
  const start = new Date(item.startAt || item.createdAt).getTime();
  const deadline = new Date(item.deadline).getTime();
  const now = Date.now();
  if (Number.isNaN(deadline)) return { percent: 0, label: "No deadline" };
  if (now >= deadline) return { percent: 100, label: "Overdue" };
  const duration = Math.max(deadline - start, 1);
  const elapsed = Math.max(now - start, 0);
  const percent = Math.min(100, Math.max(0, (elapsed / duration) * 100));
  return { percent, label: timeLeft(item.deadline) };
}

function timeLeft(deadline) {
  const diff = new Date(deadline).getTime() - Date.now();
  const abs = Math.abs(diff);
  const minutes = Math.floor(abs / 60000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  let text;
  if (minutes < 60) text = `${minutes}m`;
  else if (hours < 24) text = `${hours}h ${minutes % 60}m`;
  else text = `${days}d ${hours % 24}h`;
  return diff < 0 ? `${text} overdue` : `${text} left`;
}

function isToday(dateValue) {
  const date = new Date(dateValue);
  const today = new Date();
  return date.getFullYear() === today.getFullYear() && date.getMonth() === today.getMonth() && date.getDate() === today.getDate();
}

function isOverdue(item) {
  return new Date(item.deadline).getTime() < Date.now();
}

function toLocalInputValue(value) {
  const date = new Date(value);
  const offset = date.getTimezoneOffset();
  const local = new Date(date.getTime() - offset * 60000);
  return local.toISOString().slice(0, 16);
}

function fromLocalInputValue(value) {
  return value ? new Date(value).toISOString() : new Date().toISOString();
}

function escapeHTML(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttr(value = "") {
  return escapeHTML(value).replaceAll("`", "&#096;");
}

function truncate(value, length) {
  return value.length > length ? `${value.slice(0, length)}...` : value;
}

function capitalize(value = "") {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function showToast(message) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(showToast.timeout);
  showToast.timeout = setTimeout(() => toast.classList.remove("show"), 2200);
}

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("service-worker.js").catch(() => {});
  });
}

init();
