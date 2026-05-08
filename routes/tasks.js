const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { body, query, validationResult } = require('express-validator');
const db = require('../database/db');
const { authenticate, requireProjectAccess, requireProjectAdmin } = require('../middleware/auth');

// GET /api/tasks - Get all tasks for the current user (cross-project)
router.get('/', authenticate, (req, res) => {
  try {
    const { status, priority, project_id, assignee_id, overdue, search } = req.query;

    let sql = `
      SELECT t.*, 
        p.name as project_name, p.color as project_color,
        u.name as assignee_name, u.avatar as assignee_avatar,
        c.name as creator_name
      FROM tasks t
      JOIN projects p ON t.project_id = p.id
      LEFT JOIN users u ON t.assignee_id = u.id
      LEFT JOIN users c ON t.creator_id = c.id
    `;

    const conditions = [];
    const params = [];

    if (req.user.role !== 'admin') {
      sql += ` JOIN project_members pm ON t.project_id = pm.project_id AND pm.user_id = ? `;
      params.push(req.user.id);
    }

    if (status) { conditions.push('t.status = ?'); params.push(status); }
    if (priority) { conditions.push('t.priority = ?'); params.push(priority); }
    if (project_id) { conditions.push('t.project_id = ?'); params.push(project_id); }
    if (assignee_id) { conditions.push('t.assignee_id = ?'); params.push(assignee_id); }
    if (overdue === 'true') { conditions.push("t.due_date < date('now') AND t.status != 'done'"); }
    if (search) { conditions.push("(t.title LIKE ? OR t.description LIKE ?)"); params.push(`%${search}%`, `%${search}%`); }

    if (conditions.length > 0) sql += ' WHERE ' + conditions.join(' AND ');
    sql += ' ORDER BY t.created_at DESC';

    const tasks = db.prepare(sql).all(...params);
    res.json({ tasks });
  } catch (err) {
    console.error('Get tasks error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/tasks/project/:projectId - Get tasks for a specific project
router.get('/project/:projectId', authenticate, requireProjectAccess, (req, res) => {
  try {
    const { status, priority, assignee_id } = req.query;
    const conditions = ['t.project_id = ?'];
    const params = [req.params.projectId];

    if (status) { conditions.push('t.status = ?'); params.push(status); }
    if (priority) { conditions.push('t.priority = ?'); params.push(priority); }
    if (assignee_id) { conditions.push('t.assignee_id = ?'); params.push(assignee_id); }

    const tasks = db.prepare(`
      SELECT t.*,
        u.name as assignee_name, u.avatar as assignee_avatar, u.email as assignee_email,
        c.name as creator_name
      FROM tasks t
      LEFT JOIN users u ON t.assignee_id = u.id
      LEFT JOIN users c ON t.creator_id = c.id
      WHERE ${conditions.join(' AND ')}
      ORDER BY 
        CASE t.priority WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END,
        t.due_date ASC NULLS LAST,
        t.created_at DESC
    `).all(...params);

    res.json({ tasks });
  } catch (err) {
    console.error('Get project tasks error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/tasks - Create a new task
router.post('/', authenticate, [
  body('title').trim().isLength({ min: 2, max: 200 }).withMessage('Title must be 2-200 chars'),
  body('description').optional().trim().isLength({ max: 2000 }),
  body('project_id').isUUID().withMessage('Valid project ID required'),
  body('priority').optional().isIn(['low', 'medium', 'high', 'critical']),
  body('assignee_id').optional().isUUID(),
  body('due_date').optional().isDate(),
  body('estimated_hours').optional().isFloat({ min: 0 }),
  body('tags').optional().isArray()
], (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  const { title, description, project_id, priority = 'medium', assignee_id, due_date, estimated_hours = 0, tags = [] } = req.body;

  try {
    // Check user has access to the project
    if (req.user.role !== 'admin') {
      const membership = db.prepare('SELECT id FROM project_members WHERE project_id = ? AND user_id = ?')
        .get(project_id, req.user.id);
      if (!membership) return res.status(403).json({ error: 'You are not a member of this project' });
    }

    // Validate assignee is in the project
    if (assignee_id) {
      const assigneeMember = db.prepare('SELECT id FROM project_members WHERE project_id = ? AND user_id = ?')
        .get(project_id, assignee_id);
      if (!assigneeMember && req.user.role !== 'admin') {
        return res.status(400).json({ error: 'Assignee must be a project member' });
      }
    }

    const taskId = uuidv4();
    db.prepare(`
      INSERT INTO tasks (id, title, description, project_id, priority, assignee_id, creator_id, due_date, estimated_hours, tags)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(taskId, title, description || null, project_id, priority,
      assignee_id || null, req.user.id, due_date || null, estimated_hours, JSON.stringify(tags));

    // Notify assignee
    if (assignee_id && assignee_id !== req.user.id) {
      db.prepare(`INSERT INTO notifications (id, user_id, title, message, type, entity_type, entity_id) VALUES (?, ?, ?, ?, ?, ?, ?)`)
        .run(uuidv4(), assignee_id, 'New Task Assigned', `You have been assigned: "${title}"`, 'task', 'task', taskId);
    }

    // Log activity
    db.prepare(`INSERT INTO activity_logs (id, user_id, action, entity_type, entity_id, metadata) VALUES (?, ?, ?, ?, ?, ?)`)
      .run(uuidv4(), req.user.id, 'created_task', 'task', taskId, JSON.stringify({ title, project_id }));

    const task = db.prepare(`
      SELECT t.*, u.name as assignee_name, u.avatar as assignee_avatar, c.name as creator_name
      FROM tasks t
      LEFT JOIN users u ON t.assignee_id = u.id
      LEFT JOIN users c ON t.creator_id = c.id
      WHERE t.id = ?
    `).get(taskId);

    res.status(201).json({ message: 'Task created', task });
  } catch (err) {
    console.error('Create task error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/tasks/:id - Get task details
router.get('/:id', authenticate, (req, res) => {
  try {
    const task = db.prepare(`
      SELECT t.*, 
        p.name as project_name, p.color as project_color,
        u.name as assignee_name, u.avatar as assignee_avatar, u.email as assignee_email,
        c.name as creator_name, c.email as creator_email
      FROM tasks t
      JOIN projects p ON t.project_id = p.id
      LEFT JOIN users u ON t.assignee_id = u.id
      LEFT JOIN users c ON t.creator_id = c.id
      WHERE t.id = ?
    `).get(req.params.id);

    if (!task) return res.status(404).json({ error: 'Task not found' });

    // Check access
    if (req.user.role !== 'admin') {
      const membership = db.prepare('SELECT id FROM project_members WHERE project_id = ? AND user_id = ?')
        .get(task.project_id, req.user.id);
      if (!membership) return res.status(403).json({ error: 'Access denied' });
    }

    const comments = db.prepare(`
      SELECT cm.*, u.name as user_name, u.avatar
      FROM comments cm JOIN users u ON cm.user_id = u.id
      WHERE cm.task_id = ?
      ORDER BY cm.created_at ASC
    `).all(req.params.id);

    res.json({ task, comments });
  } catch (err) {
    console.error('Get task error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/tasks/:id - Update task
router.put('/:id', authenticate, [
  body('title').optional().trim().isLength({ min: 2, max: 200 }),
  body('status').optional().isIn(['todo', 'in_progress', 'review', 'done']),
  body('priority').optional().isIn(['low', 'medium', 'high', 'critical']),
  body('assignee_id').optional(),
  body('due_date').optional(),
  body('estimated_hours').optional().isFloat({ min: 0 }),
  body('actual_hours').optional().isFloat({ min: 0 }),
  body('tags').optional().isArray()
], (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  try {
    const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id);
    if (!task) return res.status(404).json({ error: 'Task not found' });

    // Check access
    if (req.user.role !== 'admin') {
      const membership = db.prepare('SELECT role FROM project_members WHERE project_id = ? AND user_id = ?')
        .get(task.project_id, req.user.id);
      if (!membership) return res.status(403).json({ error: 'Access denied' });

      // Only assignee or project admin can update certain fields
      const isAssignee = task.assignee_id === req.user.id;
      const isProjectAdmin = membership.role === 'admin';
      const isCreator = task.creator_id === req.user.id;

      if (!isAssignee && !isProjectAdmin && !isCreator) {
        return res.status(403).json({ error: 'You do not have permission to update this task' });
      }
    }

    const { title, description, status, priority, assignee_id, due_date, estimated_hours, actual_hours, tags } = req.body;
    const updates = [];
    const params = [];
    const oldStatus = task.status;

    if (title !== undefined) { updates.push('title = ?'); params.push(title); }
    if (description !== undefined) { updates.push('description = ?'); params.push(description); }
    if (status !== undefined) { updates.push('status = ?'); params.push(status); }
    if (priority !== undefined) { updates.push('priority = ?'); params.push(priority); }
    if (assignee_id !== undefined) { updates.push('assignee_id = ?'); params.push(assignee_id || null); }
    if (due_date !== undefined) { updates.push('due_date = ?'); params.push(due_date || null); }
    if (estimated_hours !== undefined) { updates.push('estimated_hours = ?'); params.push(estimated_hours); }
    if (actual_hours !== undefined) { updates.push('actual_hours = ?'); params.push(actual_hours); }
    if (tags !== undefined) { updates.push('tags = ?'); params.push(JSON.stringify(tags)); }

    if (updates.length === 0) return res.status(400).json({ error: 'No fields to update' });

    updates.push('updated_at = CURRENT_TIMESTAMP');
    params.push(req.params.id);

    db.prepare(`UPDATE tasks SET ${updates.join(', ')} WHERE id = ?`).run(...params);

    // Notify on status change
    if (status && status !== oldStatus && task.assignee_id && task.assignee_id !== req.user.id) {
      db.prepare(`INSERT INTO notifications (id, user_id, title, message, type, entity_type, entity_id) VALUES (?, ?, ?, ?, ?, ?, ?)`)
        .run(uuidv4(), task.assignee_id, 'Task Updated', `Task "${task.title}" status changed to ${status}`, 'info', 'task', task.id);
    }

    // Notify new assignee
    if (assignee_id && assignee_id !== task.assignee_id && assignee_id !== req.user.id) {
      db.prepare(`INSERT INTO notifications (id, user_id, title, message, type, entity_type, entity_id) VALUES (?, ?, ?, ?, ?, ?, ?)`)
        .run(uuidv4(), assignee_id, 'Task Assigned', `You have been assigned: "${task.title}"`, 'task', 'task', task.id);
    }

    // Log
    db.prepare(`INSERT INTO activity_logs (id, user_id, action, entity_type, entity_id, metadata) VALUES (?, ?, ?, ?, ?, ?)`)
      .run(uuidv4(), req.user.id, 'updated_task', 'task', task.id, JSON.stringify({ updates: req.body }));

    const updatedTask = db.prepare(`
      SELECT t.*, u.name as assignee_name, u.avatar as assignee_avatar, c.name as creator_name
      FROM tasks t LEFT JOIN users u ON t.assignee_id = u.id LEFT JOIN users c ON t.creator_id = c.id
      WHERE t.id = ?
    `).get(req.params.id);

    res.json({ message: 'Task updated', task: updatedTask });
  } catch (err) {
    console.error('Update task error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/tasks/:id
router.delete('/:id', authenticate, (req, res) => {
  try {
    const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id);
    if (!task) return res.status(404).json({ error: 'Task not found' });

    if (req.user.role !== 'admin') {
      const membership = db.prepare('SELECT role FROM project_members WHERE project_id = ? AND user_id = ?')
        .get(task.project_id, req.user.id);
      if (!membership) return res.status(403).json({ error: 'Access denied' });
      if (membership.role !== 'admin' && task.creator_id !== req.user.id) {
        return res.status(403).json({ error: 'Only project admins or task creators can delete tasks' });
      }
    }

    db.prepare('DELETE FROM tasks WHERE id = ?').run(req.params.id);
    res.json({ message: 'Task deleted successfully' });
  } catch (err) {
    console.error('Delete task error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/tasks/:id/comments - Add comment
router.post('/:id/comments', authenticate, [
  body('content').trim().isLength({ min: 1, max: 2000 }).withMessage('Comment must be 1-2000 chars')
], (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  try {
    const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id);
    if (!task) return res.status(404).json({ error: 'Task not found' });

    if (req.user.role !== 'admin') {
      const membership = db.prepare('SELECT id FROM project_members WHERE project_id = ? AND user_id = ?')
        .get(task.project_id, req.user.id);
      if (!membership) return res.status(403).json({ error: 'Access denied' });
    }

    const commentId = uuidv4();
    db.prepare('INSERT INTO comments (id, task_id, user_id, content) VALUES (?, ?, ?, ?)')
      .run(commentId, req.params.id, req.user.id, req.body.content);

    const comment = db.prepare(`
      SELECT cm.*, u.name as user_name, u.avatar
      FROM comments cm JOIN users u ON cm.user_id = u.id
      WHERE cm.id = ?
    `).get(commentId);

    res.status(201).json({ message: 'Comment added', comment });
  } catch (err) {
    console.error('Add comment error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
