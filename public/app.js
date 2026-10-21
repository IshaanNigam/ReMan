let allRecipes = [];
let knownIngredients = [];
let selectedRecipeId = null;
let editingRecipeId = null;
let activeFilter = 'all';
let activeTab = 'tree'; // 'tree' | 'graph' | 'cycle'
let breadcrumbHistory = [];
let customServingsMap = {};
let checkedShoppingItems = new Set();

let currentTheme = localStorage.getItem('theme') || 'dark';
let authMode = 'login'; // 'login' | 'register'
let activeOAuthProvider = null;

let authToken = localStorage.getItem('token') || null;
let currentUser = JSON.parse(localStorage.getItem('user') || 'null');

// DOM References
const authBar = document.getElementById('authBar');
const globalStats = document.getElementById('globalStats');
const recipeListEl = document.getElementById('recipeList');
const contentPanel = document.getElementById('contentPanel');
const searchInput = document.getElementById('searchInput');
const newRecipeBtn = document.getElementById('newRecipeBtn');
const importRecipeBtn = document.getElementById('importRecipeBtn');
const jsonFileInput = document.getElementById('jsonFileInput');
const knownIngredientsList = document.getElementById('knownIngredientsList');

// Auth Modal References
const authModal = document.getElementById('authModal');
const emailAuthForm = document.getElementById('emailAuthForm');
const authNameGroup = document.getElementById('authNameGroup');
const authFullName = document.getElementById('authFullName');
const authEmailInput = document.getElementById('authEmailInput');
const authPasswordInput = document.getElementById('authPasswordInput');
const authErrorBanner = document.getElementById('authErrorBanner');
const authSubmitBtn = document.getElementById('authSubmitBtn');
const oauthPickerBox = document.getElementById('oauthPickerBox');

// Recipe Modal References
const recipeModal = document.getElementById('recipeModal');
const modalTitle = document.getElementById('modalTitle');
const recipeForm = document.getElementById('recipeForm');
const formRecipeName = document.getElementById('formRecipeName');
const formRecipeCustomId = document.getElementById('formRecipeCustomId');
const formServings = document.getElementById('formServings');
const formComponentsList = document.getElementById('formComponentsList');
const formError = document.getElementById('formError');

// ==========================================
// INITIALIZATION, THEME & TOASTS
// ==========================================

async function init() {
  applyTheme(currentTheme);
  await handleOAuthRedirectCallback();
  renderAuthBar();
  await Promise.all([fetchRecipes(), fetchKnownIngredients()]);

  window.addEventListener('keydown', (e) => {
    if (e.key === '/' && document.activeElement.tagName !== 'INPUT' && document.activeElement.tagName !== 'SELECT') {
      e.preventDefault();
      searchInput.focus();
    }
  });
}

async function handleOAuthRedirectCallback() {
  const params = new URLSearchParams(window.location.search);
  const urlToken = params.get('token');
  const authError = params.get('auth_error');

  if (authError) {
    showToast(authError, 'error');
    window.history.replaceState({}, document.title, '/');
    openAuthModal('login');
    return;
  }

  if (urlToken) {
    try {
      const res = await fetch('/api/auth/me', {
        headers: { Authorization: `Bearer ${urlToken}` }
      });
      if (res.ok) {
        const data = await res.json();
        authToken = urlToken;
        currentUser = data.user;
        localStorage.setItem('token', authToken);
        localStorage.setItem('user', JSON.stringify(currentUser));
        showToast(`Signed in via ${currentUser.provider.toUpperCase()} as ${currentUser.username}!`, 'success');
      }
    } catch (err) {
      showToast('Failed to verify OAuth session.', 'error');
    }
    window.history.replaceState({}, document.title, '/');
  }
}

function applyTheme(theme) {
  currentTheme = theme;
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('theme', theme);

  const iconEl = document.getElementById('themeIcon');
  const labelEl = document.getElementById('themeLabel');
  if (iconEl && labelEl) {
    if (theme === 'dark') {
      iconEl.textContent = '☀️';
      labelEl.textContent = 'Light Mode';
    } else {
      iconEl.textContent = '🌙';
      labelEl.textContent = 'Dark Mode';
    }
  }

  if (selectedRecipeId && activeTab === 'graph') {
    renderMainPanel();
  }
}

function toggleTheme() {
  const next = currentTheme === 'dark' ? 'light' : 'dark';
  applyTheme(next);
  showToast(`Switched to ${next === 'light' ? 'Light' : 'Dark'} Mode`, 'info');
}

function showToast(message, type = 'info') {
  const container = document.getElementById('toastContainer');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 3400);
}

// ==========================================
// AUTHENTICATION (EMAIL/PASSWORD + GOOGLE/GITHUB)
// ==========================================

function renderAuthBar() {
  if (authToken && currentUser) {
    const initials = (currentUser.username || currentUser.email || 'U').slice(0, 2).toUpperCase();
    const avatarHtml = currentUser.avatar
      ? `<img src="${escapeHtml(currentUser.avatar)}" alt="avatar" style="width:28px;height:28px;border-radius:50%;object-fit:cover;" />`
      : `<div class="user-avatar">${escapeHtml(initials)}</div>`;

    const providerBadge =
      currentUser.provider === 'google'
        ? 'Google Account'
        : currentUser.provider === 'github'
        ? 'GitHub Account'
        : currentUser.email || 'Email Account';

    authBar.innerHTML = `
      <div class="user-profile-pill">
        ${avatarHtml}
        <div class="user-details">
          <span class="user-name">${escapeHtml(currentUser.username)}</span>
          <span class="user-provider">${escapeHtml(providerBadge)}</span>
        </div>
      </div>
      <button class="btn btn-danger btn-sm" onclick="logout()">Logout</button>
    `;
  } else {
    authBar.innerHTML = `
      <button class="btn btn-ghost btn-sm" onclick="openAuthModal('login')">Sign In</button>
      <button class="btn btn-primary btn-sm" onclick="openAuthModal('register')">Sign Up</button>
    `;
  }
}

function openAuthModal(mode = 'login') {
  switchAuthMode(mode);
  authErrorBanner.classList.add('hidden');
  authModal.classList.remove('hidden');
}

function closeAuthModal() {
  authModal.classList.add('hidden');
}

function switchAuthMode(mode) {
  authMode = mode;
  document.getElementById('tabSignIn').classList.toggle('active', mode === 'login');
  document.getElementById('tabSignUp').classList.toggle('active', mode === 'register');
  authNameGroup.classList.toggle('hidden', mode === 'login');
  authSubmitBtn.textContent = mode === 'login' ? 'Sign In with Email' : 'Create Account';
  authErrorBanner.classList.add('hidden');
}

function fillDemoCredentials() {
  switchAuthMode('login');
  authEmailInput.value = 'demo@recipegraph.dev';
  authPasswordInput.value = 'password123';
}

emailAuthForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  authErrorBanner.classList.add('hidden');

  const endpoint = authMode === 'login' ? '/api/auth/login' : '/api/auth/register';
  const payload = {
    name: authFullName.value.trim(),
    email: authEmailInput.value.trim(),
    password: authPasswordInput.value
  };

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  const data = await res.json();
  if (!res.ok) {
    authErrorBanner.textContent = data.error || 'Authentication failed.';
    authErrorBanner.classList.remove('hidden');
    return;
  }

  completeLoginSession(data.token, data.user);
});

function openOAuthPrompt(provider) {
  activeOAuthProvider = provider;
  const titleEl = document.getElementById('oauthPickerTitle');
  const listEl = document.getElementById('oauthPresetAccounts');

  const providerLabel = provider === 'google' ? 'Google' : 'GitHub';
  titleEl.textContent = `Continue with ${providerLabel}`;

  const presets =
    provider === 'google'
      ? [
          { name: 'Master Chef (Google)', email: 'chef.google@gmail.com' },
          { name: 'Inter IIT Evaluator', email: 'evaluator.iit@gmail.com' }
        ]
      : [
          { name: 'dev-chef (GitHub)', email: 'dev-chef@users.noreply.github.com' },
          { name: 'inter-iit-tech (GitHub)', email: 'techmeet@github.com' }
        ];

  listEl.innerHTML = presets
    .map(
      acc => `
      <div class="oauth-account-item" onclick="executeOAuthLogin('${provider}', '${acc.email}', '${acc.name}')">
        <div>
          <strong>${escapeHtml(acc.name)}</strong>
          <div style="font-size:0.72rem; color:var(--text-muted);">${escapeHtml(acc.email)}</div>
        </div>
        <span class="badge">${providerLabel} ➔</span>
      </div>
    `
    )
    .join('');

  oauthPickerBox.classList.remove('hidden');
}

function closeOAuthPrompt() {
  oauthPickerBox.classList.add('hidden');
}

function submitCustomOAuth() {
  const email = document.getElementById('oauthCustomEmail').value.trim();
  const name = document.getElementById('oauthCustomName').value.trim();
  if (!email || !email.includes('@')) {
    return showToast('Please enter a valid email address.', 'error');
  }
  executeOAuthLogin(activeOAuthProvider || 'google', email, name || email.split('@')[0]);
}

async function executeOAuthLogin(provider, email, name) {
  const res = await fetch('/api/auth/oauth', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ provider, email, name })
  });

  const data = await res.json();
  if (!res.ok) {
    return showToast(data.error || 'OAuth sign-in failed', 'error');
  }

  completeLoginSession(data.token, data.user);
}

function completeLoginSession(token, user) {
  authToken = token;
  currentUser = user;
  localStorage.setItem('token', authToken);
  localStorage.setItem('user', JSON.stringify(currentUser));
  closeAuthModal();
  renderAuthBar();
  showToast(`Signed in as ${currentUser.username} (${currentUser.provider || 'email'})`, 'success');
}

async function logout() {
  await fetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
  authToken = null;
  currentUser = null;
  localStorage.removeItem('token');
  localStorage.setItem('user', 'null');
  renderAuthBar();
  showToast('You have been logged out.', 'info');
}

// ==========================================
// DATA FETCHING & METRICS
// ==========================================

async function fetchKnownIngredients() {
  try {
    const res = await fetch('/ingredients');
    if (res.ok) {
      knownIngredients = await res.json();
      knownIngredientsList.innerHTML = knownIngredients
        .map(i => `<option value="${escapeHtml(i.name)}"></option>`)
        .join('');
    }
  } catch (e) {}
}

async function fetchRecipes() {
  const res = await fetch('/recipes');
  allRecipes = await res.json();

  if (!selectedRecipeId && allRecipes.length > 0) {
    selectRecipe(allRecipes[0].id, true);
  } else if (selectedRecipeId && !allRecipes.some(r => r.id === selectedRecipeId)) {
    selectRecipe(allRecipes[0]?.id || null, true);
  } else {
    renderGlobalStats();
    renderSidebar();
    renderMainPanel();
  }
}

function getTreeDepth(recipe) {
  if (!recipe || !recipe.components || recipe.components.length === 0) return 1;
  let maxSub = 0;
  for (const c of recipe.components) {
    if (c.type === 'recipe') {
      maxSub = Math.max(maxSub, getTreeDepth(c));
    }
  }
  return 1 + maxSub;
}

function renderGlobalStats() {
  const nestedCount = allRecipes.filter(r => r.components.some(c => c.type === 'recipe')).length;
  const maxDepthAcrossAll = allRecipes.reduce((acc, r) => Math.max(acc, getTreeDepth(r)), 0);

  globalStats.innerHTML = `
    <div class="stat-chip">📚 Recipes: <strong>${allRecipes.length}</strong></div>
    <div class="stat-chip">🔗 Nested: <strong>${nestedCount}</strong></div>
    <div class="stat-chip">🌲 Max Depth: <strong>${maxDepthAcrossAll}</strong></div>
  `;
}

// ==========================================
// SIDEBAR & FILTERING
// ==========================================

function setFilter(filterType) {
  activeFilter = filterType;
  document.querySelectorAll('.filter-pill').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.filter === filterType);
  });
  renderSidebar();
}

function renderSidebar() {
  const query = (searchInput.value || '').trim().toLowerCase();

  const filtered = allRecipes.filter(r => {
    const matchesSearch = !query || r.name.toLowerCase().includes(query) || r.id.toLowerCase().includes(query);
    const hasSubRecipes = r.components.some(c => c.type === 'recipe');
    if (activeFilter === 'nested' && !hasSubRecipes) return false;
    if (activeFilter === 'base' && hasSubRecipes) return false;
    return matchesSearch;
  });

  if (filtered.length === 0) {
    recipeListEl.innerHTML = `<div style="color:var(--text-muted); padding:1.5rem; text-align:center; font-size:0.85rem;">No matching recipes.</div>`;
    return;
  }

  recipeListEl.innerHTML = filtered.map(recipe => {
    const subCount = recipe.components.filter(c => c.type === 'recipe').length;
    const ingCount = recipe.components.filter(c => c.type === 'ingredient').length;
    const depth = getTreeDepth(recipe);
    const isActive = recipe.id === selectedRecipeId ? 'active' : '';

    return `
      <div class="recipe-card-item ${isActive}" onclick="selectRecipe('${recipe.id}', true)">
        <div class="recipe-card-top">
          <span class="recipe-card-name">${escapeHtml(recipe.name)}</span>
          <span class="recipe-card-id">${escapeHtml(recipe.id)}</span>
        </div>
        <div class="recipe-card-chips">
          <span class="mini-chip">🥗 ${ingCount} ing</span>
          <span class="mini-chip">🍲 ${subCount} sub</span>
          ${depth > 1 ? `<span class="mini-chip depth-chip">Depth ${depth}</span>` : ''}
        </div>
      </div>
    `;
  }).join('');
}

function selectRecipe(id, resetBreadcrumbs = false) {
  if (!id) {
    selectedRecipeId = null;
    renderMainPanel();
    return;
  }
  selectedRecipeId = id;
  checkedShoppingItems.clear();

  const target = allRecipes.find(r => r.id === id);
  if (target) {
    if (resetBreadcrumbs) {
      breadcrumbHistory = [{ id: target.id, name: target.name }];
    } else {
      const existingIdx = breadcrumbHistory.findIndex(b => b.id === id);
      if (existingIdx !== -1) {
        breadcrumbHistory = breadcrumbHistory.slice(0, existingIdx + 1);
      } else {
        breadcrumbHistory.push({ id: target.id, name: target.name });
      }
    }
  }

  renderGlobalStats();
  renderSidebar();
  renderMainPanel();
}

// ==========================================
// MAIN PANEL: HERO, TABS, TREE, GRAPH, TOTALS
// ==========================================

function renderMainPanel() {
  const recipe = allRecipes.find(r => r.id === selectedRecipeId);
  if (!recipe) {
    contentPanel.innerHTML = `<div class="empty-state">Select a recipe from the left sidebar.</div>`;
    return;
  }

  const baseServings = recipe.servings || 1;
  const currentServings = customServingsMap[recipe.id] || baseServings;
  const scaleFactor = currentServings / baseServings;
  const depth = getTreeDepth(recipe);

  const breadcrumbsHtml = breadcrumbHistory.map((b, idx) => {
    const isCurrent = idx === breadcrumbHistory.length - 1;
    return `
      <span class="crumb ${isCurrent ? 'current' : ''}" onclick="selectRecipe('${b.id}', false)">
        ${escapeHtml(b.name)}
      </span>
      ${!isCurrent ? `<span style="color:var(--text-muted)">/</span>` : ''}
    `;
  }).join('');

  const usedInHtml = recipe.used_in && recipe.used_in.length > 0
    ? recipe.used_in.map(u => `
        <span class="badge badge-recipe" style="cursor:pointer" onclick="selectRecipe('${u.id}', false)">
          ↗ ${escapeHtml(u.name)}
        </span>
      `).join(' ')
    : `<span style="color:var(--text-muted); font-size:0.82rem;">Top-level dish (not used as a sub-recipe yet)</span>`;

  contentPanel.innerHTML = `
    <div class="breadcrumb-bar">
      <span style="color:var(--text-muted); font-weight:600;">🧭 Path:</span>
      ${breadcrumbsHtml}
    </div>

    <div class="hero-header">
      <div class="hero-title-area">
        <h2>${escapeHtml(recipe.name)}</h2>
        <div class="meta-badges">
          <span class="badge badge-mono">ID: ${escapeHtml(recipe.id)}</span>
          <span class="badge badge-recipe">🌲 Nesting Depth: ${depth}</span>
          <span class="badge badge-ingredient">🥕 ${recipe.total_ingredients.length} Base Ingredients</span>
          <span class="badge">👨‍🍳 By ${escapeHtml(recipe.author)}</span>
        </div>
      </div>

      <div class="hero-actions">
        <div class="scaler-box" title="Dynamically scales all nested sub-recipes and total ingredients">
          <span class="scaler-label">Servings:</span>
          <button class="scaler-btn" onclick="adjustServings('${recipe.id}', -1)">−</button>
          <span class="scaler-value">${currentServings} ${scaleFactor !== 1 ? `(${scaleFactor.toFixed(1)}x)` : ''}</span>
          <button class="scaler-btn" onclick="adjustServings('${recipe.id}', 1)">＋</button>
        </div>

        <div class="action-btn-group">
          <button class="btn btn-ghost btn-sm" onclick="cloneRecipe('${recipe.id}')" title="Duplicate this recipe">
            📋 Clone
          </button>
          <button class="btn btn-ghost btn-sm" onclick="exportRecipeJson('${recipe.id}')" title="Export JSON">
            📤 Export
          </button>
          <button class="btn btn-primary btn-sm" onclick="openEditModal('${recipe.id}')">
            ✏️ Edit Recipe
          </button>
          <button class="btn btn-danger btn-sm" onclick="deleteRecipe('${recipe.id}')">
            🗑️ Delete
          </button>
        </div>
      </div>
    </div>

    <!-- View Tabs -->
    <div class="tabs-bar">
      <div class="view-tabs">
        <button class="tab-btn ${activeTab === 'tree' ? 'active' : ''}" onclick="switchTab('tree')">
          🌿 Interactive Recipe Tree
        </button>
        <button class="tab-btn ${activeTab === 'graph' ? 'active' : ''}" onclick="switchTab('graph')">
          🕸️ Visual Dependency Graph (DAG)
        </button>
        <button class="tab-btn ${activeTab === 'cycle' ? 'active' : ''}" onclick="switchTab('cycle')">
          🛡️ Circular Dependency Simulator
        </button>
      </div>
      ${activeTab === 'tree' ? `
        <div style="display:flex; gap:0.4rem;">
          <button class="btn btn-ghost btn-sm" onclick="toggleAllNodes(true)">Expand All</button>
          <button class="btn btn-ghost btn-sm" onclick="toggleAllNodes(false)">Collapse All</button>
        </div>
      ` : ''}
    </div>

    <div class="explorer-grid">
      <div>
        ${renderLeftTabContent(recipe, scaleFactor)}

        <div class="card">
          <div class="card-header">
            <h3>🔗 Reverse Dependencies (Used As Component In)</h3>
          </div>
          <div class="meta-badges">${usedInHtml}</div>
        </div>
      </div>

      <div>
        ${renderConsolidatedShoppingCard(recipe, scaleFactor)}
      </div>
    </div>
  `;
}

function switchTab(tabName) {
  activeTab = tabName;
  renderMainPanel();
}

function adjustServings(recipeId, delta) {
  const recipe = allRecipes.find(r => r.id === recipeId);
  if (!recipe) return;
  const current = customServingsMap[recipeId] || recipe.servings || 1;
  const next = Math.max(1, current + delta);
  customServingsMap[recipeId] = next;
  renderMainPanel();
}

function renderLeftTabContent(recipe, scaleFactor) {
  if (activeTab === 'graph') {
    return `
      <div class="card">
        <div class="card-header">
          <h3>🕸️ Visual Recipe Composition Graph (Click any sub-recipe node to inspect)</h3>
        </div>
        <div class="graph-canvas-wrap">
          ${buildSvgDependencyGraph(recipe, scaleFactor)}
        </div>
      </div>
    `;
  }

  if (activeTab === 'cycle') {
    const candidateOptions = allRecipes
      .map(r => `<option value="${r.id}">${escapeHtml(r.name)} (${r.id})</option>`)
      .join('');

    return `
      <div class="card">
        <div class="card-header">
          <h3>🛡️ Circular Dependency Detector &amp; Simulator</h3>
        </div>
        <div class="simulator-box">
          <p style="font-size:0.84rem; color:var(--text-secondary);">
            Test what happens if you attempt to add another recipe as a sub-recipe inside <strong>${escapeHtml(recipe.name)} (${recipe.id})</strong>:
          </p>
          <div style="display:flex; gap:0.5rem;">
            <select id="simCandidateSelect" class="sim-select">
              ${candidateOptions}
            </select>
            <button class="btn btn-primary" onclick="runCycleSimulation('${recipe.id}')">Test Dependency</button>
          </div>
          <div id="simOutput"></div>
        </div>
      </div>
    `;
  }

  const subRecipeOptions = allRecipes
    .filter(r => r.id !== recipe.id)
    .map(r => `<option value="${r.id}">${escapeHtml(r.name)} (${r.id})</option>`)
    .join('');

  return `
    <div class="card">
      <div class="card-header">
        <h3>🌿 Recursive Composition Hierarchy</h3>
        <span style="font-size:0.75rem; color:var(--text-muted);">Click any sub-recipe to drill down</span>
      </div>
      <div class="tree-root">
        ${renderRecursiveNodes(recipe.components, 'root', scaleFactor, recipe.id, true)}
      </div>

      <div class="quick-add-bar">
        <select id="quickAddType" onchange="toggleQuickAddInputs()">
          <option value="ingredient">+ Quick Add Ingredient</option>
          <option value="recipe">+ Quick Add Sub-Recipe</option>
        </select>

        <span id="quickAddTargetWrap">
          <input type="text" id="quickAddIngName" list="knownIngredientsList" placeholder="Ingredient name" />
        </span>

        <select id="quickAddSubSelect" class="hidden">
          <option value="">-- Choose Sub-Recipe --</option>
          ${subRecipeOptions}
        </select>

        <input type="number" step="any" id="quickAddQty" value="100" style="width:80px;" placeholder="Qty" />
        <input type="text" id="quickAddUnit" value="g" style="width:70px;" placeholder="Unit" />
        <button class="btn btn-primary btn-sm" onclick="handleQuickAddComponent('${recipe.id}')">Add</button>
      </div>
    </div>
  `;
}

function renderRecursiveNodes(components, pathPrefix, multiplier = 1, parentRecipeId = null, isDirectChild = false) {
  if (!components || components.length === 0) {
    return `<div style="color:var(--text-muted); font-size:0.84rem; padding:0.5rem;">No components defined.</div>`;
  }

  return components.map((comp, idx) => {
    const nodeKey = `${pathPrefix}_${idx}`;
    const scaledQty = Number(((Number(comp.quantity) || 1) * multiplier).toFixed(2));

    const directActionsHtml = isDirectChild && comp.component_id ? `
      <button class="inline-icon-btn" title="Edit quantity" onclick="promptUpdateComponentQty('${parentRecipeId}', ${comp.component_id}, ${comp.quantity}, '${escapeHtml(comp.unit || '')}')">✏️</button>
      <button class="inline-icon-btn" title="Remove component" onclick="removeSingleComponent('${parentRecipeId}', ${comp.component_id})">✕</button>
    ` : '';

    if (comp.type === 'ingredient') {
      return `
        <div class="tree-node">
          <div class="tree-row is-ingredient">
            <div class="tree-label">
              <span class="toggle-btn" style="cursor:default;">•</span>
              <span class="badge badge-ingredient">Ingredient</span>
              <strong>${escapeHtml(comp.name)}</strong>
            </div>
            <div class="tree-right">
              <span class="qty-pill">${scaledQty} ${escapeHtml(comp.unit || '')}</span>
              ${directActionsHtml}
            </div>
          </div>
        </div>
      `;
    } else {
      return `
        <div class="tree-node">
          <div class="tree-row is-subrecipe">
            <div class="tree-label">
              <button class="toggle-btn" onclick="toggleNode('${nodeKey}')" id="btn_${nodeKey}">▼</button>
              <span class="badge badge-recipe">Sub-Recipe</span>
              <span class="link-recipe" onclick="selectRecipe('${comp.recipe_id}', false)" title="Inspect ${escapeHtml(comp.name)}">
                ${escapeHtml(comp.name)}
              </span>
            </div>
            <div class="tree-right">
              <span class="qty-pill">${scaledQty} ${escapeHtml(comp.unit || 'batch')}</span>
              ${directActionsHtml}
            </div>
          </div>
          <div id="children_${nodeKey}" class="collapsible-children">
            ${renderRecursiveNodes(comp.components, nodeKey, scaledQty, comp.recipe_id, false)}
          </div>
        </div>
      `;
    }
  }).join('');
}

// ==========================================
// SVG DEPENDENCY GRAPH GENERATOR (THEME-AWARE)
// ==========================================

function buildSvgDependencyGraph(rootRecipe, scaleFactor = 1) {
  const levels = [];
  const isLight = currentTheme === 'light';

  function traverse(node, depth, parentKey, mult) {
    if (!levels[depth]) levels[depth] = [];
    const key = `${node.id || node.name}_${depth}_${levels[depth].length}`;
    const item = {
      key,
      id: node.recipe_id || node.id,
      label: node.name,
      type: depth === 0 ? 'root' : node.type,
      qty: depth === 0
        ? `${(node.servings * scaleFactor).toFixed(0)} serv`
        : `${Number(((node.quantity || 1) * mult).toFixed(2))} ${node.unit || ''}`,
      parentKey
    };
    levels[depth].push(item);

    if (node.components && node.components.length > 0) {
      const nextMult = depth === 0 ? scaleFactor : mult * (Number(node.quantity) || 1);
      node.components.forEach(child => traverse(child, depth + 1, key, nextMult));
    }
  }

  traverse(rootRecipe, 0, null, scaleFactor);

  const colWidth = 220;
  const rowHeight = 64;
  const maxRows = Math.max(...levels.map(l => l.length), 1);
  const svgWidth = Math.max(levels.length * colWidth + 60, 520);
  const svgHeight = Math.max(maxRows * rowHeight + 60, 300);

  const positions = new Map();

  levels.forEach((levelNodes, d) => {
    const x = 40 + d * colWidth;
    const totalHeight = levelNodes.length * rowHeight;
    const startY = (svgHeight - totalHeight) / 2 + 12;

    levelNodes.forEach((n, idx) => {
      positions.set(n.key, { x, y: startY + idx * rowHeight, node: n });
    });
  });

  let edgesSvg = '';
  let nodesSvg = '';

  positions.forEach(({ x, y, node }) => {
    if (node.parentKey && positions.has(node.parentKey)) {
      const p = positions.get(node.parentKey);
      const x1 = p.x + 165;
      const y1 = p.y + 22;
      const x2 = x;
      const y2 = y + 22;
      const cx = (x1 + x2) / 2;
      const stroke = node.type === 'recipe' ? '#9333ea' : '#059669';

      edgesSvg += `<path d="M ${x1} ${y1} C ${cx} ${y1}, ${cx} ${y2}, ${x2} ${y2}" fill="none" stroke="${stroke}" stroke-width="2" stroke-opacity="0.65" />`;
    }

    const fill = isLight
      ? (node.type === 'root' ? '#e0e7ff' : node.type === 'recipe' ? '#f3e8ff' : '#d1fae5')
      : (node.type === 'root' ? '#312e81' : node.type === 'recipe' ? '#3b0764' : '#064e3b');
    const border = node.type === 'root' ? '#6366f1' : (node.type === 'recipe' ? '#a855f7' : '#10b981');
    const textMain = isLight ? '#0f172a' : '#ffffff';
    const textSub = isLight ? '#475569' : '#cbd5e1';
    const clickAttr = (node.type === 'recipe' && node.id) ? `onclick="selectRecipe('${node.id}', false)" style="cursor:pointer"` : '';

    nodesSvg += `
      <g transform="translate(${x}, ${y})" ${clickAttr}>
        <rect width="165" height="44" rx="8" fill="${fill}" stroke="${border}" stroke-width="1.8" />
        <text x="10" y="19" fill="${textMain}" font-size="11.5" font-weight="700" font-family="Inter, sans-serif">
          ${escapeHtml(node.label.length > 18 ? node.label.slice(0, 17) + '…' : node.label)}
        </text>
        <text x="10" y="35" fill="${textSub}" font-size="10" font-family="JetBrains Mono, monospace">
          ${escapeHtml(node.qty)}
        </text>
      </g>
    `;
  });

  return `
    <svg width="${svgWidth}" height="${svgHeight}" viewBox="0 0 ${svgWidth} ${svgHeight}">
      ${edgesSvg}
      ${nodesSvg}
    </svg>
  `;
}

// ==========================================
// CONSOLIDATED SHOPPING LIST & CYCLE SIMULATOR
// ==========================================

function renderConsolidatedShoppingCard(recipe, scaleFactor) {
  const items = recipe.total_ingredients || [];
  const totalCount = items.length;
  const checkedCount = items.filter((_, idx) => checkedShoppingItems.has(idx)).length;
  const pct = totalCount > 0 ? Math.round((checkedCount / totalCount) * 100) : 0;

  return `
    <div class="card">
      <div class="card-header">
        <h3>🛒 Consolidated Ingredients</h3>
        <button class="btn btn-ghost btn-sm" onclick="copyShoppingList('${recipe.id}', ${scaleFactor})">
          📋 Copy List
        </button>
      </div>

      <div class="progress-wrap">
        <div class="progress-meta">
          <span>Prep / Shopping Checklist (Click items to check off)</span>
          <strong>${checkedCount} / ${totalCount} (${pct}%)</strong>
        </div>
        <div class="progress-track">
          <div class="progress-fill" style="width:${pct}%"></div>
        </div>
      </div>

      ${totalCount === 0
        ? `<p style="color:var(--text-muted); font-size:0.85rem;">No base ingredients found.</p>`
        : `
          <div class="shopping-list">
            ${items.map((ing, idx) => {
              const isChecked = checkedShoppingItems.has(idx);
              const scaledQty = Number((ing.quantity * scaleFactor).toFixed(2));
              return `
                <div class="shopping-row ${isChecked ? 'checked' : ''}" onclick="toggleShoppingItem(${idx})">
                  <div class="shopping-left">
                    <input type="checkbox" ${isChecked ? 'checked' : ''} onclick="event.stopPropagation(); toggleShoppingItem(${idx})" />
                    <strong>${escapeHtml(ing.name)}</strong>
                  </div>
                  <span class="qty-pill">${scaledQty} ${escapeHtml(ing.unit)}</span>
                </div>
              `;
            }).join('')}
          </div>
        `
      }
    </div>
  `;
}

function toggleShoppingItem(idx) {
  if (checkedShoppingItems.has(idx)) {
    checkedShoppingItems.delete(idx);
  } else {
    checkedShoppingItems.add(idx);
  }
  renderMainPanel();
}

function copyShoppingList(recipeId, scaleFactor) {
  const recipe = allRecipes.find(r => r.id === recipeId);
  if (!recipe) return;
  const lines = recipe.total_ingredients.map(
    i => `- ${i.name}: ${Number((i.quantity * scaleFactor).toFixed(2))} ${i.unit}`
  );
  const text = `Shopping List for ${recipe.name}:\n` + lines.join('\n');
  navigator.clipboard.writeText(text);
  showToast('Consolidated shopping list copied to clipboard!', 'success');
}

function runCycleSimulation(parentId) {
  const candidateId = document.getElementById('simCandidateSelect').value;
  const outputEl = document.getElementById('simOutput');

  function findCycle(currId, path) {
    if (currId === parentId) return [...path, currId];
    if (path.includes(currId)) return null;
    const r = allRecipes.find(x => x.id === currId);
    if (!r) return null;
    for (const c of r.components) {
      if (c.type === 'recipe') {
        const res = findCycle(c.recipe_id, [...path, currId]);
        if (res) return res;
      }
    }
    return null;
  }

  const cycle = parentId === candidateId
    ? [parentId, candidateId]
    : findCycle(candidateId, [parentId]);

  if (cycle) {
    const namedCycle = cycle.map(id => {
      const r = allRecipes.find(x => x.id === id);
      return r ? `${r.name} (${id})` : id;
    }).join(' ➔ ');

    outputEl.innerHTML = `
      <div class="sim-result cycle">
        <strong>❌ CIRCULAR DEPENDENCY BLOCKED!</strong><br/>
        Cycle Path: ${escapeHtml(namedCycle)}
      </div>
    `;
  } else {
    outputEl.innerHTML = `
      <div class="sim-result valid">
        <strong>✅ VALID DAG DEPENDENCY!</strong><br/>
        Adding '${escapeHtml(candidateId)}' inside '${escapeHtml(parentId)}' preserves a valid Directed Acyclic Graph.
      </div>
    `;
  }
}

// ==========================================
// INLINE COMPONENT CRUD & MODAL OPERATIONS
// ==========================================

function requireAuthOrOpenModal() {
  if (!authToken) {
    showToast('Please sign in to create or modify recipes.', 'info');
    openAuthModal('login');
    return false;
  }
  return true;
}

function toggleQuickAddInputs() {
  const type = document.getElementById('quickAddType').value;
  const ingWrap = document.getElementById('quickAddTargetWrap');
  const subSelect = document.getElementById('quickAddSubSelect');
  const unitInput = document.getElementById('quickAddUnit');
  const qtyInput = document.getElementById('quickAddQty');

  if (type === 'ingredient') {
    ingWrap.classList.remove('hidden');
    subSelect.classList.add('hidden');
    qtyInput.value = 100;
    unitInput.value = 'g';
  } else {
    ingWrap.classList.add('hidden');
    subSelect.classList.remove('hidden');
    qtyInput.value = 1;
    unitInput.value = 'batch';
  }
}

async function handleQuickAddComponent(recipeId) {
  if (!requireAuthOrOpenModal()) return;

  const type = document.getElementById('quickAddType').value;
  const quantity = parseFloat(document.getElementById('quickAddQty').value) || 1;
  const unit = document.getElementById('quickAddUnit').value.trim();

  let payload = { type, quantity, unit };
  if (type === 'ingredient') {
    payload.name = document.getElementById('quickAddIngName').value.trim();
    if (!payload.name) return showToast('Enter an ingredient name.', 'error');
  } else {
    payload.recipe_id = document.getElementById('quickAddSubSelect').value;
    if (!payload.recipe_id) return showToast('Select a sub-recipe.', 'error');
  }

  const res = await fetch(`/recipes/${recipeId}/components`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${authToken}`
    },
    body: JSON.stringify(payload)
  });

  const data = await res.json();
  if (!res.ok) {
    showToast(data.error || 'Could not add component', 'error');
    return;
  }

  showToast('Component added!', 'success');
  await Promise.all([fetchRecipes(), fetchKnownIngredients()]);
}

async function promptUpdateComponentQty(recipeId, componentId, currentQty, currentUnit) {
  if (!requireAuthOrOpenModal()) return;
  const newQty = prompt('Enter new quantity:', currentQty);
  if (newQty === null) return;
  const newUnit = prompt('Enter unit:', currentUnit);
  if (newUnit === null) return;

  const res = await fetch(`/recipes/${recipeId}/components/${componentId}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${authToken}`
    },
    body: JSON.stringify({ quantity: parseFloat(newQty) || 1, unit: newUnit.trim() })
  });

  if (!res.ok) {
    const err = await res.json();
    return showToast(err.error || 'Failed to update component', 'error');
  }

  showToast('Component updated!', 'success');
  await fetchRecipes();
}

async function removeSingleComponent(recipeId, componentId) {
  if (!requireAuthOrOpenModal()) return;

  const res = await fetch(`/recipes/${recipeId}/components/${componentId}`, {
    method: 'DELETE',
    headers: { 'Authorization': `Bearer ${authToken}` }
  });

  if (!res.ok) {
    const err = await res.json();
    return showToast(err.error || 'Failed to remove component', 'error');
  }

  showToast('Component removed.', 'info');
  await fetchRecipes();
}

async function cloneRecipe(recipeId) {
  if (!requireAuthOrOpenModal()) return;
  const orig = allRecipes.find(r => r.id === recipeId);
  if (!orig) return;

  const payload = {
    name: `${orig.name} (Copy)`,
    servings: orig.servings,
    components: orig.components.map(c =>
      c.type === 'ingredient'
        ? { type: 'ingredient', name: c.name, quantity: c.quantity, unit: c.unit }
        : { type: 'recipe', recipe_id: c.recipe_id, quantity: c.quantity, unit: c.unit }
    )
  };

  const res = await fetch('/recipes', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${authToken}`
    },
    body: JSON.stringify(payload)
  });

  const data = await res.json();
  if (!res.ok) return showToast(data.error || 'Failed to clone', 'error');

  showToast(`Cloned as "${data.name}"!`, 'success');
  await fetchRecipes();
  selectRecipe(data.id, true);
}

function exportRecipeJson(recipeId) {
  const recipe = allRecipes.find(r => r.id === recipeId);
  if (!recipe) return;
  const blob = new Blob([JSON.stringify(recipe, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${recipe.id}.json`;
  a.click();
  URL.revokeObjectURL(url);
  showToast(`Exported ${recipe.id}.json`, 'success');
}

importRecipeBtn.addEventListener('click', () => {
  if (!requireAuthOrOpenModal()) return;
  jsonFileInput.click();
});

jsonFileInput.addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const text = await file.text();
    const parsed = JSON.parse(text);
    const list = Array.isArray(parsed) ? parsed : [parsed];
    for (const item of list) {
      await fetch('/recipes', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`
        },
        body: JSON.stringify(item)
      });
    }
    showToast('Imported recipe JSON successfully!', 'success');
    await fetchRecipes();
  } catch (err) {
    showToast('Invalid JSON file.', 'error');
  }
  jsonFileInput.value = '';
});

function toggleNode(nodeKey) {
  const childrenEl = document.getElementById(`children_${nodeKey}`);
  const btnEl = document.getElementById(`btn_${nodeKey}`);
  if (!childrenEl) return;
  const isHidden = childrenEl.classList.toggle('hidden');
  btnEl.textContent = isHidden ? '▶' : '▼';
}

function toggleAllNodes(expand) {
  document.querySelectorAll('.collapsible-children').forEach(el => {
    el.classList.toggle('hidden', !expand);
  });
  document.querySelectorAll('.toggle-btn').forEach(btn => {
    if (btn.textContent === '▼' || btn.textContent === '▶') {
      btn.textContent = expand ? '▼' : '▶';
    }
  });
}

newRecipeBtn.addEventListener('click', () => {
  if (!requireAuthOrOpenModal()) return;
  editingRecipeId = null;
  modalTitle.textContent = 'Create New Recipe';
  formRecipeName.value = '';
  formRecipeCustomId.value = '';
  formRecipeCustomId.disabled = false;
  formServings.value = 2;
  formComponentsList.innerHTML = '';
  formError.classList.add('hidden');

  addComponentRow({ type: 'ingredient', name: '', quantity: 100, unit: 'g' });
  recipeModal.classList.remove('hidden');
});

function openEditModal(recipeId) {
  if (!requireAuthOrOpenModal()) return;
  const recipe = allRecipes.find(r => r.id === recipeId);
  if (!recipe) return;

  editingRecipeId = recipeId;
  modalTitle.textContent = `Edit Recipe: ${recipe.name}`;
  formRecipeName.value = recipe.name;
  formRecipeCustomId.value = recipe.id;
  formRecipeCustomId.disabled = true;
  formServings.value = recipe.servings;
  formComponentsList.innerHTML = '';
  formError.classList.add('hidden');

  recipe.components.forEach(comp => addComponentRow(comp));
  recipeModal.classList.remove('hidden');
}

function addComponentRow(comp = { type: 'ingredient', name: '', quantity: 100, unit: 'g' }) {
  const row = document.createElement('div');
  row.className = 'comp-row';
  row.dataset.type = comp.type;

  if (comp.type === 'ingredient') {
    row.innerHTML = `
      <span class="badge badge-ingredient" style="justify-content:center;">Ingredient</span>
      <input type="text" class="comp-name" list="knownIngredientsList" placeholder="Ingredient name (e.g., Flour)" value="${escapeHtml(comp.name || '')}" required />
      <input type="number" step="any" class="comp-qty" placeholder="Qty" value="${comp.quantity ?? 100}" required />
      <input type="text" class="comp-unit" placeholder="Unit (g, ml)" value="${escapeHtml(comp.unit || 'g')}" />
      <button type="button" class="btn btn-danger btn-sm" onclick="this.parentElement.remove()">✕</button>
    `;
  } else {
    const optionsHtml = allRecipes
      .filter(r => r.id !== editingRecipeId)
      .map(r => `<option value="${r.id}" ${r.id === comp.recipe_id ? 'selected' : ''}>${escapeHtml(r.name)} (${r.id})</option>`)
      .join('');

    row.innerHTML = `
      <span class="badge badge-recipe" style="justify-content:center;">Sub-Recipe</span>
      <select class="comp-recipe-id" required>
        <option value="">-- Select Existing Recipe --</option>
        ${optionsHtml}
      </select>
      <input type="number" step="any" class="comp-qty" placeholder="Batches" value="${comp.quantity ?? 1}" required />
      <input type="text" class="comp-unit" placeholder="batch" value="${escapeHtml(comp.unit || 'batch')}" />
      <button type="button" class="btn btn-danger btn-sm" onclick="this.parentElement.remove()">✕</button>
    `;
  }

  formComponentsList.appendChild(row);
}

document.getElementById('addIngredientRowBtn').addEventListener('click', () => {
  addComponentRow({ type: 'ingredient', name: '', quantity: 100, unit: 'g' });
});

document.getElementById('addSubRecipeRowBtn').addEventListener('click', () => {
  addComponentRow({ type: 'recipe', recipe_id: '', quantity: 1, unit: 'batch' });
});

document.getElementById('closeModalBtn').addEventListener('click', () => recipeModal.classList.add('hidden'));
document.getElementById('cancelModalBtn').addEventListener('click', () => recipeModal.classList.add('hidden'));

recipeForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  formError.classList.add('hidden');

  const components = Array.from(formComponentsList.querySelectorAll('.comp-row')).map(row => {
    const type = row.dataset.type;
    const quantity = parseFloat(row.querySelector('.comp-qty').value) || 1;
    const unit = row.querySelector('.comp-unit').value.trim();

    if (type === 'ingredient') {
      return {
        type: 'ingredient',
        name: row.querySelector('.comp-name').value.trim(),
        quantity,
        unit
      };
    } else {
      return {
        type: 'recipe',
        recipe_id: row.querySelector('.comp-recipe-id').value,
        quantity,
        unit
      };
    }
  });

  const payload = {
    id: editingRecipeId ? undefined : formRecipeCustomId.value.trim(),
    name: formRecipeName.value.trim(),
    servings: parseInt(formServings.value, 10) || 1,
    components
  };

  const url = editingRecipeId ? `/recipes/${editingRecipeId}` : '/recipes';
  const method = editingRecipeId ? 'PUT' : 'POST';

  const res = await fetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${authToken}`
    },
    body: JSON.stringify(payload)
  });

  const data = await res.json();
  if (!res.ok) {
    formError.textContent = data.error || 'Failed to save recipe.';
    formError.classList.remove('hidden');
    return;
  }

  recipeModal.classList.add('hidden');
  showToast(editingRecipeId ? 'Recipe updated!' : 'Recipe created!', 'success');
  await Promise.all([fetchRecipes(), fetchKnownIngredients()]);
  selectRecipe(data.id, true);
});

async function deleteRecipe(recipeId) {
  if (!requireAuthOrOpenModal()) return;
  if (!confirm('Are you sure you want to delete this recipe?')) return;

  const res = await fetch(`/recipes/${recipeId}`, {
    method: 'DELETE',
    headers: { 'Authorization': `Bearer ${authToken}` }
  });
  const data = await res.json();
  if (!res.ok) {
    showToast(data.error || 'Could not delete recipe.', 'error');
    return;
  }

  showToast('Recipe deleted.', 'info');
  if (selectedRecipeId === recipeId) selectedRecipeId = null;
  await fetchRecipes();
}

searchInput.addEventListener('input', () => renderSidebar());

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
// ==========================================
// ADMIN BACKEND INSPECTOR LOGIC
// ==========================================

let adminDataCache = null;
let currentAdminTab = 'users';

async function openAdminModal() {
  if (!requireAuthOrOpenModal()) return;
  document.getElementById('adminModal').classList.remove('hidden');
  await refreshAdminData();
}

function closeAdminModal() {
  document.getElementById('adminModal').classList.add('hidden');
}

function switchAdminTab(tab) {
  currentAdminTab = tab;
  ['users', 'tables', 'logs', 'raw'].forEach(t => {
    const btn = document.getElementById(`admTab_${t}`);
    if (btn) btn.classList.toggle('active', t === tab);
  });
  renderAdminBody();
}

async function refreshAdminData() {
  const res = await fetch('/api/admin/overview', {
    headers: { Authorization: `Bearer ${authToken}` }
  });
  if (!res.ok) {
    showToast('Failed to load admin overview. Please sign in again.', 'error');
    return;
  }
  adminDataCache = await res.json();
  renderAdminMetrics();
  renderAdminBody();
}

function renderAdminMetrics() {
  if (!adminDataCache) return;
  const { counts, system } = adminDataCache;
  document.getElementById('adminMetricsStrip').innerHTML = `
    <div class="card" style="margin:0; padding:0.75rem;">
      <div style="font-size:0.72rem; color:var(--text-muted);">REGISTERED USERS</div>
      <div style="font-size:1.35rem; font-weight:800;">👥 ${counts.users}</div>
    </div>
    <div class="card" style="margin:0; padding:0.75rem;">
      <div style="font-size:0.72rem; color:var(--text-muted);">RECIPES IN DB</div>
      <div style="font-size:1.35rem; font-weight:800;">🍲 ${counts.recipes}</div>
    </div>
    <div class="card" style="margin:0; padding:0.75rem;">
      <div style="font-size:0.72rem; color:var(--text-muted);">RAW INGREDIENTS</div>
      <div style="font-size:1.35rem; font-weight:800;">🥕 ${counts.ingredients}</div>
    </div>
    <div class="card" style="margin:0; padding:0.75rem;">
      <div style="font-size:0.72rem; color:var(--text-muted);">DAG COMPONENT EDGES</div>
      <div style="font-size:1.35rem; font-weight:800;">🔗 ${counts.recipe_components}</div>
    </div>
    <div class="card" style="margin:0; padding:0.75rem;">
      <div style="font-size:0.72rem; color:var(--text-muted);">UPTIME / MEMORY</div>
      <div style="font-size:0.95rem; font-weight:700; margin-top:0.2rem;">🟢 ${system.uptimeSeconds}s • ${system.memoryRssMb} MB</div>
    </div>
  `;
}

function renderAdminBody() {
  const container = document.getElementById('adminTabContent');
  if (!adminDataCache) return;

  if (currentAdminTab === 'users') {
    const rows = adminDataCache.users.map(u => `
      <tr style="border-bottom: 1px solid var(--border-subtle);">
        <td style="padding:0.6rem;"><code>#${u.id}</code></td>
        <td style="padding:0.6rem;"><strong>${escapeHtml(u.username)}</strong></td>
        <td style="padding:0.6rem;">${escapeHtml(u.email)}</td>
        <td style="padding:0.6rem;"><span class="badge">${escapeHtml(u.provider.toUpperCase())}</span></td>
        <td style="padding:0.6rem;">
          <span class="badge ${u.role === 'admin' ? 'badge-recipe' : 'badge-ingredient'}">${escapeHtml(u.role.toUpperCase())}</span>
        </td>
        <td style="padding:0.6rem;">${u.recipe_count}</td>
        <td style="padding:0.6rem; font-size:0.75rem; color:var(--text-muted);">${new Date(u.created_at).toLocaleString()}</td>
        <td style="padding:0.6rem; display:flex; gap:0.35rem;">
          <button class="btn btn-ghost btn-sm" onclick="toggleAdminUserRole(${u.id})">Role ⇄</button>
          <button class="btn btn-danger btn-sm" onclick="deleteAdminUser(${u.id})">✕</button>
        </td>
      </tr>
    `).join('');

    container.innerHTML = `
      <table style="width:100%; border-collapse:collapse; font-size:0.84rem; text-align:left;">
        <thead>
          <tr style="border-bottom: 2px solid var(--border-subtle); color:var(--text-muted);">
            <th style="padding:0.5rem;">ID</th>
            <th style="padding:0.5rem;">Username</th>
            <th style="padding:0.5rem;">Email</th>
            <th style="padding:0.5rem;">Auth Provider</th>
            <th style="padding:0.5rem;">Role</th>
            <th style="padding:0.5rem;">Recipes</th>
            <th style="padding:0.5rem;">Joined</th>
            <th style="padding:0.5rem;">Actions</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    `;
    return;
  }

  if (currentAdminTab === 'tables') {
    const compRows = adminDataCache.recipe_components.slice(0, 60).map(rc => `
      <tr style="border-bottom: 1px solid var(--border-subtle);">
        <td style="padding:0.45rem;"><code>#${rc.id}</code></td>
        <td style="padding:0.45rem;"><code>${escapeHtml(rc.parent_recipe_id)}</code></td>
        <td style="padding:0.45rem;"><span class="badge ${rc.type === 'recipe' ? 'badge-recipe' : 'badge-ingredient'}">${rc.type}</span></td>
        <td style="padding:0.45rem;"><code>${rc.type === 'recipe' ? escapeHtml(rc.child_recipe_id) : 'Ing #' + rc.ingredient_id}</code></td>
        <td style="padding:0.45rem;">${rc.quantity} ${escapeHtml(rc.unit)}</td>
      </tr>
    `).join('');

    container.innerHTML = `
      <h4 style="margin-bottom:0.5rem;">Relational Table: <code>recipe_components</code> (Showing first 60 rows)</h4>
      <table style="width:100%; border-collapse:collapse; font-size:0.82rem; text-align:left;">
        <thead>
          <tr style="border-bottom: 2px solid var(--border-subtle); color:var(--text-muted);">
            <th style="padding:0.45rem;">Edge ID</th>
            <th style="padding:0.45rem;">Parent Recipe ID</th>
            <th style="padding:0.45rem;">Type</th>
            <th style="padding:0.45rem;">Target Ref</th>
            <th style="padding:0.45rem;">Quantity &amp; Unit</th>
          </tr>
        </thead>
        <tbody>${compRows}</tbody>
      </table>
    `;
    return;
  }

  if (currentAdminTab === 'logs') {
    const logRows = adminDataCache.logs.map(l => `
      <tr style="border-bottom: 1px solid var(--border-subtle); font-family: 'JetBrains Mono', monospace; font-size:0.78rem;">
        <td style="padding:0.45rem; color:var(--text-muted);">${new Date(l.time).toLocaleTimeString()}</td>
        <td style="padding:0.45rem;"><strong>${l.method}</strong></td>
        <td style="padding:0.45rem;">${escapeHtml(l.url)}</td>
        <td style="padding:0.45rem; color:${l.status >= 400 ? 'var(--danger)' : 'var(--ing-accent)'};">${l.status}</td>
        <td style="padding:0.45rem;">${l.durationMs} ms</td>
      </tr>
    `).join('');

    container.innerHTML = `
      <table style="width:100%; border-collapse:collapse; text-align:left;">
        <thead>
          <tr style="border-bottom: 2px solid var(--border-subtle); color:var(--text-muted); font-size:0.78rem;">
            <th style="padding:0.45rem;">Time</th>
            <th style="padding:0.45rem;">Method</th>
            <th style="padding:0.45rem;">Endpoint</th>
            <th style="padding:0.45rem;">Status</th>
            <th style="padding:0.45rem;">Latency</th>
          </tr>
        </thead>
        <tbody>${logRows}</tbody>
      </table>
    `;
    return;
  }

  if (currentAdminTab === 'raw') {
    container.innerHTML = `
      <pre style="background:var(--bg-base); padding:1rem; border-radius:8px; font-family:'JetBrains Mono',monospace; font-size:0.76rem; overflow:auto;">${escapeHtml(JSON.stringify(adminDataCache, null, 2))}</pre>
    `;
  }
}

async function toggleAdminUserRole(userId) {
  const res = await fetch(`/api/admin/users/${userId}/role`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${authToken}` }
  });
  const data = await res.json();
  if (!res.ok) return showToast(data.error || 'Failed to update role', 'error');
  showToast(data.message, 'success');
  await refreshAdminData();
}

async function deleteAdminUser(userId) {
  if (!confirm('Delete this user account?')) return;
  const res = await fetch(`/api/admin/users/${userId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${authToken}` }
  });
  const data = await res.json();
  if (!res.ok) return showToast(data.error || 'Failed to delete user', 'error');
  showToast(data.message, 'info');
  await refreshAdminData();
}
init();