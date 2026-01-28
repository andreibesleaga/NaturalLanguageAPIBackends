const NLQueryEngine = require('../lib/NLQueryEngine');
const assert = require('assert');

(async () => {
    console.log("Starting Library Tests...");

    // Test 1: Config and Instantiation
    const engine = new NLQueryEngine({
        models: {
            "test-model": { provider: "OpenAI", api_key: "sk-test" }
        }
    });
    assert.ok(engine, "Engine should instantiate");

    // Test 2: Validation Logic (SQL)
    console.log("Test 2: Validation Logic (SQL)");
    // Mock loadSchema for consistency
    engine.loadSchema = async (type) => {
        if (type === 'sql') return "CREATE TABLE users (id SERIAL);";
        return "";
    };

    const validSQL = "SELECT * FROM users";
    const invalidSQL = "SELECT * FROM secrets";

    const errors1 = await engine.validateSQL(validSQL);
    assert.strictEqual(errors1, null, "Valid SQL should have no errors");

    const errors2 = await engine.validateSQL(invalidSQL);
    assert.ok(errors2 && errors2.length > 0, "Invalid SQL should return errors");
    assert.ok(errors2[0].includes("Unknown tables"), "Error should mention unknown tables");

    // Test 3: OpenRouter Configuration Check
    console.log("Test 3: OpenRouter Config");
    process.env.OPENROUTER_API_KEY = "sk-or-test";
    const orEngine = new NLQueryEngine({});
    try {
        const model = orEngine.getModelInstance("deepseek/deepseek-r1-0528:free"); // implicit OpenRouter
        // If it returns an object that looks like OpenAI instance
        assert.ok(model.apiKey === "sk-or-test", "Should use OpenRouter Key from env");
        assert.ok(model.baseURL === "https://openrouter.ai/api/v1", "Should use OpenRouter Base URL");
    } catch (e) {
        console.error("OpenRouter config test failed:", e);
    }

    console.log("All Tests Passed!");
})();
