# DayFlow Planner

A clean GitHub Pages-ready to-do list, daily planner, activity tracker, and notes dashboard.

## What is included

- Activities with deadline progress bars
- Subtasks under each activity
- Completed tasks crossed out and visually softened
- Custom categories/bundles
- Quick notes with autosave
- Today, Activities, Planner, Notes, and Insights views
- Search, filters, sorting, priorities, tags, recurring task copies
- Focus timer
- Export/import JSON backup
- Local browser storage fallback
- Optional Firebase login + cloud sync across devices

---

# Easiest setup: local-only version

Upload these files to a GitHub repository and enable GitHub Pages.

This works immediately, but each user’s data is saved only in their own browser.

---

# Optional setup: login + cloud sync with Firebase

Use this if you want users to log in and see the same planner data on phone, laptop, and another browser.

You do not need a paid server. The app can stay on GitHub Pages.

## Step 1 — Create Firebase project

1. Go to Firebase Console.
2. Click **Add project**.
3. Give it any name, for example `dayflow-planner`.
4. You can disable Google Analytics to keep setup simple.
5. Finish creating the project.

## Step 2 — Add a Web App

1. In the Firebase project overview, click the **Web** icon: `</>`.
2. App nickname: `DayFlow Web`.
3. Do **not** enable Firebase Hosting. You are using GitHub Pages.
4. Click **Register app**.
5. Firebase will show a `firebaseConfig` object. Copy the values.

## Step 3 — Paste config into `firebase-config.js`

Open this file:

```text
firebase-config.js
```

Replace the placeholder values with your Firebase values.

Note: Firebase web config values are meant to be used in frontend apps. Your real protection is the Firestore security rules above, not hiding `firebase-config.js`.

Example shape:

```js
window.DAYFLOW_FIREBASE_CONFIG = {
  apiKey: "your-api-key",
  authDomain: "your-project.firebaseapp.com",
  projectId: "your-project",
  storageBucket: "your-project.appspot.com",
  messagingSenderId: "123456789",
  appId: "1:123456789:web:abcdef"
};
```

## Step 4 — Enable login methods

In Firebase Console:

1. Go to **Authentication**.
2. Click **Get started**.
3. Open **Sign-in method**.
4. Enable **Google**.
5. Enable **Email/Password**.

## Step 5 — Add your GitHub Pages domain

In Firebase Console:

1. Go to **Authentication**.
2. Open **Settings**.
3. Open **Authorized domains**.
4. Add your GitHub Pages domain, for example:

```text
yourusername.github.io
```

Do not include `https://`.

## Step 6 — Create Firestore database

In Firebase Console:

1. Go to **Firestore Database**.
2. Click **Create database**.
3. Choose **Production mode**.
4. Choose a nearby region.
5. Create the database.

## Step 7 — Add security rules

In Firebase Console:

1. Go to **Firestore Database**.
2. Open the **Rules** tab.
3. Replace the rules with this:

```js
rules_version = '2';

service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{userId}/{document=**} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
  }
}
```

4. Click **Publish**.

These rules mean every user can only read and write their own planner.

## Step 8 — Upload to GitHub

Upload all files to your GitHub repository:

```text
index.html
styles.css
app.js
firebase-config.js
service-worker.js
manifest.webmanifest
assets/icon.svg
.nojekyll
.gitignore
README.md
```

Then enable GitHub Pages from **Settings → Pages**.

---

# How the sync works

- Without login: data is saved in the current browser using localStorage.
- With login: data is saved in Firestore at this path:

```text
users/{firebaseUserId}/planner/main
```

So each user has a separate private planner.

When an existing local user logs in for the first time, the app asks if they want to import this browser’s planner into their cloud account.

---

# Important free-plan advice

To stay free, use Google login and email/password login. Avoid phone/SMS login because SMS verification can cost money.

The app uses debounced autosave, so it waits briefly before saving to the cloud instead of saving every single typed letter.
