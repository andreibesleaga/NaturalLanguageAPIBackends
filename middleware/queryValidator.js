const { buildSchema, parse, validate } = require('graphql');
const SwaggerParser = require('@apidevtools/swagger-parser');
const { Parser } = require('node-sql-parser');
const fs = require('fs').promises;
const path = require('path');

const loadSchema = async (schemaType) => {
  try {
    const schemaPath = path.join(__dirname, '..', 'schema', `schema.${schemaType}`);
    return await fs.readFile(schemaPath, 'utf8');
  } catch (error) {
    throw new Error(`Failed to load ${schemaType} schema: ${error.message}`);
  }
};

const validateGraphQLQuery = async (query) => {
  try {
    const schemaContent = await loadSchema('graphql');
    const schema = buildSchema(schemaContent);
    const document = parse(query);
    const errors = validate(schema, document);
    return errors.length === 0 ? null : errors;
  } catch (error) {
    throw new Error(`GraphQL validation error: ${error.message}`);
  }
};

const validateOpenAPIQuery = async (query) => {
  try {
    let parsedQuery;
    try {
      parsedQuery = typeof query === 'string' ? JSON.parse(query) : query;
    } catch (e) {
      return ['Invalid JSON format for REST query'];
    }

    const schemaContent = await loadSchema('openapi');
    const api = await SwaggerParser.validate(JSON.parse(schemaContent));

    // Minimal validation
    if (!parsedQuery.method || !parsedQuery.url) {
      return ['Missing method or url'];
    }
    return null;
  } catch (error) {
    throw new Error(`OpenAPI validation error: ${error.message}`);
  }
};

const validateSQLQuery = async (query) => {
  try {
    const parser = new Parser();
    const result = parser.parse(query);

    if (!result || !result.ast) {
      return ['Invalid SQL syntax'];
    }

    const schemaContent = await loadSchema('sql');
    const tablesMatch = schemaContent.matchAll(/CREATE TABLE\s+(?:IF NOT EXISTS\s+)?["`]?(\w+)["`]?/gi);
    const tables = [];
    for (const match of tablesMatch) {
      tables.push(match[1]);
    }

    // node-sql-parser AST helper to get tables
    const tableList = result.tableList || [];
    // Wait, parser.parse returns AST. tableList is a property of AST object usually? 
    // No, parser.parse returns { ast: ..., tableList: ..., columnList: ... } for some versions?
    // Or we need to use parser.tableList(query).

    // Let's use parser.tableList separately or check result structure.
    // Documentation says parser.parse returns { ast: ... }. 
    // parser.parse(sql) -> { ast }
    // parser.tableList(sql) -> ["table1", "table2"]

    // If result.tables was undefined, then queryTables was [] -> invalidTables [] -> valid.

    const queryTables = parser.tableList(query).map(t => t.split('::')[2] || t.split('::')[0]);
    // parser.tableList format: "db::schema::table" or just "table" depending on options.

    const invalidTables = queryTables.filter(table => {
      const cleanTable = table.replace(/["`]/g, '');
      return !tables.some(t => t === cleanTable);
    });

    return invalidTables.length ? [`Unknown tables: ${invalidTables.join(', ')}`] : null;
  } catch (error) {
    throw new Error(`SQL validation error: ${error.message}`);
  }
};

const queryValidator = async (req, res, next) => {
  const { query, queryType } = req.body;

  if (!query || !queryType) {
    return res.status(400).json({
      error: 'Missing required fields: query and queryType'
    });
  }

  try {
    let validationErrors = null;

    switch (queryType.toLowerCase()) {
      case 'graphql':
        validationErrors = await validateGraphQLQuery(query);
        break;
      case 'openapi':
        validationErrors = await validateOpenAPIQuery(query);
        break;
      case 'sql':
        validationErrors = await validateSQLQuery(query);
        break;
      default:
        return res.status(400).json({
          error: 'Invalid queryType. Must be one of: graphql, openapi, sql'
        });
    }

    if (validationErrors) {
      return res.status(400).json({
        error: `Invalid ${queryType} query`,
        details: validationErrors
      });
    }

    next();
  } catch (error) {
    return res.status(500).json({
      error: 'Validation error',
      message: error.message
    });
  }
};

module.exports = queryValidator;