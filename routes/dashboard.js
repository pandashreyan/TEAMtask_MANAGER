const express = require('express');
const router = express.Router();
const db = require('../database/db');
const { authenticate, requireAdmin } = require('../middleware/auth');

// GET /api/dashboard - Comprehensive dashboard stats
router.get('/', authenticate, (req, res) => {
  try {
    const userId = req.user.id;
    const isAdmin = req.user.role === 'admin';

    let projectFilter = isAdmin ? '' : `JOIN project_members pm ON p.id = pm.project_id AND pm.user_id = '${userId}'`;
    let taskFilter = isAdmin ? '' : `AND t.project_id IN (SELECT project_id FROM project_members WHERE user_id = '${userId}')`;

    // Project stats
    const projectStats = db.prepare(`
      SELECT 
        COUNT(DISTINCT p.id) as total_projects,
        COUNT(DISTINCT CASE WHEN p.status = 'active' THEN p.id END) as active_projects,
        COUNT(DISTINCT CASE WHEN p.status = 'completed' THEN p.id END) as completed_projects,
        COUNT(DISTINCT CASE WHEN p.status = 'on_hold' THEN p.id END) as on_hold_projects
      FROM projects p ${projectFilter}
    `).get();

    // Task stats
    const taskStats = db.prepare(`
      SELECT
        COUNT(*) as total_tasks,
        COUNT(CASE WHEN status = 'todo' THEN 1 END) as todo,
        COUNT(CASE WHEN status = 'in_progress' THEN 1 END) as in_progress,
        COUNT(CASE WHEN status = 'review' THEN 1 END) as review,
        COUNT(CASE WHEN status = 'done' THEN 1 END) as done,
        COUNT(CASE WHEN due_date < date('now') AND status != 'done' THEN 1 END) as overdue,
        COUNT(CASE WHEN assignee_id = '${userId}' THEN 1 END) as assigned_to_me,
        COUNT(CASE WHEN assignee_id = '${userId}' AND status = 'done' THEN 1 END) as completed_by_me
      FROM tasks t WHERE 1=1 ${taskFilter}
    `).get();

    // My assigned tasks (not done)
    const myTasks = db.prepare(`
      SELECT t.*, p.name as project_name, p.color as project_color
      FROM tasks t JOIN projects p ON t.project_id = p.id
      WHERE t.assignee_id = ? AND t.status != 'done'
      ORDER BY 
        CASE t.priority WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END,
        t.due_date ASC NULLS LAST
      LIMIT 10
    `).all(userId);

    // Overdue tasks
    const overdueTasks = db.prepare(`
      SELECT t.*, p.name as project_name, p.color as project_color,
        u.name as assignee_name
      FROM tasks t 
      JOIN projects p ON t.project_id = p.id
      LEFT JOIN users u ON t.assignee_id = u.id
      WHERE t.due_date < date('now') AND t.status != 'done' ${taskFilter}
      ORDER BY t.due_date ASC
      LIMIT 10
    `).all();

    // Recent activity
    const recentActivity = db.prepare(`
      SELECT al.*, u.name as user_name, u.avatar
      FROM activity_logs al JOIN users u ON al.user_id = u.id
      WHERE ${isAdmin ? '1=1' : `al.user_id = '${userId}' OR al.entity_id IN (
        SELECT id FROM projects p JOIN project_members pm ON p.id = pm.project_id WHERE pm.user_id = '${userId}'
        UNION SELECT id FROM tasks WHERE project_id IN (SELECT project_id FROM project_members WHERE user_id = '${userId}')
      )`}
      ORDER BY al.created_at DESC
      LIMIT 15
    `).all();

    // Projects with progress
    const projects = db.prepare(`
      SELECT p.*,
        COUNT(DISTINCT t.id) as total_tasks,
        COUNT(DISTINCT CASE WHEN t.status='done' THEN t.id END) as done_tasks,
        COUNT(DISTINCT pm.user_id) as member_count
      FROM projects p
      ${projectFilter}
      LEFT JOIN tasks t ON p.id = t.project_id
      LEFT JOIN project_members pm ON p.id = pm.project_id
      GROUP BY p.id
      ORDER BY p.updated_at DESC
      LIMIT 6
    `).all();

    // Priority breakdown
    const priorityStats = db.prepare(`
      SELECT priority, COUNT(*) as count
      FROM tasks t WHERE status != 'done' ${taskFilter}
      GROUP BY priority
    `).all();

    // Weekly task completion trend (last 7 days)
    const weeklyTrend = db.prepare(`
      SELECT 
        date(updated_at) as date,
        COUNT(CASE WHEN status = 'done' THEN 1 END) as completed
      FROM tasks t
      WHERE updated_at >= date('now', '-7 days') ${taskFilter}
      GROUP BY date(updated_at)
      ORDER BY date ASC
    `).all();

    // Unread notifications count
    const unreadCount = db.prepare(`
      SELECT COUNT(*) as count FROM notifications WHERE user_id = ? AND is_read = 0
    `).get(userId);

    res.json({
      projectStats,
      taskStats,
      myTasks,
      overdueTasks,
      recentActivity,
      projects,
      priorityStats,
      weeklyTrend,
      unreadNotifications: unreadCount.count
    });
  } catch (err) {
    console.error('Dashboard error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/dashboard/notifications
router.get('/notifications', authenticate, (req, res) => {
  try {
    const notifications = db.prepare(`
      SELECT * FROM notifications WHERE user_id = ?
      ORDER BY created_at DESC LIMIT 30
    `).all(req.user.id);
    res.json({ notifications });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/dashboard/notifications/read
router.put('/notifications/read', authenticate, (req, res) => {
  try {
    db.prepare('UPDATE notifications SET is_read = 1 WHERE user_id = ?').run(req.user.id);
    res.json({ message: 'All notifications marked as read' });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/dashboard/users - Admin only: all users
router.get('/users', authenticate, requireAdmin, (req, res) => {
  try {
    const users = db.prepare(`
      SELECT u.id, u.name, u.email, u.role, u.avatar, u.created_at,
        COUNT(DISTINCT pm.project_id) as project_count,
        COUNT(DISTINCT CASE WHEN t.assignee_id = u.id THEN t.id END) as task_count
      FROM users u
      LEFT JOIN project_members pm ON u.id = pm.user_id
      LEFT JOIN tasks t ON u.id = t.assignee_id
      GROUP BY u.id
      ORDER BY u.created_at DESC
    `).all();
    res.json({ users });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
