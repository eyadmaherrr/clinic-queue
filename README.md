# Clinic Queue Management System

Real-time queue management system for Dr Maher Mahmoud Clinics.

## Features
- Real-time queue updates with Socket.io
- Patient tracking via phone number
- TV display screen for waiting room
- Doctor screen with patient history
- Priority and missed patient marking
- WhatsApp integration
- Persistent storage with SQLite

## Deployment on Render

1. Push code to GitHub
2. Connect repository to Render
3. Add environment variables:
   - `NODE_ENV=production`
   - `SESSION_SECRET=your-secret-key`
   - `BASE_URL=https://your-app.onrender.com`
4. Deploy!

## Local Development
```bash
npm install
npm run dev