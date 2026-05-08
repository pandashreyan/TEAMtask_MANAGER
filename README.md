# 🚀 Team Task Manager

Welcome to **Team Task Manager**! This is a robust, full-stack web application designed to help teams collaborate, organize projects, and track tasks efficiently. Whether you're managing a small side hustle or coordinating a large team, this tool provides everything you need to stay on top of your goals.

## ✨ Features

- **🔐 Secure Authentication:** Full signup and login flows using JWT (JSON Web Tokens) and securely hashed passwords.
- **👥 Role-Based Access Control (RBAC):** Built-in Admin and Member roles ensure that users only see and edit what they're allowed to.
- **📁 Project Management:** Create projects, set due dates, and invite team members to collaborate.
- **✅ Task Tracking:** Create, assign, and track tasks through customizable statuses (To Do, In Progress, Review, Done).
- **📊 Real-time Dashboard:** Get a bird's-eye view of overdue tasks, project progress, and recent activity.
- **⚡ Lightning Fast:** Powered by a lightweight Express.js backend and a lightning-fast SQLite database.

## 🛠️ Technology Stack

- **Frontend:** Vanilla HTML5, CSS3, and JavaScript (No bulky frameworks, just pure performance!)
- **Backend:** Node.js & Express.js
- **Database:** SQLite (using `better-sqlite3` for high-performance synchronous execution)
- **Security:** `bcryptjs` for password hashing, `helmet` for HTTP header security, and rate limiting to prevent abuse.

## 💻 Running the App Locally

Want to test it out on your own machine? It's super simple!

### Prerequisites
Make sure you have [Node.js](https://nodejs.org/) (v18 or higher) installed on your computer.

### Setup Instructions

1. **Clone the repository:**
   ```bash
   git clone https://github.com/pandashreyan/TEAMtask_MANAGER.git
   cd TEAMtask_MANAGER
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Set up your environment variables:**
   Copy the `.env.example` file to `.env` and fill in your secrets.
   ```bash
   cp .env.example .env
   ```

4. **Start the server:**
   ```bash
   npm run dev
   ```
   *The server will start on `http://localhost:3000` (or whatever port you specified in your `.env`). The database will be created automatically on your first run!*

## 🚂 Deployment

This application is fully optimized for deployment on [Railway](https://railway.app/). 

**Important Note for Railway Deployments:**
Because Railway uses ephemeral file systems, make sure to add a **Persistent Volume** mounted to `/app/data` and set your `DATABASE_PATH` environment variable to `/app/data/taskmanager.db`. This ensures your SQLite database isn't deleted between deployments!

## 🤝 Contributing
Feel free to fork this project, submit pull requests, or open issues if you find bugs or want to request new features. Let's build something awesome together!

---
*Built with ❤️ for better team collaboration.*
