const fs = require('fs');
const path = require('path');

const rawDbPath = process.env.DB_PATH || path.join(__dirname, '../data/recipes.db');
const dbFile = rawDbPath.endsWith('.json') ? rawDbPath : `${rawDbPath}.json`;
const dbDir = path.dirname(dbFile);

if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

let state = {
  users: [],
  ingredients: [],
  recipes: [],
  recipe_components: [],
  counters: { users: 0, ingredients: 0, recipe_components: 0 }
};

if (fs.existsSync(dbFile)) {
  try {
    state = JSON.parse(fs.readFileSync(dbFile, 'utf-8'));
  } catch (err) {
    console.warn('Initializing fresh database store...');
  }
}

let inTransaction = false;

function save() {
  if (!inTransaction) {
    fs.writeFileSync(dbFile, JSON.stringify(state, null, 2), 'utf-8');
  }
}

const db = {
  pragma() {},
  exec() {},
  transaction(fn) {
    return (...args) => {
      const backup = JSON.parse(JSON.stringify(state));
      inTransaction = true;
      try {
        const result = fn(...args);
        inTransaction = false;
        save();
        return result;
      } catch (err) {
        state = backup;
        inTransaction = false;
        throw err;
      }
    };
  },
  // Direct user helper methods for Email/Password + Google/GitHub OAuth
  findUserByEmailOrUsername(identifier) {
    const clean = String(identifier || '').trim().toLowerCase();
    return state.users.find(
      u =>
        (u.email && u.email.toLowerCase() === clean) ||
        (u.username && u.username.toLowerCase() === clean)
    );
  },
  findUserById(id) {
    return state.users.find(u => u.id === Number(id));
  },
  createUser({ username, email, password_hash, provider = 'email', avatar = '' }) {
    const cleanEmail = String(email || '').trim().toLowerCase();
    const cleanUsername = String(username || cleanEmail.split('@')[0] || 'chef').trim();

    if (cleanEmail && state.users.some(u => u.email && u.email.toLowerCase() === cleanEmail)) {
      throw new Error('An account with this email already exists.');
    }

    const id = ++state.counters.users;
    const newUser = {
      id,
      username: cleanUsername,
      email: cleanEmail || `${cleanUsername.toLowerCase()}@recipegraph.local`,
      password_hash: password_hash || '',
      provider,
      avatar,
      created_at: new Date().toISOString()
    };
    state.users.push(newUser);
    save();
    return newUser;
  },
  upsertOAuthUser({ email, username, provider, avatar }) {
    const cleanEmail = String(email || '').trim().toLowerCase();
    let user = state.users.find(u => u.email && u.email.toLowerCase() === cleanEmail);
    if (user) {
      user.provider = provider || user.provider;
      if (avatar) user.avatar = avatar;
      if (username) user.username = username;
      save();
      return user;
    }
    return this.createUser({
      username: username || cleanEmail.split('@')[0],
      email: cleanEmail,
      password_hash: 'oauth_external_account',
      provider,
      avatar
    });
  },

  // Admin Dashboard Helpers
  getAdminOverviewData() {
    const safeUsers = state.users.map(u => ({
      id: u.id,
      username: u.username,
      email: u.email || `${u.username}@recipegraph.dev`,
      provider: u.provider || 'email',
      role: u.role || (u.username === 'chef_demo' ? 'admin' : 'user'),
      avatar: u.avatar || '',
      created_at: u.created_at,
      recipe_count: state.recipes.filter(r => r.user_id === u.id).length
    }));

    return {
      counts: {
        users: state.users.length,
        recipes: state.recipes.length,
        ingredients: state.ingredients.length,
        recipe_components: state.recipe_components.length
      },
      users: safeUsers,
      recipes: state.recipes,
      ingredients: state.ingredients,
      recipe_components: state.recipe_components
    };
  },
  toggleUserRole(userId) {
    const user = state.users.find(u => u.id === Number(userId));
    if (!user) return null;
    const currentRole = user.role || (user.username === 'chef_demo' ? 'admin' : 'user');
    user.role = currentRole === 'admin' ? 'user' : 'admin';
    save();
    return user;
  },
  deleteUserById(userId) {
    const id = Number(userId);
    const before = state.users.length;
    state.users = state.users.filter(u => u.id !== id);
    if (state.users.length < before) {
      save();
      return true;
    }
    return false;
  },

  prepare(sql) {
    const norm = sql.replace(/\s+/g, ' ').trim();

    return {
      get(...params) {
        if (/SELECT COUNT\(\*\) as count FROM recipes/i.test(norm)) {
          return { count: state.recipes.length };
        }
        if (/FROM ingredients WHERE name = \?/i.test(norm)) {
          const target = String(params[0] || '').toLowerCase();
          return state.ingredients.find(i => i.name.toLowerCase() === target);
        }
        if (/FROM recipes r LEFT JOIN users u/i.test(norm)) {
          const r = state.recipes.find(x => x.id === String(params[0]));
          if (!r) return undefined;
          const u = state.users.find(x => x.id === r.user_id);
          return { ...r, author: u ? u.username : 'System' };
        }
        if (/FROM users WHERE username = \?/i.test(norm)) {
          const target = String(params[0] || '').toLowerCase();
          return state.users.find(
            u =>
              (u.username && u.username.toLowerCase() === target) ||
              (u.email && u.email.toLowerCase() === target)
          );
        }
        if (/FROM recipes WHERE id = \?/i.test(norm)) {
          return state.recipes.find(r => r.id === String(params[0]));
        }
        if (/FROM recipe_components WHERE id = \? AND parent_recipe_id = \?/i.test(norm)) {
          return state.recipe_components.find(
            rc => rc.id === Number(params[0]) && rc.parent_recipe_id === String(params[1])
          );
        }
        return undefined;
      },

      all(...params) {
        if (/SELECT child_recipe_id FROM recipe_components/i.test(norm)) {
          return state.recipe_components
            .filter(rc => rc.parent_recipe_id === String(params[0]) && rc.type === 'recipe')
            .map(rc => ({ child_recipe_id: rc.child_recipe_id }));
        }
        if (/FROM recipe_components rc LEFT JOIN ingredients i/i.test(norm)) {
          return state.recipe_components
            .filter(rc => rc.parent_recipe_id === String(params[0]))
            .map(rc => {
              const ing = state.ingredients.find(i => i.id === rc.ingredient_id);
              return {
                component_id: rc.id,
                type: rc.type,
                quantity: rc.quantity,
                unit: rc.unit,
                ingredient_name: ing ? ing.name : null,
                child_recipe_id: rc.child_recipe_id
              };
            });
        }
        if (/SELECT DISTINCT r\.id, r\.name FROM recipe_components/i.test(norm)) {
          const childId = String(params[0]);
          const parentIds = new Set(
            state.recipe_components
              .filter(rc => rc.type === 'recipe' && rc.child_recipe_id === childId)
              .map(rc => rc.parent_recipe_id)
          );
          return state.recipes
            .filter(r => parentIds.has(r.id))
            .map(r => ({ id: r.id, name: r.name }));
        }
        if (/FROM ingredients ORDER BY name ASC/i.test(norm)) {
          return [...state.ingredients].sort((a, b) => a.name.localeCompare(b.name));
        }
        if (/FROM recipes WHERE name LIKE \?/i.test(norm)) {
          const query = String(params[0] || '').replace(/%/g, '').toLowerCase();
          return state.recipes
            .filter(r => r.name.toLowerCase().includes(query))
            .map(r => ({ id: r.id }));
        }
        if (/FROM recipes ORDER BY created_at/i.test(norm)) {
          return state.recipes.map(r => ({ id: r.id }));
        }
        return [];
      },

      run(...params) {
        if (/INSERT (OR IGNORE )?INTO users/i.test(norm)) {
          const isIgnore = /OR IGNORE/i.test(norm);
          const [username, password_hash] = params;
          const existing = state.users.find(
            u => u.username && u.username.toLowerCase() === String(username).toLowerCase()
          );
          if (existing) {
            if (!existing.email) existing.email = 'demo@recipegraph.dev';
            if (!existing.provider) existing.provider = 'email';
            save();
            if (isIgnore) return { changes: 0, lastInsertRowid: existing.id };
            throw new Error('UNIQUE constraint failed: users.username');
          }
          const id = ++state.counters.users;
          state.users.push({
            id,
            username,
            email: username === 'chef_demo' ? 'demo@recipegraph.dev' : `${username}@recipegraph.dev`,
            password_hash,
            provider: 'email',
            created_at: new Date().toISOString()
          });
          save();
          return { changes: 1, lastInsertRowid: id };
        }

        if (/INSERT OR IGNORE INTO ingredients/i.test(norm)) {
          const name = String(params[0] || '').trim();
          const existing = state.ingredients.find(i => i.name.toLowerCase() === name.toLowerCase());
          if (existing) return { changes: 0, lastInsertRowid: existing.id };
          const id = ++state.counters.ingredients;
          state.ingredients.push({ id, name });
          save();
          return { changes: 1, lastInsertRowid: id };
        }

        if (/INSERT (OR IGNORE )?INTO recipes/i.test(norm)) {
          const isIgnore = /OR IGNORE/i.test(norm);
          const [id, name, servings, user_id] = params;
          const existing = state.recipes.find(r => r.id === String(id));
          if (existing) {
            if (isIgnore) return { changes: 0, lastInsertRowid: existing.id };
            throw new Error('UNIQUE constraint failed: recipes.id');
          }
          state.recipes.push({
            id: String(id),
            name: String(name),
            servings: Number(servings) || 1,
            user_id: user_id || 1,
            created_at: new Date().toISOString()
          });
          save();
          return { changes: 1, lastInsertRowid: id };
        }

        if (/INSERT INTO recipe_components/i.test(norm)) {
          const id = ++state.counters.recipe_components;
          if (params.length === 6) {
            const [parent_recipe_id, type, ingredient_id, child_recipe_id, quantity, unit] = params;
            state.recipe_components.push({
              id,
              parent_recipe_id: String(parent_recipe_id),
              type,
              ingredient_id: ingredient_id ? Number(ingredient_id) : null,
              child_recipe_id: child_recipe_id ? String(child_recipe_id) : null,
              quantity: Number(quantity) || 0,
              unit: unit || ''
            });
          } else if (/VALUES \(\?, 'ingredient'/i.test(norm)) {
            const [parent_recipe_id, ingredient_id, quantity, unit] = params;
            state.recipe_components.push({
              id,
              parent_recipe_id: String(parent_recipe_id),
              type: 'ingredient',
              ingredient_id: Number(ingredient_id),
              child_recipe_id: null,
              quantity: Number(quantity) || 0,
              unit: unit || ''
            });
          } else if (/VALUES \(\?, 'recipe'/i.test(norm)) {
            const [parent_recipe_id, child_recipe_id, quantity, unit] = params;
            state.recipe_components.push({
              id,
              parent_recipe_id: String(parent_recipe_id),
              type: 'recipe',
              ingredient_id: null,
              child_recipe_id: String(child_recipe_id),
              quantity: Number(quantity) || 1,
              unit: unit || 'batch'
            });
          }
          save();
          return { changes: 1, lastInsertRowid: id };
        }

        if (/UPDATE recipes SET name = \?, servings = \? WHERE id = \?/i.test(norm)) {
          const [name, servings, id] = params;
          const r = state.recipes.find(x => x.id === String(id));
          if (!r) return { changes: 0 };
          r.name = name;
          r.servings = Number(servings);
          save();
          return { changes: 1 };
        }

        if (/DELETE FROM recipe_components WHERE parent_recipe_id = \?$/i.test(norm)) {
          const parentId = String(params[0]);
          const before = state.recipe_components.length;
          state.recipe_components = state.recipe_components.filter(rc => rc.parent_recipe_id !== parentId);
          save();
          return { changes: before - state.recipe_components.length };
        }

        if (/DELETE FROM recipes WHERE id = \?/i.test(norm)) {
          const id = String(params[0]);
          const before = state.recipes.length;
          state.recipes = state.recipes.filter(r => r.id !== id);
          const changes = before - state.recipes.length;
          if (changes > 0) {
            state.recipe_components = state.recipe_components.filter(rc => rc.parent_recipe_id !== id);
            save();
          }
          return { changes };
        }

        if (/UPDATE recipe_components SET quantity = \?, unit = \? WHERE id = \?/i.test(norm)) {
          const [quantity, unit, id] = params;
          const comp = state.recipe_components.find(rc => rc.id === Number(id));
          if (!comp) return { changes: 0 };
          comp.quantity = Number(quantity);
          comp.unit = unit;
          save();
          return { changes: 1 };
        }

        if (/DELETE FROM recipe_components WHERE id = \? AND parent_recipe_id = \?/i.test(norm)) {
          const [id, parentId] = params;
          const before = state.recipe_components.length;
          state.recipe_components = state.recipe_components.filter(
            rc => !(rc.id === Number(id) && rc.parent_recipe_id === String(parentId))
          );
          const changes = before - state.recipe_components.length;
          if (changes > 0) save();
          return { changes };
        }

        return { changes: 0 };
      }
    };
  }
};

module.exports = db;