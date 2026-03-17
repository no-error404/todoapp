// these are the dependencies that can be used throughout the code
// including SQLITE database
const express = require("express");
const Database = require("better-sqlite3");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");


//Reads authorisation header and returns (username, password) and NULL if empty
function getBasicAuth(req){
    const header = req.headers["authorization"];
    if(!header || !header.startsWith("Basic")) return null;

//header contains "Basic fcxdDdfeSd3"
    const base64 = header.slice(6);
    const decoded = Buffer.from(base64, "base64").toString("utf8"); //this gives u "username:password"
    const colonIndex = decoded.indexOf(":");
    const username = decoded.slice(0, colonIndex);
    const password = decoded.slice(colonIndex + 1);
    return {username, password};
}

function requireLogin(req, res, next){
    const credentials = getBasicAuth(req);

    if (credentials){
        const hashed = hashPassword(credentials.password);
        const user = db.prepare("SELECT * FROM users WHERE username = ? AND password = ?").get(credentials.username, hashed);
            if (user){
                req.user = user;
                return next();
            }
        }
    res.status(401).set("WWW-Authenticate", 'Basic realm="Todos"').send("Login required");
    }


//Hashing function of passwords
function hashPassword(password){
    return crypto.createHash("sha512").update(password).digest("hex");
}

//Helper function to replace placeholders in the HTML with data from object
function renderTemplate(filename, data = {}){
    const filePath = path.join(__dirname, "views", filename);
    let html = fs.readFileSync(filePath, "utf8");
    console.log("Before replace:", html);
    for (const [key, value] of Object.entries(data)){
        html = html.replaceAll(`{{${key}}}`, value);
    }
    console.log("After replace:", html);
    return html;
}

//This function Renders a template and wraps it in the shared layout
function renderPage(templateFile, data = {}){
    const content = renderTemplate(templateFile, data);
    return renderTemplate("layout.html", {title: data.title || "Todos", content});
    }

// this initialises the express.js server and saves it as a constant and creates a new DB. 
const app = express();
const db = new Database("todos.db");
db.pragma('foreign_keys = ON');

//Create SQLite Tables, one for todos, other for users
db.exec(
    `CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL UNIQUE,
        password TEXT NOT NULL 
        );
       
     CREATE TABLE IF NOT EXISTS todos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        completed INTEGER DEFAULT 0,
        user_id INTEGER NOT NULL REFERENCES users(id)
        )`
    );
        

app.use(express.json());
app.use(express.urlencoded({extended : false})); //parses incoming HTTP requests and parses URL-encoded payloads and gives it to req.body

//signup form before any other pages - GET
app.get("/signup", (req, res) => {res.send(`
    <!DOCTYPE html>
    <html>
    <head><title>Sign Up</title></head>
    <body>
      <h1>Create an account</h1>
      <form method="POST" action="/signup">
        <label>Username: <input type="text" name="username" required></label><br><br>
        <label>Password: <input type="password" name="password" required></label><br><br>
        <input type="submit" value="Sign Up">
      </form>
    </body>
    </html>
    `);
});

//submission of the signup form using using POST
app.post("/signup", (req, res) => {
    const {username, password} = req.body;
    if (!username || !password){
        return res.status(400).send("Username and password are required");
    }

    const existing = db.prepare("SELECT id FROM users WHERE username = ?").get(username);
    if (existing){
        return res.status(400).send("That username is already taken. Please choose another.");
    }
    db.prepare("INSERT INTO users (username, password) VALUES (?, ?)").run(username, hashPassword(password));
   
    res.send("Account created! You can now visit <a href='/todos'>/todos</a> and log in.");
})

app.get("/", (req, res) => {
    res.redirect("/signup");
});

app.get("/logout", (req, res) => {
    res.status(401)
       .set("WWW-Authenticate", 'Basic realm="Todos"')
       .send('Logged out. <a href="/todos">Sign in again</a>');
});

app.use(requireLogin); //use the login function for every route



// GET endpoint to fetch all todo items
app.get("/todos", (req, res) => {
    const todos = db.prepare("SELECT * FROM todos WHERE user_id = ?").all(req.user.id);
    console.log(todos);
    // Build an HTML string for each todo
    const todoItems = todos.map(todo => `
        <div class="todo-item">
            <span class="${todo.completed ? 'completed' : ''}">${todo.title}</span>
            <a href="/todos/${todo.id}">View</a>
        </div>
    `).join('');

    res.send(renderPage('todos.html', {
        title: 'All Todos',
        todoItems
    }));
});

// GET endpoint to show a blank form. This together with the next /POST is the create a todo
app.get("/todos/new", (req, res) => {
    res.send(renderPage('todo-form.html', {
        title: 'New Todo',
        formTitle: 'Create a new todo',
        formAction: '/todos',
        currentTitle: '',   // blank for a new todo
        checkedAttr: '',    // unchecked by default
        submitLabel: 'Create'
    }));
});

//GET endpoint to get a todo by specific id
app.get("/todos/:id", (req, res) => {
    const id = parseInt(req.params.id);
    const todo = db.prepare("SELECT * FROM todos WHERE id = ? AND user_id = ?").get(id, req.user.id);

    if (!todo) return res.status(404).send('Todo not found');

    res.send(renderPage('todo-detail.html', {
        title: todo.title,
        todoTitle: todo.title,
        id: todo.id,
        completedClass: todo.completed ? 'completed' : '',
        status: todo.completed ? 'Completed ✅' : 'In progress'
    }));
});

//GET /todos/:id/edit + POST /todos/id: (update todo)
app.get("/todos/:id/edit", (req, res) => {
    const id = parseInt(req.params.id);
    const todo = db.prepare("SELECT * FROM todos WHERE id = ? AND user_id = ?").get(id, req.user.id);

    if (!todo) return res.status(404).send('Todo not found');

    res.send(renderPage('todo-form.html', {
        title: 'Edit Todo',
        formTitle: 'Edit todo',
        formAction: `/todos/${todo.id}`,
        currentTitle: todo.title,                        // pre-fill the title field
        checkedAttr: todo.completed ? 'checked' : '',   // pre-check if completed
        submitLabel: 'Save changes'
    }));
});

//POST endpoint for submitting the form and redirecting to /todos
app.post("/todos", (req, res) => {
    const { title, completed } = req.body;
    if (!title) return res.status(400).send('Title is required');

    db.prepare("INSERT INTO todos (title, completed, user_id) VALUES (?, ?, ?)")
      .run(title, completed ? 1 : 0, req.user.id);

    res.redirect('/todos');
});


//POST (update)
app.post("/todos/:id", (req, res) => {
    const id = parseInt(req.params.id);
    const { title, completed } = req.body;
    if (!title) return res.status(400).send('Title is required');

    const todo = db.prepare("SELECT * FROM todos WHERE id = ? AND user_id = ?").get(id, req.user.id);
    if (!todo) return res.status(404).send('Todo not found');

    db.prepare("UPDATE todos SET title = ?, completed = ? WHERE id = ?")
      .run(title, completed ? 1 : 0, id);

    res.redirect(`/todos/${id}`);
});

// DELETE endpoint to delete an existing todo item by its ID
app.post("/todos/:id/delete", (req, res) => {
    const id = parseInt(req.params.id);
    const todo = db.prepare("SELECT * FROM todos WHERE id = ? AND user_id = ?").get(id, req.user.id);
    if (!todo) return res.status(404).send('Todo not found');

    db.prepare("DELETE FROM todos WHERE id = ?").run(id);
    res.redirect('/todos');
});

app.listen(3000, () => {
    console.log("Server is running on port 3000");
}); 