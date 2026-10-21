const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const db = require('./db');

function seedDatabase() {
  const recipeCount = db.prepare('SELECT COUNT(*) as count FROM recipes').get().count;
  if (recipeCount > 0) {
    console.log(`Database already contains ${recipeCount} recipes. Skipping seed.`);
    return;
  }

  console.log('Seeding dataset from dataset/ingredients.json and dataset/recipes.json...');

  // 1. Create default demo user
  const insertUser = db.prepare('INSERT OR IGNORE INTO users (username, password_hash) VALUES (?, ?)');
  const passwordHash = bcrypt.hashSync('password123', 10);
  const userResult = insertUser.run('chef_demo', passwordHash);
  const userId = userResult.lastInsertRowid || 1;

  // Helpers for ingredients
  const insertIngredient = db.prepare('INSERT OR IGNORE INTO ingredients (name) VALUES (?)');
  const getIngredient = db.prepare('SELECT id FROM ingredients WHERE name = ? COLLATE NOCASE');

  function ensureIngredient(name) {
    const cleanName = String(name || 'Unknown Ingredient').trim();
    insertIngredient.run(cleanName);
    return getIngredient.get(cleanName).id;
  }

  // Map to resolve ingredient_id -> ingredient name & default unit (if ingredients.json uses IDs)
  const ingredientIdMap = new Map();

  // 2. Load dataset/ingredients.json
  const ingredientsPath = path.join(__dirname, '../dataset/ingredients.json');
  if (fs.existsSync(ingredientsPath)) {
    const rawIngData = JSON.parse(fs.readFileSync(ingredientsPath, 'utf-8'));
    const ingList = Array.isArray(rawIngData)
      ? rawIngData
      : (rawIngData.ingredients || Object.values(rawIngData));

    const ingTx = db.transaction(() => {
      for (const item of ingList) {
        if (typeof item === 'string') {
          ensureIngredient(item);
        } else if (item && typeof item === 'object') {
          const name = item.name || item.ingredient || item.title || item.id;
          if (name) {
            ensureIngredient(name);
            if (item.id) {
              ingredientIdMap.set(String(item.id), {
                name: String(name).trim(),
                unit: item.unit || item.default_unit || ''
              });
            }
          }
        }
      }
    });
    ingTx();
    console.log(`Loaded ingredients from ingredients.json.`);
  } else {
    console.warn('Warning: dataset/ingredients.json not found. Ingredients will be inferred from recipes.json.');
  }

  // 3. Load dataset/recipes.json
  const recipesPath = path.join(__dirname, '../dataset/recipes.json');
  if (!fs.existsSync(recipesPath)) {
    console.error('Error: dataset/recipes.json not found! Place recipes.json inside the dataset/ folder.');
    return;
  }

  const rawRecData = JSON.parse(fs.readFileSync(recipesPath, 'utf-8'));
  const recipeList = Array.isArray(rawRecData)
    ? rawRecData
    : (rawRecData.recipes || Object.values(rawRecData));

  const insertRecipe = db.prepare(`
    INSERT OR IGNORE INTO recipes (id, name, servings, user_id)
    VALUES (?, ?, ?, ?)
  `);

  const insertComponent = db.prepare(`
    INSERT INTO recipe_components (parent_recipe_id, type, ingredient_id, child_recipe_id, quantity, unit)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  // Execute Two-Pass Seeding inside a single atomic transaction
  const recipeTx = db.transaction(() => {
    // PASS 1: Insert all parent recipe rows first so foreign keys on child_recipe_id never fail
    for (const r of recipeList) {
      if (!r || !r.id || !r.name) continue;
      insertRecipe.run(
        String(r.id).trim(),
        String(r.name).trim(),
        Number(r.servings) || 1,
        userId
      );
    }

    // PASS 2: Insert all components (ingredients and nested sub-recipes)
    for (const r of recipeList) {
      if (!r || !r.id || !Array.isArray(r.components)) continue;
      const parentId = String(r.id).trim();

      for (const comp of r.components) {
        if (comp.type === 'ingredient') {
          // Resolve name either directly from comp.name or via ingredient_id lookup
          let ingName = comp.name;
          let fallbackUnit = '';
          if (!ingName && (comp.ingredient_id || comp.id)) {
            const mapped = ingredientIdMap.get(String(comp.ingredient_id || comp.id));
            if (mapped) {
              ingName = mapped.name;
              fallbackUnit = mapped.unit;
            } else {
              ingName = String(comp.ingredient_id || comp.id);
            }
          }

          const dbIngId = ensureIngredient(ingName);
          const qty = comp.quantity !== undefined ? Number(comp.quantity) : 1;
          const unit = comp.unit !== undefined ? String(comp.unit) : fallbackUnit;

          insertComponent.run(parentId, 'ingredient', dbIngId, null, qty, unit);
        } else if (comp.type === 'recipe') {
          const childRecipeId = String(comp.recipe_id || comp.id).trim();
          const qty = comp.quantity !== undefined ? Number(comp.quantity) : 1;
          const unit = comp.unit !== undefined ? String(comp.unit) : 'batch';

          // Verify target recipe exists before linking
          const exists = db.prepare('SELECT id FROM recipes WHERE id = ?').get(childRecipeId);
          if (exists) {
            insertComponent.run(parentId, 'recipe', null, childRecipeId, qty, unit);
          } else {
            console.warn(`Skipping missing sub-recipe reference '${childRecipeId}' in '${parentId}'`);
          }
        }
      }
    }
  });

  recipeTx();
  console.log(`Successfully seeded ${recipeList.length} recipes from dataset/recipes.json!`);
}

if (require.main === module) {
  seedDatabase();
}

module.exports = seedDatabase;