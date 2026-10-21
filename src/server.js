require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('./db');
const seedDatabase = require('./seed');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'super_secret_inter_iit_jwt_key_2026';

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

app.set('trust proxy', 1);

// Live in-memory API Request Log buffer for Admin Monitoring
const apiRequestLogs = [];
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    if (req.originalUrl.startsWith('/api') || req.originalUrl.startsWith('/recipes') || req.originalUrl.startsWith('/ingredients')) {
      apiRequestLogs.unshift({
        time: new Date().toISOString(),
        method: req.method,
        url: req.originalUrl,
        status: res.statusCode,
        durationMs: Date.now() - start,
        ip: req.ip || '127.0.0.1'
      });
      if (apiRequestLogs.length > 80) apiRequestLogs.pop();
    }
  });
  next();
});

// Helper to dynamically resolve public URL on localhost or cloud deployment
function getBaseUrl(req) {
  if (process.env.BASE_URL && !process.env.BASE_URL.includes('localhost')) {
    return process.env.BASE_URL.replace(/\/$/, '');
  }
  return `${req.protocol}://${req.get('host')}`;
}

// Seed database on startup
seedDatabase();

// ==========================================
// HELPER FUNCTIONS & CORE ALGORITHMS
// ==========================================
// Trust reverse proxy headers when deployed on Render / Railway / Cloud
app.set('trust proxy', 1);

// Live in-memory API Request Log buffer for Admin Monitoring
const apiRequestLogs = [];
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    if (req.originalUrl.startsWith('/api') || req.originalUrl.startsWith('/recipes') || req.originalUrl.startsWith('/ingredients')) {
      apiRequestLogs.unshift({
        time: new Date().toISOString(),
        method: req.method,
        url: req.originalUrl,
        status: res.statusCode,
        durationMs: Date.now() - start,
        ip: req.ip || '127.0.0.1'
      });
      if (apiRequestLogs.length > 80) apiRequestLogs.pop();
    }
  });
  next();
});

// Helper to dynamically resolve public URL on localhost or cloud deployment
function getBaseUrl(req) {
  if (process.env.BASE_URL && !process.env.BASE_URL.includes('localhost')) {
    return process.env.BASE_URL.replace(/\/$/, '');
  }
  return `${req.protocol}://${req.get('host')}`;
}
function ensureIngredientId(name) {
  const cleanName = name.trim();
  db.prepare('INSERT OR IGNORE INTO ingredients (name) VALUES (?)').run(cleanName);
  return db.prepare('SELECT id FROM ingredients WHERE name = ? COLLATE NOCASE').get(cleanName).id;
}

/**
 * Circular Dependency Detection (DFS)
 * Checks if adding `candidateChildId` as a component of `parentId` creates a cycle.
 * Returns the cycle path array if a cycle is detected, or null if valid.
 */
function findCyclePath(parentId, candidateChildId) {
  if (parentId === candidateChildId) {
    return [parentId, candidateChildId];
  }

  const getChildRecipes = db.prepare(`
    SELECT child_recipe_id FROM recipe_components
    WHERE parent_recipe_id = ? AND type = 'recipe'
  `);

  function dfs(currentId, visitedPath) {
    if (currentId === parentId) {
      return [...visitedPath, currentId];
    }
    if (visitedPath.includes(currentId)) {
      return null;
    }

    const children = getChildRecipes.all(currentId);
    for (const row of children) {
      const cycle = dfs(row.child_recipe_id, [...visitedPath, currentId]);
      if (cycle) return cycle;
    }
    return null;
  }

  return dfs(candidateChildId, [parentId]);
}

/**
 * Recursively builds the full nested composition tree for a recipe
 */
function buildRecipeTree(recipeId, ancestorIds = new Set()) {
  const recipe = db.prepare(`
    SELECT r.*, u.username as author
    FROM recipes r
    LEFT JOIN users u ON r.user_id = u.id
    WHERE r.id = ?
  `).get(recipeId);

  if (!recipe) return null;

  const rawComponents = db.prepare(`
    SELECT rc.id as component_id, rc.type, rc.quantity, rc.unit,
           i.name as ingredient_name, rc.child_recipe_id
    FROM recipe_components rc
    LEFT JOIN ingredients i ON rc.ingredient_id = i.id
    WHERE rc.parent_recipe_id = ?
  `).all(recipeId);

  const nextAncestors = new Set(ancestorIds);
  nextAncestors.add(recipeId);

  const components = rawComponents.map(comp => {
    if (comp.type === 'ingredient') {
      return {
        component_id: comp.component_id,
        type: 'ingredient',
        name: comp.ingredient_name,
        quantity: comp.quantity,
        unit: comp.unit
      };
    } else {
      // Prevent infinite recursion if corrupted data exists
      if (nextAncestors.has(comp.child_recipe_id)) {
        return {
          component_id: comp.component_id,
          type: 'recipe',
          recipe_id: comp.child_recipe_id,
          name: 'Circular Reference Detected',
          error: true
        };
      }
      const nestedRecipe = buildRecipeTree(comp.child_recipe_id, nextAncestors);
      return {
        component_id: comp.component_id,
        type: 'recipe',
        recipe_id: comp.child_recipe_id,
        name: nestedRecipe ? nestedRecipe.name : 'Unknown Recipe',
        servings: nestedRecipe ? nestedRecipe.servings : 1,
        quantity: comp.quantity || 1,
        unit: comp.unit || 'batch',
        components: nestedRecipe ? nestedRecipe.components : []
      };
    }
  });

  return {
    id: recipe.id,
    name: recipe.name,
    servings: recipe.servings,
    user_id: recipe.user_id,
    author: recipe.author || 'System',
    components
  };
}

/**
 * Recursively traverses a recipe tree and consolidates all raw ingredients
 */
function expandIngredients(recipeTree, multiplier = 1, accumulator = new Map()) {
  if (!recipeTree || !recipeTree.components) return [];

  for (const comp of recipeTree.components) {
    if (comp.type === 'ingredient') {
      const unitNorm = (comp.unit || '').trim().toLowerCase();
      const key = `${comp.name.toLowerCase()}__${unitNorm}`;
      const addedQty = (Number(comp.quantity) || 0) * multiplier;

      if (accumulator.has(key)) {
        const existing = accumulator.get(key);
        existing.quantity = Number((existing.quantity + addedQty).toFixed(2));
      } else {
        accumulator.set(key, {
          name: comp.name,
          quantity: Number(addedQty.toFixed(2)),
          unit: comp.unit || ''
        });
      }
    } else if (comp.type === 'recipe') {
      const subMultiplier = multiplier * (Number(comp.quantity) || 1);
      expandIngredients(comp, subMultiplier, accumulator);
    }
  }

  return Array.from(accumulator.values());
}

/**
 * Finds all parent recipes that directly use this recipe
 */
function getUsedInRecipes(recipeId) {
  return db.prepare(`
    SELECT DISTINCT r.id, r.name
    FROM recipe_components rc
    JOIN recipes r ON rc.parent_recipe_id = r.id
    WHERE rc.type = 'recipe' AND rc.child_recipe_id = ?
  `).all(recipeId);
}

// ==========================================
// AUTHENTICATION MIDDLEWARE & REAL OAUTH 2.0 ROUTES
// ==========================================

const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;

function signUserToken(user) {
  const payload = {
    id: user.id,
    username: user.username,
    email: user.email || `${user.username}@recipegraph.dev`,
    provider: user.provider || 'email',
    avatar: user.avatar || ''
  };
  const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '24h' });
  return { token, user: payload };
}

function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Authentication required. Please sign in.' });

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ error: 'Session expired or invalid token. Please sign in again.' });
    req.user = user;
    next();
  });
}

// 1. Email & Password Registration
app.post('/api/auth/register', (req, res) => {
  const { name, username, email, password } = req.body;
  const cleanEmail = (email || '').trim().toLowerCase();
  const displayName = (name || username || cleanEmail.split('@')[0] || '').trim();

  if (!cleanEmail || !cleanEmail.includes('@')) {
    return res.status(400).json({ error: 'Please enter a valid email address.' });
  }
  if (!password || password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters long.' });
  }

  try {
    const hash = bcrypt.hashSync(password, 10);
    const newUser = db.createUser({
      username: displayName,
      email: cleanEmail,
      password_hash: hash,
      provider: 'email'
    });
    res.status(201).json(signUserToken(newUser));
  } catch (err) {
    res.status(400).json({ error: err.message || 'Failed to register account.' });
  }
});

// 2. Email & Password Login
app.post('/api/auth/login', (req, res) => {
  const { email, username, password } = req.body;
  const identifier = (email || username || '').trim();

  if (!identifier || !password) {
    return res.status(400).json({ error: 'Email and password are required.' });
  }

  const user = db.findUserByEmailOrUsername(identifier);
  if (!user || !user.password_hash || user.password_hash === 'oauth_external_account') {
    return res.status(401).json({ error: 'Invalid email or password.' });
  }

  if (!bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'Invalid email or password.' });
  }

  res.json(signUserToken(user));
});

// 3. REAL GOOGLE OAUTH 2.0 FLOW
app.get('/api/auth/google', (req, res) => {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId || clientId === 'your_google_client_id_here') {
    return res.redirect('/?auth_error=' + encodeURIComponent('GOOGLE_CLIENT_ID is not configured in .env yet.'));
  }

  const redirectUri = `${BASE_URL}/api/auth/google/callback`;
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    access_type: 'online',
    prompt: 'select_account'
  });

  res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`);
});

app.get('/api/auth/google/callback', async (req, res) => {
  const { code, error } = req.query;
  if (error || !code) {
    return res.redirect('/?auth_error=' + encodeURIComponent('Google sign-in was cancelled or failed.'));
  }

  try {
    const redirectUri = `${BASE_URL}/api/auth/google/callback`;

    // Exchange authorization code for access token
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: process.env.GOOGLE_CLIENT_ID,
        client_secret: process.env.GOOGLE_CLIENT_SECRET,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code'
      })
    });

    const tokenData = await tokenRes.json();
    if (!tokenRes.ok || !tokenData.access_token) {
      throw new Error(tokenData.error_description || 'Failed to exchange Google OAuth code.');
    }

    // Fetch real Google user profile
    const profileRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` }
    });
    const profile = await profileRes.json();

    const user = db.upsertOAuthUser({
      email: profile.email,
      username: profile.name || profile.email.split('@')[0],
      provider: 'google',
      avatar: profile.picture || ''
    });

    const { token } = signUserToken(user);
    res.redirect(`/?token=${encodeURIComponent(token)}`);
  } catch (err) {
    console.error('Google OAuth Error:', err);
    res.redirect('/?auth_error=' + encodeURIComponent(err.message || 'Google authentication failed.'));
  }
});

// 4. REAL GITHUB OAUTH 2.0 FLOW
app.get('/api/auth/github', (req, res) => {
  const clientId = process.env.GITHUB_CLIENT_ID;
  if (!clientId || clientId === 'your_github_client_id_here') {
    return res.redirect('/?auth_error=' + encodeURIComponent('GITHUB_CLIENT_ID is not configured in .env yet.'));
  }

  const redirectUri = `${BASE_URL}/api/auth/github/callback`;
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: 'read:user user:email'
  });

  res.redirect(`https://github.com/login/oauth/authorize?${params.toString()}`);
});

app.get('/api/auth/github/callback', async (req, res) => {
  const { code, error } = req.query;
  if (error || !code) {
    return res.redirect('/?auth_error=' + encodeURIComponent('GitHub sign-in was cancelled or failed.'));
  }

  try {
    // Exchange code for GitHub access token
    const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify({
        client_id: process.env.GITHUB_CLIENT_ID,
        client_secret: process.env.GITHUB_CLIENT_SECRET,
        code
      })
    });

    const tokenData = await tokenRes.json();
    if (tokenData.error || !tokenData.access_token) {
      throw new Error(tokenData.error_description || 'Failed to exchange GitHub OAuth code.');
    }

    const ghHeaders = {
      Authorization: `Bearer ${tokenData.access_token}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'RecipeGraph-App'
    };

    // Fetch GitHub user profile
    const profileRes = await fetch('https://api.github.com/user', { headers: ghHeaders });
    const profile = await profileRes.json();

    // Fetch primary verified email if profile.email is private
    let email = profile.email;
    if (!email) {
      const emailsRes = await fetch('https://api.github.com/user/emails', { headers: ghHeaders });
      const emails = await emailsRes.json();
      if (Array.isArray(emails) && emails.length > 0) {
        const primary = emails.find(e => e.primary && e.verified) || emails[0];
        email = primary.email;
      }
    }
    if (!email) {
      email = `${profile.login}@users.noreply.github.com`;
    }

    const user = db.upsertOAuthUser({
      email,
      username: profile.name || profile.login,
      provider: 'github',
      avatar: profile.avatar_url || ''
    });

    const { token } = signUserToken(user);
    res.redirect(`/?token=${encodeURIComponent(token)}`);
  } catch (err) {
    console.error('GitHub OAuth Error:', err);
    res.redirect('/?auth_error=' + encodeURIComponent(err.message || 'GitHub authentication failed.'));
  }
});

// 5. Session Verification & Logout
app.get('/api/auth/me', authenticateToken, (req, res) => {
  const freshUser = db.findUserById(req.user.id);
  res.json({ user: freshUser ? signUserToken(freshUser).user : req.user });
});

app.post('/api/auth/logout', (req, res) => {
  res.json({ message: 'Logged out successfully.' });
});

// ==========================================
// RECIPE MANAGEMENT API ROUTES
// ==========================================

// GET /ingredients - List all raw ingredients from the database
app.get('/ingredients', (req, res) => {
  const rows = db.prepare('SELECT id, name FROM ingredients ORDER BY name ASC').all();
  res.json(rows);
});


// GET /recipes - List all recipes (with optional search filter)
app.get('/recipes', (req, res) => {
  const search = (req.query.search || '').trim();
  let rows;
  if (search) {
    rows = db.prepare('SELECT id FROM recipes WHERE name LIKE ? ORDER BY created_at DESC').all(`%${search}%`);
  } else {
    rows = db.prepare('SELECT id FROM recipes ORDER BY created_at ASC').all();
  }

  const recipes = rows.map(r => {
    const tree = buildRecipeTree(r.id);
    return {
      ...tree,
      total_ingredients: expandIngredients(tree),
      used_in: getUsedInRecipes(r.id)
    };
  });

  res.json(recipes);
});

// GET /recipes/:id - Get single recipe with full recursive tree & expanded ingredients
app.get('/recipes/:id', (req, res) => {
  const tree = buildRecipeTree(req.params.id);
  if (!tree) return res.status(404).json({ error: 'Recipe not found.' });

  res.json({
    ...tree,
    total_ingredients: expandIngredients(tree),
    used_in: getUsedInRecipes(req.params.id)
  });
});

// POST /recipes - Create a new recipe
app.post('/recipes', authenticateToken, (req, res) => {
  const { id, name, servings, components } = req.body;
  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'Recipe name is required.' });
  }

  const recipeId = (id && id.trim()) ? id.trim() : `recipe_${Date.now()}`;
  const existing = db.prepare('SELECT id FROM recipes WHERE id = ?').get(recipeId);
  if (existing) {
    return res.status(400).json({ error: `Recipe ID '${recipeId}' already exists.` });
  }

  const compList = Array.isArray(components) ? components : [];

  try {
    const createTx = db.transaction(() => {
      db.prepare('INSERT INTO recipes (id, name, servings, user_id) VALUES (?, ?, ?, ?)')
        .run(recipeId, name.trim(), Number(servings) || 1, req.user.id);

      const insertComp = db.prepare(`
        INSERT INTO recipe_components (parent_recipe_id, type, ingredient_id, child_recipe_id, quantity, unit)
        VALUES (?, ?, ?, ?, ?, ?)
      `);

      for (const comp of compList) {
        if (comp.type === 'ingredient') {
          if (!comp.name) throw new Error('Ingredient name is required.');
          const ingId = ensureIngredientId(comp.name);
          insertComp.run(recipeId, 'ingredient', ingId, null, Number(comp.quantity) || 0, comp.unit || '');
        } else if (comp.type === 'recipe') {
          const targetId = comp.recipe_id;
          const targetRecipe = db.prepare('SELECT id, name FROM recipes WHERE id = ?').get(targetId);
          if (!targetRecipe) throw new Error(`Referenced recipe '${targetId}' does not exist.`);

          const cycle = findCyclePath(recipeId, targetId);
          if (cycle) {
            throw new Error(`Circular dependency detected: ${cycle.join(' -> ')}`);
          }

          insertComp.run(recipeId, 'recipe', null, targetId, Number(comp.quantity) || 1, comp.unit || 'batch');
        }
      }
    });

    createTx();
    const createdTree = buildRecipeTree(recipeId);
    res.status(201).json({
      ...createdTree,
      total_ingredients: expandIngredients(createdTree),
      used_in: []
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// PUT /recipes/:id - Update recipe details and optionally replace components
app.put('/recipes/:id', authenticateToken, (req, res) => {
  const recipeId = req.params.id;
  const existing = db.prepare('SELECT * FROM recipes WHERE id = ?').get(recipeId);
  if (!existing) return res.status(404).json({ error: 'Recipe not found.' });

  const { name, servings, components } = req.body;

  try {
    const updateTx = db.transaction(() => {
      if (name !== undefined || servings !== undefined) {
        db.prepare('UPDATE recipes SET name = ?, servings = ? WHERE id = ?')
          .run(name ? name.trim() : existing.name, Number(servings) || existing.servings, recipeId);
      }

      if (Array.isArray(components)) {
        db.prepare('DELETE FROM recipe_components WHERE parent_recipe_id = ?').run(recipeId);

        const insertComp = db.prepare(`
          INSERT INTO recipe_components (parent_recipe_id, type, ingredient_id, child_recipe_id, quantity, unit)
          VALUES (?, ?, ?, ?, ?, ?)
        `);

        for (const comp of components) {
          if (comp.type === 'ingredient') {
            if (!comp.name) throw new Error('Ingredient name is required.');
            const ingId = ensureIngredientId(comp.name);
            insertComp.run(recipeId, 'ingredient', ingId, null, Number(comp.quantity) || 0, comp.unit || '');
          } else if (comp.type === 'recipe') {
            const targetId = comp.recipe_id;
            const targetRecipe = db.prepare('SELECT id FROM recipes WHERE id = ?').get(targetId);
            if (!targetRecipe) throw new Error(`Referenced recipe '${targetId}' does not exist.`);

            const cycle = findCyclePath(recipeId, targetId);
            if (cycle) {
              throw new Error(`Circular dependency detected: ${cycle.join(' -> ')}`);
            }

            insertComp.run(recipeId, 'recipe', null, targetId, Number(comp.quantity) || 1, comp.unit || 'batch');
          }
        }
      }
    });

    updateTx();
    const updatedTree = buildRecipeTree(recipeId);
    res.json({
      ...updatedTree,
      total_ingredients: expandIngredients(updatedTree),
      used_in: getUsedInRecipes(recipeId)
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// DELETE /recipes/:id - Delete a recipe
app.delete('/recipes/:id', authenticateToken, (req, res) => {
  const recipeId = req.params.id;
  const usedIn = getUsedInRecipes(recipeId);
  if (usedIn.length > 0) {
    const names = usedIn.map(r => r.name).join(', ');
    return res.status(400).json({
      error: `Cannot delete this recipe because it is used as a component in: ${names}. Remove it from those recipes first.`
    });
  }

  const info = db.prepare('DELETE FROM recipes WHERE id = ?').run(recipeId);
  if (info.changes === 0) return res.status(404).json({ error: 'Recipe not found.' });

  res.json({ message: 'Recipe deleted successfully.' });
});

// POST /recipes/:id/components - Add a single component to an existing recipe
app.post('/recipes/:id/components', authenticateToken, (req, res) => {
  const parentId = req.params.id;
  const parent = db.prepare('SELECT * FROM recipes WHERE id = ?').get(parentId);
  if (!parent) return res.status(404).json({ error: 'Parent recipe not found.' });

  const { type, name, recipe_id, quantity, unit } = req.body;

  try {
    if (type === 'ingredient') {
      if (!name) return res.status(400).json({ error: 'Ingredient name is required.' });
      const ingId = ensureIngredientId(name);
      db.prepare(`
        INSERT INTO recipe_components (parent_recipe_id, type, ingredient_id, quantity, unit)
        VALUES (?, 'ingredient', ?, ?, ?)
      `).run(parentId, ingId, Number(quantity) || 0, unit || '');
    } else if (type === 'recipe') {
      const target = db.prepare('SELECT id FROM recipes WHERE id = ?').get(recipe_id);
      if (!target) return res.status(404).json({ error: `Recipe '${recipe_id}' not found.` });

      const cycle = findCyclePath(parentId, recipe_id);
      if (cycle) {
        return res.status(400).json({
          error: `Circular dependency prevented! Adding '${recipe_id}' to '${parentId}' creates cycle: ${cycle.join(' -> ')}`
        });
      }

      db.prepare(`
        INSERT INTO recipe_components (parent_recipe_id, type, child_recipe_id, quantity, unit)
        VALUES (?, 'recipe', ?, ?, ?)
      `).run(parentId, recipe_id, Number(quantity) || 1, unit || 'batch');
    } else {
      return res.status(400).json({ error: "Component type must be 'ingredient' or 'recipe'." });
    }

    const updatedTree = buildRecipeTree(parentId);
    res.status(201).json({
      ...updatedTree,
      total_ingredients: expandIngredients(updatedTree),
      used_in: getUsedInRecipes(parentId)
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// PUT /recipes/:id/components/:componentId - Update component quantity/unit
app.put('/recipes/:id/components/:componentId', authenticateToken, (req, res) => {
  const { id, componentId } = req.params;
  const { quantity, unit } = req.body;

  const comp = db.prepare('SELECT * FROM recipe_components WHERE id = ? AND parent_recipe_id = ?').get(componentId, id);
  if (!comp) return res.status(404).json({ error: 'Component not found in this recipe.' });

  db.prepare('UPDATE recipe_components SET quantity = ?, unit = ? WHERE id = ?')
    .run(quantity !== undefined ? Number(quantity) : comp.quantity, unit !== undefined ? unit : comp.unit, componentId);

  const updatedTree = buildRecipeTree(id);
  res.json({
    ...updatedTree,
    total_ingredients: expandIngredients(updatedTree),
    used_in: getUsedInRecipes(id)
  });
});

// DELETE /recipes/:id/components/:componentId - Remove a component from a recipe
app.delete('/recipes/:id/components/:componentId', authenticateToken, (req, res) => {
  const { id, componentId } = req.params;
  const info = db.prepare('DELETE FROM recipe_components WHERE id = ? AND parent_recipe_id = ?').run(componentId, id);
  if (info.changes === 0) return res.status(404).json({ error: 'Component not found.' });

  const updatedTree = buildRecipeTree(id);
  res.json({
    ...updatedTree,
    total_ingredients: expandIngredients(updatedTree),
    used_in: getUsedInRecipes(id)
  });
});
// ==========================================
// HEALTH CHECK & ADMIN BACKEND INSPECTOR API
// ==========================================

app.get('/api/health', (req, res) => {
  res.json({
    status: 'healthy',
    uptimeSeconds: Math.round(process.uptime()),
    memoryRssMb: Math.round(process.memoryUsage().rss / 1024 / 1024),
    nodeVersion: process.version,
    timestamp: new Date().toISOString()
  });
});

app.get('/api/admin/overview', authenticateToken, (req, res) => {
  const dbOverview = db.getAdminOverviewData();
  res.json({
    system: {
      uptimeSeconds: Math.round(process.uptime()),
      memoryRssMb: Math.round(process.memoryUsage().rss / 1024 / 1024),
      nodeVersion: process.version,
      environment: process.env.NODE_ENV || 'development'
    },
    ...dbOverview,
    logs: apiRequestLogs
  });
});

app.patch('/api/admin/users/:id/role', authenticateToken, (req, res) => {
  const updated = db.toggleUserRole(req.params.id);
  if (!updated) return res.status(404).json({ error: 'User not found.' });
  res.json({ message: `Updated role for ${updated.username} to ${updated.role}` });
});

app.delete('/api/admin/users/:id', authenticateToken, (req, res) => {
  if (Number(req.params.id) === Number(req.user.id)) {
    return res.status(400).json({ error: 'You cannot delete your own currently logged-in account.' });
  }
  const ok = db.deleteUserById(req.params.id);
  if (!ok) return res.status(404).json({ error: 'User not found.' });
  res.json({ message: 'User deleted.' });
});

app.listen(PORT, () => {
  console.log(`Recipe Composition & Management System running at http://localhost:${PORT}`);
});