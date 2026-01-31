# Ghanti (Bell) App

This is a tiny static site + server that plays a temple bell sound and counts unique visitors.

Server (Node.js)

- Serves the static site and provides a simple unique-visitor counter using cookies.

Quick start:

1. Install dependencies:

```powershell
cd C:\Users\ranji\Desktop\bell
npm install
```

2. Run the server:

```powershell
npm start
```

3. Open http://localhost:3000 in your browser (the server also serves the static files so cookies work).

Notes

- The server stores counts in `counts.json` in the project folder.
- The visitor counter increments once per browser (cookie `ghanti_uid`).
- For production use, use a proper database and secure cookie settings.
