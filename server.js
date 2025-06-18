const { Pool } = require("pg");
const { OpenAI } = require("openai");
const { Anthropic } = require("@anthropic-ai/sdk");
//const { ChatMistralAI } = require("langchain/models/chat/mistral");
const { spawn } = require("child_process");

const express = require("express");
const app = express();
app.use(express.json());

// Setup URLs & AI config
const fs = require("fs");
const config = JSON.parse(fs.readFileSync("models.json", "utf8"));
// Setup URLs
const db = new Pool({ connectionString: process.env.DATABASE_URL || "postgres://user:password@localhost:5432/dbname" });
const GraphQLUrl = process.env.GRAPHQL_URL || "https://your-graphql-api.com/graphql";
const RestApiUrl = process.env.REST_API_URL || "https://your-rest-api.com";
// setup other config
const appPort = process.env.PORT || 3000;
const timeout = process.env.TIMEOUT || 30000; // URL call timeout - 30 seconds

// Error handling middleware
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({ error: 'Internal Server Error' });
});

function getModelInstance(modelName) {
    try {
        const modelConfig = config.models[modelName || config.default_model];
        if (!modelConfig) throw new Error("Model configuration not found");
        if (modelConfig.provider === "OpenAI") return new OpenAI({ apiKey: modelConfig.api_key });
        if (modelConfig.provider === "Anthropic") return new Anthropic({ apiKey: modelConfig.api_key });
        //if (modelConfig.provider === "ChatMistralAI") return new ChatMistralAI({ apiKey: modelConfig.api_key, modelName: modelConfig.model });
        if (modelConfig.provider === "DeepSeek") return modelConfig;
        throw new Error("Unsupported model");
    } catch (error) {
        console.error("Error creating model instance:", error);
        throw error;
    }
}

async function generateQuery(naturalQuery, queryType, modelName) {
    const model = getModelInstance(modelName);
    let schemas = {};
    let schema = Object.entries(schemas)
        .map(([type, content]) => `\n\n=== ${type.toUpperCase()} Schema ===\n\n${content}`)
        .join("");
    const schemaTypes = ["graphql", "openapi", "sql"];

    // Load schemas
    for (const type of schemaTypes) {
        const schemaPath = `schema.${type}`;
        if (fs.existsSync(schemaPath)) {
            if (fs.existsSync(schemaPath)) {
                schemas[type] = fs.readFileSync(schemaPath, "utf8");
            }
        }

        const prompt = `Given these schemas:\n${schema}\n\nConvert this natural language query:\n"${naturalQuery}"`;

        if (model.provider === "DeepSeek") {
            return new Promise((resolve, reject) => {
                const deepSeekProcess = spawn("deepseek-cli", ["--prompt", prompt]);
                let output = "";
                deepSeekProcess.stdout.on("data", (data) => (output += data.toString()));
                deepSeekProcess.stderr.on("data", (data) => console.error("DeepSeek Error:", data.toString()));
                deepSeekProcess.on("close", () => resolve(output.trim()));
            });
        }

        const response = await model.chat.completions.create({
            model: modelName || config.default_model,
            messages: [{ role: "system", content: prompt }],
        });
        return response.choices[0].message.content;
    }
}

async function executeQuery(query, queryType) {
    const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Request timeout')), timeout)
    );

    try {
        return await Promise.race([
            _executeQuery(query, queryType),
            timeoutPromise
        ]);
    } catch (error) {
        throw error;
    }
}

async function _executeQuery(query, queryType) {
    if (queryType === "GraphQL") {
        const { request } = require("graphql-request");
        return await request(GraphQLUrl, query);
    }
    if (queryType === "REST") {
        const axios = require("axios");
        const { method, url, params, body } = JSON.parse(query);
        return await axios({ method, url: `${RestApiUrl}${url}`, params, data: body });
    }
    if (queryType === "SQL") return await db.query(query);
}

// Add after express setup
const validateQuery = (req, res, next) => {
    const { query, queryType, model } = req.body;
    if (!query || !queryType) {
        return res.status(400).json({ error: "Missing required fields" });
    }
    if (!["GraphQL", "REST", "SQL"].includes(queryType)) {
        return res.status(400).json({ error: "Invalid query type" });
    }
    next();
};

app.post("/generate-query", validateQuery, async (req, res) => {
    try {
        const { query, queryType, model } = req.body;
        const generatedQuery = await generateQuery(query, queryType, model);
        res.json(generatedQuery);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post("/execute-query", async (req, res) => {
    try {
        const { query, queryType } = req.body;
        const result = await executeQuery(query, queryType);
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.listen(appPort, () => console.log("Server running on port 3000"));
