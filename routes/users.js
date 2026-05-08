const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { body, validationResult } = require('express-validator');
const db = require('../database/db');
const { authenticate, requireAdmin } = require('../middleware/auth');

// GET /api/users - Get all users (for member assignment, etc.)
router.get('/', authenticate, (req, res) => {
  try {
    const users = db.prepare(`
      SELECT id, name, email, role, avatar, created_at FROM users ORDER BY name ASC
    `).all();
    res.json({ users });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/users/:id - Get user by ID
router.get('/:id', authenticate, (req, res) => {
  try {
    const user = db.prepare(`
      SELECT id, name, email, role, avatar, created_at FROM users WHERE id = ?
    `).get(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({ user });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/users/:id/role - Admin: change user role
router.put('/:id/role', authenticate, requireAdmin, [
  body('role').isIn(['admin', 'member']).withMessage('Role must be admin or member')
], (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  try {
    const user = db.prepare('SELECT id FROM users WHERE id = ?').get(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (req.params.id === req.user.id) return res.status(400).json({ error: 'Cannot change your own role' });

    db.prepare('UPDATE users SET role = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .run(req.body.role, req.params.id);

    res.json({ message: 'User role updated' });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/users/:id - Admin: delete user
router.delete('/:id', authenticate, requireAdmin, (req, res) => {
  try {
    if (req.params.id === req.user.id) return res.status(400).json({ error: 'Cannot delete your own account' });
    db.prepare('DELETE FROM users WHERE id = ?').run(req.params.id);
    res.json({ message: 'User deleted successfully' });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
