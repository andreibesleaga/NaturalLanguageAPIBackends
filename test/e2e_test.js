const assert = require('assert');
const NLQueryEngine = require('../lib/NLQueryEngine');
require('dotenv').config();

const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY;

(async () => {
    if (!OPENROUTER_KEY) {
        console.log("⚠️ SKIPPING E2E TESTS: No OPENROUTER_API_KEY found in .env");
        process.exit(0);
    }

    console.log("🚀 Starting End-to-End Tests with OpenRouter...");

    // Instantiate Engine
    const engine = new NLQueryEngine();

    // Helper to print step results
    const logResult = (name, result, expectedType) => {
        console.log(`\n--- Test: ${name} ---`);
        console.log("Result:", result);
        if (expectedType && typeof result !== expectedType && !result.generatedQuery) {
            throw new Error(`Expected ${expectedType} but got ${typeof result}`);
        }
    };

    const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

    try {
        // --- TEST 1: SQL Generation & Validation ---
        // We expect it to generate a valid SQL query based on schema.sql (users table)
        // Query: "Find all users with email gmail.com"
        console.log("\n🧪 Test 1: Generate SQL Query");
        const sqlPrompt = "Show me all users with an email ending in gmail.com";
        console.log("SQL Prompt:", sqlPrompt);

        const sqlQuery = await engine.generateQuery(sqlPrompt, "SQL", "deepseek/deepseek-r1-0528:free");
        console.log("Generated SQL:", sqlQuery);

        assert.ok(sqlQuery.toLowerCase().includes("select"), "Should act like a SELECT statement");
        assert.ok(sqlQuery.toLowerCase().includes("users"), "Should reference 'users' table");

        console.log("Validating SQL...");
        const sqlErrors = await engine.validateSQL(sqlQuery);
        assert.strictEqual(sqlErrors, null, "Generated SQL should be valid against schema");
        console.log("✅ SQL Generation & Validation Passed");
        await sleep(3000);


        // --- TEST 2: REST/OpenAPI Generation ---
        // Query: "Get user with ID 123"
        console.log("\n🧪 Test 2: Generate REST Query");
        const apiPrompt = "Get the user details for user id 123";
        console.log("API Prompt:", apiPrompt);

        const apiQuery = await engine.generateQuery(apiPrompt, "REST", "deepseek/deepseek-r1-0528:free");
        console.log("Generated REST:", apiQuery);
        // Expect JSON string: { "method": "GET", "url": "/user/123" }
        // Note: LLM might return Markdown code block, we need to handle that in real app or prompt strictly.
        // Our prompt says "Output ONLY the code/query, no markdown formatting."

        const validMethods = ["GET", "POST", "PUT", "DELETE"];
        let apiJson;
        try {
            apiJson = JSON.parse(apiQuery);
        } catch (e) {
            // Check if output is a simple "GET /url" string
            const parts = apiQuery.trim().split(/\s+/);
            if (parts.length >= 2 && validMethods.includes(parts[0].toUpperCase())) {
                apiJson = { method: parts[0].toUpperCase(), url: parts[1] };
            } else {
                // Try stripping markdown if present (cleanup for robustness test)
                const clean = apiQuery.replace(/```json/g, '').replace(/```/g, '').trim();
                try { apiJson = JSON.parse(clean); } catch (e2) { apiJson = null; }
            }
        }

        if (!apiJson) {
            console.error("Failed to parse REST output:", apiQuery);
        }

        assert.ok(apiJson.method, "Should have method");
        assert.ok(apiJson.url, "Should have url");
        assert.ok(apiJson.url.includes("user"), "Should hit user endpoint");

        console.log("Validating REST...");
        const apiErrors = await engine.validateOpenAPI(apiJson);
        assert.strictEqual(apiErrors, null, "Generated REST query should be valid against OpenAPI schema");
        console.log("✅ REST Generation & Validation Passed");
        await sleep(3000);


        // --- TEST 2.5: GraphQL Generation ---
        console.log("\n🧪 Test 2.5: Generate GraphQL Query");
        const gqlPrompt = "Get user name for id 10";
        const gqlQuery = await engine.generateQuery(gqlPrompt, "GraphQL", "deepseek/deepseek-r1-0528:free");
        console.log("Generated GraphQL:", gqlQuery);

        // Basic check
        assert.ok(gqlQuery.includes("getUser"), "Should use getUser query");
        assert.ok(gqlQuery.includes("name"), "Should request name field");

        console.log("Validating GraphQL...");
        const gqlErrors = await engine.validateGraphQL(gqlQuery);
        assert.strictEqual(gqlErrors, null, "Generated GraphQL should be valid");
        console.log("✅ GraphQL Generation & Validation Passed");
        await sleep(3000);


        // --- TEST 3: Full AI Query (End-to-End attempt) ---
        // Note: Execution step requires actual running DB/API. We will mock execution ONLY 
        // to verify the pipeline flow, or skip execution if DB not present.
        // But the user asked for "endpoints endtoend".
        // If DB is not running, execution will fail.

        console.log("\n🧪 Test 3: /ai-query Pipeline (Flow Check)");

        // Mocking executeQuery for this test to avoid needing a real Postgres/GraphQL server running
        // We only want to test the Engine's ability to orchestrate.
        engine.executeQuery = async (q, t) => {
            console.log(`[Mock Execution] Type: ${t}, Query: ${q}`);
            return { mockData: "Success" };
        };

        const pipelinePrompt = "Find user with email test@test.com";
        const result = await engine.processNaturalQuery(pipelinePrompt, "SQL", "deepseek/deepseek-r1-0528:free");
        assert.ok(result.generatedQuery, "Should have generated query");
        assert.ok(result.result, "Should have result");
        assert.deepStrictEqual(result.result, { mockData: "Success" });

        console.log("✅ Pipeline Flow Passed");

    } catch (error) {
        console.error("\n❌ TEST FAILED:", error);
        process.exit(1);
    }
})();
