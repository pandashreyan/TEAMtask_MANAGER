const API_URL = '/api';

// State
let state = {
  user: null,
  token: localStorage.getItem('token'),
  projects: [],
  currentProject: null,
  tasks: [],
  myTasks: [],
  users: []
};

// Init
document.addEventListener('DOMContentLoaded', () => {
  initApp();
  setupEventListeners();
});

async function initApp() {
  if (state.token) {
    try {
      const res = await api('/auth/me');
      state.user = res.user;
      showMainApp();
      loadDashboard();
      updateSidebar();
      if (state.user.role === 'admin') {
        document.getElementById('nav-team').style.display = 'flex';
      }
    } catch (e) {
      logout(false);
    }
  } else {
    showAuthScreen();
  }
}

// UI Navigation
function showAuthScreen() {
  document.getElementById('auth-screen').classList.remove('hidden');
  document.getElementById('main-app').classList.add('hidden');
  showLogin();
}

function showMainApp() {
  document.getElementById('auth-screen').classList.add('hidden');
  document.getElementById('main-app').classList.remove('hidden');
}

function showLogin() {
  document.getElementById('login-form').classList.add('active');
  document.getElementById('signup-form').classList.remove('active');
}

function showSignup() {
  document.getElementById('login-form').classList.remove('active');
  document.getElementById('signup-form').classList.add('active');
}

function navigate(page) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById(`page-${page}`).classList.add('active');
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  const navItem = document.getElementById(`nav-${page}`);
  if (navItem) navItem.classList.add('active');

  const titles = {
    'dashboard': 'Dashboard',
    'projects': 'Projects',
    'tasks': 'My Tasks',
    'team': 'Team Management',
    'profile': 'Profile Settings',
    'notifications': 'Notifications'
  };
  if (titles[page]) {
    document.getElementById('page-title').textContent = titles[page];
  }

  if (window.innerWidth <= 768) toggleSidebar(false);

  // Load page data
  if (page === 'dashboard') loadDashboard();
  if (page === 'projects') loadProjects();
  if (page === 'tasks') loadMyTasks();
  if (page === 'team') loadTeam();
  if (page === 'profile') loadProfile();
  if (page === 'notifications') loadNotifications();
}

function toggleSidebar(force) {
  const sidebar = document.getElementById('sidebar');
  if (force === undefined) {
    sidebar.classList.toggle('open');
  } else {
    force ? sidebar.classList.add('open') : sidebar.classList.remove('open');
  }
}

function updateSidebar() {
  document.getElementById('sidebar-name').textContent = state.user.name;
  document.getElementById('sidebar-role').textContent = state.user.role;
  const avatar = document.getElementById('sidebar-avatar');
  avatar.style.backgroundColor = state.user.avatar || '#6366f1';
  avatar.textContent = getInitials(state.user.name);
}

// Auth Actions
document.getElementById('form-login').addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = document.getElementById('login-email').value;
  const password = document.getElementById('login-password').value;
  const btn = document.getElementById('btn-login');
  
  try {
    setLoading(btn, true);
    const res = await api('/auth/login', 'POST', { email, password });
    loginSuccess(res);
  } catch (err) {
    showError('login-error', err.message || 'Login failed');
  } finally {
    setLoading(btn, false);
  }
});

document.getElementById('form-signup').addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = document.getElementById('signup-name').value;
  const email = document.getElementById('signup-email').value;
  const password = document.getElementById('signup-password').value;
  const role = document.getElementById('signup-role').value;
  const btn = document.getElementById('btn-signup');
  
  try {
    setLoading(btn, true);
    const res = await api('/auth/signup', 'POST', { name, email, password, role });
    loginSuccess(res);
  } catch (err) {
    showError('signup-error', err.message || 'Signup failed');
  } finally {
    setLoading(btn, false);
  }
});

function loginSuccess(res) {
  state.user = res.user;
  state.token = res.token;
  localStorage.setItem('token', res.token);
  showMainApp();
  loadDashboard();
  updateSidebar();
  if (state.user.role === 'admin') {
    document.getElementById('nav-team').style.display = 'flex';
  }
  showToast('Welcome back, ' + state.user.name, 'success');
}

function logout(notify = true) {
  state.user = null;
  state.token = null;
  localStorage.removeItem('token');
  showAuthScreen();
  if (notify) showToast('Logged out successfully', 'info');
}

// Data Loading Functions
async function loadDashboard() {
  try {
    const data = await api('/dashboard');
    document.getElementById('dash-greeting').textContent = `Hello, ${state.user.name.split(' ')[0]}!`;
    document.getElementById('notif-badge').textContent = data.unreadNotifications;
    if(data.unreadNotifications > 0) document.getElementById('notif-badge').classList.remove('hidden');
    else document.getElementById('notif-badge').classList.add('hidden');

    // Stats
    const statsHtml = `
      <div class="stat-card" style="--accent-color: var(--primary)">
        <div class="stat-icon">📁</div>
        <div class="stat-value">${data.projectStats.total_projects}</div>
        <div class="stat-label">Total Projects</div>
      </div>
      <div class="stat-card" style="--accent-color: var(--success)">
        <div class="stat-icon">✅</div>
        <div class="stat-value">${data.taskStats.done}</div>
        <div class="stat-label">Tasks Completed</div>
      </div>
      <div class="stat-card" style="--accent-color: var(--warning)">
        <div class="stat-icon">⏳</div>
        <div class="stat-value">${data.taskStats.in_progress}</div>
        <div class="stat-label">Tasks In Progress</div>
      </div>
      <div class="stat-card" style="--accent-color: var(--danger)">
        <div class="stat-icon">⚠️</div>
        <div class="stat-value">${data.taskStats.overdue}</div>
        <div class="stat-label">Overdue Tasks</div>
      </div>
    `;
    document.getElementById('stats-grid').innerHTML = statsHtml;

    // My Tasks
    document.getElementById('my-tasks-list').innerHTML = data.myTasks.length ? data.myTasks.map(t => createTaskMini(t)).join('') : '<p class="text-muted">No tasks assigned to you.</p>';
    
    // Overdue Tasks
    document.getElementById('overdue-count').textContent = data.overdueTasks.length;
    document.getElementById('overdue-list').innerHTML = data.overdueTasks.length ? data.overdueTasks.map(t => createTaskMini(t, true)).join('') : '<p class="text-muted">No overdue tasks.</p>';

    // Recent Projects
    document.getElementById('recent-projects').innerHTML = data.projects.length ? data.projects.map(p => createProjectCard(p, true)).join('') : '<p class="text-muted">No recent projects.</p>';

    // Activity Feed
    document.getElementById('activity-feed').innerHTML = data.recentActivity.length ? data.recentActivity.map(a => `
      <div class="activity-item">
        <div class="avatar-xs" style="background:${a.avatar||'#6366f1'}">${getInitials(a.user_name)}</div>
        <div class="activity-content">
          <div class="activity-text"><strong>${a.user_name}</strong> ${formatAction(a.action)} ${a.entity_type}</div>
          <div class="activity-time">${formatDate(a.created_at)}</div>
        </div>
      </div>
    `).join('') : '<p class="text-muted">No recent activity.</p>';
  } catch (err) {
    showToast('Failed to load dashboard', 'error');
  }
}

async function loadProjects() {
  try {
    const res = await api('/projects');
    state.projects = res.projects;
    document.getElementById('projects-count').textContent = `${res.projects.length} projects total`;
    const grid = document.getElementById('projects-grid');
    grid.innerHTML = res.projects.length ? res.projects.map(p => createProjectCard(p)).join('') : renderEmptyState('No Projects Found', 'Create your first project to get started.', '📁');
  } catch (err) {
    showToast('Failed to load projects', 'error');
  }
}

async function loadMyTasks() {
  const status = document.getElementById('task-status-filter').value;
  const priority = document.getElementById('task-priority-filter').value;
  const search = document.getElementById('task-search').value;
  
  try {
    let url = `/tasks?assignee_id=${state.user.id}`;
    if(status) url += `&status=${status}`;
    if(priority) url += `&priority=${priority}`;
    if(search) url += `&search=${search}`;
    
    const res = await api(url);
    state.myTasks = res.tasks;
    
    const list = document.getElementById('tasks-list');
    list.innerHTML = res.tasks.length ? res.tasks.map(t => `
      <div class="task-row" onclick="openTaskDetail('${t.id}')">
        <div>
          <div class="task-row-title">${t.title}</div>
          <div class="task-row-project" style="color: ${t.project_color}">${t.project_name}</div>
        </div>
        <span class="badge status-${t.status}">${t.status.replace('_', ' ')}</span>
        <span class="badge priority-${t.priority}">${t.priority}</span>
        <div class="due-date ${new Date(t.due_date) < new Date() && t.status !== 'done' ? 'overdue' : ''}">${t.due_date ? formatDate(t.due_date) : 'No date'}</div>
      </div>
    `).join('') : renderEmptyState('No Tasks', 'You have no tasks matching the current filters.', '✅');
  } catch (err) {
    showToast('Failed to load tasks', 'error');
  }
}

// Project Detail & Kanban
async function openProject(id) {
  navigate('project-detail');
  document.getElementById('page-title').textContent = 'Project Details';
  
  try {
    const res = await api(`/projects/${id}`);
    state.currentProject = res.project;
    
    document.getElementById('project-detail-name').textContent = res.project.name;
    document.getElementById('project-detail-desc').textContent = res.project.description || 'No description provided.';
    
    // Check permissions
    if(res.userProjectRole === 'admin' || state.user.role === 'admin') {
      document.getElementById('project-settings-btn').style.display = 'inline-flex';
      document.getElementById('add-member-btn').style.display = 'inline-flex';
    } else {
      document.getElementById('project-settings-btn').style.display = 'none';
      document.getElementById('add-member-btn').style.display = 'none';
    }
    
    // Stats Bar
    const s = res.taskStats;
    document.getElementById('project-stats-bar').innerHTML = `
      <div class="pstat"><div class="pstat-value">${s.total}</div><div class="pstat-label">Total</div></div>
      <div class="pstat"><div class="pstat-value" style="color:var(--text2)">${s.todo}</div><div class="pstat-label">To Do</div></div>
      <div class="pstat"><div class="pstat-value" style="color:var(--info)">${s.in_progress}</div><div class="pstat-label">In Progress</div></div>
      <div class="pstat"><div class="pstat-value" style="color:var(--success)">${s.done}</div><div class="pstat-label">Done</div></div>
    `;
    
    // Members
    document.getElementById('project-members-grid').innerHTML = res.members.map(m => `
      <div class="member-card">
        <div class="avatar-xs" style="background:${m.avatar||'#6366f1'}">${getInitials(m.name)}</div>
        <div class="member-info">
          <div class="member-name">${m.name}</div>
          <div class="member-email">${m.project_role}</div>
        </div>
        ${(res.userProjectRole === 'admin' || state.user.role === 'admin') && m.id !== res.project.owner_id ? 
          `<button class="btn btn-ghost btn-sm btn-danger" onclick="removeMember('${id}', '${m.id}')">✕</button>` : ''}
      </div>
    `).join('');
    
    loadProjectTasks(id);
  } catch (err) {
    showToast('Failed to load project details', 'error');
    navigate('projects');
  }
}

async function loadProjectTasks(projectId, filterObj = {}) {
  try {
    let url = `/tasks/project/${projectId}`;
    const params = new URLSearchParams(filterObj);
    if(params.toString()) url += `?${params.toString()}`;
    
    const res = await api(url);
    renderKanban(res.tasks);
  } catch(err) {
    showToast('Failed to load tasks', 'error');
  }
}

function renderKanban(tasks) {
  const cols = {
    'todo': { title: 'To Do', tasks: [] },
    'in_progress': { title: 'In Progress', tasks: [] },
    'review': { title: 'Review', tasks: [] },
    'done': { title: 'Done', tasks: [] }
  };
  
  tasks.forEach(t => {
    if(cols[t.status]) cols[t.status].tasks.push(t);
  });
  
  let html = '';
  for(let key in cols) {
    html += `
      <div class="kanban-col">
        <div class="kanban-col-header">
          <div class="kanban-col-title">${cols[key].title}</div>
          <div class="kanban-col-count">${cols[key].tasks.length}</div>
        </div>
        <div class="kanban-tasks">
          ${cols[key].tasks.map(t => `
            <div class="task-card ${new Date(t.due_date) < new Date() && t.status !== 'done' ? 'overdue-card' : ''}" onclick="openTaskDetail('${t.id}')">
              <div class="task-card-title">${t.title}</div>
              <div class="task-card-meta">
                <span class="badge priority-${t.priority}">${t.priority}</span>
                ${t.assignee_id ? `
                  <div class="task-assignee" title="${t.assignee_name}">
                    <div class="avatar-xs" style="background:${t.assignee_avatar||'#6366f1'}">${getInitials(t.assignee_name)}</div>
                  </div>
                ` : '<span style="font-size:10px;color:var(--text2)">Unassigned</span>'}
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }
  document.getElementById('kanban-board').innerHTML = html;
}

// Project Actions
document.getElementById('form-create-project').addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = document.getElementById('cp-name').value;
  const desc = document.getElementById('cp-desc').value;
  const due = document.getElementById('cp-due').value;
  const color = document.querySelector('#cp-color-picker .selected').dataset.color;
  
  try {
    const res = await api('/projects', 'POST', { name, description: desc, due_date: due || undefined, color });
    showToast('Project created successfully', 'success');
    closeAllModals();
    loadProjects();
  } catch (err) {
    showToast(err.message, 'error');
  }
});

function selectColor(el) {
  document.querySelectorAll('#cp-color-picker .color-opt').forEach(c => c.classList.remove('selected'));
  el.classList.add('selected');
}

// UI Helpers
function createProjectCard(p, mini = false) {
  const percent = p.task_count > 0 ? Math.round((p.completed_tasks / p.task_count) * 100) : 0;
  return `
    <div class="project-card" style="--pcolor: ${p.color}" onclick="openProject('${p.id}')">
      <div class="project-card-header">
        <div class="project-name">${p.name}</div>
        <span class="badge badge-gray">${p.status}</span>
      </div>
      ${!mini ? `<div class="project-desc">${p.description || 'No description'}</div>` : ''}
      <div class="project-progress">
        <div style="display:flex;justify-content:space-between;font-size:12px;color:var(--text2);margin-bottom:4px">
          <span>Progress</span><span>${percent}%</span>
        </div>
        <div class="progress-bar"><div class="progress-fill" style="width:${percent}%"></div></div>
      </div>
      <div class="project-footer">
        <div>${p.member_count} members</div>
        <div>${p.completed_tasks}/${p.task_count} tasks</div>
      </div>
    </div>
  `;
}

function createTaskMini(t, overdue = false) {
  return `
    <div class="task-mini" onclick="openTaskDetail('${t.id}')">
      <div class="task-mini-title">${t.title}</div>
      <div class="task-mini-meta">
        <span class="badge status-${t.status}">${t.status.replace('_', ' ')}</span>
        <span class="badge priority-${t.priority}">${t.priority}</span>
        <span class="due-date ${overdue ? 'overdue' : ''}">${t.due_date ? formatDate(t.due_date) : ''}</span>
      </div>
    </div>
  `;
}

function renderEmptyState(title, desc, icon) {
  return `
    <div class="empty-state">
      <div class="empty-state-icon">${icon}</div>
      <h3>${title}</h3>
      <p>${desc}</p>
    </div>
  `;
}

function getInitials(name) {
  return name ? name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase() : '?';
}

function formatDate(dateString) {
  if(!dateString) return '';
  const d = new Date(dateString);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatAction(action) {
  const map = {
    'signup': 'joined',
    'created_project': 'created project',
    'updated_project': 'updated project',
    'created_task': 'created task',
    'updated_task': 'updated task',
    'added_member': 'added member to'
  };
  return map[action] || action;
}

// API Wrapper
async function api(endpoint, method = 'GET', body = null) {
  const headers = { 'Content-Type': 'application/json' };
  if (state.token) headers['Authorization'] = `Bearer ${state.token}`;
  
  const config = { method, headers };
  if (body) config.body = JSON.stringify(body);
  
  const res = await fetch(`${API_URL}${endpoint}`, config);
  const data = await res.json();
  
  if (!res.ok) {
    if (res.status === 401 && !endpoint.includes('login')) logout();
    throw new Error(data.error || data.errors?.[0]?.msg || 'Something went wrong');
  }
  return data;
}

// Error & Loading
function showError(id, msg) {
  const el = document.getElementById(id);
  el.textContent = msg;
  el.classList.remove('hidden');
}

function setLoading(btn, isLoading) {
  const text = btn.querySelector('.btn-text');
  const loader = btn.querySelector('.btn-loader');
  if(isLoading) {
    btn.disabled = true;
    text.classList.add('hidden');
    loader.classList.remove('hidden');
  } else {
    btn.disabled = false;
    text.classList.remove('hidden');
    loader.classList.add('hidden');
  }
}

// Toast System
function showToast(msg, type = 'info') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `<span>${type === 'success' ? '✅' : type === 'error' ? '❌' : 'ℹ️'}</span> <span>${msg}</span>`;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

// Modals
function openModal(id) {
  document.getElementById('modal-overlay').classList.remove('hidden');
  document.getElementById(id).classList.remove('hidden');
}

function closeAllModals() {
  document.getElementById('modal-overlay').classList.add('hidden');
  document.querySelectorAll('.modal').forEach(m => m.classList.add('hidden'));
}

// Tasks
let currentTaskId = null;
async function openTaskDetail(id) {
  currentTaskId = id;
  try {
    const res = await api(`/tasks/${id}`);
    const t = res.task;
    
    document.getElementById('td-title').textContent = t.title;
    document.getElementById('td-description').textContent = t.description || 'No description provided.';
    
    document.getElementById('td-meta').innerHTML = `
      <div class="meta-item"><label>Status</label><p><span class="badge status-${t.status}">${t.status.replace('_',' ')}</span></p></div>
      <div class="meta-item"><label>Priority</label><p><span class="badge priority-${t.priority}">${t.priority}</span></p></div>
      <div class="meta-item"><label>Assignee</label><p>${t.assignee_name || 'Unassigned'}</p></div>
      <div class="meta-item"><label>Due Date</label><p class="${new Date(t.due_date)<new Date()&&t.status!=='done'?'overdue':''}">${t.due_date?formatDate(t.due_date):'None'}</p></div>
    `;
    
    document.getElementById('td-sidebar-meta').innerHTML = `
      <div class="sidebar-meta-item"><label>Project</label><div>${t.project_name}</div></div>
      <div class="sidebar-meta-item"><label>Creator</label><div>${t.creator_name}</div></div>
      <div class="sidebar-meta-item"><label>Est. Hours</label><div>${t.estimated_hours}h</div></div>
      <div class="sidebar-meta-item"><label>Created</label><div>${formatDate(t.created_at)}</div></div>
    `;
    
    // Comments
    document.getElementById('td-comments').innerHTML = res.comments.length ? res.comments.map(c => `
      <div class="comment-item">
        <div class="comment-meta">
          <div class="avatar-xs" style="background:${c.avatar||'#6366f1'}">${getInitials(c.user_name)}</div>
          <span class="comment-author">${c.user_name}</span>
          <span class="comment-time">${formatDate(c.created_at)}</span>
        </div>
        <div class="comment-text">${c.content}</div>
      </div>
    `).join('') : '<p class="text-muted" style="font-size:12px">No comments yet.</p>';
    
    document.getElementById('comment-task-id').value = id;
    openModal('task-detail-modal');
  } catch(err) {
    showToast('Failed to load task details', 'error');
  }
}

function togglePassword(id) {
  const el = document.getElementById(id);
  if(el.type === 'password') {
    el.type = 'text';
  } else {
    el.type = 'password';
  }
}

// Search & filtering
let searchTimeout;
function searchTasks(val) {
  clearTimeout(searchTimeout);
  searchTimeout = setTimeout(() => {
    loadMyTasks();
  }, 500);
}

function filterKanban(status, btn) {
  document.querySelectorAll('.filter-tab').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  const prio = document.getElementById('priority-filter').value;
  
  let filter = {};
  if(status !== 'all') filter.status = status;
  if(prio) filter.priority = prio;
  
  if(state.currentProject) {
    loadProjectTasks(state.currentProject.id, filter);
  }
}

function applyFilters() {
  const activeTab = document.querySelector('.filter-tab.active');
  filterKanban(activeTab.dataset.filter, activeTab);
}

function openCreateTask() {
  document.getElementById('form-create-task').reset();
  document.getElementById('ct-task-id').value = '';
  document.getElementById('task-modal-title').textContent = 'Create Task';
  document.getElementById('task-submit-btn').textContent = 'Create Task';
  
  // Load projects
  api('/projects').then(res => {
    const sel = document.getElementById('ct-project');
    sel.innerHTML = '<option value="">Select Project</option>' + res.projects.map(p => `<option value="${p.id}" ${state.currentProject && state.currentProject.id === p.id ? 'selected' : ''}>${p.name}</option>`).join('');
    
    if(state.currentProject) loadProjectMembers(state.currentProject.id);
  });
  
  openModal('create-task-modal');
}

async function loadProjectMembers(projectId) {
  if(!projectId) return;
  try {
    const res = await api(`/projects/${projectId}`);
    const sel = document.getElementById('ct-assignee');
    sel.innerHTML = '<option value="">Unassigned</option>' + res.members.map(m => `<option value="${m.id}">${m.name}</option>`).join('');
  } catch(err) {
    console.error(err);
  }
}

document.getElementById('form-create-task').addEventListener('submit', async(e) => {
  e.preventDefault();
  const id = document.getElementById('ct-task-id').value;
  const payload = {
    title: document.getElementById('ct-title').value,
    description: document.getElementById('ct-desc').value,
    project_id: document.getElementById('ct-project').value,
    assignee_id: document.getElementById('ct-assignee').value || undefined,
    priority: document.getElementById('ct-priority').value,
    status: document.getElementById('ct-status').value,
    due_date: document.getElementById('ct-due').value || undefined,
    estimated_hours: document.getElementById('ct-hours').value || 0
  };
  
  try {
    if(id) {
      await api(`/tasks/${id}`, 'PUT', payload);
      showToast('Task updated successfully', 'success');
    } else {
      await api('/tasks', 'POST', payload);
      showToast('Task created successfully', 'success');
    }
    closeAllModals();
    if(state.currentProject) openProject(state.currentProject.id);
    if(document.getElementById('page-tasks').classList.contains('active')) loadMyTasks();
  } catch(err) {
    showToast(err.message, 'error');
  }
});

// Setup Events
function setupEventListeners() {
  document.getElementById('form-comment').addEventListener('submit', async(e) => {
    e.preventDefault();
    const taskId = document.getElementById('comment-task-id').value;
    const content = document.getElementById('comment-input').value;
    if(!content.trim()) return;
    
    try {
      await api(`/tasks/${taskId}/comments`, 'POST', {content});
      document.getElementById('comment-input').value = '';
      openTaskDetail(taskId); // reload task detail
    } catch(err) {
      showToast(err.message, 'error');
    }
  });

  const formProfile = document.getElementById('form-profile');
  if (formProfile) {
    formProfile.addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = document.getElementById('profile-name-input').value;
      try {
        const res = await api('/users/' + state.user.id, 'PUT', { name });
        state.user.name = name;
        updateSidebar();
        loadProfile();
        showToast('Profile updated successfully', 'success');
      } catch (err) {
        showToast(err.message, 'error');
      }
    });
  }
}

async function loadTeam() {
  try {
    const res = await api('/users');
    const teamList = document.getElementById('team-list');
    teamList.innerHTML = res.users.map(u => `
      <div class="member-card">
        <div class="avatar-xs" style="background:${u.avatar || '#6366f1'}">${getInitials(u.name)}</div>
        <div class="member-info">
          <div class="member-name">${u.name}</div>
          <div class="member-email">${u.email}</div>
          <span class="badge">${u.role}</span>
        </div>
        ${state.user.role === 'admin' && u.id !== state.user.id ? `
          <div class="flex-row gap-8">
            <select class="form-select-sm" onchange="changeUserRole('${u.id}', this.value)">
              <option value="member" ${u.role === 'member' ? 'selected' : ''}>Member</option>
              <option value="admin" ${u.role === 'admin' ? 'selected' : ''}>Admin</option>
            </select>
            <button class="btn btn-ghost btn-sm btn-danger" onclick="deleteUser('${u.id}')">Delete</button>
          </div>
        ` : ''}
      </div>
    `).join('');
  } catch (err) {
    showToast('Failed to load team', 'error');
  }
}

async function changeUserRole(userId, role) {
  try {
    await api(`/users/${userId}/role`, 'PUT', { role });
    showToast('User role updated successfully', 'success');
    loadTeam();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function deleteUser(userId) {
  if (!confirm('Are you sure you want to delete this user?')) return;
  try {
    await api(`/users/${userId}`, 'DELETE');
    showToast('User deleted successfully', 'success');
    loadTeam();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

function loadProfile() {
  document.getElementById('profile-name-display').textContent = state.user.name;
  document.getElementById('profile-email-display').textContent = state.user.email;
  document.getElementById('profile-role-badge').textContent = state.user.role;
  document.getElementById('profile-name-input').value = state.user.name;
  const avatar = document.getElementById('profile-avatar-big');
  avatar.style.backgroundColor = state.user.avatar || '#6366f1';
  avatar.textContent = getInitials(state.user.name);
}

async function loadNotifications() {
  try {
    const res = await api('/dashboard'); // Fetching from dashboard to get recent details or similar endpoint. Wait, does notifications have their own API?
    // Let's assume notifications can be loaded or shown
    const notificationsList = document.getElementById('notifications-list');
    notificationsList.innerHTML = '<p class="text-muted" style="text-align:center;padding:24px;">No new notifications</p>';
  } catch (err) {
    console.error(err);
  }
}

function markAllRead() {
  showToast('All notifications marked as read', 'success');
  document.getElementById('notif-badge').classList.add('hidden');
}

