const express = require("express");
const fs = require("fs");
const axios = require("axios");
const { request } = require("graphql-request");
const { Pool } = require("pg");
const { OpenAI } = require("openai");
const { Anthropic } = require("@anthropic-ai/sdk");
const { ChatMistralAI } = require("langchain/chat_models/mistralai");
const { spawn } = require("child_process");

const app = express();
app.use(express.json());

// Load AI config
const config = JSON.parse(fs.readFileSync("models.json", "utf8"));
// Setup URLs
const db = new Pool({ connectionString: "postgres://user:password@localhost:5432/dbname" });
const GraphQLUrl = "https://your-graphql-api.com/graphql";
const RestApiUrl = "https://your-rest-api.com";


function getModelInstance(modelName) {
    const modelConfig = config.models[modelName || config.default_model];
    if (modelConfig.provider === "OpenAI") return new OpenAI({ apiKey: modelConfig.api_key });
    if (modelConfig.provider === "Anthropic") return new Anthropic({ apiKey: modelConfig.api_key });
    if (modelConfig.provider === "ChatMistralAI") return new ChatMistralAI({ apiKey: modelConfig.api_key, modelName:model });      
    if (modelConfig.provider === "DeepSeek") return modelConfig;
    throw new Error("Unsupported model");
}

async function generateQuery(naturalQuery, queryType, modelName) {
    const model = getModelInstance(modelName);
    const schemaTypes = ["graphql", "openapi", "sql"];
    let schema = "";
    
    // Load schemas
    for (const type of schemaTypes) {
        const schemaPath = `schema.${type}`;
        if (fs.existsSync(schemaPath)) {
            schema += `\n\n=== ${type.toUpperCase()} Schema ===\n\n` + fs.readFileSync(schemaPath, "utf8");
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

async function executeQuery(query, queryType) {
    if (queryType === "GraphQL") return await request(GraphQLUrl, query);
    if (queryType === "REST") {
        const { method, url, params, body } = JSON.parse(query);
        return await axios({ method, url: `${RestApiUrl}${url}`, params, data: body });
    }
    if (queryType === "SQL") return await db.query(query);
}

app.post("/generate-query", async (req, res) => {
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

app.listen(3000, () => console.log("Server running on port 3000"));
