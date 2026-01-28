const express = require("express");
const NLQueryEngine = require("./lib/NLQueryEngine");
const fs = require("fs");

const app = express();
app.use(express.json());

// Load Config
let config = {};
try {
    config = JSON.parse(fs.readFileSync("models.json", "utf8"));
} catch (e) {
    console.warn("models.json not found, relying on defaults/env");
}

const engine = new NLQueryEngine(config);

// Error handling middleware
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({ error: 'Internal Server Error' });
});

app.post("/generate-query", async (req, res) => {
    try {
        const { query, queryType, model } = req.body;
        if (!query || !queryType) return res.status(400).json({ error: "Missing required fields" });

        const result = await engine.generateQuery(query, queryType, model);
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/execute-query', async (req, res) => {
    try {
        const { query, queryType } = req.body;
        if (!query || !queryType) return res.status(400).json({ error: "Missing required fields" });

        // Explicit verification step before execution
        const errors = await engine.validateQuery(query, queryType);
        if (errors) return res.status(400).json({ error: "Validation failed", details: errors });

        const result = await engine.executeQuery(query, queryType);
        res.json({ result });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/ai-query', async (req, res) => {
    try {
        const { prompt, queryType, model } = req.body;
        if (!prompt || !queryType) return res.status(400).json({ error: "Missing required fields: prompt, queryType" });

        const result = await engine.processNaturalQuery(prompt, queryType, model);
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

const appPort = process.env.PORT || 3000;
app.listen(appPort, () => console.log(`Server running on port ${appPort}`));
