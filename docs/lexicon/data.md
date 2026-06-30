---
created: 2026-06-03
updated: 2026-06-30
category: lexicon
status: current
doc_kind: node
id: data-glossary
summary: Glossary of data, database, and storage concepts.
tags: [lexicon, data, storage]
---

# Data & Storage

## Database Types

### Relational Database
**Definition:** A database that organizes data into tables with predefined schemas, enforcing relationships through foreign keys and using SQL for queries.
**Usage:** Use for structured data with clear relationships, ACID requirements, and complex queries (joins, aggregations). The default choice for most business applications.
**Related:** SQL (query language), ACID (transaction properties), Schema (table definition), Normalization (reducing redundancy)
**Tags:** data, database, relational

### Document Database
**Definition:** A NoSQL database storing semi-structured data as documents (JSON, BSON), typically with flexible schemas.
**Usage:** Use for content management, catalogs, or any data that doesn't fit neatly into relational tables. Good for hierarchical data and rapid iteration on schema. Distinguish from Relational (rigid schema, joins) — documents are self-contained.
**Related:** NoSQL (category), MongoDB (implementation), Denormalization (embedded documents), Schema-less (flexible structure)
**Tags:** data, database, document

### Key-Value Store
**Definition:** A NoSQL database that stores data as key-value pairs, optimized for simple lookups by primary key.
**Usage:** Use for caching, session storage, or any scenario where data is accessed exclusively by key. The simplest and fastest database model, but limited query capability.
**Related:** Redis (in-memory KV), Cache (common use case), Column Family (key-value variant with columns)
**Tags:** data, database, key-value

### Graph Database
**Definition:** A database that stores data as nodes, edges, and properties, optimized for relationship-heavy queries.
**Usage:** Use for social networks, recommendation engines, fraud detection, or any domain where relationships between entities are the primary query dimension. Distinguish from Relational (joins are expensive for deep relationships).
**Related:** Node (entity), Edge (relationship), Traversal (path query), Cypher/SPARQL (graph query languages)
**Tags:** data, database, graph

### Vector Database
**Definition:** A database optimized for storing and querying high-dimensional vector embeddings, enabling semantic similarity search.
**Usage:** Use for RAG (retrieval-augmented generation), recommendation systems, image/audio similarity search, or any AI embedding workflow. Queries find "closest" vectors by distance (cosine, Euclidean).
**Related:** Embedding (vector representation), Similarity Search (nearest neighbor), RAG (retrieval for LLMs), Index (ANN index for speed)
**Tags:** data, database, vector

### Time-Series Database
**Definition:** A database optimized for timestamped data points, supporting high write throughput and time-range queries.
**Usage:** Use for metrics, monitoring data, IoT sensor data, or any append-heavy chronological data. Optimized for range scans and downsampling.
**Related:** Metric (numeric data point), Downsampling (aggregating over time), Retention (data lifecycle), Prometheus (implementation)
**Tags:** data, database, time-series

### In-Memory Database
**Definition:** A database that primarily stores data in RAM for low latency, with optional persistence to disk.
**Usage:** Use for caching, real-time analytics, leaderboards, or any workload requiring microsecond response times. Distinguish from Disk-based (slower, larger capacity) — trade memory for speed.
**Related:** Cache (subset), Redis (implementation), Volatile (data lost on restart without persistence)
**Tags:** data, database, in-memory

## Data Modeling

### Normalization
**Definition:** The process of organizing data to reduce redundancy by dividing it into related tables and defining relationships between them.
**Usage:** Apply to maintain data integrity and avoid update anomalies. Normal forms (1NF, 2NF, 3NF, BCNF) define increasing levels of normalization. Distinguish from Denormalization (adding redundancy for performance).
**Related:** Denormalization (redundancy for speed), Normal Form (NF level), Schema Design (the process)
**Tags:** data, modeling, normalization

### Denormalization
**Definition:** The intentional addition of redundant data to improve read performance, often by embedding related data in a single table or document.
**Usage:** Use when read performance matters more than write efficiency or storage cost. Common in document databases and read-heavy workloads. Distinguish from Normalization (removing redundancy).
**Related:** Normalization (the opposite), Read Model (denormalized for queries), Materialized View (denormalized database view)
**Tags:** data, modeling, denormalization

### Schema
**Definition:** The formal structure of a database — tables, columns, types, constraints, relationships, indexes — defining what data can be stored and how.
**Usage:** Use to describe the shape of data. In relational databases, schemas are rigid and enforced. In NoSQL, schemas are implicit and flexible.
**Related:** Constraint (schema rule), Migration (schema change), DDL (schema definition language)
**Tags:** data, modeling, schema

### Index
**Definition:** A data structure that speeds up data retrieval at the cost of slower writes and additional storage, typically implemented as B-tree, hash, or inverted index.
**Usage:** Add indexes on columns used in WHERE, JOIN, ORDER BY, and GROUP BY clauses. Too many indexes hurt write performance. Distinguish from Full-Table Scan (no index, reads all rows).
**Related:** B-tree (common index type), Unique Index (enforces uniqueness), Composite Index (multiple columns), Execution Plan (index usage analysis)
**Tags:** data, modeling, index

### Migration
**Definition:** A version-controlled, reversible script that changes the database schema — adding tables, columns, indexes, or transforming data.
**Usage:** Use for all schema changes in production environments. Migrations enable audit trail, rollback, and team coordination. Distinguish from Seed Data (initial data, not schema) and Raw SQL (ad-hoc, not versioned).
**Related:** Seed (initial data), Rollback (reversing migration), Schema Drift (migration vs actual state)
**Tags:** data, modeling, migration

## Querying

### SQL (Structured Query Language)
**Definition:** The standard language for querying and manipulating relational databases, supporting SELECT, INSERT, UPDATE, DELETE, and DDL statements.
**Usage:** The universal language for relational databases. SQL knowledge transfers across most database systems, with dialect variations.
**Related:** DDL (schema definition), DML (data manipulation), Query (SELECT statement), Join (combining tables)
**Tags:** data, query, sql

### Join
**Definition:** A SQL operation that combines rows from two or more tables based on a related column, producing INNER, LEFT, RIGHT, FULL, or CROSS results.
**Usage:** Use to retrieve related data from multiple tables in a single query. Different join types control which unmatched rows are included. Distinguish from Subquery (nested query, not a direct row combination).
**Related:** Foreign Key (the relationship), Inner Join (matched rows only), Left Join (all left + matched right), Subquery (alternative)
**Tags:** data, query, join

### Aggregation
**Definition:** The process of computing a single value from multiple rows — SUM, COUNT, AVG, MIN, MAX, GROUP BY.
**Usage:** Use for summarizing data, generating reports, or computing statistics. GROUP BY defines the grouping dimension. Distinguish from Window Function (aggregation over a window without collapsing rows).
**Related:** GROUP BY (aggregation dimension), Window Function (aggregation without collapse), Having (post-aggregation filter)
**Tags:** data, query, aggregation

### CTE (Common Table Expression)
**Definition:** A named, temporary result set within a SQL query, improving readability and enabling recursion.
**Usage:** Use for breaking complex queries into readable steps, recursive queries (hierarchies), or referencing the same subquery multiple times. Distinguish from Subquery (anonymous, harder to read) and View (persisted, reusable across queries).
**Related:** Subquery (anonymous CTE), Recursive CTE (hierarchy traversal), View (persisted CTE)
**Tags:** data, query, cte

## Caching

### Cache
**Definition:** A temporary, fast storage layer that stores copies of frequently accessed data to reduce latency and backend load.
**Usage:** Use for hot data — frequently read, infrequently written, or expensive to compute. Cache invalidation is one of the hardest problems in computer science. Distinguish from Buffer (write optimization) — Cache is for reads.
**Related:** Cache Hit/Miss (result), Cache Invalidation (stale data), CDN (geographic cache), HTTP Cache (browser/proxy)
**Tags:** data, caching

### Cache Invalidation
**Definition:** The process of removing or updating cached data when the source data changes, ensuring cache consumers see fresh data.
**Usage:** The hardest part of caching. Strategies: TTL (time-based), write-through (update cache on write), change notification (invalidate on event). Distinguish from Cache Eviction (removing old data to free space).
**Related:** TTL (time-to-live), Write-Through (update on write), Cache Stampede (thundering herd on invalidation), Stale Data (what we're avoiding)
**Tags:** data, caching, invalidation

### TTL (Time-to-Live)
**Definition:** A duration after which a cached entry is automatically invalidated, regardless of whether the source data has changed.
**Usage:** Use when real-time accuracy isn't required. Longer TTL improves hit rate but risks stale data. Shorter TTL improves freshness but reduces cache effectiveness.
**Related:** Cache Invalidation (broader), Stale Data (risk of long TTL), Freshness (data recency)
**Tags:** data, caching, ttl

### Write-Through Cache
**Definition:** A caching strategy where data is written to both the cache and the backing store simultaneously on every write.
**Usage:** Use when read-after-write consistency matters. The write is complete only when both cache and store are updated. Distinguish from Write-Behind (write to cache, async to store) and Cache-Aside (cache updates on read miss).
**Related:** Write-Behind (async write-back), Cache-Aside (lazy caching), Write-Around (skip cache on write)
**Tags:** data, caching, write-through

### Cache-Aside
**Definition:** A caching strategy where the application checks the cache first on read, loads from the database on miss, and populates the cache for future reads.
**Usage:** The most common caching pattern for read-heavy workloads. The application manages the cache explicitly. Distinguish from Read-Through (the cache library handles the load and populate).
**Related:** Read-Through (cache-managed), Write-Through (write-side), Lazy Loading (populate on demand)
**Tags:** data, caching, cache-aside

### Cache Stampede
**Definition:** A scenario where many requests simultaneously miss the cache (after invalidation or expiry) and all hit the backend, overwhelming it.
**Usage:** Prevent with: early recalculation (refresh before expiry), probabilistic expiry (random TTL jitter), or mutex on repopulation (only one request reloads). Distinguish from Thundering Herd (same concept, broader term).
**Related:** Thundering Herd (same concept), Hot Key (single key causing stampede), TTL Jitter (prevention technique)
**Tags:** data, caching, stampede

## Consistency

### ACID
**Definition:** A set of database transaction properties: Atomicity (all-or-nothing), Consistency (valid states only), Isolation (concurrent transactions don't interfere), Durability (committed data survives failures).
**Usage:** The gold standard for transaction reliability. Relational databases typically provide ACID; NoSQL databases trade some ACID properties for performance or scalability.
**Related:** Transaction (ACID unit), Isolation Level (how much concurrency is allowed), BASE (the NoSQL trade-off)
**Tags:** data, consistency, acid

### BASE
**Definition:** A consistency model prioritizing availability over strict consistency: Basically Available, Soft state (may change over time), Eventual consistency.
**Usage:** Use for distributed systems where availability and partition tolerance matter more than immediate consistency. The alternative to ACID for scaled-out NoSQL systems.
**Related:** ACID (the alternative), CAP Theorem (the trade-off framework), Eventual Consistency (the BASE guarantee)
**Tags:** data, consistency, base

### CAP Theorem
**Definition:** A distributed systems theorem stating that a system can provide at most two of three guarantees: Consistency (all nodes see the same data), Availability (every request gets a response), Partition Tolerance (system works despite network failures).
**Usage:** Use as a decision framework for distributed system design. In practice, you must handle partitions (P) and choose between CP (consistency) and AP (availability).
**Related:** Consistency (C), Availability (A), Partition Tolerance (P), PACELC (CAP + latency trade-off)
**Tags:** data, consistency, cap-theorem

### Eventual Consistency
**Definition:** A consistency model where updates propagate asynchronously, and replicas will converge to the same state eventually if no new updates arrive.
**Usage:** Use when availability and partition tolerance are more important than immediate consistency. Common in DNS, CDNs, and NoSQL databases. Distinguish from Strong Consistency (all replicas updated immediately).
**Related:** Strong Consistency (immediate), Read-Your-Writes (session consistency), Quorum (consistency tuning), Conflict Resolution (handling diverging replicas)
**Tags:** data, consistency, eventual-consistency

### Strong Consistency
**Definition:** A consistency model where all replicas return the most recent write, appearing as if there's only one copy of the data.
**Usage:** Use when users must see their own writes immediately (banking, inventory). Distinguish from Eventual Consistency (delayed propagation) — Strong Consistency trades availability for correctness.
**Related:** Eventual Consistency (delayed), Linearizability (the formal model), Quorum (W+R > N for strong consistency)
**Tags:** data, consistency, strong-consistency
