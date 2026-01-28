# Natural Language API Backends

Simple gateway implementation extensible example of using AI models for Natural Language to get backend queries results from: GraphQL, REST API, SQL DB

Define the schemas in `schema/schema.graphql`, `schema/schema.openapi`, etc. and the AI models configuration in models.json, then use node server.js and the two endpoints for generation and execution of a query made in plain english to a certain backend type for results.

## Configuration

1.  Copy `models.json` and fill in your API keys for the providers you intend to use.
2.  Ensure you have a database running if using SQL features.
3.  Update the `.env` file with your specific service URLs.
