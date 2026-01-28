const { Pool } = require("pg");
const { OpenAI } = require("openai");
const { Anthropic } = require("@anthropic-ai/sdk");
// const { ChatMistralAI } = require("@langchain/mistralai");
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const { buildSchema, parse, validate } = require('graphql');
const SwaggerParser = require('@apidevtools/swagger-parser');
const { Parser } = require('node-sql-parser');

class NLQueryEngine {
    constructor(config) {
        this.config = config || {};
        this.models = this.config.models || {};
        this.defaultModel = this.config.default_model;

        // Connections
        this.db = new Pool({ connectionString: process.env.DATABASE_URL });
        this.GraphQLUrl = process.env.GRAPHQL_URL;
        this.RestApiUrl = process.env.REST_API_URL;
        this.timeout = parseInt(process.env.TIMEOUT) || 30000;

        // OpenRouter config (if not strictly in models.json, look in env)
        if (process.env.OPENROUTER_API_KEY) {
            this.models['openrouter-auto'] = {
                provider: 'OpenRouter',
                api_key: process.env.OPENROUTER_API_KEY,
                model: 'deepseek/deepseek-r1-0528:free' // Default fallback or use config
            };
        }
    }

    getModelInstance(modelName) {
        const name = modelName || this.defaultModel;
        // Check for OpenRouter dynamic naming or explicit config
        let modelConfig = this.models[name];

        // Quick fix to default to OpenRouter if configured and no other match, or explicit openrouter check
        if (!modelConfig && process.env.OPENROUTER_API_KEY && (name.includes('openrouter') || !this.models[name])) {
            modelConfig = {
                provider: 'OpenRouter',
                api_key: process.env.OPENROUTER_API_KEY,
                model: name // Pass the requested model name to OpenRouter
            };
        }

        if (!modelConfig) throw new Error(`Model configuration not found for ${name}`);

        if (modelConfig.provider === "OpenAI") return new OpenAI({ apiKey: modelConfig.api_key });
        if (modelConfig.provider === "Anthropic") return new Anthropic({ apiKey: modelConfig.api_key });
        if (modelConfig.provider === "OpenRouter") {
            return new OpenAI({
                baseURL: "https://openrouter.ai/api/v1",
                apiKey: modelConfig.api_key,
                defaultHeaders: {
                    "HTTP-Referer": "https://github.com/andreibesleaga/NaturalLanguageAPIBackends", // Required by OpenRouter
                    "X-Title": "NaturalLanguageAPIBackends"
                }
            });
        }
        if (modelConfig.provider === "DeepSeek") return modelConfig;

        throw new Error("Unsupported model provider");
    }

    async loadSchema(schemaType) {
        try {
            // Allow schema path override or default to root/schema
            const schemaPath = path.join(process.cwd(), 'schema', `schema.${schemaType}`);
            return await fs.promises.readFile(schemaPath, 'utf8');
        } catch (error) {
            // Fallback for library usage? expect schemas in cwd
            console.warn(`Could not load schema.${schemaType}: ${error.message}`);
            return "";
        }
    }

    async generateQuery(naturalQuery, queryType, modelName) {
        const model = this.getModelInstance(modelName);
        let schemas = {};
        const schemaTypes = ["graphql", "openapi", "sql"];

        // Load schemas
        let schemaText = "";
        for (const type of schemaTypes) {
            const content = await this.loadSchema(type);
            if (content) {
                schemas[type] = content;
                schemaText += `\n\n=== ${type.toUpperCase()} Schema ===\n\n${content}`;
            }
        }
        console.log(`DEBUG: Loaded schemas total characters: ${schemaText.length}`);

        const prompt = `Given these schemas:\n${schemaText}\n\nConvert this natural language query:\n"${naturalQuery}"\n\nTarget Query Type: ${queryType}\nOutput ONLY the code/query, no markdown formatting.`;

        // DeepSeek CLI handling
        if (model.provider === "DeepSeek") {
            return new Promise((resolve, reject) => {
                const deepSeekProcess = spawn(model.command || "deepseek-cli", ["--prompt", prompt]);
                let output = "";
                let errorOutput = "";
                deepSeekProcess.stdout.on("data", (data) => (output += data.toString()));
                deepSeekProcess.stderr.on("data", (data) => (errorOutput += data.toString()));
                deepSeekProcess.on("close", (code) => {
                    if (code !== 0) reject(new Error(`DeepSeek failed: ${errorOutput}`));
                    else resolve(output.trim());
                });
                deepSeekProcess.on("error", reject);
            });
        }

        // OpenAI / Anthropic / OpenRouter
        // OpenRouter uses OpenAI SDK calling convention
        if (model instanceof OpenAI || (model.provider === 'OpenRouter')) {
            const completion = await model.chat.completions.create({
                model: (this.models[modelName] && this.models[modelName].model) || modelName || this.config.default_model || "openai/gpt-3.5-turbo",
                messages: [{ role: "system", content: "You are a specialized SQL/GraphQL/API query generator." }, { role: "user", content: prompt }],
            });
            const content = completion.choices[0].message.content.trim();
            console.log("DEBUG: Raw LLM Output:", content);
            // Basic cleanup if the model outputs markdown backticks
            return content.replace(/^```(sql|json|graphql)?/i, '').replace(/```$/, '').trim();
        }

        if (model instanceof Anthropic) {
            const completion = await model.messages.create({
                model: modelName || "claude-3-opus-20240229",
                max_tokens: 1024,
                messages: [{ role: "user", content: prompt }],
            });
            return completion.content[0].text;
        }
    }

    async validateQuery(query, queryType) {
        switch (queryType.toLowerCase()) {
            case 'graphql': return this.validateGraphQL(query);
            case 'openapi':
            case 'rest': return this.validateOpenAPI(query);
            case 'sql': return this.validateSQL(query);
            default: return ["Unknown query type"];
        }
    }

    async validateGraphQL(query) {
        try {
            const schemaContent = await this.loadSchema('graphql');
            if (!schemaContent) return ["Schema not found"];
            const schema = buildSchema(schemaContent);
            const document = parse(query);
            const errors = validate(schema, document);
            return errors.length ? errors.map(e => e.message) : null;
        } catch (e) { return [e.message]; }
    }

    async validateOpenAPI(query) {
        try {
            let parsedQuery;
            try { parsedQuery = typeof query === 'string' ? JSON.parse(query) : query; }
            catch (e) { return ['Invalid JSON format for REST query']; }

            const schemaContent = await this.loadSchema('openapi');
            if (!schemaContent) return ["Schema not found"];
            await SwaggerParser.validate(JSON.parse(schemaContent)); // Throws if invalid schema

            if (!parsedQuery.method || !parsedQuery.url) return ['Missing method or url'];
            return null;
        } catch (e) { return [e.message]; }
    }

    async validateSQL(query) {
        try {
            const parser = new Parser();
            let tableList;
            try {
                // Use postgres dialect which supports different syntax if needed, or stick to generic but handle case better
                tableList = parser.tableList(query, { database: 'postgresql' }).map(t => t.split('::')[2] || t.split('::')[0]);
            } catch (e) { return ['Invalid SQL syntax: ' + e.message]; }

            const schemaContent = await this.loadSchema('sql');
            const tablesMatch = schemaContent.matchAll(/CREATE TABLE\s+(?:IF NOT EXISTS\s+)?["`]?(\w+)["`]?/gi);
            const tables = [];
            for (const match of tablesMatch) tables.push(match[1]);

            // Allow standard checks; case sensitivity might be tricky depending on DB
            const invalidTables = tableList.filter(table => {
                const cleanTable = table.replace(/["`]/g, '');
                return !tables.some(t => t === cleanTable);
            });
            return invalidTables.length ? [`Unknown tables: ${invalidTables.join(', ')}`] : null;
        } catch (e) { return [e.message]; }
    }

    async executeQuery(query, queryType) {
        // Timeout wrapper
        const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), this.timeout));

        const execution = async () => {
            if (queryType === "GraphQL") {
                const { request } = require("graphql-request");
                return await request(this.GraphQLUrl, query);
            }
            if (queryType === "REST") {
                const axios = require("axios");
                const { method, url, params, body } = typeof query === 'string' ? JSON.parse(query) : query;
                return await axios({ method, url: `${this.RestApiUrl}${url}`, params, data: body });
            }
            if (queryType === "SQL") return await this.db.query(query);
        };

        return Promise.race([execution(), timeoutPromise]);
    }

    async processNaturalQuery(naturalQuery, queryType, modelName) {
        // 1. Generate
        const generatedQuery = await this.generateQuery(naturalQuery, queryType, modelName);

        // 2. Validate
        const validationErrors = await this.validateQuery(generatedQuery, queryType);
        if (validationErrors) {
            throw new Error(`Validation failed for generated query: ${JSON.stringify(validationErrors)}\nQuery: ${generatedQuery}`);
        }

        // 3. Execute
        const result = await this.executeQuery(generatedQuery, queryType);
        return {
            generatedQuery,
            result
        };
    }
}

module.exports = NLQueryEngine;
