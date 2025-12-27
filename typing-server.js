const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Serve static files from public directory
app.use(express.static('public'));

// Redirect root to typing game
app.get('/', (req, res) => {
    res.redirect('/typing-game.html');
});

app.listen(PORT, () => {
    console.log(`Typing Game server running at http://localhost:${PORT}`);
    console.log(`Open http://localhost:${PORT}/typing-game.html to play!`);
});
