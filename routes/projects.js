const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { body, validationResult } = require('express-validator');
const db = require('../database/db');
const { authenticate, requireAdmin, requireProjectAccess, requireProjectAdmin } = require('../middleware/auth');

// GET /api/projects - Get all projects for the current user
router.get('/', authenticate, (req, res) => {
  try {
    let projects;
    if (req.user.role === 'admin') {
      projects = db.prepare(`
        SELECT p.*,
          u.name as owner_name, u.email as owner_email,
          COUNT(DISTINCT pm.user_id) as member_count,
          COUNT(DISTINCT t.id) as task_count,
          COUNT(DISTINCT CASE WHEN t.status = 'done' THEN t.id END) as completed_tasks
        FROM projects p
        LEFT JOIN users u ON p.owner_id = u.id
        LEFT JOIN project_members pm ON p.id = pm.project_id
        LEFT JOIN tasks t ON p.id = t.project_id
        GROUP BY p.id
        ORDER BY p.created_at DESC
      `).all();
    } else {
      projects = db.prepare(`
        SELECT p.*,
          u.name as owner_name, u.email as owner_email,
          COUNT(DISTINCT pm2.user_id) as member_count,
          COUNT(DISTINCT t.id) as task_count,
          COUNT(DISTINCT CASE WHEN t.status = 'done' THEN t.id END) as completed_tasks,
          pm.role as user_project_role
        FROM projects p
        JOIN project_members pm ON p.id = pm.project_id AND pm.user_id = ?
        LEFT JOIN users u ON p.owner_id = u.id
        LEFT JOIN project_members pm2 ON p.id = pm2.project_id
        LEFT JOIN tasks t ON p.id = t.project_id
        GROUP BY p.id
        ORDER BY p.created_at DESC
      `).all(req.user.id);
    }
    res.json({ projects });
  } catch (err) {
    console.error('Get projects error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/projects - Create a new project
router.post('/', authenticate, [
  body('name').trim().isLength({ min: 2, max: 100 }).withMessage('Project name must be 2-100 chars'),
  body('description').optional().trim().isLength({ max: 500 }),
  body('color').optional().matches(/^#[0-9A-Fa-f]{6}$/).withMessage('Invalid color hex'),
  body('due_date').optional().isDate().withMessage('Invalid date format')
], (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  const { name, description, color = '#6366f1', due_date } = req.body;
  const projectId = uuidv4();
  const memberId = uuidv4();

  try {
    const createProject = db.transaction(() => {
      db.prepare(`
        INSERT INTO projects (id, name, description, color, owner_id, due_date)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(projectId, name, description || null, color, req.user.id, due_date || null);

      // Auto-add creator as admin member
      db.prepare(`
        INSERT INTO project_members (id, project_id, user_id, role)
        VALUES (?, ?, ?, 'admin')
      `).run(memberId, projectId, req.user.id);

      // Log activity
      db.prepare(`INSERT INTO activity_logs (id, user_id, action, entity_type, entity_id, metadata)
        VALUES (?, ?, ?, ?, ?, ?)`).run(
        uuidv4(), req.user.id, 'created_project', 'project', projectId,
        JSON.stringify({ name })
      );
    });

    createProject();

    const project = db.prepare(`
      SELECT p.*, u.name as owner_name, 0 as member_count, 0 as task_count
      FROM projects p JOIN users u ON p.owner_id = u.id
      WHERE p.id = ?
    `).get(projectId);

    res.status(201).json({ message: 'Project created', project });
  } catch (err) {
    console.error('Create project error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/projects/:id - Get project details
router.get('/:id', authenticate, requireProjectAccess, (req, res) => {
  try {
    const project = db.prepare(`
      SELECT p.*, u.name as owner_name, u.email as owner_email
      FROM projects p JOIN users u ON p.owner_id = u.id
      WHERE p.id = ?
    `).get(req.params.id);

    if (!project) return res.status(404).json({ error: 'Project not found' });

    const members = db.prepare(`
      SELECT u.id, u.name, u.email, u.role as global_role, u.avatar, pm.role as project_role, pm.joined_at
      FROM project_members pm JOIN users u ON pm.user_id = u.id
      WHERE pm.project_id = ?
      ORDER BY pm.joined_at ASC
    `).all(req.params.id);

    const taskStats = db.prepare(`
      SELECT
        COUNT(*) as total,
        COUNT(CASE WHEN status='todo' THEN 1 END) as todo,
        COUNT(CASE WHEN status='in_progress' THEN 1 END) as in_progress,
        COUNT(CASE WHEN status='review' THEN 1 END) as review,
        COUNT(CASE WHEN status='done' THEN 1 END) as done,
        COUNT(CASE WHEN due_date < date('now') AND status != 'done' THEN 1 END) as overdue
      FROM tasks WHERE project_id = ?
    `).get(req.params.id);

    res.json({ project, members, taskStats, userProjectRole: req.projectRole });
  } catch (err) {
    console.error('Get project error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/projects/:id - Update project
router.put('/:id', authenticate, requireProjectAdmin, [
  body('name').optional().trim().isLength({ min: 2, max: 100 }),
  body('status').optional().isIn(['active', 'completed', 'archived', 'on_hold']),
  body('color').optional().matches(/^#[0-9A-Fa-f]{6}$/),
  body('due_date').optional().isDate()
], (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  const { name, description, status, color, due_date } = req.body;
  const updates = [];
  const params = [];

  if (name !== undefined) { updates.push('name = ?'); params.push(name); }
  if (description !== undefined) { updates.push('description = ?'); params.push(description); }
  if (status !== undefined) { updates.push('status = ?'); params.push(status); }
  if (color !== undefined) { updates.push('color = ?'); params.push(color); }
  if (due_date !== undefined) { updates.push('due_date = ?'); params.push(due_date); }

  if (updates.length === 0) return res.status(400).json({ error: 'No fields to update' });

  updates.push('updated_at = CURRENT_TIMESTAMP');
  params.push(req.params.id);

  try {
    db.prepare(`UPDATE projects SET ${updates.join(', ')} WHERE id = ?`).run(...params);

    // Log
    db.prepare(`INSERT INTO activity_logs (id, user_id, action, entity_type, entity_id, metadata) VALUES (?, ?, ?, ?, ?, ?)`)
      .run(uuidv4(), req.user.id, 'updated_project', 'project', req.params.id, JSON.stringify({ updates: req.body }));

    const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);
    res.json({ message: 'Project updated', project });
  } catch (err) {
    console.error('Update project error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/projects/:id
router.delete('/:id', authenticate, requireProjectAdmin, (req, res) => {
  try {
    const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);
    if (!project) return res.status(404).json({ error: 'Project not found' });

    // Only owner or global admin can delete
    if (project.owner_id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Only the project owner can delete this project' });
    }

    db.prepare('DELETE FROM projects WHERE id = ?').run(req.params.id);
    res.json({ message: 'Project deleted successfully' });
  } catch (err) {
    console.error('Delete project error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/projects/:id/members - Add member to project
router.post('/:id/members', authenticate, requireProjectAdmin, [
  body('email').isEmail().withMessage('Valid email required'),
  body('role').optional().isIn(['admin', 'member'])
], (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  const { email, role = 'member' } = req.body;

  try {
    const user = db.prepare('SELECT id, name, email FROM users WHERE email = ?').get(email);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const existing = db.prepare('SELECT id FROM project_members WHERE project_id = ? AND user_id = ?')
      .get(req.params.id, user.id);
    if (existing) return res.status(409).json({ error: 'User is already a member' });

    const memberId = uuidv4();
    db.prepare('INSERT INTO project_members (id, project_id, user_id, role) VALUES (?, ?, ?, ?)')
      .run(memberId, req.params.id, user.id, role);

    // Notify the user
    db.prepare(`INSERT INTO notifications (id, user_id, title, message, type, entity_type, entity_id)
      VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
      uuidv4(), user.id, 'Added to Project',
      `You have been added to a project as ${role}`, 'info', 'project', req.params.id
    );

    // Log
    db.prepare(`INSERT INTO activity_logs (id, user_id, action, entity_type, entity_id, metadata) VALUES (?, ?, ?, ?, ?, ?)`)
      .run(uuidv4(), req.user.id, 'added_member', 'project', req.params.id, JSON.stringify({ memberId: user.id, role }));

    res.status(201).json({ message: `${user.name} added to project`, member: { ...user, project_role: role } });
  } catch (err) {
    console.error('Add member error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/projects/:id/members/:userId - Remove member
router.delete('/:id/members/:userId', authenticate, requireProjectAdmin, (req, res) => {
  try {
    const project = db.prepare('SELECT owner_id FROM projects WHERE id = ?').get(req.params.id);
    if (req.params.userId === project.owner_id) {
      return res.status(400).json({ error: 'Cannot remove the project owner' });
    }

    db.prepare('DELETE FROM project_members WHERE project_id = ? AND user_id = ?')
      .run(req.params.id, req.params.userId);

    res.json({ message: 'Member removed from project' });
  } catch (err) {
    console.error('Remove member error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
