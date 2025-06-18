const { buildSchema, parse, validate } = require('graphql');
const SwaggerParser = require('@apidevtools/swagger-parser');
const { Parser } = require('node-sql-parser');
const fs = require('fs').promises;
const path = require('path');

const loadSchema = async (schemaType) => {
  try {
    const schemaPath = path.join(__dirname, '..', `schema.${schemaType}`);
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
    const schemaContent = await loadSchema('openapi');
    const api = await SwaggerParser.validate(JSON.parse(schemaContent));
    const endpoint = query.path;
    const method = query.method?.toLowerCase();
    
    if (!api.paths[endpoint] || !api.paths[endpoint][method]) {
      return ['Invalid endpoint or method'];
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
    
    if (!result) {
      return ['Invalid SQL syntax'];
    }
    
    const schemaContent = await loadSchema('sql');
    // Basic table existence check
    const tables = schemaContent.match(/CREATE TABLE (\w+)/g) || [];
    const queryTables = result.tables || [];
    
    const invalidTables = queryTables.filter(table => 
      !tables.some(t => t.includes(table))
    );
    
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