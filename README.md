# Recipe Composition & Management System
---

## 1. Overview & Features Implemented
This application is a full-stack **Recipe Composition & Management System** centered around **recursive recipe reuse**. A recipe can contain raw ingredients as well as previously created recipes nested to an arbitrary depth.

### Core Features
- **Arbitrary-Depth Recursive Composition:** Recipes can embed other recipes (`Lasagna -> Bolognese Sauce -> Tomato Sauce`) with no hardcoded nesting limit.
- **Interactive Recipe Explorer UI:** Expand/collapse individual or all nested sub-recipes, visually distinguish raw ingredients from sub-recipes, and click any sub-recipe to jump directly to its definition.
- **Recursive Ingredient Expansion:** Traverses the entire dependency tree of a dish and aggregates raw ingredients by `(name, unit)` to display a consolidated shopping/prep list.
- **Circular Dependency Detection (DFS):** Prevents direct (`A -> A`) and indirect (`A -> B -> C -> A`) cycles whenever creating or updating recipes or components, returning the exact cycle path in the error message.
- **Full CRUD & Component Management:** Create, edit, and delete recipes, manage individual components, and scale sub-recipe batch multipliers.
- **JWT Authentication:** Register/Login flow protecting recipe mutation endpoints.

### Bonus Features Implemented
- **Reverse Dependency Tracking ("Used In"):** Displays all parent recipes that depend on the currently viewed recipe and prevents breaking deletions.
- **Live Recipe Search:** Instant filtering of recipes by name.

---

## 2. Technology Stack
- **Backend:** Node.js, Express.js
- **Database:** SQLite (`better-sqlite3` with WAL mode and foreign key enforcement)
- **Authentication:** JSON Web Tokens (`jsonwebtoken`) + `bcryptjs`
- **Frontend:** Vanilla HTML5, CSS3, JavaScript (ES6+)
- **Containerization:** Docker & Docker Compose

---

## 3. Project Structure
```text
recipe-management-system/
├── .env.example
├── Dockerfile
├── docker-compose.yml
├── package.json
├── README.md
├── src/
│   ├── db.js          # SQLite connection & relational schema initialization
│   ├── seed.js        # Initial dataset seeder (Tomato Sauce, Lasagna, Pizza, etc.)
│   └── server.js      # Express REST API, recursive algorithms, DFS cycle detection
└── public/
    ├── index.html     # Main SPA layout
    ├── style.css      # Styling for tree indentation, badges, and modal
    └── app.js         # Frontend state, recursive DOM renderer, API client