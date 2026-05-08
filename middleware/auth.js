const jwt = require('jsonwebtoken');
const db = require('../database/db');

const authenticate = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

  if (!token) {
    return res.status(401).json({ error: 'Access denied. No token provided.' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = db.prepare('SELECT id, name, email, role, avatar FROM users WHERE id = ?').get(decoded.userId);

    if (!user) {
      return res.status(401).json({ error: 'Invalid token. User not found.' });
    }

    req.user = user;
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expired. Please login again.' });
    }
    return res.status(403).json({ error: 'Invalid token.' });
  }
};

const requireAdmin = (req, res, next) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Access denied. Admin role required.' });
  }
  next();
};

const requireProjectAccess = (req, res, next) => {
  const projectId = req.params.projectId || req.params.id;
  const userId = req.user.id;

  const membership = db.prepare(`
    SELECT pm.role FROM project_members pm
    WHERE pm.project_id = ? AND pm.user_id = ?
  `).get(projectId, userId);

  if (!membership && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Access denied. You are not a member of this project.' });
  }

  req.projectRole = membership ? membership.role : 'admin';
  next();
};

const requireProjectAdmin = (req, res, next) => {
  const projectId = req.params.projectId || req.params.id;
  const userId = req.user.id;

  // Global admin always passes
  if (req.user.role === 'admin') {
    req.projectRole = 'admin';
    return next();
  }

  const membership = db.prepare(`
    SELECT pm.role FROM project_members pm
    WHERE pm.project_id = ? AND pm.user_id = ?
  `).get(projectId, userId);

  if (!membership || membership.role !== 'admin') {
    return res.status(403).json({ error: 'Access denied. Project admin role required.' });
  }

  req.projectRole = 'admin';
  next();
};

module.exports = { authenticate, requireAdmin, requireProjectAccess, requireProjectAdmin };
